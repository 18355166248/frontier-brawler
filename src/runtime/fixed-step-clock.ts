export interface FixedStepResult {
  steps: number;
  clampedFrameMs: number;
  interpolation: number;
}

export interface FixedStepClockOptions {
  tickRate: number;
  maxFrameMs?: number;
}

/**
 * 浏览器 RAF、Cocos update(dt) 和原生生命周期必须共用同一套固定步长规则。
 * 逻辑仍按 60Hz 推进，渲染帧只负责提供经过时间；单帧追赶上限用于避免应用
 * 从后台回来后一次补跑数秒逻辑，导致玩家瞬移或瞬间被敌人打死。
 */
export class FixedStepClock {
  readonly stepMs: number;
  readonly maxFrameMs: number;
  private accumulatorMs = 0;

  constructor(options: FixedStepClockOptions) {
    if (!Number.isFinite(options.tickRate) || options.tickRate <= 0) {
      throw new Error('tickRate 必须是正数');
    }
    this.stepMs = 1000 / options.tickRate;
    this.maxFrameMs = options.maxFrameMs ?? 250;
    if (!Number.isFinite(this.maxFrameMs) || this.maxFrameMs < 0) {
      throw new Error('maxFrameMs 必须是非负数');
    }
  }

  /** 消费一帧真实时间，并返回这次应推进的逻辑帧数。 */
  consume(frameMs: number, paused: boolean, step: () => void): FixedStepResult {
    const safeFrameMs = Number.isFinite(frameMs)
      ? Math.max(0, Math.min(this.maxFrameMs, frameMs))
      : 0;
    this.accumulatorMs += safeFrameMs;

    let steps = 0;
    while (this.accumulatorMs >= this.stepMs) {
      // 暂停期间仍消费时间但不推进逻辑，恢复时不会把暂停帧集中补跑。
      if (!paused) {
        step();
        steps += 1;
      }
      this.accumulatorMs -= this.stepMs;
    }

    return {
      steps,
      clampedFrameMs: safeFrameMs,
      interpolation: this.accumulatorMs / this.stepMs,
    };
  }

  /** 原生应用恢复或主动重开一局时清掉亚帧残留，避免第一帧时序不稳定。 */
  reset(): void {
    this.accumulatorMs = 0;
  }
}
