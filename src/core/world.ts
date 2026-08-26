/**
 * 世界推进：固定步长的逻辑帧。不引用任何渲染 API。
 *
 * 横版割草的战场是「带纵深的平面」：
 *   x 横向推进（左右走、面朝方向）
 *   y 是站位纵深（上下走，决定谁站前谁站后，也决定攻击能不能够到）
 * 屏幕上的绘制顺序按 y 排，y 大的画在后面（更远），这样遮挡关系是对的。
 */
import type {
  ActionState,
  DamageEvent,
  Entity,
  EnemyKind,
  Facing,
  InputIntent,
  Projectile,
  Team,
  Vec2,
  WorldEvents,
} from './types';
import {
  EXECUTE_THRESHOLD,
  HEAVY_FULL_CHARGE_FRAMES,
  JUMP_COOLDOWN,
  PERFECT_CANCEL_DAMAGE_MULT,
  canInterrupt,
  isActionAirborne,
  isActionInvulnerable,
  isPerfectCancel,
  resolveAction,
  resolveDashCooldown,
  resolveExecuteHeal,
  resolveExecuteRange,
  resolveSkillCost,
} from './actions';
import { ENEMY_PROFILES, think } from './enemies';
import { RunStats } from './stats';

export interface Arena {
  /** 可行走区域，纵深范围比横向窄得多——这是横版的空间感来源 */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 玩家输入比 AI 意图多技能、处决、跳跃，以及重击蓄力需要的攻击键持续状态。 */
export interface InputState extends InputIntent {
  /** 攻击键是否仍按住；重击用它区分短按释放和满蓄力，attack 仍只表示按下沿。 */
  attackHeld: boolean;
  skill: boolean;
  execute: boolean;
  jump: boolean;
}

export const EMPTY_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  attack: false,
  attackHeld: false,
  dash: false,
  skill: false,
  execute: false,
  jump: false,
};

/**
 * 会自动接续的动作链。远程和冲锋的「预警段 → 生效段」靠它衔接：
 * 预警段播完不回 idle，而是进入真正带判定的那一段。
 * 拆成两个动作而不是一个长动作，是为了让预警帧数可以单独调，
 * 调难度时不牵动判定窗口。
 */
const ACTION_CHAIN: Partial<Record<ActionState, ActionState>> = {
  aim: 'shoot',
  charge: 'rush',
  bossCharge: 'bossRush',
};

/** 敌人攻击链的收尾动作，播完才交还令牌 */
const TOKEN_RELEASING: ActionState[] = [
  'slash',
  'slash2',
  'slash3',
  'shoot',
  'rush',
  'heavy',
  'bossSlam',
  'bossRush',
  'bossNova',
  'bossSummon',
];

/** 命中回能。想放技能就得先打进去，这是 GAME_DESIGN 3.4 的第 4 条约束。 */
const ENERGY_PER_HIT = 7;
const ENERGY_PER_EXECUTE = 25;

/**
 * 输入缓冲窗口（帧）。玩家按键取的是"按下那一瞬间"，之前完全不缓冲——
 * 提前几帧按下一段连段的下一击，落在还不可打断的窗口里就被直接吃掉，
 * 玩家得掐着帧数精确落在收招段才按得出来，这正是"动作不连贯"的来源
 * 之一：连段深浅玩家操作是对的，游戏却没接住。8 帧（约 133ms）是格斗类
 * 游戏常见的缓冲宽度，够容错「提前出手」，也不至于长到让明显过时的
 * 按键还在几帧后突然生效、显得像输入延迟。
 */
const INPUT_BUFFER_FRAMES = 8;

let nextId = 1;
let nextProjectileId = 1;

/** 仅供无渲染逻辑回归隔离样本；正式游戏不调用，生产构建会 tree-shake。 */
export function resetWorldIdsForTesting(): void {
  nextId = 1;
  nextProjectileId = 1;
}

export function createEntity(team: Team, pos: Vec2, overrides: Partial<Entity> = {}): Entity {
  return {
    id: nextId++,
    team,
    pos: { ...pos },
    velocity: { x: 0, y: 0 },
    facing: team === 'player' ? 1 : -1,
    hp: 100,
    maxHp: 100,
    speed: 2.4,
    radius: 16,
    hurtbox: { offset: { x: 0, y: 0 }, halfWidth: 16, halfDepth: 12, height: 60 },
    action: 'idle',
    actionFrame: 0,
    hitTargets: new Set(),
    stunFrames: 0,
    invulnFrames: 0,
    knockback: { x: 0, y: 0 },
    attackCooldown: 0,
    energy: 0,
    maxEnergy: 100,
    dashCooldown: 0,
    jumpCooldown: 0,
    attackBuffer: 0,
    dashBuffer: 0,
    jumpBuffer: 0,
    skillBuffer: 0,
    executeBuffer: 0,
    lockedMoveDir: { x: 1, y: 0 },
    damageMultiplier: 1,
    skillDamageMultiplier: 1,
    skillCostMultiplier: 1,
    executeHealBonus: 0,
    damageTakenMultiplier: 1,
    perfectCancelPending: false,
    telegraph: null,
    ai: { turnCooldown: 0, repositionFrames: 0, bossPhase: 1, bossSummoned: false },
    dead: false,
    deadFrames: 0,
    ...overrides,
  };
}

