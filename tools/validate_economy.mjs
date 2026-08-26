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
  queueBuildingConstruction,
  recordStageCompletion,
  settleConstruction,
  settleOfflineIncome,
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

const queueProfile = createProfile();
recordStageCompletion(queueProfile.base);
recordStageCompletion(queueProfile.base);
applyResourceChanges(queueProfile.base, { materials: 50 }, 'test-grant');
if (!queueBuildingConstruction(queueProfile.base, 'trainingGround', {
  nowMs: 1_000,
  durationMs: 100,
  cost: { materials: 10 },
})) fail('已解锁建筑无法加入队列');
if (!queueBuildingConstruction(queueProfile.base, 'forge', {
  nowMs: 1_000,
  durationMs: 200,
  cost: { materials: 20 },
})) fail('第二栋建筑无法串行排队');
if (queueProfile.base.constructionQueue[1]?.startsAtMs !== 1_100) fail('第二栋建筑没有串行等待');
if (queueBuildingConstruction(queueProfile.base, 'forge', {
  nowMs: 1_000,
  durationMs: 10,
  cost: {},
})) fail('同一建筑被重复加入队列');
if (settleConstruction(queueProfile.base, 1_099).length !== 0) fail('建筑提前完成');
if (settleConstruction(queueProfile.base, 1_100).join(',') !== 'trainingGround') {
  fail('第一栋建筑没有按时完成');
}
if (settleConstruction(queueProfile.base, 1_300).join(',') !== 'forge') {
  fail('跨多个时间点结算队列失败');
}
if (queueProfile.base.resources.materials !== 20) fail('建造成本没有走统一资源账本');

const offlineProfile = createProfile();
const hour = 3_600_000;
settleOfflineIncome(offlineProfile.base, 10_000, 10, 8 * hour);
const firstHalfHour = settleOfflineIncome(offlineProfile.base, 10_000 + hour / 2, 10, 8 * hour);
if (firstHalfHour.creditedMaterials !== 5) fail('半小时离线收益计算错误');
const quarterHour = settleOfflineIncome(offlineProfile.base, 10_000 + (hour * 3) / 4, 10, 8 * hour);
const secondQuarter = settleOfflineIncome(offlineProfile.base, 10_000 + hour, 10, 8 * hour);
if (quarterHour.creditedMaterials !== 2 || secondQuarter.creditedMaterials !== 3) {
  fail('零碎离线时间没有正确累计');
}
const beforeClockRollback = JSON.stringify(offlineProfile.base);
settleOfflineIncome(offlineProfile.base, 1, 10, 8 * hour);
if (JSON.stringify(offlineProfile.base) !== beforeClockRollback) fail('系统时钟回拨仍产生了收益');
const capped = settleOfflineIncome(offlineProfile.base, 10_000 + 20 * hour, 10, 8 * hour);
if (capped.creditedMaterials !== 80) fail('离线收益没有按上限截断');
if (offlineProfile.base.resources.blueprints !== 0 || offlineProfile.base.resources.rareMaterials !== 0) {
  fail('离线收益错误地产出了图纸或稀有材料');
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
  console.log('[validate_economy] 资源账本、建筑解锁、建造队列、离线收益与跨关迁移通过');
}
