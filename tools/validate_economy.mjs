#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/economy.ts';",
      "export * from './src/core/run.ts';",
      "export * from './src/core/stages.ts';",
      "export * from './src/core/world.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'economy-validation-entry.ts',
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
if (!source) throw new Error('无法加载经营核心');
const economy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const {
  BUILDING_UNLOCKS,
  EMPTY_INPUT,
  Run,
  STAGES,
  applyResourceChanges,
  createProfile,
  createStageProfile,
  recordStageCompletion,
  unlockedBuildings,
} = economy;

const fail = (message) => {
  console.error(`[validate_economy] FAIL: ${message}`);
  process.exitCode = 1;
};

const profile = createProfile();
if (!applyResourceChanges(profile.base, { materials: 40, blueprints: 2 }, 'stage-clear')) {
  fail('合法收入写入失败');
}
if (!applyResourceChanges(profile.base, { materials: -25, blueprints: -1 }, 'construction')) {
  fail('多资源原子消耗失败');
}

const beforeFailedSpend = JSON.stringify(profile.base);
if (applyResourceChanges(profile.base, { materials: -999, rareMaterials: 1 }, 'invalid-spend')) {
  fail('余额不足的组合交易不应成功');
}
if (JSON.stringify(profile.base) !== beforeFailedSpend) fail('失败交易留下了部分余额或流水');

const next = createStageProfile(profile);
if (next.base.resources.materials !== 15 || next.base.resources.blueprints !== 1) {
  fail('资源没有跨关保留');
}
next.base.resources.materials += 1;
if (profile.base.resources.materials !== 15) fail('跨关档案仍与上一关共享资源对象');
next.base.resourceLedger[0].reason = 'mutated-copy';
if (profile.base.resourceLedger[0]?.reason !== 'stage-clear') fail('跨关档案仍与上一关共享流水对象');

const legacyProfile = createProfile();
delete legacyProfile.base;
const migrated = createStageProfile(legacyProfile);
if (migrated.base.resources.materials !== 0 || migrated.base.resourceLedger.length !== 0) {
  fail('缺少 M5 字段的旧档案没有迁移为空账本');
}

const unlockProfile = createProfile();
const expectedUnlocks = ['trainingGround', 'forge', 'alchemyLab', 'resourceField', 'archive'];
for (let clears = 0; clears <= expectedUnlocks.length; clears += 1) {
  const actual = unlockedBuildings(unlockProfile.base);
  if (actual.join(',') !== expectedUnlocks.slice(0, clears).join(',')) {
    fail(`第 ${clears} 次通关后的建筑顺序错误：${actual.join(',')}`);
  }
  if (clears < expectedUnlocks.length) recordStageCompletion(unlockProfile.base);
}
if (BUILDING_UNLOCKS.some((building, index) => building.unlockAfterClears !== index + 1)) {
  fail('五栋建筑没有按 1-5 次通关逐栋开放');
}

// 集成验证：Boss 房首次清空计一次；在结算/掉落界面继续 step 不能重复累计。
const runProfile = createProfile();
const run = new Run(STAGES[0], runProfile);
run.setProfession('swift');
run.enterRoom('v3', null);
for (const entity of run.world.entities) {
  if (entity.team === 'enemy') entity.dead = true;
}
for (let frame = 0; frame < 30; frame += 1) run.step(EMPTY_INPUT);
if (run.profile.base.completedStageRuns !== 1) fail('Boss 首次清空没有准确记录一次通关');

if (!process.exitCode) {
  console.log('[validate_economy] 资源账本、跨关迁移、Boss 通关计数与五建筑解锁顺序通过');
}
