/**
 * Canvas 渲染层。**只读世界状态，不改**——所有逻辑都在 core/。
 *
 * 换引擎时只需要重写这个文件，core/ 一行不动。
 * 这是 xianxia-roguelike 的教训反过来用：它的逻辑层零引擎依赖，
 * 所以能搬；耦合全压在编排层。这里从一开始就把那条线画清楚。
 */
import type {
  ActionState,
  DamageEvent,
  Entity,
  Profession,
  Projectile,
  Telegraph,
} from '../core/types';
import {
  EXECUTE_THRESHOLD,
  HEAVY_FULL_CHARGE_FRAMES,
  isActionAirborne,
  resolveAction,
  resolveSkillCost,
} from '../core/actions';
import { ENEMY_PROFILES } from '../core/enemies';
import type { StageTheme } from '../core/level';
import type { Run } from '../core/run';
import { doorPosition } from '../core/run';
import { STAGES } from '../core/stages';
import type { UpgradeTrackId } from '../core/upgrades';
import type { EquipmentId, EquipmentSlot, WeaponId } from '../core/equipment';
import {
  WEAPONS,
  equipmentDescription,
  equipmentLabel,
  equipmentSlotOf,
} from '../core/equipment';
import { MAX_UPGRADE_LEVEL, UPGRADE_TRACK_IDS, UPGRADE_TRACKS } from '../core/upgrades';
import {
  BUILDING_PLANS,
  BUILDING_UNLOCKS,
  canAffordResources,
  hasBuilding,
  TONIC_MATERIAL_COST,
  unlockedBuildings,
} from '../core/economy';
import type { BuildingId } from '../core/economy';
import type { World } from '../core/world';
import type { BuildingArt, BuildingArtState } from './building-art';
import { Minimap } from './minimap';
import type { EquipmentIcons } from './equipment-icons';
import type { SpriteSheet } from './sprites';

/** 跳跃的视觉离地高度峰值（像素）。纯渲染表现，逻辑层不知道"高度"这个概念。 */
const JUMP_PEAK_HEIGHT = 44;

const PROFESSION_CARDS: Record<
  Profession,
  { label: string; theme: string; detail: string; color: string; key: string }
> = {
  heavy: {
    label: '重击',
    theme: '蓄力 · 抗压',
    detail: '按住攻击蓄力；满蓄力伤害与击退更高，全程超级护甲。',
    color: '#ff9a5c',
    key: '1',
  },
  swift: {
    label: '疾锋',
    theme: '连段 · 位移',
    detail: '三段普攻；冲刺更频繁，但每次无敌窗口更短。',
    color: '#7fe8ff',
    key: '2',
  },
  arcane: {
    label: '术法',
    theme: '范围 · 站位',
    detail: '中距离范围普攻；技能消耗更低，处决距离更远。',
    color: '#b79cff',
    key: '3',
  },
};

/**
 * 跳跃/跳劈期间角色离地多高，供 drawEntity 抬高角色、缩小影子用。
 *
 * 简化成一条纯函数曲线，不是真的物理模拟：jump 用抛物线 4t(1-t) 在
 * 动作正中间到达峰值，起跳和落地都在地面（t=0 和 t=1 时为 0）。
 * 这条高度曲线和 core/actions.ts 里 jump.motion 的水平位移曲线**故意用
 * 同一个 4t(1-t) 节奏**——第一版两条曲线不同步：水平位移在 17 帧就
 * 提前归零，高度却要播到 34 帧才落地，下落的后半段只有高度往下掉、
 * 人不再横向移动，视觉上像是"到最高点后垂直坠落"，没有落地弧度。
 * 峰值对齐在同一帧（跳跃最高点）之后，上升和下降才是对称的一条弧线。
 * jump.airborne 判定区间是独立的第三套数据，语义不同（布尔命中豁免，
 * 不是位置曲线），不需要和这两条对齐。
 * airSlash 继承跳跃末段的高度，随下砸动作线性归零。
 */
function jumpHeight(
  action: ActionState,
  frame: number,
  profession?: Profession,
  weapon?: WeaponId | null,
): number {
  if (action === 'jump') {
    const t = Math.min(1, frame / resolveAction('jump', profession, weapon).frames);
    return JUMP_PEAK_HEIGHT * 4 * t * (1 - t);
  }
  if (action === 'airSlash') {
    const total = resolveAction('airSlash', profession, weapon).airborne?.to ?? 16;
    const t = Math.min(1, frame / total);
    return JUMP_PEAK_HEIGHT * 0.55 * (1 - t);
  }
  return 0;
}

/**
 * 走动时身体的上下起伏。玩家有真的走路帧（腿部摆动），但没有配套的
 * 重心起伏；敌人的正式走路帧也需要同一层落脚反馈。`move` 一圈循环里
 * 起伏两次（每一步落地各
 * 一次），用 `|sin|` 而不是 `sin` 是因为要的是"落地–抬起–落地"的
 * 弹跳节奏，纯 sin 会在半圈时经过负值，变成"陷进地里"。
 */
function walkBob(
  action: ActionState,
  frame: number,
  amplitude: number,
  profession?: Profession,
  weapon?: WeaponId | null,
): number {
  if (action !== 'move') return 0;
  const t = frame / resolveAction('move', profession, weapon).frames;
  return Math.abs(Math.sin(t * Math.PI * 2)) * amplitude;
}

/** 走动一圈里两次"脚落地"对应的动作帧，踩灰尘特效的触发点用 */
function isFootfallFrame(
  frame: number,
  profession?: Profession,
  weapon?: WeaponId | null,
): boolean {
  const half = resolveAction('move', profession, weapon).frames / 2;
  return frame === 0 || Math.abs(frame - half) < 1;
}

/** 三选一卡片对应的按键，画在卡片上，也是 main.ts 里真实监听的键 */
const CHOICE_KEYS: Record<UpgradeTrackId, string> = { offense: '1', arcane: '2', guardian: '3' };
/** 三条路线各自的强调色，卡片和进度条都用它，玩家一眼能把颜色和路线对上 */
const TRACK_COLOR: Record<UpgradeTrackId, string> = {
  offense: '#e2705c',
  arcane: '#6fb6f0',
  guardian: '#63d0a8',
};

const PROFESSION_LABEL: Record<Profession, string> = {
  heavy: '重击',
  swift: '疾锋',
  arcane: '术法',
};

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  crit: boolean;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
  max: number;
  color: string;
}

/** 屏幕中央的横幅提示，只给首领阶段切换这种「整场规则变了」的大事件用。 */
interface Banner {
  text: string;
  life: number;
  max: number;
}

/**
 * 同屏飘字与特效环的上限。
 *
 * 正常游玩时每帧都会 draw 一次，life 递减，数量自然收敛。
 * 但逻辑推进和渲染是两条线：调试的 fastForward 一口气推几千帧却不画一帧，
 * 后台标签页里 rAF 停摆时也一样——事件照进，队列只增不减。
 * 封个顶，超出就丢最老的，免得恢复渲染那一瞬间糊满整个屏幕。
 */
/** 地面元素的纵深压扁系数。影子、落点圈、预警共用同一个值才像在同一个平面上。 */
const GROUND_SQUASH = 0.42;

const MAX_FLOATS = 48;
const MAX_RINGS = 12;

/**
 * 与关卡无关的通用色。天空、地面、参考线三组由 StageTheme 提供——
 * 换一套配色整关观感就变了，这是「每关不一样」里性价比最高的一档。
 */
const PALETTE = {
  shadow: 'rgba(0,0,0,0.34)',
  playerTint: '#8fd4c8',
  enemyTint: '#d99a7a',
  hpBack: 'rgba(0,0,0,0.55)',
  hpPlayer: '#63d0a8',
  hpEnemy: '#e2705c',
  energy: '#6fb6f0',
  energyFull: '#ffd479',
  telegraph: '#ff7043',
};

/**
 * 五种敌人的占位配色与体型。
 *
 * **这不是美术方案**——正式美术按 ROADMAP 末尾的规格另行产出。
 * 这里只解决一件事：在动作表就位之前，让五种敌人**靠轮廓就能区分**。
 * 那条规格要求「96px 下靠剪影认出是盾兵还是远程，不能靠颜色区分」，
 * 所以占位件也按这个标准做：体型、宽高比、头部标记各不相同，
 * 去掉颜色也还认得出来。
 */
const ENEMY_LOOK: Record<string, { color: string; w: number; h: number }> = {
  grunt: { color: '#d99a7a', w: 24, h: 52 },
  shield: { color: '#7f9bb5', w: 32, h: 50 },
  ranged: { color: '#8fbf7a', w: 18, h: 56 },
  charger: { color: '#d7b45a', w: 26, h: 46 },
  elite: { color: '#b57ab5', w: 36, h: 66 },
  // 阶段一深红，阶段二切换成更亮的橙红——颜色本身就是「打法变了」的信号，
  // 不用去读血条百分比也能一眼分辨现在是哪个阶段
  boss: { color: '#8f2f3a', w: 52, h: 92 },
};

