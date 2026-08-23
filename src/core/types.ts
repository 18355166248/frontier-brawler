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

/** 动作状态机的状态。和动作库的 clip id 一一对应。 */
export type ActionState =
  | 'idle'
  | 'move'
  | 'slash'
  | 'slash2'
  | 'dash'
  | 'hit';

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
}

export type Team = 'player' | 'enemy';

export interface Entity {
  id: number;
  team: Team;
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

  dead: boolean;
  /** 死亡后的淡出计时，给表现层用 */
  deadFrames: number;
}

export interface DamageEvent {
  attacker: number;
  target: number;
  damage: number;
  /** 世界坐标，表现层在这里放特效和飘字 */
  at: Vec2;
  killed: boolean;
}

export interface WorldEvents {
  damage: DamageEvent[];
  /** 本帧需要冻结的帧数，取最大值 */
  hitStop: number;
}
