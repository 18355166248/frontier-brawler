/**
 * 引擎无关的游戏类型。这一层不引用任何渲染 API。
 *
 * 这个约定是从 xianxia-roguelike 学来的：它的 32 个战斗系统文件零 Cocos 依赖，
 * 结果就是那 5000 多行逻辑随时能搬去别的引擎，而耦合全压在一个 9800 行的编排层里。
 * 这次从第一行代码就分开，别等到最后再拆。
 */

/** 横版战场是「带纵深的平面」：x 横向推进，y 是站位纵深，不是屏幕坐标。 */
export interface Vec2 {
  x: number;
  y: number;
}

export type Facing = 1 | -1;

/**
 * M2 的三个职业。职业只属于玩家；敌人继续走共享 ACTIONS，不认识这层概念。
 * 英文 id 会进入存档与统计，确定后不要随意改名。
 */
export const PROFESSION_IDS = ['heavy', 'swift', 'arcane'] as const;
export type Profession = (typeof PROFESSION_IDS)[number];

/** 疾锋最接近 M1 已验收的现有招式，架构迁移阶段用它保证玩法不变。 */
export const DEFAULT_PROFESSION: Profession = 'swift';

/** 动作状态机的状态。和动作库的 clip id 一一对应。 */
export type ActionState =
  | 'idle'
  | 'move'
  | 'slash'
  | 'slash2'
  /** 疾锋第三段连击；其他职业不会自然进入这个状态 */
  | 'slash3'
  /** 重击按住攻击时的蓄力状态，以及松开后的普通/满蓄力释放 */
  | 'heavyCharge'
  | 'heavyCharged'
  | 'dash'
  | 'hit'
  /** 玩家范围技，吃能量，释放期间带超级护甲 */
  | 'skill'
  /** 处决：对残血目标的专属终结动作 */
  | 'execute'
  /** 远程的瞄准段，纯预警不带判定 */
  | 'aim'
  /** 远程的放箭帧 */
  | 'shoot'
  /** 冲锋的蓄力段，纯预警不带判定 */
  | 'charge'
  /** 冲锋的突进段，带判定 */
  | 'rush'
  /** 精英重击，前摇极长换高伤害 */
  | 'heavy'
  /** 首领重击：比精英更长的前摇换更大范围和更高伤害，阶段一、二都会用 */
  | 'bossSlam'
  /** 首领蓄力，纯预警不带判定，两阶段共用 */
  | 'bossCharge'
  /** 首领突进段，带判定 */
  | 'bossRush'
  /** 首领范围技，阶段二才解锁，环形判定覆盖全场大半 */
  | 'bossNova'
  /** 首领召唤，纯表现动作不带判定——阶段切换那一刻只触发一次 */
  | 'bossSummon'
  /** 起跳。腾空区间内躲开贴地判定，是冲刺之外的第二种防御手段 */
  | 'jump'
  /** 跳劈：腾空中段取消接入的下砸攻击，「跳跃 + 攻击」这个组合的落点 */
  | 'airSlash';

export interface Hurtbox {
  /** 相对实体中心的偏移 */
  offset: Vec2;
  halfWidth: number;
  halfDepth: number;
  /** 纵向可被击中的高度，用于跳跃/低扫的判定预留 */
  height: number;
}

/** 攻击判定框，只在指定帧区间内生效——这是打击感的来源之一。 */
export interface Hitbox {
  offset: Vec2;
  halfWidth: number;
  halfDepth: number;
  /** 生效的帧区间（相对动作起始），左闭右开 */
  activeFrom: number;
  activeTo: number;
  damage: number;
  /** 击退力度，沿攻击者朝向 */
  knockback: number;
  /** 命中后的硬直帧数，攻防双方都会被冻结 */
  hitStop: number;
  /** 无视朝向的环形判定，用于范围技——不跟着 facing 翻转 */
  radial?: boolean;
  /**
   * 能不能命中腾空目标。默认 false——大多数攻击是贴地判定，
   * 跳跃应该能躲开。全场覆盖型的范围技要显式标 true，
   * 否则连它都能被一跳化解，冲刺的无敌帧就失去了存在意义。
   */
  hitsAir?: boolean;
}