/**
 * 正式动作表的显示倍率与头顶占位。源表统一按 96px / baseline=90 打包，
 * 这里仅按兵种整体缩放一次来恢复设计中的体型层级，绝不逐帧改倍率。
 */
const ENEMY_SPRITE_METRICS: Record<string, { scale: number; topOffset: number }> = {
  grunt: { scale: 0.85, topOffset: 74 },
  shield: { scale: 0.85, topOffset: 78 },
  ranged: { scale: 0.9, topOffset: 82 },
  charger: { scale: 1, topOffset: 67 },
  elite: { scale: 1.15, topOffset: 102 },
  boss: { scale: 1.35, topOffset: 126 },
};

/**
 * 打包器把玩家和敌人的脚底都注册在单格 y=90，渲染时也以这一点贴地。
 * 玩家和敌人共用同一个常量：两张表是同一个 build_ai_action_sheet.py
 * 用同一组 `--cell 96 --baseline 90` 参数打出来的，各自再写一份数字
 * 只会在其中一边改参数时悄悄错位。
 */
const SPRITE_BASELINE = 90;

/** 首领阶段二的强调色，替换 ENEMY_LOOK.boss 的默认色 */
const BOSS_PHASE_TWO_COLOR = '#e2543a';

/**
 * 近战招式的挥砍弧光样式。角色是占位方块，没有真的挥刀动画——这道弧光
 * 是唯一能让"刀刃扫过"这件事在画面上读得出来的手段，也是让 slash/slash2/
 * airSlash 三招看起来「不一样」的唯一办法（它们目前共用同一张 idle 占位
 * 图，动作本身完全无法区分）。角度用 canvas 弧度制，0 指向角色朝向的
 * 前方，数值越大越往下转（画布 y 轴向下）。
 * 只覆盖没有专属冲击特效的招式——技能/处决已经各自有 onSkillCasts/
 * onExecutes 的环形特效，不用再叠一层。
 */
