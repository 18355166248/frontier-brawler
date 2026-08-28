#!/usr/bin/env node

/** 首关教学首领门禁：局部降难不能泄漏到后续首领。 */
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/enemies.ts';",
      "export * from './src/core/run.ts';",
      "export * from './src/core/stages.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'difficulty-entry.ts',
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
if (!source) throw new Error('无法加载难度验证核心');
const { Run, STAGES, createProfile, think } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function bossAtStage(stageIndex, roomId) {
  const sourceStage = STAGES[stageIndex];
  const run = new Run({ ...sourceStage, startRoom: roomId }, createProfile());
  const boss = run.world.entities.find((entity) => entity.kind === 'boss');
  if (!boss) throw new Error(`[validate_difficulty] ${sourceStage.id} 没有生成首领`);
  return { run, boss };
}

const tutorial = bossAtStage(0, 'v3');
const standard = bossAtStage(1, 'b3');
if (tutorial.boss.ai.bossMode !== 'tutorial' || tutorial.boss.maxHp !== 280) {
  throw new Error('[validate_difficulty] 第一关没有使用 280 血教学首领');
}
if (standard.boss.ai.bossMode !== 'standard' || standard.boss.maxHp !== 420) {
  throw new Error('[validate_difficulty] 后续首领被教学降难污染');
}

const target = tutorial.run.player;
if (!target) throw new Error('[validate_difficulty] 没有生成玩家');
tutorial.boss.pos = { x: target.pos.x + 180, y: target.pos.y };
standard.boss.pos = { x: target.pos.x + 180, y: target.pos.y };
const tutorialIntent = think(tutorial.boss, target, 500, true);
const standardIntent = think(standard.boss, target, 500, true);
if (tutorialIntent.action === 'bossCharge' || tutorialIntent.action === 'bossNova') {
  throw new Error('[validate_difficulty] 教学首领仍会使用进阶招式');
}
if (standardIntent.action !== 'bossCharge') {
  throw new Error('[validate_difficulty] 标准首领的中距离突进被破坏');
}

// 私有方法在运行时仍是普通方法；这里直接验证阶段切换的召唤门禁，不复制实现。
tutorial.run.world.triggerBossPhaseTwo(tutorial.boss);
standard.run.world.triggerBossPhaseTwo(standard.boss);
if (!tutorial.boss.ai.bossSummoned || standard.boss.ai.bossSummoned) {
  throw new Error('[validate_difficulty] 教学/标准首领的阶段二召唤门禁错误');
}

console.log('[validate_difficulty] PASS: tutorial boss isolation, health, moveset, phase-two summon gate');