/**
 * 预警形状。**每一个能打死玩家的招式都必须带预警**，这是 M1 验收第 4 条：
 * 没有预警的伤害玩家会认为是游戏耍赖，而不是自己菜。
 * 形状交给渲染层画，逻辑层只负责声明「这一招从第几帧起是看得见的」。
 */
export type TelegraphShape =
  /** 直线：远程射击、冲锋突进 */
  | { kind: 'line'; length: number; width: number }
  /** 圆：精英重击的落点范围 */
  | { kind: 'circle'; radius: number }
  /** 扇形：贴脸挥砍的覆盖区 */
  | { kind: 'arc'; radius: number; halfAngle: number };

export interface Telegraph {
  shape: TelegraphShape;
  /** 已经预警了多少帧 */
  frame: number;
  /** 总预警帧数，渲染层用它算充能进度 */
  frames: number;
}

export interface ActionDef {
  id: ActionState;
  /** 动作总帧数 */
  frames: number;
  loop: boolean;
  /** 该动作是否可被玩家输入打断 */
  cancelable: boolean;
  /** 攻击判定，没有则为空 */
  hitboxes: Hitbox[];
  /** 位移曲线：每帧沿朝向前进的距离 */
  motion?: number[];
  /** 可以取消进入的后续动作（连招） */
  cancelInto?: ActionState[];
  /** 无敌帧区间（相对动作起始），左闭右开。冲刺和处决靠它换生存空间。 */
  invuln?: { from: number; to: number };
  /**
   * 腾空区间（相对动作起始），左闭右开。这段时间内，非 hitsAir 的判定框
   * 打不到这个实体——跳跃就是靠这个字段实现「躲开贴地攻击」的效果。
   * 简化模型：不做真正的高度轴碰撞体积，只用区间 + 布尔标记决定命中。
   */
  airborne?: { from: number; to: number };
  /**
   * 超级护甲：受击不进入 hit 状态、不吃硬直，但照常掉血。
   * 精英和玩家技能靠这个「不被打断」，是拉开二者与杂兵手感差距的关键。
   */
  superArmor?: boolean;
  /** 该动作自带的预警形状，从第 0 帧亮到判定生效为止 */
  telegraph?: { shape: TelegraphShape; until: number };
  /**
   * 显式声明从第几帧起允许被打断进入下一个动作（收招段起点）。
   *
   * 不写就用旧的隐式规则：有判定框就从最后一个判定框的 activeTo 算起，
   * 没有判定框就要播到最后一帧——这条隐式规则对纯位移动作（冲刺、跳跃）
   * 几乎等于「不能取消」，真实窗口只剩 1 帧，玩家按不出来。第一版的
   * 「冲刺接普攻」就是这样名存实亡的：`cancelInto` 写了，但从没人按到过。
   * 需要更早取消窗口的动作要显式写这个字段。
   */
  cancelFrom?: number;
  /**
   * 完美取消窗口（相对动作起始），左闭右开，是可取消窗口里最早的一段。
   * 玩家在这个窗口内接上后续攻击性动作，下一次命中伤害会有加成——
   * 普通取消窗口宽容度有十几帧，容错率高但没有"打得越准收益越大"这层
   * 深度；完美窗口窄得多，奖励的是快速反应而不是纯粹的连招记忆。
   * 只用于进攻性质的取消（普攻连段、冲刺/跳跃/跳劈接攻击），
   * 纯防御/位移的切换（比如冲刺接跳跃）没有伤害判定，不需要这个字段。
   */
  perfectCancelWindow?: { from: number; to: number };
}

export type Team = 'player' | 'enemy';

/**
 * 一帧的操作意图。玩家来自键盘，敌人来自 AI——
 * 走同一个结构，是为了让「出手时机」这件事只在 world 里判定一次。
 */
