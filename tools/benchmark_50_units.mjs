#!/usr/bin/env node

import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/world.ts';",
      "export * from './src/dev/performance-probe.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'performance-benchmark-entry.ts',
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
if (!source) throw new Error('无法加载战斗核心');
const { EMPTY_INPUT, PerformanceProbe, World, createEnemy, createEntity } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

// 先固定开发面板的判定语义：足量稳定帧应通过，无效样本不计入且窗口必须有上限。
const stableProbe = new PerformanceProbe();
for (let frame = 0; frame < 120; frame += 1) stableProbe.record(16.67, 0.8, 1.7);
const stableReport = stableProbe.report(51);
assert.equal(stableReport.samples, 120);
assert.equal(stableReport.entities, 51);
assert.equal(stableReport.passes60FpsTarget, true);

const boundedProbe = new PerformanceProbe(3);
boundedProbe.record(Number.NaN, 0, 0);
for (let frame = 0; frame < 5; frame += 1) boundedProbe.record(16 + frame, 1, 2);
assert.equal(boundedProbe.report(51).samples, 3);
boundedProbe.clear();
assert.equal(boundedProbe.report(51).samples, 0);

const world = new World({ minX: 40, maxX: 920, minY: 300, maxY: 500 });
world.spawn(createEntity('player', { x: 160, y: 400 }, { hp: 1_000_000, maxHp: 1_000_000 }));
const kinds = ['grunt', 'shield', 'ranged', 'charger', 'elite'];
for (let index = 0; index < 50; index += 1) {
  const column = index % 10;
  const row = Math.floor(index / 10);
  world.spawn(createEnemy(kinds[index % kinds.length], {
    x: 340 + column * 60,
    y: 320 + row * 38,
  }));
}

for (let frame = 0; frame < 120; frame += 1) world.step(EMPTY_INPUT);
const samples = [];
for (let frame = 0; frame < 600; frame += 1) {
  const startedAt = performance.now();
  world.step(EMPTY_INPUT);
  samples.push(performance.now() - startedAt);
}
samples.sort((a, b) => a - b);
const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
const p95 = samples[Math.floor(samples.length * 0.95)];
const max = samples.at(-1);
console.table({ units: world.entities.length, frames: samples.length, averageMs: average, p95Ms: p95, maxMs: max });
if (world.entities.length < 51 || p95 >= 16.67) {
  console.error('[benchmark_50_units] FAIL: 50 单位逻辑帧超过 60fps 预算');
  process.exitCode = 1;
} else {
  console.log('[benchmark_50_units] PASS: 50 enemies remain within the 60fps logic budget');
}
