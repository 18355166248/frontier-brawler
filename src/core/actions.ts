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
import type { ActionDef, ActionState } from './types';

/** 逻辑帧率。固定步长，不跟随显示帧率，保证手感在任何设备一致。 */
export const TICK_RATE = 60;

/** 技能消耗的能量。命中积累，攒够才能放，逼玩家先打进去。 */
export const SKILL_COST = 50;

/** 低于这个血量比例的敌人可被处决。GAME_DESIGN 3.4 定的 25%。 */
export const EXECUTE_THRESHOLD = 0.25;

/** 处决的有效距离，比普攻 reach 略大，否则会频繁扑空导致玩家放弃用 */
export const EXECUTE_RANGE = 62;

/** 冲刺冷却帧数。太短会退化成无脑冲，太长会让唯一的防御手段不可靠。 */
export const DASH_COOLDOWN = 45;

/**
 * 跳跃冷却帧数。跳跃只免疫贴地判定（不是全无敌），所以定得比冲刺短一点，
 * 但也不能太短——腾空区间本身有 24 帧，冷却太短会让「贴地判定基本失效」，
 * 跳跃就从「读时机的第二种防御手段」退化成「一直挂着的免疫状态」。
 */
export const JUMP_COOLDOWN = 40;

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
  },

  hit: {
    id: 'hit',
    frames: 20,
    loop: false,
    cancelable: false,
    hitboxes: [],
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
  },
};

/** 一次动作播完需要多少帧 */
export function actionLength(state: ActionState): number {
  return ACTIONS[state].frames;
}

/** 当前帧是否允许被玩家输入打断 */
export function canInterrupt(state: ActionState, frame: number): boolean {
  const def = ACTIONS[state];
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

/** 该动作在这一帧是否处于自带的无敌区间 */
export function isActionInvulnerable(state: ActionState, frame: number): boolean {
  const inv = ACTIONS[state].invuln;
  if (!inv) return false;
  return frame >= inv.from && frame < inv.to;
}

/**
 * 该动作在这一帧是否处于腾空区间——跳跃靠这个字段实现「躲开贴地攻击」，
 * 判定命中时要检查目标腾不腾空，见 world.ts 的 resolveHits。
 */
export function isActionAirborne(state: ActionState, frame: number): boolean {
  const ab = ACTIONS[state].airborne;
  if (!ab) return false;
  return frame >= ab.from && frame < ab.to;
}