export interface InputIntent {
  moveX: number;
  moveY: number;
  attack: boolean;
  dash: boolean;
  /**
   * 指定这次进攻具体用哪个动作，覆盖 EnemyProfile.attackAction。
   * 五种基础敌人都只有一招，用不上这个字段；首领要在多套招式间
   * 动态切换（重击/突进/阶段二的范围技），才需要 AI 自己点名。
   */
  action?: ActionState;
}

/**
 * 敌人类型。差异必须体现在**要求玩家做不同的事**，光改数值不算差异。
 * 对应 GAME_DESIGN.md 3.5 的五种设计。
 *
 * boss 是第六种，单独归在一起：它不是"逼玩家做一件新事"，
 * 而是把前五关学到的东西——绕位、躲预警、拉开、处决——放进一场综合考。
 */
export type EnemyKind = 'grunt' | 'shield' | 'ranged' | 'charger' | 'elite' | 'boss';

export interface Entity {
  id: number;
  team: Team;
  /** 仅敌人有；玩家为 undefined */
  kind?: EnemyKind;
  /** 仅玩家有；动作解析据此叠加职业覆盖，敌人保持 undefined。 */
  profession?: Profession;
  pos: Vec2;
  velocity: Vec2;
  facing: Facing;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  hurtbox: Hurtbox;

  action: ActionState;
  /** 当前动作已播放的帧数 */
  actionFrame: number;
  /** 本次动作已命中过的目标，避免一次挥砍多段伤害 */
  hitTargets: Set<number>;

  /** 受击硬直剩余帧 */
  stunFrames: number;
  /** 无敌帧，防止被连续锁死 */
  invulnFrames: number;
  /** 击退速度，逐帧衰减 */
  knockback: Vec2;
  /** 出手后的冷却，防止交还令牌后立刻又抢回去 */
  attackCooldown: number;

  /** 技能能量，靠命中积累 */
  energy: number;
  maxEnergy: number;
  /** 冲刺冷却剩余帧 */
  dashCooldown: number;
  /** 跳跃冷却剩余帧，防止无限连跳保持贴地判定免疫 */
  jumpCooldown: number;

  /**
   * 输入缓冲：五个出手键各自的剩余缓冲帧数，0 表示没有待处理的按键。
   * 只有玩家会用到——敌人的 AI 每帧都会重新判断要不要出手，不存在
   * "按一下就错过"的问题，只有人类的单次按键才需要这层容错。
   *
   * 按下的那一刻不管当下能不能立刻响应都先记满一份缓冲，真正判定
   * 能不能出手仍然是 `interruptible`——缓冲区只负责"记住按过"，
   * 不负责放行。见 world.ts 里 `INPUT_BUFFER_FRAMES` 的说明。
   */
  attackBuffer: number;
  dashBuffer: number;
  jumpBuffer: number;
  skillBuffer: number;
  executeBuffer: number;
  /**
   * 位移类动作（冲刺、跳跃）起手那一帧按输入锁定的方向，两者共用这一个字段——
   * 它们从不同时激活，语义上是安全的。
   *
   * 如果永远沿着朝向走，位移就只能是横向的，于是「用它躲开直线攻击」
   * 必然把玩家推向左右两侧——可远程和冲锋的攻击本来就是水平直线，
   * 横着躲是躲不开的。锁定方向后，按住上下就是纵深闪避，
   * GAME_DESIGN 3.5 说的「用纵深躲，或冲刺/跳跃切入」这才成立。
   */
  lockedMoveDir: Vec2;

  /**
   * 正面减伤系数（盾兵用）。0.25 表示正面只吃 25% 伤害，
   * 背后不减——这就是「用纵深绕后」这个玩法要求的数据来源。
   */
  frontalGuard?: number;
  /** 背后受击的伤害倍率，配合 frontalGuard 拉开正反面的差距 */
  backstabMultiplier?: number;

  /** 当前预警，渲染层读它画出可见提示；无预警时为 null */
  telegraph: Telegraph | null;