/** 按类型建敌人。数值全部来自 ENEMY_PROFILES，避免散落在关卡代码里。 */
export function createEnemy(kind: EnemyKind, pos: Vec2): Entity {
  const p = ENEMY_PROFILES[kind];
  return createEntity('enemy', pos, {
    kind,
    hp: p.hp,
    maxHp: p.hp,
    speed: p.speed,
    radius: p.radius,
    frontalGuard: p.frontalGuard,
    backstabMultiplier: p.backstabMultiplier,
    hurtbox: {
      offset: { x: 0, y: 0 },
      halfWidth: p.radius,
      halfDepth: Math.round(p.radius * 0.78),
      height: 60,
    },
  });
}

export class World {
  entities: Entity[] = [];
  projectiles: Projectile[] = [];
  arena: Arena;
  /** 命中定格剩余帧。大于 0 时整个世界冻结，只有表现层继续播。 */
  freezeFrames = 0;
  /** 本轮允许出手的敌人 id。见 enemyThink 里对「攻击令牌」的说明。 */
  attackTokens = new Set<number>();
  /** 同时最多几个敌人能进攻。2 是清版格斗的常用值：有压迫感又留得出反击窗口。 */
  maxAttackers = 2;
  /** 逻辑帧计数，用于让敌人的游走错开相位 */
  tick = 0;
  events: WorldEvents = { damage: [], hitStop: 0, executes: [], skillCasts: [], bossPhaseShifts: [] };
  stats = new RunStats();

  constructor(arena: Arena) {
    this.arena = arena;
  }

  spawn(entity: Entity): Entity {
    this.entities.push(entity);
    return entity;
  }

  get player(): Entity | undefined {
    return this.entities.find((e) => e.team === 'player' && !e.dead);
  }

  /** 推进一个逻辑帧。input 只作用于玩家。 */
  step(input: InputState): WorldEvents {
    this.events = { damage: [], hitStop: 0, executes: [], skillCasts: [], bossPhaseShifts: [] };

    // 命中定格：全局冻结几帧，是「打到实处」最廉价也最有效的反馈。
    // 冻结期间不推进任何逻辑，连动画帧也停——这正是它有效的原因。
    if (this.freezeFrames > 0) {
      this.freezeFrames -= 1;
      return this.events;
    }

    this.tick += 1;
    this.stats.frames += 1;
    this.updateTokens();

    for (const e of this.entities) {
      if (e.dead) {
        e.deadFrames += 1;
        continue;
      }
      if (e.attackCooldown > 0) e.attackCooldown -= 1;
      if (e.dashCooldown > 0) e.dashCooldown -= 1;
      if (e.jumpCooldown > 0) e.jumpCooldown -= 1;
      const control = e.team === 'player' ? input : this.enemyThink(e);
      this.stepEntity(e, control);
    }

    this.recordEngagementDistance();

    this.releaseFinishedTokens();

    this.resolveHits();
    this.updateProjectiles();
    this.separate();
    this.clampToArena();
    this.updateTelegraphs();

    if (this.events.hitStop > 0) {
      this.freezeFrames = this.events.hitStop;
    }
    return this.events;
  }

