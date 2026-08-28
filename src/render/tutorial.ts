export type TutorialHintKind = 'movement' | 'dash' | 'execute';

export interface TutorialHint {
  kind: TutorialHintKind;
  text: string;
}

export interface TutorialHintState {
  stageIndex: number;
  completedStageRuns: number;
  roomId: string;
  phase: string;
  touchMode: boolean;
  depthMoved: number;
  dashUses: number;
  executeUses: number;
  dashReady: boolean;
  telegraphActive: boolean;
  executableInRange: boolean;
}

/**
 * 首次流程只给情境提示，不暂停、不遮挡、不要求确认；一旦完成首次通关就永久退出。
 * 优先级按“现在就能采取的动作”排序，避免同一时刻出现多条互相争抢注意力的说明。
 */
export function selectFirstRunTutorialHint(state: TutorialHintState): TutorialHint | null {
  if (state.stageIndex !== 1 || state.completedStageRuns > 0 || state.phase !== 'fighting') {
    return null;
  }
  if (state.executableInRange) {
    return {
      kind: 'execute',
      text: state.touchMode ? '敌人已虚弱 · 点「决」立即处决' : '敌人已虚弱 · 按 I / F 立即处决',
    };
  }
  if (state.telegraphActive && state.dashReady) {
    return {
      kind: 'dash',
      text: state.touchMode ? '危险预警 · 推住方向并点「闪」脱离' : '危险预警 · 按方向 + K / Shift 冲刺脱离',
    };
  }
  if (state.roomId === 'v1' && state.depthMoved < 72) {
    return {
      kind: 'movement',
      text: state.touchMode ? '上下推动摇杆 · 利用纵深绕开攻击' : 'W / S 上下移动 · 利用纵深绕开攻击',
    };
  }
  if (state.dashUses === 0) {
    return {
      kind: 'dash',
      text: state.touchMode ? '敌人出手时点「闪」· 冲刺期间可躲伤害' : '敌人出手时按 K / Shift · 冲刺期间可躲伤害',
    };
  }
  if (state.executeUses === 0) {
    return {
      kind: 'execute',
      text: state.touchMode ? '看到橙色“处决”标记 · 靠近后点「决」' : '看到橙色“处决”标记 · 靠近后按 I / F',
    };
  }
  return null;
}
