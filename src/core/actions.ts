/**
 * 动作定义：帧数、判定框生效区间、位移曲线、连招取消关系。
 *
 * 帧数分配就是打击感——这条是上一轮调动作参数实测出来的：
 * 挥砍前摇慢、挥出只占 2-3 帧所以显得快、命中后定格几帧让力道落地。
 * 这里的数值和 ai-asset-pipeline 动作库里的 slash/slash2 是同一套节奏，
 * 美术帧和逻辑帧对齐，判定生效的那一帧正好是画面上剑挥到位的那一帧。
 *
 * M1 新增的招式沿用同一套原则，另加一条：
 * **敌人的高伤害招式，前摇越长伤害越高**。前摇就是预警，
 * 玩家付出「读招」的注意力，换来躲开的机会——这是「不觉得不公平」的实现方式。
 */
import type { ActionDef, ActionState, Profession } from './types';
import type { WeaponId } from './equipment';

/** 逻辑帧率。固定步长，不跟随显示帧率，保证手感在任何设备一致。 */
export const TICK_RATE = 60;

/** 技能消耗的能量。命中积累，攒够才能放，逼玩家先打进去。 */
export const SKILL_COST = 50;

/** 术法把技能当主输出手段，基础消耗更低；局内玄术成长继续乘在结果上。 */
export function resolveSkillCost(profession?: Profession): number {
  return profession === 'arcane' ? 30 : SKILL_COST;
}

/** 低于这个血量比例的敌人可被处决。GAME_DESIGN 3.4 定的 25%。 */
export const EXECUTE_THRESHOLD = 0.25;

/** 处决的有效距离，比普攻 reach 略大，否则会频繁扑空导致玩家放弃用 */
export const EXECUTE_RANGE = 62;

/** 术法不该为了处决违反中距离定位，触发距离和实际判定会一起扩展。 */
export function resolveExecuteRange(profession?: Profession): number {
  return profession === 'arcane' ? 100 : EXECUTE_RANGE;
}

/** 重装靠承伤换输出窗口，处决提供更高回复，闭合“扛住后反打”的职业循环。 */
export const EXECUTE_HEAL = 14;

export function resolveExecuteHeal(profession?: Profession): number {
  return profession === 'heavy' ? 28 : EXECUTE_HEAL;
}

/** 冲刺冷却帧数。太短会退化成无脑冲，太长会让唯一的防御手段不可靠。 */
export const DASH_COOLDOWN = 45;

/** 职业的防御代价在这里统一解析：疾锋更频繁，重击更依赖站桩抗压。 */
export function resolveDashCooldown(profession?: Profession): number {
  if (profession === 'swift') return 30;
  if (profession === 'heavy') return 70;
  return DASH_COOLDOWN;
}

/** 超级护甲只防硬直不防伤害；少量基础减伤让重装的“抗压”定位真实成立。 */
export function resolveProfessionDamageTakenMultiplier(profession?: Profession): number {
  return profession === 'heavy' ? 0.85 : 1;
}

/** 重击蓄满所需帧数；约半秒，足够让站桩预判成为真实代价。 */
export const HEAVY_FULL_CHARGE_FRAMES = 30;

/**
 * 跳跃冷却帧数。跳跃只免疫贴地判定（不是全无敌），所以定得比冲刺短一点，
 * 但也不能太短——腾空区间本身有 24 帧，冷却太短会让「贴地判定基本失效」，
 * 跳跃就从「读时机的第二种防御手段」退化成「一直挂着的免疫状态」。
 */
export const JUMP_COOLDOWN = 40;

/**
 * 完美取消命中的伤害倍率。+15% 是刻意选的克制数值——这是给"反应快"的
 * 一次性奖励，不是数值系统的另一条加成线，加太多会和局内三选一的成长
 * 倍率（锋芒每级 +12%）互相抢戏，让"哪个数字更重要"变得含糊。
 */
export const PERFECT_CANCEL_DAMAGE_MULT = 1.15;

