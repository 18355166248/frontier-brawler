/**
 * 局内统计。存在的唯一理由是**让 M1 的验收标准可判定**——
 * ROADMAP 要求的是「普攻占比 < 60%」「纵深/横向 > 0.25」这样的数字，
 * 不是「感觉还行」。所以埋点必须先于调参，否则调完也不知道调对没有。
 *
 * 这一层同样零渲染依赖：它只是 World 推进时顺手记下来的账。
 */
import type { EnemyKind } from './types';

/** 玩家主动出手的分类。占比统计只看这几种，走位和受击不计入。 */
export type OffensiveAction = 'slash' | 'slash2' | 'skill' | 'dash' | 'execute' | 'jump' | 'airSlash';

export interface UnwarnedHit {
  /** 第几逻辑帧挨的这一下 */
  frame: number;
  /** 谁打的 */
  attacker: EnemyKind | 'unknown';
  damage: number;
  /** 挨完这下是否直接死了 */
  lethal: boolean;
}

export class RunStats {
  /** 本局已推进的逻辑帧 */
  frames = 0;

  /** 各类主动动作的触发次数 */
  readonly actions: Record<OffensiveAction, number> = {
    slash: 0,
    slash2: 0,
    skill: 0,
    dash: 0,
    execute: 0,
    jump: 0,
    airSlash: 0,
  };

  /** 玩家横向移动的累计距离（含动作位移） */
  moveX = 0;
  /** 玩家纵深移动的累计距离 */
  moveY = 0;

  executes = 0;
  kills = 0;
  /** 按类型分的击杀，用来看玩家是不是在回避某一种敌人 */
  readonly killsByKind: Partial<Record<EnemyKind, number>> = {};

  /** 完美取消触发次数——用来看玩家有没有在练精确时机，而不是乱按也能过 */
  perfectCancels = 0;

  damageTaken = 0;
  hitsTaken = 0;
  /**
   * 无预警地打到玩家的伤害。M1 验收第 4 条要求这里**致死的那部分必须为 0**。
   * 低伤害的贴脸普攻允许无预警（它的前摇本身就是提示），
   * 但任何一下把玩家打死的伤害都必须是预告过的。
   */
  readonly unwarned: UnwarnedHit[] = [];

  died = false;

  recordAction(action: OffensiveAction): void {
    this.actions[action] += 1;
  }

  recordMove(dx: number, dy: number): void {
    this.moveX += Math.abs(dx);
    this.moveY += Math.abs(dy);
  }

  recordKill(kind: EnemyKind | undefined): void {
    this.kills += 1;
    if (kind) this.killsByKind[kind] = (this.killsByKind[kind] ?? 0) + 1;
  }

  recordDamageTaken(damage: number, telegraphed: boolean, attacker: EnemyKind | 'unknown', lethal: boolean): void {
    this.damageTaken += damage;
    this.hitsTaken += 1;
    if (!telegraphed) {
      this.unwarned.push({ frame: this.frames, attacker, damage, lethal });
    }
  }

  /** 主动动作总次数，占比的分母 */
  get totalOffensive(): number {
    return (
      this.actions.slash +
      this.actions.slash2 +
      this.actions.skill +
      this.actions.dash +
      this.actions.execute +
      this.actions.jump +
      this.actions.airSlash
    );
  }

  /**
   * 普攻占比。M1 验收第 1 条要求 < 0.6——
   * 还是一路平 A 的话，说明新机制没真正进入玩家的决策，深度不够。
   */
  get basicAttackRatio(): number {
    const total = this.totalOffensive;
    if (total === 0) return 0;
    return (this.actions.slash + this.actions.slash2) / total;
  }

  /**
   * 纵深与横向的移动比。M1 验收第 2 条要求 > 0.25，
   * 用来判断盾兵和远程有没有真的逼出纵深走位。
   */
  get depthRatio(): number {
    if (this.moveX < 1) return 0;
    return this.moveY / this.moveX;
  }

  /** 致死的无预警伤害。这个必须是空的，否则第 4 条直接不通过。 */
  get lethalUnwarned(): UnwarnedHit[] {
    return this.unwarned.filter((u) => u.lethal);
  }

  /** 一局多少秒，用于对照 3-5 分钟的时长目标 */
  get seconds(): number {
    return this.frames / 60;
  }

  /** 摘要，给调试面板和自动化验收读 */
  summary(): {
    seconds: number;
    basicAttackRatio: number;
    depthRatio: number;
    executes: number;
    kills: number;
    damageTaken: number;
    unwarnedLethal: number;
    actions: Record<OffensiveAction, number>;
    perfectCancels: number;
    died: boolean;
  } {
    return {
      seconds: Number(this.seconds.toFixed(1)),
      basicAttackRatio: Number(this.basicAttackRatio.toFixed(3)),
      depthRatio: Number(this.depthRatio.toFixed(3)),
      executes: this.executes,
      kills: this.kills,
      damageTaken: Math.round(this.damageTaken),
      unwarnedLethal: this.lethalUnwarned.length,
      actions: { ...this.actions },
      perfectCancels: this.perfectCancels,
      died: this.died,
    };
  }
}