  /**
   * 每个有效战斗帧只记一次“玩家到最近活敌人”的距离。
   * 用最近敌人而不是全体均值，避免远处尚未参战的远程兵把职业站位数据抬高。
   */
  private recordEngagementDistance(): void {
    const player = this.player;
    if (!player || player.dead) return;
    let nearest = Infinity;
    for (const enemy of this.entities) {
      if (enemy.team !== 'enemy' || enemy.dead) continue;
      nearest = Math.min(nearest, Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y));
    }
    if (Number.isFinite(nearest)) this.stats.recordEngagementDistance(nearest);
  }

  private stepEntity(e: Entity, input: InputState | InputIntent): void {
    if (e.invulnFrames > 0) e.invulnFrames -= 1;

    // 击退独立于主动移动，逐帧衰减。分开处理才能做到「被打飞时不能立刻走回来」。
    e.pos.x += e.knockback.x;
    e.pos.y += e.knockback.y;
    e.knockback.x *= 0.82;
    e.knockback.y *= 0.82;
    if (Math.abs(e.knockback.x) < 0.05) e.knockback.x = 0;
    if (Math.abs(e.knockback.y) < 0.05) e.knockback.y = 0;

    if (e.stunFrames > 0) {
      e.stunFrames -= 1;
      this.advanceAction(e);
      return;
    }

    // 远程的放箭帧：弹丸在这里生成，判定交给弹丸自己走
    if (e.action === 'shoot' && e.actionFrame === 2) {
      this.spawnProjectile(e);
    }

    // 首领召唤帧：动作播到一半才真正生成杂兵，让玩家先看清「它在做什么」
    // 再面对新出现的威胁，而不是杂兵凭空冒出来
    if (e.action === 'bossSummon' && e.actionFrame === 25 && !e.ai.bossSummoned) {
      this.spawnBossMinions(e);
      e.ai.bossSummoned = true;
    }

    const def = resolveAction(e.action, e.profession, e.weapon);
    const interruptible = canInterrupt(e.action, e.actionFrame, e.profession, e.weapon);
    const player = e.team === 'player' ? (input as InputState) : null;

    if (player && e.profession === 'heavy' && e.action === 'heavyCharge') {
      if (!player.attackHeld) {
        // 松键才决定释放档位；蓄满与否落成两个动作定义，命中层无需认识职业倍率。
        const release = e.actionFrame >= HEAVY_FULL_CHARGE_FRAMES ? 'heavyCharged' : 'heavy';
        this.setAction(e, release);
        this.recordAttackStat(release);
      } else if (e.actionFrame >= HEAVY_FULL_CHARGE_FRAMES) {
        // 满蓄力后停在最后一帧等待松键，不能让非循环动作自然播完回 idle。
        // advanceAction 在本函数末尾仍会 +1，因此这里先退一帧保持稳定。
        e.actionFrame = HEAVY_FULL_CHARGE_FRAMES - 1;
      }
    }

    if (player) {
      // 边缘按下就先记进缓冲区，不管这一帧能不能立刻响应——真正能不能
      // 出手仍然由下面的 interruptible 判断，缓冲区只负责"记住按过"。
      if (player.execute) e.executeBuffer = INPUT_BUFFER_FRAMES;
      if (player.skill) e.skillBuffer = INPUT_BUFFER_FRAMES;
      if (player.attack) e.attackBuffer = INPUT_BUFFER_FRAMES;
      if (player.jump) e.jumpBuffer = INPUT_BUFFER_FRAMES;
      if (player.dash) e.dashBuffer = INPUT_BUFFER_FRAMES;
    }

    if (player && interruptible) {
      // 处决和技能都没有腾空语义（没有 airborne 字段，渲染层的跳跃高度
      // 偏移也只认 jump/airSlash），腾空时触发的话人会从半空瞬间"贴地"，
      // 跟冲刺当年在腾空时触发同一个问题——见下面 dash 分支的说明。
      // 跳跃已经有跳劈这个腾空专属的取消出口，处决/技能都留给落地之后。
      // 处决优先于普攻：残血目标在手边时，玩家按处决键不该被解释成挥空刀
      if (
        e.executeBuffer > 0 &&
        !isActionAirborne(e.action, e.actionFrame, e.profession, e.weapon) &&
        this.tryExecute(e)
      ) {
        e.executeBuffer = 0;
      } else if (
        e.skillBuffer > 0 &&
        !isActionAirborne(e.action, e.actionFrame, e.profession, e.weapon) &&
        e.energy >= resolveSkillCost(e.profession) * e.skillCostMultiplier
      ) {
        e.energy -= resolveSkillCost(e.profession) * e.skillCostMultiplier;
        this.setAction(e, 'skill');
        this.stats.recordAction('skill');
        e.skillBuffer = 0;
      } else if (e.attackBuffer > 0) {
        // 只在新一轮攻击起手时响应方向转身，连段中途（e.action 已经是
        // slash/slash2/slash3）不转身——不然连段打到一半角色转向会显得很怪。
        // 位移量不变，这只是让玩家能"按方向快速转身打另一侧的敌人"，
        // 不是把普攻也变成一个位移技能。
        if (
          e.action !== 'slash' &&
          e.action !== 'slash2' &&
          e.action !== 'slash3' &&
          Math.abs(player.moveX) > 0.2
        ) {
          e.facing = (player.moveX > 0 ? 1 : -1) as Facing;
        }
        if (e.profession === 'heavy') {
          this.setAction(e, 'heavyCharge');
        } else if (e.profession === 'arcane') {
          if (
            e.action === 'arcanePulse' &&
            isPerfectCancel(e.action, e.actionFrame, e.profession, e.weapon)
          ) {
            e.perfectCancelPending = true;
            this.stats.perfectCancels += 1;
          }
          this.setAction(e, 'arcanePulse');
          this.recordAttackStat('arcanePulse');
        } else {
          this.startAttack(e, def.cancelInto?.[0]);
        }
        e.attackBuffer = 0;
      } else if (e.jumpBuffer > 0 && e.action !== 'jump' && e.action !== 'airSlash' && e.jumpCooldown <= 0) {
        this.setAction(e, 'jump');
        this.lockMoveDirection(e, player);
        e.jumpCooldown = JUMP_COOLDOWN;
        this.stats.recordAction('jump');
        e.jumpBuffer = 0;
      } else if (
        e.dashBuffer > 0 &&
        e.action !== 'dash' &&
        e.dashCooldown <= 0 &&
        !isActionAirborne(e.action, e.actionFrame, e.profession, e.weapon)
      ) {
        // 腾空时不能触发冲刺——冲刺是地面动作，没有腾空语义，
        // 人还在半空中一按冲刺就会瞬间"凭空消失、贴地冲出去"，
        // 跟落地那一下的视觉完全脱节。跳跃已经有跳劈作为取消出口，
        // 不需要再开一个"腾空接地面位移"的口子。反过来「冲刺接跳跃」
        // 完全自然（贴地滑行后一跃而起），所以只挡这一个方向。
        this.setAction(e, 'dash');
        this.lockMoveDirection(e, player);
        e.dashCooldown = resolveDashCooldown(e.profession);
        this.stats.recordAction('dash');
        e.dashBuffer = 0;
      }
    } else if (!player && input.attack && interruptible) {
      // 敌人：起手动作由类型决定（贴脸挥砍 / 瞄准 / 蓄力冲锋 / 重击）。
      // input.action 是 AI 动态点名的具体招式，只有首领会用到——
      // 它要在重击/突进/范围技之间切换，一个固定的 attackAction 表达不了。
      const profile = ENEMY_PROFILES[e.kind ?? 'grunt'];
      const wantAction = input.action ?? profile.attackAction;
      if (e.action !== wantAction) {
        this.setAction(e, wantAction);
      }
    }

    // 缓冲区衰减必须放在消费判断**之后**，不能放在这一帧处理的最前面——
    // 之前试过把它放进 world.step() 的外层循环，在 stepEntity 之前统一递减，
    // 结果差一帧：缓冲区设为 8 帧后，恰好数到第 8 帧 interruptible 才打开
    // 的那一刻，本帧的递减已经先把它减到 0，判断时读到的是减过的值，
    // 消费判断必然落空——等于缓冲区实际只能容忍 7 帧的提前量，比文档
    // 写的 8 帧少了一帧。放在这里，本帧要么先被上面的分支读到非零值并
    // 清零消费掉，要么才轮到这行衰减，值和时序都对得上。
    if (e.attackBuffer > 0) e.attackBuffer -= 1;
    if (e.dashBuffer > 0) e.dashBuffer -= 1;
    if (e.jumpBuffer > 0) e.jumpBuffer -= 1;
    if (e.skillBuffer > 0) e.skillBuffer -= 1;
    if (e.executeBuffer > 0) e.executeBuffer -= 1;

    // 动作自带的位移（挥砍前冲、冲刺、突进）优先于主动移动，但只在曲线
    // 这一帧真的有位移量时才接管——普攻/冲刺/跳劈的位移曲线都是「前段几帧
    // 冲一下，后面一长串收招帧全是 0」，之前不管数值直接按数组长度锁死
    // 整个动作，导致可取消的收招段虽然能接下一击，却完全走不动、
    // 连方向键都不响应，人像焊在地上——这正是"动作发死、不连贯"的一处
    // 具体成因。冲刺/跳跃的位移曲线中途没有 0（跳跃全程都是抛物线的一部分，
    // 手感上不该半路被走位打断），所以这条改动不影响它们的连贯位移。
    const motion = resolveAction(e.action, e.profession, e.weapon).motion;
    const before = { x: e.pos.x, y: e.pos.y };
    if (motion && e.actionFrame < motion.length && motion[e.actionFrame] !== 0) {
      const step = motion[e.actionFrame];
      if (e.action === 'dash' || e.action === 'jump') {
        // 冲刺和跳跃都走锁定方向；纵深照样压 62%，否则斜着比直着快，空间感就塌了
        e.pos.x += step * e.lockedMoveDir.x;
        e.pos.y += step * e.lockedMoveDir.y * 0.62;
      } else {
        e.pos.x += step * e.facing;
      }
    } else if (canInterrupt(e.action, e.actionFrame, e.profession, e.weapon)) {
      const len = Math.hypot(input.moveX, input.moveY);
      if (len > 0.01) {
        const nx = input.moveX / len;
        const ny = input.moveY / len;
        e.pos.x += nx * e.speed;
        // 纵深方向移速压低，否则斜着走会比横着走快，而且纵深过快会破坏横版的空间感
        e.pos.y += ny * e.speed * 0.62;
        this.faceTowards(e, nx);
        if (e.action === 'idle') this.setAction(e, 'move');
      } else if (e.action === 'move') {
        this.setAction(e, 'idle');
      }
    }

    if (e.team === 'player') {
      this.stats.recordMove(e.pos.x - before.x, e.pos.y - before.y);
    }

    this.advanceAction(e);
  }

  /**
   * 位移类动作（冲刺、跳跃）起手时锁定方向：有方向键就按方向键，
   * 没有就沿朝向前冲。锁定而不是逐帧跟随输入，是因为一旦开始就该是
   * 一段确定的位移——中途还能拐弯的话，冲刺的无敌帧和跳跃的腾空豁免
   * 就变成了「随便乱按也能贴脸游走」。
   */
  private lockMoveDirection(e: Entity, input: InputState): void {
    const len = Math.hypot(input.moveX, input.moveY);
    if (len > 0.01) {
      e.lockedMoveDir = { x: input.moveX / len, y: input.moveY / len };
      if (Math.abs(input.moveX) > 0.2) {
        e.facing = (input.moveX > 0 ? 1 : -1) as Facing;
      }
      return;
    }
    e.lockedMoveDir = { x: e.facing, y: 0 };
  }

  /**
   * 普攻起手／接续连段，顺手记账供验收统计用。
   *
   * chained 是当前动作声明的 cancelInto 目标——不再写死只认 slash/slash2：
   * 跳跃取消接的是 airSlash，硬编码两段判断会让这次触发既不计入统计，
   * 也没有 cancelInto 时还会把玩家从半空的跳劈收招段瞬间拽回地面 slash，
   * 人明明还没落地，动作却已经站在地上挥刀了。
   */
  private startAttack(e: Entity, chained: ActionState | undefined): void {
    if (chained && e.action !== chained) {
      // 完美取消判定：这一刻 e.action/e.actionFrame 还是"来源动作"，
      // setAction 之后就没法回头看了，必须在切换前读。只有玩家用得上——
      // 敌人不需要这层反馈，perfectCancelPending 恒为 false。
      if (
        e.team === 'player' &&
        isPerfectCancel(e.action, e.actionFrame, e.profession, e.weapon)
      ) {
        e.perfectCancelPending = true;
        this.stats.perfectCancels += 1;
      }
      this.setAction(e, chained);
      this.recordAttackStat(chained);
      return;
    }
    // 走到这里说明 chained 是空的——slash/airSlash 都声明了 cancelInto，
    // 只要 e.action 真的是它们俩，chained 必然非空，早在上面的分支里
    // return 掉了，根本到不了这一行，所以这两条排除其实是死代码，留着
    // 只是防御性占位。共享动作表里真正会落到这里的是 slash2（唯一没有
    // cancelInto 的普攻段）——第一版把它也排除在外，导致二段收招时再按攻击键完全没
    // 反应，连段打完之后有一小段"按键黑洞"，这正是连段显得断掉的一处
    // 具体成因。这里应该和 idle/move/dash 收招段一样，重新起一次挥砍，
    // 让二段收招段也能立刻循环回第一段，而不是必须等它播完才能再出手。
    if (e.action !== 'slash' && e.action !== 'airSlash') {
      this.setAction(e, 'slash');
      this.recordAttackStat('slash');
    }
  }

  private recordAttackStat(action: ActionState): void {
    if (
      action === 'slash' ||
      action === 'slash2' ||
      action === 'slash3' ||
      action === 'heavy' ||
      action === 'heavyCharged' ||
      action === 'arcanePulse' ||
      action === 'airSlash'
    ) {
      this.stats.recordAction(action);
    }
  }

  /**
   * 转向。盾兵慢半拍——这不是手感瑕疵而是设计要求：
   * 转身即时的话玩家永远绕不到它背后，正面减伤就只是血量膨胀。
   */
  private faceTowards(e: Entity, nx: number): void {
    if (Math.abs(nx) <= 0.2) return;
    const want = (nx > 0 ? 1 : -1) as Facing;
    if (want === e.facing) {
      e.ai.turnCooldown = 0;
      return;
    }
    const delay = e.team === 'enemy' ? ENEMY_PROFILES[e.kind ?? 'grunt'].turnDelay : 0;
    if (delay <= 0) {
      e.facing = want;
      return;
    }
    e.ai.turnCooldown += 1;
    if (e.ai.turnCooldown >= delay) {
      e.facing = want;
      e.ai.turnCooldown = 0;
    }
  }

  /**
   * 处决：找手边最近的残血敌人。找不到就返回 false，
   * 让按键回落成普攻，而不是原地播一个空动作——那样按错一次就白挨一轮打。
   */
  private tryExecute(player: Entity): boolean {
    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const e of this.entities) {
      if (e.dead || e.team === 'player') continue;
      if (e.hp / e.maxHp >= EXECUTE_THRESHOLD) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.y - player.pos.y);
      if (d <= resolveExecuteRange(player.profession) && d < bestDist) {
        best = e;
        bestDist = d;
      }
    }
    if (!best) return false;
    // 处决要转向目标，否则背对着按会砍空，玩家会以为是判定不准
    if (Math.abs(best.pos.x - player.pos.x) > 1) {
      player.facing = (best.pos.x > player.pos.x ? 1 : -1) as Facing;
    }
    this.setAction(player, 'execute');
    this.stats.recordAction('execute');
    return true;
  }

  private advanceAction(e: Entity): void {
    const def = resolveAction(e.action, e.profession, e.weapon);
    e.actionFrame += 1;
    if (e.actionFrame < def.frames) return;

    if (def.loop) {
      e.actionFrame = 0;
      return;
    }
    // 预警段播完自动进入生效段（aim→shoot、charge→rush）
    const next = ACTION_CHAIN[e.action];
    this.setAction(e, next ?? 'idle');
  }

  setAction(e: Entity, state: ActionState): void {
    e.action = state;
    e.actionFrame = 0;
    e.hitTargets.clear();
  }

  /**
   * 敌人 AI：抢到「攻击令牌」的才准出手，其余的在外围绕。
   *
   * 这是清版格斗的标准解法。不做令牌的话，五个敌人同时贴脸输出，
   * 玩家每次受击进 20 帧硬直，永远轮不到自己出手——实测就是站着被打死，
   * 而且不是数值问题：把敌人伤害调到 1 也一样操作不了。
   * 令牌把「同时能打你的人数」压到 1-2 个，其余的负责制造包围感，
   * 玩家因此始终有出手窗口，围殴的压迫感却还在。
   *
   * 具体的走位和起手条件按类型分流，见 enemies.ts。
   */
  private enemyThink(e: Entity): InputIntent {
    const target = this.player;
    if (!target) return EMPTY_INPUT;
    // 已经在出招途中就不再改朝向，否则冲锋会在突进中途拐弯，预警线就成了谎话
    const busy = e.action !== 'idle' && e.action !== 'move';
    if (!busy) {
      const dx = target.pos.x - e.pos.x;
      if (Math.abs(dx) > 1) this.faceTowards(e, dx);
    }
    return think(e, target, this.tick, this.attackTokens.has(e.id));
  }

  /** 发放攻击令牌：把最近的若干敌人选为本轮进攻者。 */
  private updateTokens(): void {
    const target = this.player;
    if (!target) {
      this.attackTokens.clear();
      return;
    }
    // 已经在出手的保留令牌，避免招式打到一半被收走导致动作中断
    for (const id of [...this.attackTokens]) {
      const e = this.entities.find((x) => x.id === id);
      if (!e || e.dead) this.attackTokens.delete(id);
    }
    if (this.attackTokens.size >= this.maxAttackers) return;

    const candidates = this.entities
      .filter(
        (e) =>
          e.team === 'enemy' &&
          !e.dead &&
          !this.attackTokens.has(e.id) &&
          // 刚出完手的要等冷却，否则同一个敌人会立刻把令牌抢回去，
          // 轮流进攻就退化成一个人贴着你连打。
          e.attackCooldown <= 0,
      )
      .map((e) => ({ e, d: Math.hypot(e.pos.x - target.pos.x, e.pos.y - target.pos.y) }))
      .sort((a, b) => a.d - b.d);

    while (this.attackTokens.size < this.maxAttackers && candidates.length) {
      const next = candidates.shift();
      if (next) this.attackTokens.add(next.e.id);
    }
  }

  /** 出手结束就交还令牌，让下一个敌人接上，形成轮流进攻的节奏。 */
  private releaseFinishedTokens(): void {
    for (const id of [...this.attackTokens]) {
      const e = this.entities.find((x) => x.id === id);
      if (!e || e.dead) {
        this.attackTokens.delete(id);
        continue;
      }
      // 预警段（aim/charge）不释放令牌，它们后面还接着真正的生效段
      const attacking = TOKEN_RELEASING.includes(e.action);
      if (
        attacking &&
        e.actionFrame >= resolveAction(e.action, e.profession, e.weapon).frames - 1
      ) {
        this.attackTokens.delete(id);
        e.attackCooldown = ENEMY_PROFILES[e.kind ?? 'grunt'].tokenCooldown;
      }
    }
  }

  /**
   * 预警更新。逻辑层只声明「这一招现在看得见」，形状怎么画是渲染层的事。
   * 只给敌人生成——玩家不需要预告自己要干什么。
   */
  private updateTelegraphs(): void {
    for (const e of this.entities) {
      if (e.dead || e.team !== 'enemy') {
        e.telegraph = null;
        continue;
      }
      const tel = resolveAction(e.action, e.profession, e.weapon).telegraph;
      if (!tel || e.actionFrame >= tel.until) {
        e.telegraph = null;
        continue;
      }
      e.telegraph = { shape: tel.shape, frame: e.actionFrame, frames: tel.until };
    }
  }

  /** 攻击判定：只在 hitbox 生效帧内检测，且每次动作对同一目标只结算一次。 */
  private resolveHits(): void {
    for (const attacker of this.entities) {
      if (attacker.dead) continue;
      const def = resolveAction(attacker.action, attacker.profession, attacker.weapon);
      for (const box of def.hitboxes) {
        if (attacker.actionFrame < box.activeFrom || attacker.actionFrame >= box.activeTo) {
          continue;
        }
        // 圆形判定也允许把圆心放在角色前方；通用解围技 offset=0，
        // 术法则用正 offset 创造中距离落点，两者走同一条碰撞路径。
        const cx = attacker.pos.x + box.offset.x * attacker.facing;
        const cy = attacker.pos.y + box.offset.y;

        if (box.radial && attacker.team === 'player' && attacker.actionFrame === box.activeFrom) {
          this.events.skillCasts.push({
            at: { x: cx, y: cy },
            radius: box.halfWidth,
            power: attacker.action === 'arcanePulse' ? 'light' : 'heavy',
          });
        }

        for (const target of this.entities) {
          if (target.dead || target.team === attacker.team) continue;
          if (this.isInvulnerable(target)) continue;
          // 腾空目标躲开非 hitsAir 的判定——这是跳跃的核心效果。
          // 简化模型：不做真正的高度轴碰撞体积，只用区间 + 布尔标记决定命中。
          if (!box.hitsAir && this.isAirborne(target)) continue;
          if (attacker.hitTargets.has(target.id)) continue;

          const tx = target.pos.x + target.hurtbox.offset.x;
          const ty = target.pos.y + target.hurtbox.offset.y;
          const overlapX = Math.abs(tx - cx) <= box.halfWidth + target.hurtbox.halfWidth;
          const overlapY = Math.abs(ty - cy) <= box.halfDepth + target.hurtbox.halfDepth;
          if (!overlapX || !overlapY) continue;

          attacker.hitTargets.add(target.id);
          this.applyDamage(attacker, target, box.damage, box.knockback, box.hitStop);
        }
      }
    }
  }

  /** 无敌判定合并了两个来源：受击后的保护帧，和动作自带的无敌区间（冲刺、处决）。 */
  private isInvulnerable(e: Entity): boolean {
    return (
      e.invulnFrames > 0 ||
      isActionInvulnerable(e.action, e.actionFrame, e.profession, e.weapon)
    );
  }

  /** 是否处于跳跃的腾空区间——注意这不是无敌，只对非 hitsAir 的判定免疫。 */
  private isAirborne(e: Entity): boolean {
    return isActionAirborne(e.action, e.actionFrame, e.profession, e.weapon);
  }

  private spawnProjectile(shooter: Entity): void {
    const target = this.player;
    if (!target) return;
    const dx = target.pos.x - shooter.pos.x;
    const dy = target.pos.y - shooter.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = 6.2;
    this.projectiles.push({
      id: nextProjectileId++,
      team: shooter.team,
      owner: shooter.id,
      pos: { x: shooter.pos.x + shooter.facing * 18, y: shooter.pos.y - 4 },
      velocity: { x: (dx / len) * speed, y: (dy / len) * speed * 0.62 },
      radius: 7,
      damage: 11,
      knockback: 3.0,
      life: 150,
      dead: false,
    });
  }

  private updateProjectiles(): void {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.pos.x += p.velocity.x;
      p.pos.y += p.velocity.y;
      p.life -= 1;
      if (
        p.life <= 0 ||
        p.pos.x < this.arena.minX - 60 ||
        p.pos.x > this.arena.maxX + 60 ||
        p.pos.y < this.arena.minY - 60 ||
        p.pos.y > this.arena.maxY + 60
      ) {
        p.dead = true;
        continue;
      }
      for (const target of this.entities) {
        if (target.dead || target.team === p.team) continue;
        if (this.isInvulnerable(target)) continue;
        // 弹丸贴地飞行，天然打不到腾空目标——跳过预警射线正是
        // GAME_DESIGN 3.5 给远程类型写的另一条解法「用纵深躲，或跳过去」。
        if (this.isAirborne(target)) continue;
        const dx = target.pos.x + target.hurtbox.offset.x - p.pos.x;
        const dy = target.pos.y + target.hurtbox.offset.y - p.pos.y;
        if (
          Math.abs(dx) > p.radius + target.hurtbox.halfWidth ||
          Math.abs(dy) > p.radius + target.hurtbox.halfDepth
        ) {
          continue;
        }
        const owner = this.entities.find((e) => e.id === p.owner);
        p.dead = true;
        this.applyProjectileDamage(owner, target, p);
        break;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  private applyProjectileDamage(owner: Entity | undefined, target: Entity, p: Projectile): void {
    const dir: Facing = p.velocity.x >= 0 ? 1 : -1;
    this.dealDamage(target, p.damage, p.knockback, 5, dir, {
      attacker: owner?.id ?? -1,
      // 弹丸来自 aim 段，那 24 帧的射线就是它的预警
      telegraphed: true,
      attackerKind: owner?.kind,
    });
  }

  private applyDamage(
    attacker: Entity,
    target: Entity,
    damage: number,
    knockback: number,
    hitStop: number,
  ): void {
    let dealt = damage;

    // 玩家的成长加成（锋芒/玄术路线）。处决走的是必杀逻辑，不受这两条影响，
    // 所以放在 isExecute 覆盖之前应用没问题——反正后面会被直接盖掉。
    if (attacker.team === 'player') {
      dealt *=
        attacker.action === 'skill' ? attacker.skillDamageMultiplier : attacker.damageMultiplier;
    }

    // 完美取消加成：只对触发完美取消后紧接着的这一次命中生效，用完立刻
    // 清空标记——是"反应快"的一次性奖励，不会叠加成持续增益。
    // 处决/技能不经过这里设置这个标记（它们走 tryExecute/独立分支，
    // 不经过 startAttack），所以处决的必杀伤害不会被这条额外放大。
    let perfectHit = false;
    if (attacker.perfectCancelPending) {
      dealt *= PERFECT_CANCEL_DAMAGE_MULT;
      perfectHit = true;
      attacker.perfectCancelPending = false;
    }

    let backstab = false;
    let guarded = false;

    // 盾兵的正反面差异。判断依据是攻击者站在防守者的哪一侧，
    // 不是攻击者自己的朝向——玩家绕到背后砍，砍的方向是朝回来的。
    if (target.frontalGuard !== undefined) {
      const fromFront = (attacker.pos.x - target.pos.x) * target.facing > 0;
      if (fromFront) {
        dealt *= target.frontalGuard;
        guarded = true;
      } else {
        dealt *= target.backstabMultiplier ?? 1;
        backstab = true;
      }
    }

    const isExecute = attacker.action === 'execute';
    if (isExecute) {
      // 处决只对残血目标起手，这里直接终结，不再走减伤
      dealt = target.hp;
      guarded = false;
    }

    const telegraphed = attacker.team === 'enemy' ? this.wasTelegraphed(attacker) : true;
    const killed = this.dealDamage(target, dealt, knockback, hitStop, attacker.facing, {
      attacker: attacker.id,
      backstab,
      guarded,
      execute: isExecute,
      telegraphed,
      attackerKind: attacker.kind,
      perfectCancel: perfectHit,
    });

    // 玩家命中回能，攒够才能放技能——这条约束是「不无脑平 A」的支点之一
    if (attacker.team === 'player') {
      attacker.energy = Math.min(
        attacker.maxEnergy,
        attacker.energy + (isExecute ? ENERGY_PER_EXECUTE : ENERGY_PER_HIT),
      );
    }

    if (isExecute && killed) {
      const healed = resolveExecuteHeal(attacker.profession) + attacker.executeHealBonus;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + healed);
      this.stats.executes += 1;
      this.events.executes.push({ at: { x: target.pos.x, y: target.pos.y }, healed });
    }
  }

  /**
   * 伤害结算的唯一出口。近战和弹丸都走这里，
   * 免得「超级护甲」「无敌帧」「统计埋点」这些规则在两处各写一遍然后慢慢跑偏。
   */
  private dealDamage(
    target: Entity,
    damage: number,
    knockback: number,
    hitStop: number,
    dir: Facing,
    meta: {
      attacker: number;
      backstab?: boolean;
      guarded?: boolean;
      execute?: boolean;
      telegraphed?: boolean;
      attackerKind?: EnemyKind;
      perfectCancel?: boolean;
    },
  ): boolean {
    // 护甲只影响玩家实际承受的伤害；统计、飘字和致死判断必须使用同一个结果，
    // 否则画面显示 20、血条却只掉 18，验收数据也会和真实战斗分叉。
    const appliedDamage =
      target.team === 'player' ? damage * target.damageTakenMultiplier : damage;
    target.hp -= appliedDamage;
    const killed = target.hp <= 0;

    // 超级护甲：照常掉血，但不进硬直、不换动作。
    // 精英因此「打不断」，玩家只能靠走位躲而不是靠输出压制。
    const armored = resolveAction(target.action, target.profession, target.weapon).superArmor === true;
    if (armored) {
      // 仍给几帧无敌，防的是同一帧被多段判定重复结算，不是防连击
      target.invulnFrames = Math.max(target.invulnFrames, 6);
    } else {
      target.knockback.x = knockback * dir;
      target.knockback.y = 0;
      target.stunFrames = 12;
      target.invulnFrames = 20;
      this.setAction(target, 'hit');
    }

    if (killed) {
      target.hp = 0;
      target.dead = true;
      if (target.team === 'enemy') this.stats.recordKill(target.kind);
      if (target.team === 'player') this.stats.died = true;
    } else if (
      target.kind === 'boss' &&
      target.ai.bossPhase === 1 &&
      target.hp / target.maxHp <= 0.5
    ) {
      this.triggerBossPhaseTwo(target);
    }

    if (target.team === 'player') {
      this.stats.recordDamageTaken(
        appliedDamage,
        meta.telegraphed === true,
        meta.attackerKind ?? 'unknown',
        killed,
      );
    }

    const event: DamageEvent = {
      attacker: meta.attacker,
      target: target.id,
      damage: Math.round(appliedDamage),
      at: { x: target.pos.x, y: target.pos.y },
      killed,
      backstab: meta.backstab,
      guarded: meta.guarded,
      execute: meta.execute,
      telegraphed: meta.telegraphed,
      perfectCancel: meta.perfectCancel,
    };
    this.events.damage.push(event);
    // 击杀的定格更长一点，让"斩杀"这件事被看见
    this.events.hitStop = Math.max(this.events.hitStop, killed ? hitStop + 4 : hitStop);
    return killed;
  }

  /**
   * 首领血量降到 50% 触发一次阶段切换：强制打断当前招式，切进召唤动作，
   * 并在事件里记一笔——渲染层靠这个放特写、打出「阶段二」的提示。
   * 不给明确表现的话，玩家只会觉得「这家伙怎么突然开始放大招了」。
   */
  private triggerBossPhaseTwo(boss: Entity): void {
    boss.ai.bossPhase = 2;
    this.setAction(boss, 'bossSummon');
    this.events.bossPhaseShifts.push({ at: { x: boss.pos.x, y: boss.pos.y }, phase: 2 });
  }

  /**
   * 阶段二召唤两个杂兵，只在切换那一刻触发一次——bossSummoned 挡住重复触发。
   * 召唤出的杂兵走的是标准 createEnemy 路径，照样要抢攻击令牌，
   * 不会因为是「首领召唤的」就获得特权同时围殴玩家，
   * M1 已经验证过那样的结果是玩家站着被打死。
   */
  private spawnBossMinions(boss: Entity): void {
    const offsets = [
      { x: -76, y: -42 },
      { x: -76, y: 42 },
    ];
    for (const off of offsets) {
      this.spawn(createEnemy('grunt', { x: boss.pos.x + off.x, y: boss.pos.y + off.y }));
    }
  }

  /**
   * 这一招有没有给过预警。M1 验收第 4 条要求「所有致死伤害都有可见预警」，
   * 判定依据就是攻击动作本身是否声明了 telegraph，
   * 以及它是不是某个预警段接续下来的生效段（rush 接 charge、shoot 接 aim）。
   */
  private wasTelegraphed(attacker: Entity): boolean {
    if (resolveAction(attacker.action, attacker.profession, attacker.weapon).telegraph) return true;
    for (const [pre, post] of Object.entries(ACTION_CHAIN)) {
      if (
        post === attacker.action &&
        resolveAction(pre as ActionState, attacker.profession, attacker.weapon).telegraph
      ) {
        return true;
      }
    }
    return false;
  }

  /** 简单的圆形推挤，防止敌人叠在同一个点上变成一坨。 */
  private separate(): void {
    const list = this.entities.filter((e) => !e.dead);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dy = (b.pos.y - a.pos.y) * 1.6; // 纵深方向更"厚"，避免前后重叠
        const dist = Math.hypot(dx, dy) || 0.001;
        const min = a.radius + b.radius;
        if (dist >= min) continue;
        const push = (min - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.pos.x -= nx * push;
        a.pos.y -= (ny * push) / 1.6;
        b.pos.x += nx * push;
        b.pos.y += (ny * push) / 1.6;
      }
    }
  }

  private clampToArena(): void {
    for (const e of this.entities) {
      e.pos.x = Math.min(this.arena.maxX, Math.max(this.arena.minX, e.pos.x));
      e.pos.y = Math.min(this.arena.maxY, Math.max(this.arena.minY, e.pos.y));
    }
  }
}