export const ACTIONS: Record<ActionState, ActionDef> = {
  idle: {
    id: 'idle',
    frames: 48,
    loop: true,
    cancelable: true,
    hitboxes: [],
  },

  move: {
    id: 'move',
    frames: 33,
    loop: true,
    cancelable: true,
    hitboxes: [],
  },

  /** 第一段：纵劈。前摇 8 帧，第 9-11 帧判定，之后收招。 */
  slash: {
    id: 'slash',
    frames: 24,
    loop: false,
    cancelable: false,
    // 挥出瞬间带一点前冲，砍空时也有重心前移的感觉
    motion: [0, 0, 0, 0, 0, 0, 0, 0, 1.2, 2.4, 1.6, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [
      {
        offset: { x: 34, y: 0 },
        halfWidth: 30,
        halfDepth: 22,
        activeFrom: 8,
        activeTo: 12,
        damage: 12,
        knockback: 3.2,
        hitStop: 5,
      },
    ],
    // 命中窗口之后才允许接第二段，太早接会让第一段看起来没打完
    cancelInto: ['slash2'],
    // 贴脸普攻的伤害虽然低，预警照样要给。
    // M1 验收第 4 条要的是「所有致死伤害都有可见预警」——
    // 被杂兵磨掉最后 12 点血也是死，不能因为单下伤害低就免了预告。
    // 前摇本来就是 8 帧的提示，这里只是把它画出来。渲染层只对敌人显示。
    telegraph: { shape: { kind: 'arc', radius: 62, halfAngle: 0.72 }, until: 8 },
    // 可取消窗口是 12-24 帧（12 帧宽，容错率不低）；完美窗口只取最早的
    // 4 帧（12-16），奖励的是"收招一开始就接上"，不是"随便什么时候接
    // 都一样"。
    perfectCancelWindow: { from: 12, to: 16 },
  },

  /** 第二段：横扫。范围更大、击退更强，作为连招收尾。 */
  slash2: {
    id: 'slash2',
    frames: 26,
    loop: false,
    cancelable: false,
    motion: [0, 0, 0, 0, 1.0, 2.2, 3.0, 2.0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [
      {
        offset: { x: 30, y: 0 },
        halfWidth: 40,
        halfDepth: 30,
        activeFrom: 6,
        activeTo: 11,
        damage: 18,
        knockback: 6.0,
        hitStop: 8,
      },
    ],
  },

  /**
   * 疾锋第三段：总伤害不直接膨胀成最优解，而是用更短前摇和强击退做连段收尾。
   * 24+26+24 帧打 12+18+14，整套理论 DPS 与原两段接近，主要变化是操作频率。
   */
  slash3: {
    id: 'slash3',
    frames: 24,
    loop: false,
    cancelable: false,
    motion: [0, 0, 0, 0, 1.4, 2.8, 3.6, 2.4, 1.0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [
      {
        offset: { x: 36, y: 0 },
        halfWidth: 38,
        halfDepth: 26,
        activeFrom: 5,
        activeTo: 10,
        damage: 14,
        knockback: 7.0,
        hitStop: 7,
      },
    ],
    cancelFrom: 10,
    cancelInto: ['slash'],
    perfectCancelWindow: { from: 10, to: 14 },
  },

  /** 重击蓄力本身没有判定，松键后由 world 切到普通或满蓄力释放。 */
  heavyCharge: {
    id: 'heavyCharge',
    frames: HEAVY_FULL_CHARGE_FRAMES + 1,
    loop: false,
    cancelable: false,
    hitboxes: [],
    superArmor: true,
  },

  /** 满蓄力释放单独占一个状态，避免把倍率塞进世界命中逻辑形成职业特判。 */
  heavyCharged: {
    id: 'heavyCharged',
    frames: 38,
    loop: false,
    cancelable: false,
    motion: [0, 0, 0, 0, 0, 0, 0, 0, 1.2, 2.8, 4.2, 3.0, 1.4, 0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [
      {
        offset: { x: 40, y: 0 },
        halfWidth: 44,
        halfDepth: 34,
        activeFrom: 10,
        activeTo: 15,
        damage: 36,
        knockback: 12,
        hitStop: 11,
      },
    ],
    superArmor: true,
  },

  /** 术法普攻：没有贴脸前冲，在角色前方约 64px 处引爆小范围灵力。 */
  arcanePulse: {
    id: 'arcanePulse',
    frames: 30,
    loop: false,
    cancelable: false,
    hitboxes: [
      {
        offset: { x: 64, y: 0 },
        halfWidth: 34,
        halfDepth: 32,
        activeFrom: 11,
        activeTo: 16,
        damage: 13,
        knockback: 3.5,
        hitStop: 5,
        radial: true,
      },
    ],
    cancelFrom: 16,
    perfectCancelWindow: { from: 16, to: 20 },
  },

  dash: {
    id: 'dash',
    frames: 26,
    loop: false,
    cancelable: false,
    motion: [0, 1.5, 4.5, 7.0, 8.0, 7.5, 6.0, 4.5, 3.0, 2.0, 1.2, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [],
    // 无敌帧只覆盖位移段，收招段照常挨打。
    // 全程无敌会让冲刺变成万能解，那就没有「什么时候冲」的判断了。
    invuln: { from: 2, to: 15 },
    cancelInto: ['slash'],
    // 无敌帧结束（第 15 帧）就能取消接普攻——这是「冲刺接攻击」这个组合
    // 的实际生效点。不写这个字段的话，dash 没有判定框，会落进
    // canInterrupt 的隐式规则「播到最后一帧才能取消」，26 帧里只有
    // 第 25 帧能接，窗口窄到基本按不出来，cancelInto 名存实亡。
    cancelFrom: 15,
    // 无敌帧刚结束就接上（15-19 帧）算完美——"贴脸就砍"的节奏，
    // 比普通取消窗口（15-25，10 帧宽）严格得多。
    perfectCancelWindow: { from: 15, to: 19 },
  },

  /**
   * 受击硬直：动画播 20 帧，但真正锁死行动的是 world.ts 里单独维护的
   * `stunFrames`（12 帧，和 GAME_DESIGN 数值框架表一致）。这里必须显式写
   * `cancelFrom: 12`，理由和冲刺/跳跃当年踩的坑一模一样——没有判定框、
   * 没写这个字段的话，`canInterrupt` 会落进隐式规则「播到最后一帧才能
   * 打断」，也就是 frame 19。stunFrames 在 frame 12 就已经清零，但玩家
   * 要一直等到 frame 19 才能重新出手，中间 7 帧是纯粹多出来的、没人
   * 设计过的隐形硬直——挨一下打实际卡住的时间比文档写的 12 帧多出接近
   * 三分之二，这正是"打完一下感觉黏"的一处具体成因。
   */
  hit: {
    id: 'hit',
    frames: 20,
    loop: false,
    cancelable: false,
    hitboxes: [],
    cancelFrom: 12,
  },

  /**
   * 范围技：吃 50 能量，环形判定 + 强击退。
   *
   * 定位是**解围**而不是输出：带超级护甲，被围住时能强行清出空间。
   * 这个定位决定了它会被真正使用——纯加伤害的技能玩家只会在顺风时按，
   * 而解围技在逆风时是刚需，普攻占比才压得下来（M1 验收第 1 条）。
   */
  skill: {
    id: 'skill',
    frames: 40,
    loop: false,
    cancelable: false,
    superArmor: true,
    hitboxes: [
      {
        offset: { x: 0, y: 0 },
        halfWidth: 96,
        halfDepth: 62,
        activeFrom: 14,
        activeTo: 19,
        damage: 26,
        knockback: 9.0,
        hitStop: 10,
        radial: true,
      },
    ],
  },

  /**
   * 处决：只对残血目标生效，伤害高到必定终结。
   *
   * 全程无敌是刻意的——处决要求玩家主动贴脸，如果贴上去就被围殴打断，
   * 玩家学两次就再也不用了（那样 M1 验收第 3 条永远不达标）。
   * 用无敌换主动进攻，正是 GAME_DESIGN 3.4「避免玩家龟缩放风筝」的意图。
   */
  execute: {
    id: 'execute',
    frames: 30,
    loop: false,
    cancelable: false,
    superArmor: true,
    invuln: { from: 0, to: 26 },
    motion: [0, 0, 1.0, 2.0, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [
      {
        offset: { x: 30, y: 0 },
        halfWidth: 34,
        halfDepth: 26,
        activeFrom: 5,
        activeTo: 9,
        // 处决是终结技，伤害只需保证「一定打死残血目标」
        damage: 999,
        knockback: 2.0,
        hitStop: 12,
      },
    ],
  },

  /**
   * 远程瞄准段：24 帧纯预警，不带任何判定。
   * 这 24 帧就是玩家「看到激光线 → 侧移一步」的全部时间窗口。
   */
  aim: {
    id: 'aim',
    frames: 24,
    loop: false,
    cancelable: false,
    hitboxes: [],
    telegraph: { shape: { kind: 'line', length: 420, width: 18 }, until: 24 },
  },

  /** 放箭：第 2 帧生成弹丸（在 world 里处理），本身不带判定框。 */
  shoot: {
    id: 'shoot',
    frames: 16,
    loop: false,
    cancelable: false,
    hitboxes: [],
  },

  /**
   * 冲锋蓄力：28 帧预警。突进伤害不低，所以预警给得比远程还长。
   * 预警形状是突进路径本身——玩家看到的就是「它会撞过来的那条线」。
   */
  charge: {
    id: 'charge',
    frames: 28,
    loop: false,
    cancelable: false,
    hitboxes: [],
    // 蓄力时微微后撤，是格斗游戏常见的起手提示，让预警在动作剪影上也读得出来
    motion: [-0.4, -0.4, -0.3, -0.3, -0.2, -0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    telegraph: { shape: { kind: 'line', length: 300, width: 44 }, until: 28 },
  },

  /**
   * 冲锋突进：判定跟着位移走，撞到就吃伤害。
   *
   * 突进距离必须**大于起手距离**，否则这个敌人从头到尾撞不到人——
   * 第一版就栽在这里：位移合计只有 62px，而它在 190px 外起手，
   * 蓄力、预警、突进整套演完，人还在两个身位之外。
   * 现在合计约 197px，加上判定框和玩家体积的富余，够覆盖 215px 的起手线，
   * 而且会**冲过头**——冲过头才有"侧身让开、看它扑空"的博弈。
   */
  rush: {
    id: 'rush',
    frames: 30,
    loop: false,
    cancelable: false,
    motion: [22, 22, 21, 20, 19, 18, 16, 14, 12, 10, 8, 6, 4, 2.5, 1.5, 0.8, 0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [
      {
        offset: { x: 20, y: 0 },
        halfWidth: 26,
        halfDepth: 22,
        activeFrom: 0,
        // 判定覆盖整个高速段，减速滑行段不再伤人
        activeTo: 15,
        damage: 16,
        knockback: 7.0,
        hitStop: 7,
      },
    ],
  },

  /**
   * 精英重击：32 帧前摇换 24 点伤害和大范围。
   * 带超级护甲，所以**不能靠打断来解**，只能靠走位躲——
   * 这正是设计里「拉开打，不能贴脸莽」要求玩家做的事。
   */
  heavy: {
    id: 'heavy',
    frames: 54,
    loop: false,
    cancelable: false,
    superArmor: true,
    hitboxes: [
      {
        offset: { x: 26, y: 0 },
        halfWidth: 56,
        halfDepth: 40,
        activeFrom: 32,
        activeTo: 38,
        damage: 24,
        knockback: 8.0,
        hitStop: 10,
      },
    ],
    telegraph: { shape: { kind: 'circle', radius: 74 }, until: 32 },
  },

  /**
   * 首领招式——LEVEL_DESIGN 第八节：两阶段各换一套招式组，
   * 每一招都比对应的精英/冲锋版本更强，但**遵守同一条纪律**：
   * 伤害越高，预警必须越长越明显，不能既强又突然。
   */

  /**
   * 首领重击：44 帧前摇（比精英 heavy 长 12 帧），换更大范围和更高伤害。
   * 两阶段都会用——是首领最基础也是最常见的招式。
   */
  bossSlam: {
    id: 'bossSlam',
    frames: 62,
    loop: false,
    cancelable: false,
    superArmor: true,
    hitboxes: [
      {
        offset: { x: 30, y: 0 },
        halfWidth: 72,
        halfDepth: 50,
        activeFrom: 44,
        activeTo: 51,
        damage: 32,
        knockback: 9.5,
        hitStop: 12,
      },
    ],
    telegraph: { shape: { kind: 'circle', radius: 92 }, until: 44 },
  },

  /**
   * 首领蓄力：24 帧预警——比冲锋的 28 帧短，逼玩家更快做出反应，
   * 配合下面 bossRush 更大的突进距离，让首领的突进比冲锋更有压迫感。
   */
  bossCharge: {
    id: 'bossCharge',
    frames: 24,
    loop: false,
    cancelable: false,
    hitboxes: [],
    motion: [-0.5, -0.5, -0.4, -0.4, -0.3, -0.3, -0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    telegraph: { shape: { kind: 'line', length: 360, width: 56 }, until: 24 },
  },

  /**
   * 首领突进：位移合计约 250px，比冲锋的 197px 更远更快，
   * 同样遵守「必须冲过头」的约束——扑空才有博弈，不是纯粹的追杀。
   */
  bossRush: {
    id: 'bossRush',
    frames: 32,
    loop: false,
    cancelable: false,
    motion: [
      26, 26, 25, 24, 23, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2.5, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ],
    hitboxes: [
      {
        offset: { x: 24, y: 0 },
        halfWidth: 32,
        halfDepth: 26,
        activeFrom: 0,
        activeTo: 17,
        damage: 22,
        knockback: 8.0,
        hitStop: 8,
      },
    ],
  },

  /**
   * 首领范围技：阶段二才解锁的招式，覆盖范围比玩家的 skill 还大。
   * 30 帧前摇给圆形预警，判定生效时机短而干脆——「蓄力很久，打出来很快」
   * 是范围技共通的节奏，玩家在预警阶段就该拉开，而不是等判定那一下再躲。
   */
  bossNova: {
    id: 'bossNova',
    frames: 44,
    loop: false,
    cancelable: false,
    superArmor: true,
    hitboxes: [
      {
        offset: { x: 0, y: 0 },
        halfWidth: 150,
        halfDepth: 104,
        activeFrom: 30,
        activeTo: 34,
        damage: 30,
        knockback: 10.0,
        hitStop: 12,
        radial: true,
        // 全场覆盖型的范围技——跳跃躲不掉，逼玩家这一招必须靠冲刺
        // 或者拉开距离应对。不标的话，跳跃会架空冲刺在阶段二的价值。
        hitsAir: true,
      },
    ],
    telegraph: { shape: { kind: 'circle', radius: 150 }, until: 30 },
  },

  /**
   * 首领召唤：纯表现动作，不带任何判定框——它不直接伤人，
   * 危险的是召唤出来的两个杂兵。50 帧够长，让玩家看清「这不是在打我」
   * 而是「阶段要变了」，配合 world.ts 里阶段切换的震屏和飘字一起读。
   */
  bossSummon: {
    id: 'bossSummon',
    frames: 50,
    loop: false,
    cancelable: false,
    superArmor: true,
    hitboxes: [],
  },

  /**
   * 起跳：冲刺之外的第二种防御手段，但躲的东西不一样——冲刺是水平方向
   * 无敌 + 位移，跳跃是腾空期间对贴地判定免疫，不给位移控制权。
   * 两者互补而不是替代：躲不开的东西不一样，才有「这下该冲还是该跳」
   * 的判断，不然多出来的键位只是同一个解法的两张皮。
   *
   * 没有 invuln——跳跃不是全免疫，是靠 airborne + Hitbox.hitsAir 决定
   * 哪些判定打得到。全场覆盖型的范围技（比如 bossNova）标了 hitsAir，
   * 跳了也没用，逼玩家在那种招式面前还是得靠冲刺或拉开距离。
   */
  jump: {
    id: 'jump',
    frames: 34,
    loop: false,
    cancelable: false,
    // 弧线跳跃：水平位移曲线和 render/renderer.ts 里的 jumpHeight 用同一条
    // 4t(1-t) 抛物线节奏、贯穿整个 34 帧——第一版只在前 17 帧有位移，
    // 17 帧后水平速度提前归零，但高度要到 34 帧才落地，于是下落的后半段
    // 只有高度往下掉、人没有横向移动，看起来像是"到最高点后垂直坠落"，
    // 没有落地弧度。现在起跳和落地两端速度都趋于 0，峰值落在跳跃最高点
    // （第 16-17 帧），上升和下降对称，轨迹才是一条连贯的抛物线。
    // 总位移约 34px，和冲刺（约 46px）同一量级但略小：跳跃仍以腾空免疫
    // 为主，位移是让它"看得出在跳"的必要条件，不是第二个冲刺。
    // 方向由起跳那一帧的输入锁定，见 world.ts 的 lockMoveDirection。
    motion: [
      0, 0.17, 0.33, 0.48, 0.62, 0.75, 0.87, 0.98, 1.08, 1.17, 1.25, 1.31, 1.37, 1.42, 1.45, 1.48,
      1.5, 1.5, 1.5, 1.48, 1.45, 1.42, 1.37, 1.31, 1.25, 1.17, 1.08, 0.98, 0.87, 0.75, 0.62, 0.48,
      0.33, 0.17,
    ],
    hitboxes: [],
    airborne: { from: 3, to: 27 },
    // 腾空中段（离起跳有一点距离，落地还有余裕）就能取消接跳劈或者
    // 提前进入收招——不用等到 34 帧全播完，那样这个动作会显得又慢又黏。
    cancelFrom: 16,
    cancelInto: ['airSlash'],
    // 腾空中段刚开放取消就接上（16-20 帧）算完美——这一刻正好是跳跃
    // 接近最高点的位置，"读对预警、立刻追打"的反应窗口。
    perfectCancelWindow: { from: 16, to: 20 },
  },

  /**
   * 跳劈：腾空中段取消接入的下砸。伤害 16，卡在普攻两段（12/18）之间——
   * 这是「读对预警、跳过去、还敢追一下」换来的奖励，不是白给的高伤害，
   * 真正的收益是「躲开了本该吃的那下」，跳劈只是锦上添花。
   * 判定生效时仍处于腾空区间，落地瞬间才重新能被贴地判定打中，
   * 不然会出现「跳劈刚落地就被杂兵秒杀」这种不讲理的衔接。
   */
  airSlash: {
    id: 'airSlash',
    frames: 26,
    loop: false,
    cancelable: false,
    motion: [3.0, 2.6, 2.0, 1.4, 0.8, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hitboxes: [
      {
        offset: { x: 28, y: 0 },
        halfWidth: 32,
        halfDepth: 24,
        activeFrom: 6,
        activeTo: 11,
        damage: 16,
        knockback: 5.0,
        hitStop: 6,
      },
    ],
    airborne: { from: 0, to: 16 },
    // 落地（腾空结束）就能取消接一次挥砍——「跳跃躲判定 → 跳劈追打 →
    // 落地立即连段」现在是一条完整的空对地连招，不再是打完跳劈就只能
    // 回 idle 的孤立招式。cancelFrom 必须等于 airborne.to（16），不能用
    // 默认的判定框收尾规则（第 11 帧）：那样会在人还悬空时就切成地面
    // slash，出现「半空中挥地面刀」的违和——这正是当初重构 startAttack
    // 时特意规避的问题，这里不能重蹈覆辙。
    cancelFrom: 16,
    cancelInto: ['slash'],
    // 落地那一刻就接上（16-19 帧）算完美——"跳劈刚落地立刻追击"，
    // 是这套空对地连招里最紧凑的一个衔接点。
    perfectCancelWindow: { from: 16, to: 19 },
  },
};

/**
 * 职业只覆盖真正有差异的玩家招式，共享移动/受击和全部敌人动作继续回退 ACTIONS。
 * 疾锋是第一套正式覆盖；后续每落一个职业只往对应分支加 ActionDef，
 * 不再修改世界逻辑的查表方式，避免职业越多分支越散。
 */
export const PROFESSION_ACTIONS: Record<
  Profession,
  Partial<Record<ActionState, ActionDef>>
> = {
  heavy: {
    // 重击没有多段链：短按也会经历一次蓄力姿态，松键后释放慢而重的单段攻击。
    heavy: {
      ...ACTIONS.heavy,
      frames: 34,
      motion: [0, 0, 0, 0, 0, 0, 1.0, 2.2, 3.2, 2.0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hitboxes: [
        {
          offset: { x: 36, y: 0 },
          halfWidth: 38,
          halfDepth: 30,
          activeFrom: 9,
          activeTo: 14,
          damage: 18,
          knockback: 6,
          hitStop: 8,
        },
      ],
      telegraph: undefined,
      superArmor: true,
    },
    heavyCharge: ACTIONS.heavyCharge,
    heavyCharged: ACTIONS.heavyCharged,
    // 重装处决收招更慢，但回复翻倍；回复值由 resolveExecuteHeal 统一解析。
    execute: {
      ...ACTIONS.execute,
      frames: 36,
      cancelFrom: 16,
      invuln: { from: 0, to: 32 },
    },
  },
  swift: {
    // 第二段不再收尾，而是把输入送进疾锋专属第三段。
    slash2: {
      ...ACTIONS.slash2,
      cancelFrom: 11,
      cancelInto: ['slash3'],
      perfectCancelWindow: { from: 11, to: 15 },
    },
    slash3: ACTIONS.slash3,
    // 冷却更短，但单次无敌窗由 13 帧压到 10 帧；疾锋能频繁位移，
    // 每次却更要求时机，不能把“快”做成无脑常驻无敌。
    dash: {
      ...ACTIONS.dash,
      frames: 22,
      motion: ACTIONS.dash.motion?.slice(0, 22),
      invuln: { from: 2, to: 12 },
      cancelFrom: 12,
      perfectCancelWindow: { from: 12, to: 16 },
    },
  },
  arcane: {
    arcanePulse: ACTIONS.arcanePulse,
    // 主技能从贴身解围改为前方范围爆发：伤害更集中，但失去通用版超级护甲，
    // 术法必须先用走位创造施法窗口，不能在包围中无脑硬放。
    skill: {
      ...ACTIONS.skill,
      frames: 42,
      superArmor: false,
      hitboxes: [
        {
          offset: { x: 72, y: 0 },
          halfWidth: 78,
          halfDepth: 60,
          activeFrom: 18,
          activeTo: 24,
          damage: 32,
          knockback: 7,
          hitStop: 9,
          radial: true,
        },
      ],
    },
    // 触发距离扩大后必须同步扩大判定，否则会出现按键成功却在第 5 帧打空。
    execute: {
      ...ACTIONS.execute,
      hitboxes: [
        {
          ...ACTIONS.execute.hitboxes[0],
          offset: { x: 64, y: 0 },
          halfWidth: 42,
          halfDepth: 34,
        },
      ],
    },
  },
};

/**
 * M4 武器只覆盖职业已经允许的动作形态，不发明跨职业招式。
 * 三把实验武器默认不装备，先通过调试入口验证差异，再接掉落和正式界面。
 */
export const WEAPON_ACTIONS: Record<WeaponId, Partial<Record<ActionState, ActionDef>>> = {
  'iron-maul': {
    heavyCharged: {
      ...(PROFESSION_ACTIONS.heavy.heavyCharged ?? ACTIONS.heavyCharged),
      frames: 40,
      hitboxes: [
        {
          ...ACTIONS.heavyCharged.hitboxes[0],
          halfWidth: 50,
          halfDepth: 38,
          damage: 40,
          knockback: 14,
          activeFrom: 11,
          activeTo: 16,
        },
      ],
    },
  },
  'breaker-maul': {
    heavyCharged: {
      ...(PROFESSION_ACTIONS.heavy.heavyCharged ?? ACTIONS.heavyCharged),
      frames: 32,
      hitboxes: [
        {
          ...ACTIONS.heavyCharged.hitboxes[0],
          halfWidth: 42,
          halfDepth: 32,
          damage: 32,
          knockback: 11,
          activeFrom: 9,
          activeTo: 13,
        },
      ],
    },
  },
  'wind-sabers': {
    slash3: {
      ...(PROFESSION_ACTIONS.swift.slash3 ?? ACTIONS.slash3),
      frames: 20,
      motion: ACTIONS.slash3.motion?.slice(0, 20),
      hitboxes: [
        {
          ...ACTIONS.slash3.hitboxes[0],
          activeFrom: 4,
          activeTo: 9,
          knockback: 3.5,
        },
      ],
      cancelFrom: 9,
      perfectCancelWindow: { from: 9, to: 13 },
    },
  },
  'hook-blades': {
    slash2: {
      ...(PROFESSION_ACTIONS.swift.slash2 ?? ACTIONS.slash2),
      frames: 26,
      hitboxes: [
        {
          ...ACTIONS.slash2.hitboxes[0],
          halfWidth: 48,
          halfDepth: 34,
          knockback: 7,
          activeFrom: 6,
          activeTo: 11,
        },
      ],
      cancelFrom: 13,
      perfectCancelWindow: { from: 13, to: 16 },
    },
  },
  'spirit-focus': {
    arcanePulse: {
      ...(PROFESSION_ACTIONS.arcane.arcanePulse ?? ACTIONS.arcanePulse),
      frames: 34,
      hitboxes: [
        {
          ...ACTIONS.arcanePulse.hitboxes[0],
          offset: { x: 72, y: 0 },
          halfWidth: 42,
          halfDepth: 38,
          activeFrom: 13,
          activeTo: 18,
          damage: 15,
        },
      ],
      cancelFrom: 18,
      perfectCancelWindow: { from: 18, to: 22 },
    },
  },
  'ember-focus': {
    arcanePulse: {
      ...(PROFESSION_ACTIONS.arcane.arcanePulse ?? ACTIONS.arcanePulse),
      frames: 28,
      hitboxes: [
        {
          ...ACTIONS.arcanePulse.hitboxes[0],
          offset: { x: 56, y: 0 },
          halfWidth: 32,
          halfDepth: 30,
          activeFrom: 10,
          activeTo: 15,
          damage: 12,
        },
      ],
      cancelFrom: 15,
      perfectCancelWindow: { from: 15, to: 19 },
    },
  },
};

/** 武器覆盖优先，其次职业覆盖；敌人两层都没有，最终退回共享动作表。 */
export function resolveAction(
  state: ActionState,
  profession?: Profession,
  weapon?: WeaponId | null,
): ActionDef {
  return (
    (weapon ? WEAPON_ACTIONS[weapon][state] : undefined) ??
    (profession ? PROFESSION_ACTIONS[profession][state] : undefined) ??
    ACTIONS[state]
  );
}

/** 一次动作播完需要多少帧 */
export function actionLength(state: ActionState, profession?: Profession, weapon?: WeaponId | null): number {
  return resolveAction(state, profession, weapon).frames;
}

/** 当前帧是否允许被玩家输入打断 */
export function canInterrupt(
  state: ActionState,
  frame: number,
  profession?: Profession,
  weapon?: WeaponId | null,
): boolean {
  const def = resolveAction(state, profession, weapon);
  if (def.cancelable) return true;
  // 显式声明的取消点优先——纯位移动作（冲刺、跳跃）没有判定框，
  // 不写这个字段的话会落进下面的隐式规则，取消窗口只剩最后 1 帧。
  if (def.cancelFrom !== undefined) return frame >= def.cancelFrom;
  // 一次性动作在判定窗口结束后进入可取消的收招段，
  // 这是连招手感的关键：太早能取消会让攻击没有重量，太晚会觉得黏。
  const last = def.hitboxes[def.hitboxes.length - 1];
  if (!last) return frame >= def.frames - 1;
  return frame >= last.activeTo;
}

/**
 * 这次取消是不是落在来源动作的完美窗口内。窗口是可取消窗口里最早的
 * 一段，奖励的是「反应快」而不是「记得住连段表」——普通取消窗口有
 * 十几帧宽容度，完美窗口窄得多，需要玩家在收招段一开始就接上。
 */
export function isPerfectCancel(
  fromState: ActionState,
  frame: number,
  profession?: Profession,
  weapon?: WeaponId | null,
): boolean {
  const win = resolveAction(fromState, profession, weapon).perfectCancelWindow;
  if (!win) return false;
  return frame >= win.from && frame < win.to;
}

/** 该动作在这一帧是否处于自带的无敌区间 */
export function isActionInvulnerable(
  state: ActionState,
  frame: number,
  profession?: Profession,
  weapon?: WeaponId | null,
): boolean {
  const inv = resolveAction(state, profession, weapon).invuln;
  if (!inv) return false;
  return frame >= inv.from && frame < inv.to;
}

/**
 * 该动作在这一帧是否处于腾空区间——跳跃靠这个字段实现「躲开贴地攻击」，
 * 判定命中时要检查目标腾不腾空，见 world.ts 的 resolveHits。
 */
export function isActionAirborne(
  state: ActionState,
  frame: number,
  profession?: Profession,
  weapon?: WeaponId | null,
): boolean {
  const ab = resolveAction(state, profession, weapon).airborne;
  if (!ab) return false;
  return frame >= ab.from && frame < ab.to;
}