const SWING_STYLE: Partial<Record<ActionState, { color: string; baseAngle: number; arcLen: number; width: number }>> = {
  // 第一段：由上往下的纵劈，弧光从头顶前方扫到胸口前方
  slash: { color: '#eef2f5', baseAngle: -0.35, arcLen: 1.5, width: 4 },
  // 第二段：横扫收尾，弧光更宽更亮，读出来比第一段更有分量
  slash2: { color: '#ffd479', baseAngle: 0.05, arcLen: 2.6, width: 6 },
  // 疾锋第三段用冷色反向收束，哪怕暂时复用 slash2 帧也能从弧光读出第三击。
  slash3: { color: '#7fe8ff', baseAngle: -0.1, arcLen: 2.2, width: 5 },
  // 重击释放复用现有挥砍帧，但用更粗、更暖的弧光体现重量；满蓄力再放大一级。
  heavy: { color: '#ffb45e', baseAngle: -0.55, arcLen: 2.1, width: 8 },
  heavyCharged: { color: '#ff6b45', baseAngle: -0.7, arcLen: 2.5, width: 12 },
  // 跳劈：陡直向下的下砸，弧光整体压低，和"从天而降"的动作意图对上
  airSlash: { color: '#7fe8ff', baseAngle: 1.0, arcLen: 1.3, width: 5 },
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private floats: FloatText[] = [];
  private rings: Ring[] = [];
  private banner: Banner | null = null;
  /** 命中时的屏幕震动剩余帧 */
  private shake = 0;
  /** 渲染帧计数，只用于纯表现层的呼吸动画，不参与任何逻辑 */
  private clock = 0;
  private minimap = new Minimap();
  /** 上一帧是否处于腾空状态，按实体 id 记——落地那一帧靠它和当前状态一比较才测得出来 */
  private wasAirborne = new Map<number, boolean>();
  /**
   * 上一次画到的 move 动作帧号，按实体 id 记。踩点特效要靠"帧号变化到
   * 落地点"而不是"当前帧号等于落地点"来触发——后者在显示帧率高于
   * 逻辑帧率时会连续好几次渲染都读到同一个逻辑帧，同一步会被踩好几次灰。
   */
  private lastMoveFrame = new Map<number, number>();
  private drawableEntities: Entity[] = [];
  private touchMode = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private sheets: Map<string, SpriteSheet>,
    private equipmentIcons?: EquipmentIcons,
    private buildingArt?: BuildingArt,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('拿不到 2d context');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  setTouchMode(enabled: boolean): void {
    this.touchMode = enabled;
  }

  get isTouchMode(): boolean {
    return this.touchMode;
  }

  onEvents(damage: DamageEvent[]): void {
    for (const d of damage) {
      // 飘字颜色承担信息量：处决、背刺、被格挡各自不同，
      // 玩家不用看数字就知道这一下打对了没有。
      let color = '#ffffff';
      let text = String(d.damage);
      if (d.execute) {
        color = '#ff9f68';
        text = '处决';
      } else if (d.backstab) {
        color = '#ffd479';
        text = `${d.damage} 背刺`;
      } else if (d.guarded) {
        color = '#9db4c8';
        text = `${d.damage} 格挡`;
      }
      // 完美取消命中：加后缀 + 专属强调色，不覆盖背刺/格挡已有的信息——
      // 玩家要能同时看出"打在哪"和"时机对不对"。处决不会叠加这个标记
      // （处决走的是必杀逻辑，不经过完美取消判定），不用担心冲突。
      if (d.perfectCancel) {
        color = '#7fe8ff';
        text = `${text}·完美`;
      }
      this.floats.push({
        x: d.at.x,
        y: d.at.y,
        text,
        life: 42,
        crit: d.killed || !!d.execute || !!d.perfectCancel,
        color,
      });
      // 击杀震得更狠一点，把"斩杀"和"打中"区分开
      this.shake = Math.max(this.shake, d.killed ? 9 : 5);
    }
    if (this.floats.length > MAX_FLOATS) {
      this.floats.splice(0, this.floats.length - MAX_FLOATS);
    }
  }

  onExecutes(list: { at: { x: number; y: number }; healed: number }[]): void {
    for (const e of list) {
      this.rings.push({ x: e.at.x, y: e.at.y, radius: 70, life: 24, max: 24, color: '#ff9f68' });
      this.floats.push({
        x: e.at.x,
        y: e.at.y - 18,
        text: `+${e.healed}`,
        life: 40,
        crit: false,
        color: '#63d0a8',
      });
    }
    this.trim();
  }

  onSkillCasts(
    list: { at: { x: number; y: number }; radius: number; power: 'light' | 'heavy' }[],
  ): void {
    for (const s of list) {
      const light = s.power === 'light';
      const life = light ? 12 : 20;
      this.rings.push({
        x: s.at.x,
        y: s.at.y,
        radius: s.radius,
        life,
        max: life,
        color: light ? '#92dcff' : '#6fb6f0',
      });
      this.shake = Math.max(this.shake, light ? 2 : 7);
    }
    this.trim();
  }

  /**
   * 首领阶段切换。给的表现比普通命中重得多——大震屏 + 大范围环 + 屏幕中央
   * 停留近两秒的横幅。玩家必须明确意识到「打法变了」，不然阶段二突然冒出的
   * 范围技和杂兵会被当成「凭空掉血」「哪来的杂兵」，这正是 M1 验收第 4 条
   * 一直在防的事——只是这次防的对象从单次伤害扩大到了整个招式池切换。
   */
  onBossPhaseShift(list: { at: { x: number; y: number }; phase: 2 }[]): void {
    for (const s of list) {
      this.rings.push({ x: s.at.x, y: s.at.y, radius: 160, life: 34, max: 34, color: '#e2705c' });
      this.shake = Math.max(this.shake, 13);
      this.banner = { text: `首领进入阶段 ${s.phase}`, life: 100, max: 100 };
    }
    this.trim();
  }

  private trim(): void {
    if (this.floats.length > MAX_FLOATS) {
      this.floats.splice(0, this.floats.length - MAX_FLOATS);
    }
    if (this.rings.length > MAX_RINGS) {
      this.rings.splice(0, this.rings.length - MAX_RINGS);
    }
  }

  draw(run: Run): void {
    const { ctx, canvas } = this;
    const world = run.world;
    this.clock += 1;
    ctx.save();

    if (this.shake > 0) {
      const amount = this.shake * 0.6;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.shake -= 1;
    }

    // 切房间的推镜：不做黑屏加载，只把新场景推进来一小段
    if (run.transition > 0) {
      const t = run.transition / 20;
      ctx.globalAlpha = 1 - t * 0.8;
      ctx.translate(t * 46, 0);
    }

    this.drawGround(world, run.stage.theme);
    this.drawDoors(run);

    // 预警画在地面上、角色之下：它是"地上的标记"而不是浮在人前面的 UI，
    // 压在角色下面才不会挡住敌人自己的起手动作。
    for (const e of world.entities) {
      if (!e.dead && e.telegraph) this.drawTelegraph(e, e.telegraph);
    }

    this.drawRings();

    // 按纵深排序：y 大的更远，先画，才有正确的前后遮挡
    this.drawableEntities.length = 0;
    this.drawableEntities.push(...world.entities);
    this.drawableEntities.sort((a, b) => a.pos.y - b.pos.y);
    for (const e of this.drawableEntities) this.drawEntity(e);

    for (const p of world.projectiles) this.drawProjectile(p);

    this.drawFloats();
    ctx.restore();

    this.drawHud(run);
    this.drawBanner();
    this.minimap.draw(ctx, run, canvas.width);
  }

  private drawBanner(): void {
    if (!this.banner) return;
    const { ctx, canvas } = this;
    const b = this.banner;
    const t = 1 - b.life / b.max;
    // 淡入快、停留久、淡出慢——横幅是用来读的，不是用来一闪而过的
    const alpha = t < 0.12 ? t / 0.12 : t > 0.8 ? (1 - t) / 0.2 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = '#e2705c';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 5;
    ctx.strokeText(b.text, canvas.width / 2, 150);
    ctx.fillText(b.text, canvas.width / 2, 150);
    ctx.restore();
    b.life -= 1;
    if (b.life <= 0) this.banner = null;
  }

  private drawGround(world: World, theme: StageTheme): void {
    const { ctx, canvas } = this;
    const { arena } = world;

    const sky = ctx.createLinearGradient(0, 0, 0, arena.minY);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, arena.minY);

    const ground = ctx.createLinearGradient(0, arena.minY, 0, arena.maxY + 60);
    ground.addColorStop(0, theme.groundFar);
    ground.addColorStop(1, theme.groundNear);
    ctx.fillStyle = ground;
    ctx.fillRect(0, arena.minY, canvas.width, arena.maxY + 60 - arena.minY);

    // 几条横向参考线，帮玩家读出纵深——纯色地面会让人判断不了自己站多前
    ctx.strokeStyle = theme.lane;
    ctx.lineWidth = 1;
    for (let y = arena.minY; y <= arena.maxY; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // 场地左右边界：房间尺寸各不相同，不画边界玩家读不出这间房到底多宽
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(arena.minX - 8, arena.minY);
    ctx.lineTo(arena.minX - 8, arena.maxY + 14);
    ctx.moveTo(arena.maxX + 8, arena.minY);
    ctx.lineTo(arena.maxX + 8, arena.maxY + 14);
    ctx.stroke();
  }

  /**
   * 门。没清空时是暗色栅栏，清空瞬间点亮。
   * 「门开了」是房间制里最重要的一次状态转换——玩家要一眼看见往哪走。
   */
  private drawDoors(run: Run): void {
    const { ctx } = this;
    const arena = run.world.arena;
    const open = new Set(run.openDoors);
    const doors = Object.keys(run.room.doors) as (keyof typeof run.room.doors)[];

    for (const dir of doors) {
      if (!run.room.doors[dir]) continue;
      const at = doorPosition(arena, dir);
      const isOpen = open.has(dir);
      const horizontal = dir === 'east' || dir === 'west';
      const w = horizontal ? 14 : 84;
      const h = horizontal ? 74 : 16;

      ctx.save();
      if (isOpen) {
        // 开着的门做呼吸辉光，视线扫过去就会被吸住
        const pulse = 0.6 + 0.4 * Math.sin(this.clock * 0.09);
        ctx.globalAlpha = 0.35 + pulse * 0.45;
        ctx.fillStyle = '#ffd479';
        ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffe9b0';
        ctx.lineWidth = 2;
        ctx.strokeRect(at.x - w / 2, at.y - h / 2, w, h);
      } else {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = 'rgba(20,24,28,0.85)';
        ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        // 栅栏纹，和开着的门在剪影上就分得开
        const bars = horizontal ? 4 : 5;
        for (let i = 1; i < bars; i += 1) {
          ctx.beginPath();
          if (horizontal) {
            const y = at.y - h / 2 + (h / bars) * i;
            ctx.moveTo(at.x - w / 2, y);
            ctx.lineTo(at.x + w / 2, y);
          } else {
            const x = at.x - w / 2 + (w / bars) * i;
            ctx.moveTo(x, at.y - h / 2);
            ctx.lineTo(x, at.y + h / 2);
          }
          ctx.stroke();
        }
        ctx.strokeRect(at.x - w / 2, at.y - h / 2, w, h);
      }
      ctx.restore();
    }
  }

  /**
   * 预警绘制。三种形状对应三类威胁，共用一条视觉语言：
   * **越接近生效，颜色越实、越不透明**。玩家读的是"充满了没有"，
   * 而不是去记每种敌人的前摇帧数。
   */
  private drawTelegraph(e: Entity, tel: Telegraph): void {
    const { ctx } = this;
    const progress = Math.min(1, tel.frame / Math.max(1, tel.frames));
    // 起手瞬间就要看得见，所以基础不透明度不从 0 开始
    const alpha = 0.18 + progress * 0.42;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = PALETTE.telegraph;
    ctx.fillStyle = PALETTE.telegraph;
    ctx.lineWidth = 2;

    if (tel.shape.kind === 'line') {
      const { length, width } = tel.shape;
      // 预警是画在地上的，厚度要跟着纵深一起压扁。
      // 不压的话它就是一根悬在半空的横梁，和影子、落点圈完全不在一个平面上。
      const h = width * GROUND_SQUASH;
      ctx.save();
      ctx.translate(e.pos.x, e.pos.y);
      ctx.scale(e.facing, 1);
      // 外框始终可见，内部填充随充能推进——填满即将命中
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillRect(0, -h / 2, length, h);
      ctx.globalAlpha = alpha;
      ctx.strokeRect(0, -h / 2, length, h);
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillRect(0, -h / 2, length * progress, h);
      // 充能前沿加一道亮边，眼睛跟着这条边走就知道还剩多久
      ctx.globalAlpha = Math.min(1, alpha * 1.6);
      ctx.fillRect(length * progress - 2, -h / 2 - 2, 3, h + 4);
      ctx.restore();
    } else if (tel.shape.kind === 'circle') {
      const r = tel.shape.radius;
      ctx.beginPath();
      ctx.ellipse(e.pos.x, e.pos.y, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.globalAlpha = alpha * 0.3;
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.stroke();
      // 内圈随进度收缩到落点，给出"还有多久"的读数
      ctx.beginPath();
      ctx.ellipse(e.pos.x, e.pos.y, r * (1 - progress), r * 0.42 * (1 - progress), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const { radius, halfAngle } = tel.shape;
      const base = e.facing > 0 ? 0 : Math.PI;
      ctx.save();
      ctx.translate(e.pos.x, e.pos.y);
      ctx.scale(1, GROUND_SQUASH);
      // 扇形随充能张开到最终范围，起手那一下就有形可看
      const grow = 0.45 + progress * 0.55;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius * grow, base - halfAngle, base + halfAngle);
      ctx.closePath();
      ctx.globalAlpha = alpha * 0.42;
      ctx.fill();
      ctx.globalAlpha = Math.min(1, alpha * 1.5);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawRings(): void {
    const { ctx } = this;
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.radius * (0.4 + t * 0.9), r.radius * 0.42 * (0.4 + t * 0.9), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      r.life -= 1;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  private drawEntity(e: Entity): void {
    const { ctx } = this;
    const alpha = e.dead ? Math.max(0, 1 - e.deadFrames / 30) : 1;
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 跳跃期间角色离地，影子却要钉在地面原位——离地越高，影子越小越淡，
    // 这是 2D 游戏读「高度」的标准手法，没有它跳跃看起来只是往前挪了一下。
    const airH = jumpHeight(e.action, e.actionFrame, e.profession, e.weapon);
    const shadowShrink = 1 - Math.min(0.55, airH / 90);
    ctx.save();
    ctx.globalAlpha *= shadowShrink;
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    ctx.ellipse(
      e.pos.x,
      e.pos.y,
      e.radius * 0.9 * shadowShrink,
      e.radius * 0.36 * shadowShrink,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    // 落地检测：上一帧还腾空、这一帧不腾空了，就是落地那一刻——
    // 只对比这两个布尔值，不用管具体是从 jump 还是 airSlash 落地的。
    const airborneNow = isActionAirborne(e.action, e.actionFrame, e.profession, e.weapon);
    if (this.wasAirborne.get(e.id) && !airborneNow) {
      this.rings.push({ x: e.pos.x, y: e.pos.y, radius: 26, life: 14, max: 14, color: 'rgba(255,255,255,0.55)' });
    }
    this.wasAirborne.set(e.id, airborneNow);

    // 踩点灰尘：走动一圈里两次"落地"对应的帧号发生变化时才补一次，
    // 不是"当前帧号等于落地点"就补——见 lastMoveFrame 字段的说明。
    const lastFrame = this.lastMoveFrame.get(e.id);
    if (
      e.action === 'move' &&
      e.actionFrame !== lastFrame &&
      isFootfallFrame(e.actionFrame, e.profession, e.weapon)
    ) {
      this.rings.push({
        x: e.pos.x + e.facing * e.radius * 0.3,
        y: e.pos.y,
        radius: 10,
        life: 10,
        max: 10,
        color: 'rgba(200,180,150,0.4)',
      });
    }
    this.lastMoveFrame.set(e.id, e.action === 'move' ? e.actionFrame : -1);

    // 冲刺残影画在角色身后，卖"高速位移"的速度感
    this.drawDashTrail(e);

    // 受击闪白：最直接的"打到了"反馈
    const flashing = e.invulnFrames > 0 && e.invulnFrames % 4 >= 2;

    if (e.team === 'player') {
      this.drawPlayer(e, flashing, airH);
      this.drawHeavyCharge(e);
    } else {
      this.drawEnemy(e, flashing);
    }

    // 挥砍弧光画在角色之上，判定生效那几帧才会出现
    this.drawSwingArc(e);

    if (!e.dead && e.hp < e.maxHp) {
      // 血条偏移按角色实际体型算，不能全员共用一个数：首领体型比杂兵
      // 高一倍还多，固定偏移会把血条画进身体里而不是画在头顶。
      const kind = e.kind ?? 'grunt';
      const look = e.team === 'enemy' ? ENEMY_LOOK[kind] : null;
      const spriteMetrics = e.team === 'enemy' ? ENEMY_SPRITE_METRICS[kind] : null;
      const topOffset = spriteMetrics?.topOffset ?? (look ? look.h + 14 : 66);
      this.drawHpBar(e, topOffset);
    }
    ctx.restore();
  }

  /**
   * 重击蓄力必须有连续反馈，否则玩家无法判断短按和满蓄力的分界。
   * 环形进度满后改为亮橙色并保持，不靠新增美术帧也能明确读出“现在松键”。
   */
  private drawHeavyCharge(e: Entity): void {
    if (e.action !== 'heavyCharge') return;
    const { ctx } = this;
    const progress = Math.min(1, e.actionFrame / HEAVY_FULL_CHARGE_FRAMES);
    ctx.save();
    ctx.translate(e.pos.x, e.pos.y - 34);
    ctx.strokeStyle = progress >= 1 ? '#ff6b45' : '#ffb45e';
    ctx.lineWidth = progress >= 1 ? 5 : 3;
    ctx.globalAlpha = 0.55 + progress * 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, 30 + progress * 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 冲刺无敌帧内画几道渐隐残影，卖"高速冲刺"的速度感——只在无敌位移段画
   * （对应 `dash.invuln`），收招段没有残影，视觉上正好和"这段能接攻击了"
   * 的分界对上：残影消失即是可以接招的时刻。
   */
  private drawDashTrail(e: Entity): void {
    if (e.action !== 'dash') return;
    const invuln = resolveAction('dash', e.profession, e.weapon).invuln;
    if (!invuln || e.actionFrame >= invuln.to) return;
    const { ctx } = this;
    const ghosts = 4;
    for (let i = 1; i <= ghosts; i += 1) {
      const dx = -e.lockedMoveDir.x * i * 9;
      const dy = -e.lockedMoveDir.y * i * 9 * 0.62;
      ctx.save();
      ctx.globalAlpha = (1 - i / (ghosts + 1)) * 0.35;
      ctx.fillStyle = PALETTE.playerTint;
      ctx.fillRect(e.pos.x + dx - 12, e.pos.y + dy - 52, 24, 52);
      ctx.restore();
    }
  }

  /**
   * 招式判定生效时画一道挥砍弧光，见 `SWING_STYLE` 顶部的说明。
   * 纯读当前 action/actionFrame 计算，判定窗口一过就自然消失。
   *
   * 只画玩家——杂兵/盾兵的普攻也叫 'slash'（`ENEMY_PROFILES` 里共用同一个
   * `attackAction`），如果不分队伍，敌人贴脸攻击时会跟玩家自己的挥砍
   * 弧光撞成一样的白色，分不清这一下是我打出去的还是敌人打过来的。
   * 敌人的攻击已经有独立的橙红色预警系统负责"读招"，不需要再叠一层。
   */
  private drawSwingArc(e: Entity): void {
    if (e.team !== 'player') return;
    const style = SWING_STYLE[e.action];
    if (!style) return;
    const box = resolveAction(e.action, e.profession, e.weapon).hitboxes[0];
    if (!box || e.actionFrame < box.activeFrom || e.actionFrame >= box.activeTo) return;

    const span = box.activeTo - box.activeFrom;
    const t = span > 0 ? (e.actionFrame - box.activeFrom) / span : 0;
    const reach = (box.offset.x + box.halfWidth) * 0.85;

    const { ctx } = this;
    ctx.save();
    ctx.translate(e.pos.x, e.pos.y - 30);
    ctx.scale(e.facing, 1);
    ctx.lineCap = 'round';

    // 三层递减透明度的短弧线依次落在稍早的扫过位置上，叠起来读作
    // "刀光划过一道弧"，而不是一条钉死不动的静态弧线。
    const trails = 3;
    for (let i = 0; i < trails; i += 1) {
      const trailT = Math.max(0, Math.min(1, t - i * 0.22));
      const sweep = style.baseAngle - style.arcLen / 2 + style.arcLen * trailT;
      const alpha = (1 - i / trails) * (1 - Math.abs(t - 0.5) * 0.5);
      if (alpha <= 0) continue;
      ctx.strokeStyle = style.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = style.width * (1 - i * 0.25);
      ctx.beginPath();
      ctx.arc(0, 0, reach, sweep - 0.45, sweep + 0.45);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlayer(e: Entity, flashing: boolean, airH: number): void {
    const { ctx } = this;
    const sheet = this.sheets.get('player');
    const def = resolveAction(e.action, e.profession, e.weapon);
    const progress = def.loop
      ? (e.actionFrame % def.frames) / def.frames
      : e.actionFrame / def.frames;
    const rect = sheet?.frameRect(e.action, progress) ?? null;

    // 无敌帧（冲刺、处决）画成半透明，让"这下打不到我"这件事看得见
    const invulnerable =
      (def.invuln && e.actionFrame >= def.invuln.from && e.actionFrame < def.invuln.to) === true;
    if (invulnerable) ctx.globalAlpha *= 0.55;

    // 走动时叠加的重心起伏——腿部摆动帧本身已经有了，但没有配套的
    // 上下起伏，走起来还是有点"贴地滑"。幅度比敌人小一档（2px vs 3px），
    // 玩家有真的走路帧兜底，起伏只是锦上添花，不是唯一的动作信号。
    const bob = walkBob(e.action, e.actionFrame, 2, e.profession, e.weapon);

    if (rect && sheet) {
      // hero-v2 为防止长剑触格统一保留了 4px 安全边距，实际人物轮廓比旧占位件
      // 小约 9%。这里补回显示倍率，让细节在 960×540 战场里仍然读得清。
      const scale = 1.15;
      const w = rect.sw * scale;
      const h = rect.sh * scale;
      ctx.save();
      // airH 把整个角色往上抬——这是跳跃在画面上唯一的体现，
      // 逻辑层完全不知道"高度"这个概念，纯粹是渲染层的读数。
      ctx.translate(e.pos.x, e.pos.y - airH - bob);
      ctx.scale(e.facing, 1);
      if (flashing) ctx.filter = 'brightness(2.4) saturate(0.3)';
      // 和敌人走同一条贴地规则：源表脚底在 y=90，缩放后正好落在 pos.y。
      // 旧的 `-h + 12` 是 hero-v2 之前那张表留下的经验偏移，配 scale=1.15
      // 会把人物整体压到地面下约 5px——影子画在 pos.y，脚却在影子外面，
      // 和同一条线上的敌人也对不齐。
      ctx.drawImage(
        sheet.image,
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        -w / 2,
        -SPRITE_BASELINE * scale,
        w,
        h,
      );
      ctx.restore();
    } else {
      // 素材没就位时的占位块，保证玩法始终可测
      ctx.fillStyle = flashing ? '#ffffff' : PALETTE.playerTint;
      ctx.fillRect(e.pos.x - 12, e.pos.y - airH - bob - 52, 24, 52);
    }
  }

  /** 六类敌人优先走正式动作表；素材加载失败时保留几何兜底。 */
  private drawEnemy(e: Entity, flashing: boolean): void {
    const { ctx } = this;
    const kind = e.kind ?? 'grunt';
    const look = ENEMY_LOOK[kind] ?? ENEMY_LOOK.grunt;
    const x = e.pos.x;
    const y = e.pos.y;

    // 出招中的敌人整体上抬一点，让"它正在做事"在剪影上也读得出来
    const lift =
      e.action === 'charge' ||
      e.action === 'heavy' ||
      e.action === 'bossCharge' ||
      e.action === 'bossSlam' ||
      e.action === 'bossNova'
        ? 4
        : 0;
    // 正式走路帧叠一层很轻的重心起伏，几何兜底也复用它；幅度按敌人体型
    // 稍微放大一点（3px），首领这种大体型才看得出来在动。
    const bob = walkBob(e.action, e.actionFrame, 3, e.profession, e.weapon);
    const sheet = this.sheets.get(kind);
    const def = resolveAction(e.action, e.profession, e.weapon);
    const progress = def.loop
      ? (e.actionFrame % def.frames) / def.frames
      : e.actionFrame / def.frames;
    const rect = sheet?.frameRect(e.action, progress) ?? null;
    const metrics = ENEMY_SPRITE_METRICS[kind];
    let top: number;

    if (rect && sheet && metrics) {
      const w = rect.sw * metrics.scale;
      const h = rect.sh * metrics.scale;
      top = y - lift - bob - metrics.topOffset;
      ctx.save();
      ctx.translate(x, y - lift - bob);
      ctx.scale(e.facing, 1);
      const bossPhaseTwo = kind === 'boss' && e.ai.bossPhase === 2;
      if (bossPhaseTwo) {
        // 二阶段仍复用同一套骨架与动作，只把大片深红符文推向亮橙红，并在
        // 脚下补一圈精确主题色；这样不会因换图造成动作相位或脚底线跳变。
        ctx.save();
        ctx.fillStyle = BOSS_PHASE_TWO_COLOR;
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.ellipse(0, -2, 40, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (flashing) {
        ctx.filter = 'brightness(2.4) saturate(0.3)';
      } else if (bossPhaseTwo) {
        ctx.filter = 'brightness(1.3) saturate(1.55) hue-rotate(14deg)';
      }
      // 源图统一面向屏幕右侧；只在这里按 facing 镜像，脚底则严格贴到
      // 打包报告约定的 y=90，动作切换不会产生上下跳动。
      ctx.drawImage(
        sheet.image,
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        -w / 2,
        -SPRITE_BASELINE * metrics.scale,
        w,
        h,
      );
      ctx.restore();
    } else {
      // 任一正式图加载失败都走几何兜底，避免一张坏图阻断启动。几何轮廓仍
      // 保留兵种差异，boss 的阶段色也继续生效，玩法和回归测试始终可继续。
      ctx.save();
      const bossPhaseTwo = kind === 'boss' && e.ai.bossPhase === 2;
      ctx.fillStyle = flashing ? '#ffffff' : bossPhaseTwo ? BOSS_PHASE_TWO_COLOR : look.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      top = y - look.h - lift - bob;

      if (kind === 'shield') {
        // 盾兵：主体 + 正面一块厚盾。盾在哪边一眼可见，玩家才知道要绕到哪一边。
        ctx.fillRect(x - look.w / 2, top, look.w, look.h);
        ctx.strokeRect(x - look.w / 2, top, look.w, look.h);
        ctx.fillStyle = flashing ? '#ffffff' : '#cdd9e3';
        const shieldX = e.facing > 0 ? x + look.w / 2 - 2 : x - look.w / 2 - 8;
        ctx.fillRect(shieldX, top + 8, 10, look.h - 16);
        ctx.strokeRect(shieldX, top + 8, 10, look.h - 16);
      } else if (kind === 'ranged') {
        // 远程：瘦高 + 尖顶，轮廓最细，远看就知道是站桩输出的那个
        ctx.fillRect(x - look.w / 2, top, look.w, look.h);
        ctx.strokeRect(x - look.w / 2, top, look.w, look.h);
        ctx.beginPath();
        ctx.moveTo(x - look.w / 2, top);
        ctx.lineTo(x, top - 14);
        ctx.lineTo(x + look.w / 2, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (kind === 'charger') {
        // 冲锋：前倾梯形，重心压在前脚，静止时也像随时要冲出去
        const lean = 7 * e.facing;
        ctx.beginPath();
        ctx.moveTo(x - look.w / 2 + lean, top);
        ctx.lineTo(x + look.w / 2 + lean, top);
        ctx.lineTo(x + look.w / 2, y);
        ctx.lineTo(x - look.w / 2, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (kind === 'elite') {
        // 精英：体型明显大一圈 + 双角，是场上最容易被一眼锁定的目标
        ctx.fillRect(x - look.w / 2, top, look.w, look.h);
        ctx.strokeRect(x - look.w / 2, top, look.w, look.h);
        ctx.beginPath();
        ctx.moveTo(x - look.w / 2, top);
        ctx.lineTo(x - look.w / 2 - 8, top - 16);
        ctx.lineTo(x - look.w / 4, top - 4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + look.w / 2, top);
        ctx.lineTo(x + look.w / 2 + 8, top - 16);
        ctx.lineTo(x + look.w / 4, top - 4);
        ctx.closePath();
        ctx.fill();
      } else if (kind === 'boss') {
        // 首领：比精英再大一圈，四支角比精英的两支更长更夸张，
        // 顶上加一道尖冠——六关里体型最大、剪影最复杂的敌人，一眼就该认出来。
        ctx.lineWidth = 3;
        ctx.fillRect(x - look.w / 2, top, look.w, look.h);
        ctx.strokeRect(x - look.w / 2, top, look.w, look.h);

        const hornColor = flashing ? '#ffffff' : bossPhaseTwo ? '#ffd479' : '#3a1f24';
        ctx.fillStyle = hornColor;
        for (const side of [-1, 1] as const) {
          ctx.beginPath();
          ctx.moveTo(x + (side * look.w) / 2, top + 6);
          ctx.lineTo(x + (side * look.w) / 2 + side * 14, top - 24);
          ctx.lineTo(x + (side * look.w) / 3, top - 2);
          ctx.closePath();
          ctx.fill();
        }
        // 尖冠：阶段二会发亮，是「打法变了」在剪影上的第二重信号，
        // 配合 drawBanner 的横幅和 onBossPhaseShift 的震屏一起读
        ctx.fillStyle = bossPhaseTwo ? '#ffe9b0' : 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(x - 10, top);
        ctx.lineTo(x, top - 18);
        ctx.lineTo(x + 10, top);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x - look.w / 2, top, look.w, look.h);
        ctx.strokeRect(x - look.w / 2, top, look.w, look.h);
      }

      // 几何兜底的朝向指示；正式动作表直接由角色面向表达，不再叠黑块。
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + (e.facing > 0 ? look.w / 2 - 6 : -look.w / 2 + 2), top + 10, 4, 4);
      ctx.restore();
    }

    // 可处决提示。不标出来玩家不会知道这个敌人已经能秒了，
    // 处决就永远用不满——验收第 3 条要的就是这个行为真的发生。
    if (!e.dead && e.hp / e.maxHp < EXECUTE_THRESHOLD) {
      ctx.save();
      // 呼吸感只在 0.72~1 之间浮动。之前谷底压到 0.1，
      // 提示会周期性地整个消失——玩家瞥一眼没看见，就当它不能处决了。
      const pulse = 0.86 + 0.14 * Math.sin(this.clock * 0.13);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ff9f68';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText('处决', x, top - 22);
      ctx.fillText('处决', x, top - 22);
      ctx.restore();
    }
  }

  private drawProjectile(p: Projectile): void {
    const { ctx } = this;
    ctx.save();
    // 拖尾指出来向，玩家能读出它从哪儿来、往哪儿去
    const tailX = p.pos.x - p.velocity.x * 2.2;
    const tailY = p.pos.y - p.velocity.y * 2.2;
    const grad = ctx.createLinearGradient(tailX, tailY, p.pos.x, p.pos.y);
    grad.addColorStop(0, 'rgba(255,180,120,0)');
    grad.addColorStop(1, '#ffb478');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(p.pos.x, p.pos.y);
    ctx.stroke();
    ctx.fillStyle = '#ffd7a8';
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, p.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHpBar(e: Entity, topOffset: number): void {
    const { ctx } = this;
    // 首领体型大一圈，血条也跟着宽一点——不然一条和杂兵等宽的细条
    // 贴在一个大两倍的身体上方，比例上会显得很小气。
    const w = e.kind === 'boss' ? 58 : 34;
    const x = e.pos.x - w / 2;
    const y = e.pos.y - topOffset;
    ctx.fillStyle = PALETTE.hpBack;
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = e.team === 'player' ? PALETTE.hpPlayer : PALETTE.hpEnemy;
    ctx.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 3);
  }

  private drawFloats(): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      const t = 1 - f.life / 42;
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.font = f.crit ? 'bold 20px system-ui, sans-serif' : 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - 60 - t * 26);
      f.life -= 1;
    }
    ctx.globalAlpha = 1;
    this.floats = this.floats.filter((f) => f.life > 0);
  }

  private drawHud(run: Run): void {
    const { ctx } = this;
    const world = run.world;
    const player = world.player;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';

    // 按类型列出剩余敌人，调试时一眼看出场上还剩什么
    const byKind = new Map<string, number>();
    let aliveCount = 0;
    for (const e of world.entities) {
      if (e.team !== 'enemy' || e.dead) continue;
      aliveCount += 1;
      const k = e.kind ?? 'grunt';
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    const parts = [...byKind.entries()].map(
      ([k, n]) => `${ENEMY_PROFILES[k as keyof typeof ENEMY_PROFILES]?.label ?? k}×${n}`,
    );
    const profession = player?.profession ? ` · 职业 ${PROFESSION_LABEL[player.profession]}` : '';
    const weapon = player?.weapon ? ` · 武器 ${WEAPONS[player.weapon].label}` : '';
    ctx.fillText(
      `敌人 ${aliveCount}${parts.length ? ' · ' + parts.join(' ') : ''}${profession}${weapon}`,
      14,
      24,
    );

    // 战败后也能进入基地，基地层不能被“已经没有存活玩家”这条提前返回挡住。
    if (run.phase === 'baseMenu') {
      this.drawBaseMenu(run);
      return;
    }

    if (!player) {
      ctx.fillStyle = '#e2705c';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        this.touchMode ? '倒下了 · 点「基」建设基地 · 点「重」重来' : '倒下了 · 按 G 建设基地 · 按 R 重来',
        this.canvas.width / 2,
        this.canvas.height / 2,
      );
      return;
    }

    if (run.phase === 'professionSelect') {
      this.drawProfessionChoice(run);
      return;
    }

    if (run.phase === 'equipmentMenu') {
      this.drawEquipmentMenu(run);
      return;
    }

    if (run.pendingChoice) {
      this.drawUpgradeChoice(run.pendingChoice, run.profile.upgrades);
      return;
    }

    if (run.pendingEquipment) {
      this.drawEquipmentChoice(run);
      return;
    }

    // 房间清空后的指路。不提示的话玩家会站在空房间里等下一波怪。
    if (run.phase === 'cleared' && run.openDoors.length) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(this.clock * 0.08);
      ctx.fillStyle = '#ffd479';
      ctx.fillText('门已开 · 走向发光处', this.canvas.width / 2, 92);
      ctx.restore();
    }

    if (run.phase === 'stageComplete') {
      this.drawStageSummary(run);
      return;
    }

    const w = 168;
    ctx.fillStyle = PALETTE.hpBack;
    ctx.fillRect(13, 33, w + 2, 12);
    ctx.fillStyle = PALETTE.hpPlayer;
    ctx.fillRect(14, 34, w * Math.max(0, player.hp / player.maxHp), 10);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${Math.ceil(player.hp)} / ${player.maxHp}`, 14 + w + 10, 44);

    // 能量条：攒满会变色并提示按键，否则玩家不知道技能已经可以放了。
    // 实际消耗要乘玄术加成——选过技能消耗成长后，条上写的数字得和真实门槛一致。
    const cost = resolveSkillCost(player.profession) * player.skillCostMultiplier;
    const ready = player.energy >= cost;
    ctx.fillStyle = PALETTE.hpBack;
    ctx.fillRect(13, 49, w + 2, 9);
    ctx.fillStyle = ready ? PALETTE.energyFull : PALETTE.energy;
    ctx.fillRect(14, 50, w * Math.max(0, player.energy / player.maxEnergy), 7);
    ctx.fillStyle = ready ? PALETTE.energyFull : 'rgba(255,255,255,0.55)';
    ctx.fillText(
      ready
        ? this.touchMode ? '技能就绪 · 点「技」' : '技能就绪 · U'
        : `${Math.floor(player.energy)} / ${Math.round(cost)}`,
      14 + w + 10,
      58,
    );

    // 冲刺和跳跃冷却——两种防御手段都得让玩家随时知道在不在，
    // 不然「这下该冲还是该跳」的判断就无从谈起。
    ctx.fillStyle = player.dashCooldown > 0 ? 'rgba(255,255,255,0.35)' : '#8fd4c8';
    ctx.fillText(player.dashCooldown > 0 ? `冲刺 ${player.dashCooldown}` : '冲刺就绪', 14, 76);
    ctx.fillStyle = player.jumpCooldown > 0 ? 'rgba(255,255,255,0.35)' : '#8fd4c8';
    ctx.fillText(player.jumpCooldown > 0 ? `跳跃 ${player.jumpCooldown}` : '跳跃就绪', 100, 76);

    if (!hasBuilding(run.profile.base, 'forge')) {
      const storedEquipment =
        run.profile.inventory.weapons.length +
        run.profile.inventory.armors.length +
        run.profile.inventory.accessories.length;
      ctx.fillStyle = storedEquipment > 0 ? '#ffd479' : 'rgba(255,255,255,0.38)';
      ctx.fillText(
        storedEquipment > 0
          ? `库存已有 ${storedEquipment} 件装备 · 建成锻造台后可换装`
          : '建成锻造台后开放装备功能',
        14,
        96,
      );
    }
  }

  /** 出击前职业选择沿用三选一的遮罩和卡片语言，避免再造一套菜单视觉。 */
  private drawProfessionChoice(run: Run): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,13,0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('选择本次出击职业', canvas.width / 2, 86);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillText(
      hasBuilding(run.profile.base, 'trainingGround')
        ? `${this.touchMode ? '点' : '按'} 1 / 2 / 3 选择`
        : run.profile.profession === 'swift'
          ? '疾锋可用 · 建成演武场后解锁重击与术法'
          : '保留当前职业 · 建成演武场后解锁全部职业',
      canvas.width / 2,
      110,
    );

    const ids: Profession[] = ['heavy', 'swift', 'arcane'];
    const cardW = 220;
    const cardH = 218;
    const gap = 22;
    const startX = (canvas.width - ids.length * cardW - (ids.length - 1) * gap) / 2;
    const y = 154;
    ids.forEach((id, index) => {
      const card = PROFESSION_CARDS[id];
      const available = run.canSelectProfession(id);
      const x = startX + index * (cardW + gap);
      ctx.fillStyle = 'rgba(20,24,30,0.94)';
      ctx.strokeStyle = available ? card.color : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = available ? 2 : 1;
      this.roundRect(ctx, x, y, cardW, cardH, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = available ? card.color : 'rgba(255,255,255,0.32)';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(card.label, x + cardW / 2, y + 52);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(card.theme, x + cardW / 2, y + 79);
      ctx.fillStyle = available ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.36)';
      ctx.font = '13px system-ui, sans-serif';
      this.wrapText(card.detail, x + cardW / 2, y + 112, cardW - 32, 20);
      if (available) {
        ctx.beginPath();
        ctx.arc(x + cardW / 2, y + cardH - 30, 17, 0, Math.PI * 2);
        ctx.strokeStyle = card.color;
        ctx.stroke();
        ctx.fillStyle = card.color;
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.fillText(card.key, x + cardW / 2, y + cardH - 24);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillText('演武场未建成', x + cardW / 2, y + cardH - 25);
      }
    });
    ctx.restore();
  }

  /**
   * 局内三选一。全屏遮罩 + 三张卡片，故意做成暂停菜单的形态——
   * GAME_DESIGN 3.6 特意把这一步放进独立的奖励房而不是战斗结束弹窗，
   * 就是要让玩家静下来读三张卡，而不是在肾上腺素还没退的时候被无脑点掉。
   */
  private drawUpgradeChoice(options: UpgradeTrackId[], upgrades: Record<UpgradeTrackId, number>): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,13,0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('选择一条成长路线', canvas.width / 2, 86);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${this.touchMode ? '点' : '按'} 1 / 2 / 3 选择`, canvas.width / 2, 108);

    const cardW = 200;
    const cardH = 210;
    const gap = 22;
    const totalW = options.length * cardW + (options.length - 1) * gap;
    const startX = (canvas.width - totalW) / 2;
    const y = 150;

    options.forEach((id, i) => {
      const track = UPGRADE_TRACKS[id];
      const level = upgrades[id];
      const x = startX + i * (cardW + gap);
      const color = TRACK_COLOR[id];

      ctx.fillStyle = 'rgba(20,24,30,0.9)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      this.roundRect(ctx, x, y, cardW, cardH, 10);
      ctx.fill();
      ctx.stroke();

      // 已选级数用小圆点标出来，摆满级前还差几级一眼能看出
      const dotY = y + 26;
      for (let d = 0; d < MAX_UPGRADE_LEVEL; d += 1) {
        const dx = x + cardW / 2 - (MAX_UPGRADE_LEVEL - 1) * 8 + d * 16;
        ctx.beginPath();
        ctx.arc(dx, dotY, 4, 0, Math.PI * 2);
        ctx.fillStyle = d < level ? color : 'rgba(255,255,255,0.18)';
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.fillText(track.label, x + cardW / 2, y + 66);

      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(track.theme, x + cardW / 2, y + 88);

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '13px system-ui, sans-serif';
      this.wrapText(track.describe(level + 1), x + cardW / 2, y + 118, cardW - 28, 18);

      // 按键提示放卡片底部，做成一枚圆形按钮的样子
      ctx.beginPath();
      ctx.arc(x + cardW / 2, y + cardH - 30, 16, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(CHOICE_KEYS[id], x + cardW / 2, y + cardH - 25);
    });

    ctx.restore();
  }

  /** 精英/首领掉落沿用局内三选一的视觉语言，选择后先收入库存。 */
  private drawEquipmentChoice(run: Run): void {
    const { ctx, canvas } = this;
    const options = run.pendingEquipment ?? [];
    const slotLabel: Record<EquipmentSlot, string> = {
      weapon: '武器',
      armor: '护甲',
      accessory: '饰品',
    };
    const slotColor: Record<EquipmentSlot, string> = {
      weapon: '#ff9a5c',
      armor: '#7fe8ff',
      accessory: '#b79cff',
    };

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,13,0.76)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText('选择一件战利品', canvas.width / 2, 86);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillText(
      hasBuilding(run.profile.base, 'forge')
        ? `精英 / 首领房首次清空掉落 · ${this.touchMode ? '点' : '按'} 1 / 2 / 3 收入库存`
        : `${this.touchMode ? '点' : '按'} 1 / 2 / 3 存入库房 · 锻造台建成后即可装备`,
      canvas.width / 2,
      110,
    );

    const cardW = 210;
    const cardH = 250;
    const gap = 22;
    const totalW = options.length * cardW + (options.length - 1) * gap;
    const startX = (canvas.width - totalW) / 2;
    const y = 136;
    options.forEach((id, index) => {
      const slot = equipmentSlotOf(id);
      const color = slotColor[slot];
      const x = startX + index * (cardW + gap);
      ctx.fillStyle = 'rgba(20,24,30,0.94)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      this.roundRect(ctx, x, y, cardW, cardH, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(slotLabel[slot], x + cardW / 2, y + 25);
      this.drawEquipmentIcon(id, x + cardW / 2, y + 65, color, 64);
      ctx.fillStyle = color;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(equipmentLabel(id), x + cardW / 2, y + 111);
      ctx.fillStyle = 'rgba(255,255,255,0.84)';
      ctx.font = '13px system-ui, sans-serif';
      this.wrapText(equipmentDescription(id), x + cardW / 2, y + 140, cardW - 30, 18);
      ctx.beginPath();
      ctx.arc(x + cardW / 2, y + cardH - 30, 16, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(String(index + 1), x + cardW / 2, y + cardH - 25);
    });
    ctx.restore();
  }

  /** 装备面板只操作已经收入库存的物品；每张卡用数字键循环该槽位。 */
  private drawEquipmentMenu(run: Run): void {
    const { ctx, canvas } = this;
    const cards: {
      slot: EquipmentSlot;
      label: string;
      key: string;
      color: string;
      current: EquipmentId | null;
      owned: number;
    }[] = [
      {
        slot: 'weapon',
        label: '武器',
        key: '1',
        color: '#ff9a5c',
        current: run.profile.equipment.weapon,
        owned: run.profile.inventory.weapons.filter((id) =>
          WEAPONS[id].profession === run.profile.profession,
        ).length,
      },
      {
        slot: 'armor',
        label: '护甲',
        key: '2',
        color: '#7fe8ff',
        current: run.profile.equipment.armor,
        owned: run.profile.inventory.armors.length,
      },
      {
        slot: 'accessory',
        label: '饰品',
        key: '3',
        color: '#b79cff',
        current: run.profile.equipment.accessory,
        owned: run.profile.inventory.accessories.length,
      },
    ];

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,13,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('装备', canvas.width / 2, 76);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillText(
      this.touchMode ? '点 1 / 2 / 3 循环对应槽位 · 点「装」返回战斗' : '按 1 / 2 / 3 循环对应槽位 · 按 B 返回战斗',
      canvas.width / 2,
      101,
    );

    const cardW = 220;
    const cardH = 230;
    const gap = 22;
    const startX = (canvas.width - cards.length * cardW - (cards.length - 1) * gap) / 2;
    const y = 142;
    cards.forEach((card, index) => {
      const x = startX + index * (cardW + gap);
      ctx.fillStyle = 'rgba(20,24,30,0.94)';
      ctx.strokeStyle = card.color;
      ctx.lineWidth = 2;
      this.roundRect(ctx, x, y, cardW, cardH, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = card.color;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText(card.label, x + cardW / 2, y + 39);
      ctx.fillStyle = 'rgba(255,255,255,0.52)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`库存 ${card.owned}`, x + cardW / 2, y + 61);
      if (card.current) this.drawEquipmentIcon(card.current, x + cardW / 2, y + 98, card.color, 56);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 19px system-ui, sans-serif';
      ctx.fillText(card.current ? equipmentLabel(card.current) : '未装备', x + cardW / 2, y + 139);
      ctx.fillStyle = 'rgba(255,255,255,0.76)';
      ctx.font = '13px system-ui, sans-serif';
      this.wrapText(
        card.current ? equipmentDescription(card.current) : '清空精英或首领房获得装备。',
        x + cardW / 2,
        y + 165,
        cardW - 30,
        18,
      );
      ctx.beginPath();
      ctx.arc(x + cardW / 2, y + cardH - 29, 16, 0, Math.PI * 2);
      ctx.strokeStyle = card.color;
      ctx.stroke();
      ctx.fillStyle = card.color;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(card.key, x + cardW / 2, y + cardH - 24);
    });
    ctx.restore();
  }

  /**
   * M5 基地建造面板。状态完全由档案和统一队列推导，渲染层只读；锁定、资源
   * 不足、排队和完成四种状态必须同时可辨，避免按键无响应却不知道原因。
   */
  private drawBaseMenu(run: Run): void {
    const { ctx, canvas } = this;
    const progress = run.profile.base;
    const unlocked = new Set(unlockedBuildings(progress));
    const nowMs = Date.now();
    const cardW = 164;
    const cardH = 310;
    const gap = 12;
    const startX = (canvas.width - BUILDING_UNLOCKS.length * cardW - (BUILDING_UNLOCKS.length - 1) * gap) / 2;
    const firstDefeatHasNoBaseAction =
      !run.stageCleared &&
      progress.completedStageRuns === 0 &&
      progress.completedBuildings.length === 0 &&
      progress.constructionQueue.length === 0;
    const y = firstDefeatHasNoBaseAction ? 158 : 142;

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,13,0.84)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('边境基地', canvas.width / 2, 62);
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(
      this.touchMode
        ? `点 1–5 开始建造 · 建筑串行施工 · 点「基」返回${run.stageCleared ? '结算' : '战败界面'}`
        : `按 1–5 开始建造 · 建筑串行施工 · 按 G 返回${run.stageCleared ? '结算' : '战败界面'}`,
      canvas.width / 2,
      86,
    );
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(
      `基础材料 ${progress.resources.materials}  ·  图纸 ${progress.resources.blueprints}  ·  稀有材料 ${progress.resources.rareMaterials}`,
      canvas.width / 2,
      112,
    );
    if (firstDefeatHasNoBaseAction) {
      ctx.fillStyle = '#7fe8ff';
      ctx.fillText('清空战斗房可获得材料 · 击败首领后解锁演武场', canvas.width / 2, 136);
    }

    BUILDING_UNLOCKS.forEach((building, index) => {
      const plan = BUILDING_PLANS[building.id];
      const x = startX + index * (cardW + gap);
      const completed = progress.completedBuildings.includes(building.id);
      const job = progress.constructionQueue.find((item) => item.building === building.id);
      const available = unlocked.has(building.id);
      const affordable = canAffordResources(progress, plan.cost);
      const active = !completed && !job && available && affordable;
      const color = completed ? '#8fd4c8' : active ? '#ffd479' : 'rgba(255,255,255,0.28)';

      ctx.fillStyle = 'rgba(20,24,30,0.94)';
      ctx.strokeStyle = color;
      ctx.lineWidth = active || completed ? 2 : 1;
      this.roundRect(ctx, x, y, cardW, cardH, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillText(building.label, x + cardW / 2, y + 34);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '12px system-ui, sans-serif';
      this.wrapText(building.combatBenefit, x + cardW / 2, y + 62, cardW - 24, 17);

      const artState: BuildingArtState = completed ? 'completed' : job ? 'building' : 'unbuilt';
      if (!this.buildingArt?.draw(this.ctx, building.id, artState, x + 34, y + 87, 96)) {
        this.drawBuildingPlaceholder(building.id, x + cardW / 2, y + 135, color);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.44)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('建造成本', x + cardW / 2, y + 190);
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(
        `材料 ${plan.cost.materials ?? 0} · 图纸 ${plan.cost.blueprints ?? 0}`,
        x + cardW / 2,
        y + 211,
      );
      ctx.fillText(
        `稀有 ${plan.cost.rareMaterials ?? 0} · ${Math.ceil(plan.durationMs / 1_000)} 秒`,
        x + cardW / 2,
        y + 231,
      );

      let status = `按 ${index + 1} 建造`;
      let statusColor = '#ffd479';
      if (completed) {
        if (building.id === 'archive') {
          status = `永久路线 · ${progress.archiveTrack ? UPGRADE_TRACKS[progress.archiveTrack].label : '未选择'}\n${this.touchMode ? '点' : '按'} 5 切换`;
        } else if (building.id === 'alchemyLab') {
          status = `出击补给 ${progress.tonics} · 材料 ${TONIC_MATERIAL_COST}\n${this.touchMode ? '点' : '按'} 3 制作`;
        } else {
          status = '已完成';
        }
        statusColor = '#8fd4c8';
      } else if (job) {
        status = `施工中 · ${Math.ceil(Math.max(0, job.completesAtMs - nowMs) / 1_000)} 秒`;
        statusColor = '#7fe8ff';
      } else if (!available) {
        status = `${building.unlockAfterClears} 次通关后解锁`;
        statusColor = 'rgba(255,255,255,0.38)';
      } else if (!affordable) {
        status = '资源不足';
        statusColor = '#e2705c';
      }
      ctx.fillStyle = statusColor;
      ctx.font = 'bold 12px system-ui, sans-serif';
      this.wrapText(status, x + cardW / 2, y + cardH - 52, cardW - 20, 16);
    });
    ctx.restore();
  }

  /** 尚未有正式图集时的紧凑回退；状态颜色仍与卡片边框保持一致。 */
  private drawBuildingPlaceholder(id: BuildingId, centerX: number, centerY: number, color: string): void {
    const glyph: Record<BuildingId, string> = {
      trainingGround: '武',
      forge: '锻',
      alchemyLab: '丹',
      resourceField: '田',
      archive: '藏',
    };
    this.ctx.fillStyle = 'rgba(255,255,255,0.045)';
    this.roundRect(this.ctx, centerX - 43, centerY - 43, 86, 86, 9);
    this.ctx.fill();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.roundRect(this.ctx, centerX - 35, centerY - 35, 70, 70, 8);
    this.ctx.stroke();
    this.ctx.fillStyle = color;
    this.ctx.font = 'bold 28px system-ui, sans-serif';
    this.ctx.fillText(glyph[id], centerX, centerY + 10);
  }

  /** 正式 PNG 未覆盖或加载失败时画稳定占位，不让素材缺口变成空白卡片。 */
  private drawEquipmentIcon(
    id: EquipmentId,
    centerX: number,
    centerY: number,
    color: string,
    size: number,
  ): void {
    const x = centerX - size / 2;
    const y = centerY - size / 2;
    this.ctx.fillStyle = 'rgba(255,255,255,0.06)';
    this.roundRect(this.ctx, x, y, size, size, 8);
    this.ctx.fill();
    if (this.equipmentIcons?.draw(this.ctx, id, x, y, size)) return;

    const slot = equipmentSlotOf(id);
    const glyph: Record<EquipmentSlot, string> = { weapon: '刃', armor: '甲', accessory: '印' };
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.roundRect(this.ctx, x + 5, y + 5, size - 10, size - 10, 7);
    this.ctx.stroke();
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = color;
    this.ctx.font = `bold ${Math.round(size * 0.34)}px system-ui, sans-serif`;
    this.ctx.fillText(glyph[slot], centerX, centerY + size * 0.12);
  }

  /**
   * 结算界面：通关后的数据汇总。取代原来只有两行文字的提示——
   * 通关这一下有分量，值得让玩家停下来看一眼这一路打出的数字，
   * 而不是一晃而过的提示，也是 M3 清单里补的最后一块。
   *
   * 和三选一（`drawUpgradeChoice`）同一种「全屏遮罩 + 居中面板」的形态，
   * 读的是 `run.overallSummary()`——跨房间累加的整局数据，不是
   * `world.stats` 那份只反映最后一间房战斗的数字。
   */
  private drawStageSummary(run: Run): void {
    const { ctx, canvas } = this;
    // 最后一关用同一个 N 输入开启新一轮，提示语和 main.ts 的环回规则必须一致。
    const isFinalStage = run.stage.index >= STAGES.length;
    const summary = run.overallSummary();

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,13,0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const panelW = 560;
    const panelH = 470;
    const panelX = (canvas.width - panelW) / 2;
    const panelY = (canvas.height - panelH) / 2;

    ctx.fillStyle = 'rgba(20,24,30,0.92)';
    ctx.strokeStyle = '#ffd479';
    ctx.lineWidth = 2;
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(
      isFinalStage ? `全部 ${STAGES.length} 关已通关！` : `${run.stage.name} 已通关`,
      canvas.width / 2,
      panelY + 44,
    );
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(
      this.touchMode
        ? isFinalStage
          ? '点「轮」开启新一轮 ·「基」整理基地 ·「重」重玩本关'
          : '点「进」进入下一关 · 点「重」重来本关'
        : isFinalStage
          ? '按 N 开启新一轮 · G 整理基地 · R 重玩本关'
          : '按 N 进入下一关 · 按 R 重来本关',
      canvas.width / 2,
      panelY + 66,
    );

    // 数据栏：两列 label/value。无预警致死大于 0 时标红——
    // 这条本该恒为 0（GAME_DESIGN 3.4），非 0 说明有判定没给够预警，值得显眼。
    const rows: [string, string, boolean?][] = [
      ['职业', PROFESSION_LABEL[summary.profession]],
      ['用时', `${summary.seconds.toFixed(1)}s`],
      ['普攻占比', `${Math.round(summary.basicAttackRatio * 100)}%`],
      ['纵深比', summary.depthRatio.toFixed(2)],
      ['移动距离', `${summary.totalMoveDistance}px`],
      ['平均交战距离', `${summary.averageEngagementDistance}px`],
      ['处决次数', `${summary.executes}`],
      ['完美取消', `${summary.perfectCancels}`],
      ['击杀数', `${summary.kills}`],
      ['承受伤害', `${Math.round(summary.damageTaken)}`],
      ['无预警致死', `${summary.unwarnedLethal}`, summary.unwarnedLethal > 0],
    ];
    const gridTop = panelY + 92;
    const colW = panelW / 2;
    ctx.font = '13px system-ui, sans-serif';
    rows.forEach(([label, value, warn], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = panelX + 40 + col * colW;
      const y = gridTop + row * 30;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(label, x, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = warn ? '#e2705c' : '#ffffff';
      ctx.fillText(value, x + colW - 80, y);
    });

    // 成长路线：三条轨迹各自选到第几级，用和三选一同一套颜色和圆点样式，
    // 一眼能和三选一界面里看到的卡片对上号，不用重新学一套视觉语言
    const trackY = gridTop + Math.ceil(rows.length / 2) * 30 + 24;
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('成长路线', panelX + 40, trackY);

    const trackGap = (panelW - 80) / UPGRADE_TRACK_IDS.length;
    UPGRADE_TRACK_IDS.forEach((id, i) => {
      const track = UPGRADE_TRACKS[id];
      const level = run.profile.upgrades[id];
      const color = TRACK_COLOR[id];
      const cx = panelX + 40 + i * trackGap + trackGap / 2;
      const y = trackY + 26;

      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(track.label, cx, y);

      for (let d = 0; d < MAX_UPGRADE_LEVEL; d += 1) {
        const dx = cx - (MAX_UPGRADE_LEVEL - 1) * 8 + d * 16;
        ctx.beginPath();
        ctx.arc(dx, y + 16, 4, 0, Math.PI * 2);
        ctx.fillStyle = d < level ? color : 'rgba(255,255,255,0.18)';
        ctx.fill();
      }
    });

    // 最终血量与 M5 基地物资一起收尾：战斗产出若只写进档案却不在结算反馈，
    // 玩家无法建立“打这一关能推动基地”的因果关系。
    const hpY = trackY + 62;
    ctx.textAlign = 'center';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`血量 ${Math.ceil(run.profile.hp)} / ${run.profile.maxHp}`, canvas.width / 2, hpY);

    const baseY = hpY + 28;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + 40, baseY - 15);
    ctx.lineTo(panelX + panelW - 40, baseY - 15);
    ctx.stroke();
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 13px system-ui, sans-serif';
    const storedEquipment =
      run.profile.inventory.weapons.length +
      run.profile.inventory.armors.length +
      run.profile.inventory.accessories.length;
    ctx.fillText(`基地物资 · 库存装备 ${storedEquipment}`, canvas.width / 2, baseY);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '13px system-ui, sans-serif';
    const resources = run.profile.base.resources;
    ctx.fillText(
      `基础材料 ${resources.materials}  ·  图纸 ${resources.blueprints}  ·  稀有材料 ${resources.rareMaterials}`,
      canvas.width / 2,
      baseY + 22,
    );

    const newlyUnlocked = BUILDING_UNLOCKS.find(
      (building) => building.unlockAfterClears === run.profile.base.completedStageRuns,
    );
    if (newlyUnlocked) {
      ctx.fillStyle = '#8fd4c8';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(
        `新解锁 · ${newlyUnlocked.label} — ${newlyUnlocked.combatBenefit}`,
        canvas.width / 2,
        baseY + 46,
      );
    }

    ctx.restore();
  }

  /** 简单的自动换行，卡片文案够短，不需要更复杂的排版逻辑 */
  /**
   * `\n` 是文案里手写的分段点，优先按它换行；每段再做贪心式自动换行兜底
   * （防止某段仍然超宽）。纯自动换行在窄卡片上会把行尾一个字符单独挤成
   * 一行，手写分段点能保证换行落在语义边界上，不会切得很难看。
   */
  private wrapText(text: string, cx: number, startY: number, maxWidth: number, lineHeight: number): void {
    const { ctx } = this;
    let y = startY;
    for (const segment of text.split('\n')) {
      const chars = [...segment];
      let line = '';
      for (const ch of chars) {
        const next = line + ch;
        if (ctx.measureText(next).width > maxWidth && line) {
          ctx.fillText(line, cx, y);
          line = ch;
          y += lineHeight;
        } else {
          line = next;
        }
      }
      ctx.fillText(line, cx, y);
      y += lineHeight;
    }
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
