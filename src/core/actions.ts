/**
 * 动作定义：帧数、判定框生效区间、位移曲线、连招取消关系。
 *
 * 帧数分配就是打击感——这条是上一轮调动作参数实测出来的：
 * 挥砍前摇慢、挥出只占 2-3 帧所以显得快、命中后定格几帧让力道落地。
 * 这里的数值和 ai-asset-pipeline 动作库里的 slash/slash2 是同一套节奏，
 * 美术帧和逻辑帧对齐，判定生效的那一帧正好是画面上剑挥到位的那一帧。
 */
import type { ActionDef, ActionState } from './types';

/** 逻辑帧率。固定步长，不跟随显示帧率，保证手感在任何设备一致。 */
export const TICK_RATE = 60;

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
    cancelInto: ['slash'],
  },

  hit: {
    id: 'hit',
    frames: 20,
    loop: false,
    cancelable: false,
    hitboxes: [],
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
  // 一次性动作在判定窗口结束后进入可取消的收招段，
  // 这是连招手感的关键：太早能取消会让攻击没有重量，太晚会觉得黏。
  const last = def.hitboxes[def.hitboxes.length - 1];
  if (!last) return frame >= def.frames - 1;
  return frame >= last.activeTo;
}
