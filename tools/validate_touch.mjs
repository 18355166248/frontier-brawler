#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: "export * from './src/input/touch-controls.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'touch-validation-entry.ts',
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
if (!source) throw new Error('无法加载触控输入核心');
const { normalizeJoystick } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const close = (a, b) => Math.abs(a - b) < 1e-6;
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(JSON.stringify(normalizeJoystick(0, 0, 100)) === '{"x":0,"y":0}', '中心点没有归零');
expect(JSON.stringify(normalizeJoystick(10, 0, 100)) === '{"x":0,"y":0}', '死区内产生漂移');
const right = normalizeJoystick(100, 0, 100);
expect(close(right.x, 1) && close(right.y, 0), '右侧满行程没有映射为单位向量');
const clamped = normalizeJoystick(300, 400, 100);
expect(close(Math.hypot(clamped.x, clamped.y), 1), '超出摇杆的触点没有钳制');
const diagonal = normalizeJoystick(100, 100, 100);
expect(close(diagonal.x, diagonal.y), '斜向输入破坏了方向比例');
expect(JSON.stringify(normalizeJoystick(1, 1, 0)) === '{"x":0,"y":0}', '非法半径没有安全降级');
expect(JSON.stringify(normalizeJoystick(Number.NaN, 1, 10)) === '{"x":0,"y":0}', '非有限输入没有安全降级');

if (failures.length) {
  for (const message of failures) console.error(`[validate_touch] FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log('[validate_touch] PASS: deadzone, proportional direction, clamping, invalid-input fallback');
}