  /**
   * 局内三选一成长的加成，全部默认为「不生效」的中性值——
   * 没选过任何成长的玩家，数值应该和 M1 阶段完全一样。
   * 只在玩家身上有意义，敌人固定用默认值。见 GAME_DESIGN 3.6。
   */
  /** 普攻与处决伤害倍率（锋芒路线），默认 1 */
  damageMultiplier: number;
  /** 技能伤害倍率（玄术路线），默认 1 */
  skillDamageMultiplier: number;
  /** 技能能量消耗倍率，越低越省（玄术路线），默认 1 */
  skillCostMultiplier: number;
  /** 处决额外回复量（守元路线），默认 0 */
  executeHealBonus: number;

  /**
   * 这次出手是不是在上一个动作的完美取消窗口内触发的——只在触发那一刻
   * setAction 时打标记，下一次命中判定读取并应用伤害加成后立即清空，
   * 不会持续生效到后续攻击。只有玩家会用到，敌人恒为 false。
   */
  perfectCancelPending: boolean;

  /**
   * AI 的内部计时。放在实体上而不是 AI 模块的私有表里，
   * 是为了让「重开一局 = 丢掉整个 World」这件事继续成立，不用额外清理。
   */
  ai: {
    /**
     * 转身冷却。盾兵靠它慢半拍地转向——这是「绕后」能不能成立的关键：
     * 转身即时的话玩家永远绕不到背面，正面减伤就变成了纯粹的血量膨胀。
     */
    turnCooldown: number;
    /** 重新选位的剩余帧，用于远程和冲锋拉开距离后的稳定站位 */
    repositionFrames: number;
    /**
     * 首领的阶段：1（100%-50%血）只用重击和突进，
     * 2（50%以下）额外解锁范围技，且切换那一刻触发一次召唤。
     * 只有 kind==='boss' 的实体会用到，其余类型恒为 1。
     */
    bossPhase: 1 | 2;
    /** 阶段二的召唤只该触发一次——不然每次判定都召唤会没完没了地刷杂兵 */
    bossSummoned: boolean;
  };

  dead: boolean;
  /** 死亡后的淡出计时，给表现层用 */
  deadFrames: number;
}

/** 远程敌人的弹丸。独立于实体列表，判定和碰撞都比实体简单得多。 */
export interface Projectile {
  id: number;
  team: Team;
  owner: number;
  pos: Vec2;
  velocity: Vec2;
  radius: number;
  damage: number;
  knockback: number;
  /** 剩余存活帧，防止飞出场外后一直留在内存里 */
  life: number;
  dead: boolean;
}

export interface DamageEvent {
  attacker: number;
  target: number;
  damage: number;
  /** 世界坐标，表现层在这里放特效和飘字 */
  at: Vec2;
  killed: boolean;
  /** 打在背后（盾兵弱点），表现层用它区分音效和飘字颜色 */
  backstab?: boolean;
  /** 被正面格挡削弱，表现层画「铛」的反馈 */
  guarded?: boolean;
  /** 这一下是处决 */
  execute?: boolean;
  /**
   * 攻击方在出手时是否给过预警。M1 验收第 4 条靠它统计：
   * 任何造成玩家死亡的伤害都必须 telegraphed=true。
   */
  telegraphed?: boolean;
  /** 这一下是完美取消触发的连段，带了伤害加成——表现层用它画特殊反馈 */
  perfectCancel?: boolean;
}

export interface WorldEvents {
  damage: DamageEvent[];
  /** 本帧需要冻结的帧数，取最大值 */
  hitStop: number;
  /** 本帧发生的处决，表现层放特写 */
  executes: { at: Vec2; healed: number }[];
  /** 本帧释放的技能，表现层画冲击波 */
  skillCasts: { at: Vec2; radius: number }[];
  /** 本帧发生的首领阶段切换，表现层放特写并打出「阶段二」之类的提示 */
  bossPhaseShifts: { at: Vec2; phase: 2 }[];
}
