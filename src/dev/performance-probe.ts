export interface PerformanceReport {
  samples: number;
  entities: number;
  averageFps: number;
  p95FrameMs: number;
  p95LogicMs: number;
  p95RenderMs: number;
  slowFrameRate: number;
  passes60FpsTarget: boolean;
}

interface PerformanceSample {
  frameMs: number;
  logicMs: number;
  renderMs: number;
}

/** 开发期滚动帧时窗口；只保留最近 10 秒左右，避免长时间运行持续涨内存。 */
export class PerformanceProbe {
  private samples: PerformanceSample[] = [];

  constructor(private readonly capacity = 600) {}

  record(frameMs: number, logicMs: number, renderMs: number): void {
    if (![frameMs, logicMs, renderMs].every(Number.isFinite) || frameMs <= 0) return;
    this.samples.push({ frameMs, logicMs: Math.max(0, logicMs), renderMs: Math.max(0, renderMs) });
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }

  clear(): void {
    this.samples = [];
  }

  report(entities: number): PerformanceReport {
    const frames = this.samples.map((sample) => sample.frameMs);
    const logics = this.samples.map((sample) => sample.logicMs);
    const renders = this.samples.map((sample) => sample.renderMs);
    const averageFrameMs = average(frames);
    const slowFrameRate = round(
      frames.filter((frameMs) => frameMs > 20).length / Math.max(1, frames.length),
    );
    const averageFps = averageFrameMs > 0 ? round(1_000 / averageFrameMs) : 0;
    return {
      samples: frames.length,
      entities,
      averageFps,
      p95FrameMs: percentile(frames, 0.95),
      p95LogicMs: percentile(logics, 0.95),
      p95RenderMs: percentile(renders, 0.95),
      slowFrameRate,
      // 至少两秒样本后才判定，避免刚打开页面的几个偶然快帧误报通过。
      passes60FpsTarget: frames.length >= 120 && averageFps >= 58 && slowFrameRate <= 0.05,
    };
  }
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
