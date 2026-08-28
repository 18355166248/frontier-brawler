#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: "export * from './src/runtime/fixed-step-clock.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'fixed-step-validation-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  logLevel: 'silent',
});
const source = bundled.outputFiles[0]?.text;
if (!source) throw new Error('无法加载固定步长运行时');
const { FixedStepClock } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

let steps = 0;
const clock = new FixedStepClock({ tickRate: 60 });
for (let i = 0; i < 60; i += 1) clock.consume(1000 / 60, false, () => { steps += 1; });
expect(steps === 60, `一秒应推进 60 帧，实际 ${steps}`);

const clampedClock = new FixedStepClock({ tickRate: 60, maxFrameMs: 250 });
const clamped = clampedClock.consume(2000, false, () => undefined);
expect(clamped.clampedFrameMs === 250, `后台恢复没有钳制到 250ms：${clamped.clampedFrameMs}`);
expect(clamped.steps === 14 || clamped.steps === 15, `250ms 追帧数量异常：${clamped.steps}`);

let pausedSteps = 0;
const pausedClock = new FixedStepClock({ tickRate: 60 });
pausedClock.consume(1000, true, () => { pausedSteps += 1; });
pausedClock.consume(1000 / 60, false, () => { pausedSteps += 1; });
expect(pausedSteps === 1, `暂停恢复发生补帧：${pausedSteps}`);

const invalidClock = new FixedStepClock({ tickRate: 60 });
const invalid = invalidClock.consume(Number.NaN, false, () => undefined);
expect(invalid.steps === 0 && invalid.clampedFrameMs === 0, '非法帧时长没有安全降级');

if (failures.length) {
  for (const message of failures) console.error(`[validate_fixed_step] FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log('[validate_fixed_step] PASS: 60Hz cadence, catch-up clamp, pause drain, invalid-time fallback');
}
