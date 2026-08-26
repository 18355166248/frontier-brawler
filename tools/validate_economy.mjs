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
  BUILDING_IDS,
  BUILDING_PLANS,
  EMPTY_INPUT,
  Run,
  STAGES,
  applyResourceChanges,
  canAffordResources,
  craftTonic,
  createProfile,
  createStageProfile,
  queueBuildingConstruction,
  recordStageCompletion,
  roomResourceReward,
  selectArchiveTrack,
  settleConstruction,
  settleOfflineIncome,
  unlockedBuildings,
} = economy;

const fail = (message) => {
  console.error(`[validate_economy] FAIL: ${message}`);
  process.exitCode = 1;
};

if (
  BUILDING_IDS.some((id) => {
    const plan = BUILDING_PLANS[id];
    return (
      plan.id !== id ||
      !Number.isSafeInteger(plan.durationMs) ||
      plan.durationMs <= 0 ||
      Object.values(plan.cost).some((amount) => !Number.isSafeInteger(amount) || amount < 0)
    );
  })
) fail('建筑价格或时长配置不完整');

if (Object.keys(roomResourceReward(1, 'start')).length !== 0) fail('起始房错误地产出资源');
if (Object.keys(roomResourceReward(1, 'reward')).length !== 0) fail('奖励房错误地产出资源');
const normalReward = roomResourceReward(2, 'normal');
if (
  normalReward.materials !== 5 ||
  normalReward.blueprints !== undefined ||
  normalReward.rareMaterials !== undefined
) fail('普通房产出梯度错误');
const earlyEliteReward = roomResourceReward(4, 'elite');
const lateEliteReward = roomResourceReward(5, 'elite');
if (earlyEliteReward.blueprints !== 1 || earlyEliteReward.rareMaterials !== undefined) {
  fail('低阶段精英房产出梯度错误');
}
if (lateEliteReward.blueprints !== 1 || lateEliteReward.rareMaterials !== 1) {
  fail('高阶段精英房没有产出稀有材料');
}
const earlyBossReward = roomResourceReward(2, 'boss');
const lateBossReward = roomResourceReward(3, 'boss');
if (earlyBossReward.blueprints !== 2 || earlyBossReward.rareMaterials !== undefined) {
  fail('低阶段 Boss 房产出梯度错误');
}
if (lateBossReward.blueprints !== 2 || lateBossReward.rareMaterials !== 1) {
  fail('中后期 Boss 房没有产出稀有材料');
}
if (Object.keys(roomResourceReward(0, 'boss')).length !== 0) fail('非法关卡序号仍产出资源');
if (Object.keys(roomResourceReward(Number.MAX_SAFE_INTEGER, 'boss')).length !== 0) {
  fail('溢出的关卡资源计算没有被拒绝');
}

const profile = createProfile();
if (canAffordResources(profile.base, BUILDING_PLANS.trainingGround.cost)) {
  fail('空资源档案错误地满足了建造成本');
}
if (!applyResourceChanges(profile.base, { materials: 40, blueprints: 2 }, 'stage-clear')) {
  fail('合法收入写入失败');
}
if (!canAffordResources(profile.base, BUILDING_PLANS.trainingGround.cost)) {
  fail('资源充足时仍被判定为不可建造');
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

const partialLegacyProfile = createProfile();
delete partialLegacyProfile.base.resources;
delete partialLegacyProfile.base.resourceLedger;
delete partialLegacyProfile.base.nextLedgerSequence;
delete partialLegacyProfile.base.archiveTrack;
delete partialLegacyProfile.base.tonics;
const migratedPartial = createStageProfile(partialLegacyProfile);
if (
  migratedPartial.base.resources.materials !== 0 ||
  migratedPartial.base.resourceLedger.length !== 0 ||
  migratedPartial.base.nextLedgerSequence !== 1 ||
  migratedPartial.base.archiveTrack !== null ||
  migratedPartial.base.tonics !== 0
) fail('base 存在但账本子字段缺失时迁移失败');

const malformedArchiveProfile = createProfile();
malformedArchiveProfile.base.archiveTrack = 'offense2';
if (createStageProfile(malformedArchiveProfile).base.archiveTrack !== null) {
  fail('非法藏经阁路线没有在迁移时降级为空');
}
malformedArchiveProfile.base.tonics = -1;
if (createStageProfile(malformedArchiveProfile).base.tonics !== 0) {
  fail('非法丹房补给数量没有在迁移时降级为零');
}

const archiveProfile = createProfile();
if (selectArchiveTrack(archiveProfile.base, 'offense')) fail('藏经阁建成前允许选择永久路线');
archiveProfile.base.completedBuildings.push('archive');
if (!selectArchiveTrack(archiveProfile.base, 'offense')) fail('藏经阁建成后无法选择永久路线');
const archiveStageProfile = createStageProfile(archiveProfile);
if (
  archiveStageProfile.upgrades.offense !== 1 ||
  archiveStageProfile.upgrades.arcane !== 0 ||
  archiveStageProfile.upgrades.guardian !== 0
) fail('藏经阁路线没有在下一次出击种入恰好一级');
archiveProfile.base.completedBuildings = [];
const unbuiltArchiveStageProfile = createStageProfile(archiveProfile);
if (unbuiltArchiveStageProfile.upgrades.offense !== 0) {
  fail('只有路线字段、没有建成藏经阁时仍获得了永久等级');
}

const tonicProfile = createProfile();
applyResourceChanges(tonicProfile.base, { materials: 20 }, 'tonic-test-grant');
if (craftTonic(tonicProfile.base)) fail('丹房建成前允许制作补给');
tonicProfile.base.completedBuildings.push('alchemyLab');
if (!craftTonic(tonicProfile.base) || tonicProfile.base.tonics !== 1) {
  fail('丹房建成后无法制作出击补给');
}
if (tonicProfile.base.resources.materials !== 10) fail('出击补给没有通过账本扣除正确成本');
const tonicStageProfile = createStageProfile(tonicProfile);
if (tonicStageProfile.energy !== tonicStageProfile.maxEnergy || tonicStageProfile.base.tonics !== 0) {
  fail('出击补给没有在下一关恰好消耗一份并充满能量');
}
if (createStageProfile(tonicStageProfile).energy !== 0) fail('补给耗尽后下一关能量没有回落基线');
tonicProfile.base.completedBuildings = [];
tonicProfile.base.tonics = 1;
const unbuiltTonicStageProfile = createStageProfile(tonicProfile);
if (unbuiltTonicStageProfile.energy !== 0 || unbuiltTonicStageProfile.base.tonics !== 1) {
  fail('丹房未建成时错误地消耗并应用了补给');
}

const malformedProfile = createProfile();
delete malformedProfile.base.resources.materials;
if (applyResourceChanges(malformedProfile.base, { materials: -1 }, 'malformed-spend')) {
  fail('畸形余额绕过了非负校验');
}
malformedProfile.base.resources.materials = Number.MAX_SAFE_INTEGER;
if (applyResourceChanges(malformedProfile.base, { materials: 1 }, 'overflow')) {
  fail('余额结果允许越过 MAX_SAFE_INTEGER');
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
if (settleConstruction(queueProfile.base, -1).length !== 0) fail('结算接受了负时间戳');
if (settleConstruction(queueProfile.base, 1.5).length !== 0) fail('结算接受了小数时间戳');

const invalidQueueProfile = createProfile();
recordStageCompletion(invalidQueueProfile.base);
applyResourceChanges(invalidQueueProfile.base, { materials: 100 }, 'test-grant');
for (const options of [
  { nowMs: 0, durationMs: 0, cost: {} },
  { nowMs: 0, durationMs: -1, cost: {} },
  { nowMs: 1.5, durationMs: 10, cost: {} },
  { nowMs: 0, durationMs: 10, cost: { materials: -1 } },
  { nowMs: 0, durationMs: 10, cost: { materials: 1.5 } },
  { nowMs: Number.MAX_SAFE_INTEGER, durationMs: 10, cost: { materials: 1 } },
]) {
  const before = JSON.stringify(invalidQueueProfile.base);
  if (queueBuildingConstruction(invalidQueueProfile.base, 'trainingGround', options)) {
    fail(`非法建造参数被接受：${JSON.stringify(options)}`);
  }
  if (JSON.stringify(invalidQueueProfile.base) !== before) fail('非法建造参数修改了资源或队列');
}

const cappedLedgerProfile = createProfile();
for (let index = 0; index < 260; index += 1) {
  applyResourceChanges(cappedLedgerProfile.base, { materials: 1 }, 'ledger-cap');
}
if (
  cappedLedgerProfile.base.resourceLedger.length !== 200 ||
  cappedLedgerProfile.base.resourceLedger[0]?.sequence !== 61 ||
  cappedLedgerProfile.base.resourceLedger.at(-1)?.sequence !== 260
) fail('流水上限或 sequence 连续性错误');
if (applyResourceChanges(cappedLedgerProfile.base, { materials: 1 }, '   ')) {
  fail('空白交易原因未被拒绝');
}

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
settleOfflineIncome(offlineProfile.base, 1, 10, 8 * hour);
if (offlineProfile.base.lastActiveAtMs !== 1 || offlineProfile.base.offlineProductionUnits !== 0) {
  fail('系统时钟回拨后没有安全地重新锚定');
}
const recovered = settleOfflineIncome(offlineProfile.base, 1 + hour, 10, 8 * hour);
if (recovered.creditedMaterials !== 10) fail('时钟校正后离线收益没有恢复');
const capped = settleOfflineIncome(offlineProfile.base, 10_000 + 20 * hour, 10, 8 * hour);
if (capped.creditedMaterials !== 80) fail('离线收益没有按上限截断');
if (offlineProfile.base.resources.blueprints !== 0 || offlineProfile.base.resources.rareMaterials !== 0) {
  fail('离线收益错误地产出了图纸或稀有材料');
}

// 集成验证：资源田完工前不产出，完工后从真实完成时刻开始累计。
const fieldProfile = createProfile();
for (let clear = 0; clear < 4; clear += 1) recordStageCompletion(fieldProfile.base);
applyResourceChanges(fieldProfile.base, { materials: 100, blueprints: 10 }, 'field-test-grant');
if (!queueBuildingConstruction(fieldProfile.base, 'resourceField', {
  nowMs: 1_000,
  durationMs: 100,
  cost: { materials: 80, blueprints: 4 },
})) fail('资源田无法加入测试队列');
const fieldRun = new Run(STAGES[0], fieldProfile);
if (fieldRun.settleBaseOfflineIncome(1_050).creditedMaterials !== 0) {
  fail('资源田完工前错误地产出离线材料');
}
if (fieldRun.settleBaseConstruction(1_200).join(',') !== 'resourceField') {
  fail('资源田没有按时完工');
}
if (fieldProfile.base.lastActiveAtMs !== 1_100) fail('资源田没有从真实完工时刻锚定收益');
const fieldIncome = fieldRun.settleBaseOfflineIncome(1_100 + hour);
if (fieldIncome.creditedMaterials !== 12) fail('资源田建成后的首轮离线产速错误');
if (fieldProfile.base.resources.blueprints !== 6 || fieldProfile.base.resources.rareMaterials !== 0) {
  fail('资源田离线收益错误地修改了高级资源');
}

// 集成验证：Boss 房首次清空计一次；在结算/掉落界面继续 step 不能重复累计。
const runProfile = createProfile();
const run = new Run(STAGES[0], runProfile);
if (run.toggleBaseMenu(1_000)) fail('通关前错误地开放了基地菜单');
if (
  run.availableProfessions.join(',') !== 'swift' ||
  !run.canSelectProfession('swift') ||
  run.canSelectProfession('heavy') ||
  run.canSelectProfession('arcane')
) fail('演武场建成前的正式职业能力模型错误');
// setProfession 是开发地址和自动验证共用的机械入口，不应被正式 UI 门禁污染。
run.setProfession('heavy');
if (run.profile.profession !== 'heavy') fail('职业机械入口错误地依赖演武场');
if (!run.canSelectProfession('heavy') || run.canSelectProfession('arcane')) {
  fail('旧档案当前职业没有保留，或借机开放了其他锁定职业');
}
run.setProfession('swift');
run.enterRoom('v3', null);
for (const entity of run.world.entities) {
  if (entity.team === 'enemy') entity.dead = true;
}
for (let frame = 0; frame < 30; frame += 1) run.step(EMPTY_INPUT);
if (run.profile.base.completedStageRuns !== 1) fail('Boss 首次清空没有准确记录一次通关');
const firstBossResources = { ...run.profile.base.resources };
const expectedBossReward = roomResourceReward(STAGES[0].index, 'boss');
if (
  firstBossResources.materials !== expectedBossReward.materials ||
  firstBossResources.blueprints !== expectedBossReward.blueprints ||
  firstBossResources.rareMaterials !== (expectedBossReward.rareMaterials ?? 0)
) fail('Boss 首次清空没有通过统一账本发放正确资源');
if (
  !run.profile.base.resourceLedger.every(
    (entry) => entry.reason === `room-clear:${STAGES[0].id}:v3`,
  )
) {
  fail('Boss 战斗产出的流水原因不可追溯');
}
if (run.pendingEquipment?.[0]) run.chooseEquipment(run.pendingEquipment[0]);
run.enterRoom('v3', null);
for (const entity of run.world.entities) {
  if (entity.team === 'enemy') entity.dead = true;
}
for (let frame = 0; frame < 30; frame += 1) run.step(EMPTY_INPUT);
if (run.profile.base.completedStageRuns !== 1) fail('重入已清空 Boss 房重复累计通关');
if (JSON.stringify(run.profile.base.resources) !== JSON.stringify(firstBossResources)) {
  fail('重入已清空 Boss 房重复发放资源');
}
const inheritedClear = createStageProfile(run.profile);
if (inheritedClear.base.completedStageRuns !== 1) fail('通关次数没有跨关继承');

if (!run.toggleBaseMenu(1_000) || run.phase !== 'baseMenu') {
  fail('通关并领取战利品后无法打开基地菜单');
}
if (!run.queueBaseBuilding('trainingGround', 1_000)) fail('首个解锁建筑无法从基地菜单开工');
if (run.queueBaseBuilding('trainingGround', 1_000)) fail('基地菜单允许同一建筑重复开工');
if (
  run.profile.base.resources.materials !==
    firstBossResources.materials - (BUILDING_PLANS.trainingGround.cost.materials ?? 0) ||
  run.profile.base.resources.blueprints !==
    firstBossResources.blueprints - (BUILDING_PLANS.trainingGround.cost.blueprints ?? 0)
) fail('基地菜单建造没有按配置原子扣除成本');
if (run.settleBaseConstruction(5_999).length !== 0) fail('基地建筑提前完成');
if (run.settleBaseConstruction(6_000).join(',') !== 'trainingGround') {
  fail('基地建筑没有按配置时间完成');
}
if (!run.canSelectProfession('heavy') || !run.canSelectProfession('arcane')) {
  fail('演武场建成后没有同时开放重击与术法');
}
if (!run.toggleBaseMenu(6_000) || run.phase !== 'stageComplete') {
  fail('基地菜单无法返回通关结算');
}
run.profile.base.completedBuildings.push('archive');
if (!run.toggleBaseMenu(6_000) || !run.cycleArchiveTrack()) {
  fail('基地菜单无法切换藏经阁永久路线');
}
if (run.profile.base.archiveTrack !== 'offense') fail('藏经阁首次切换没有选择锋芒路线');
if (!run.cycleArchiveTrack() || run.profile.base.archiveTrack !== 'arcane') {
  fail('藏经阁路线无法免费改选');
}
run.profile.base.completedBuildings.push('alchemyLab');
applyResourceChanges(run.profile.base, { materials: 10 }, 'menu-tonic-grant');
if (!run.craftTonic() || run.profile.base.tonics !== 1) fail('基地菜单无法制作丹房补给');

if (!process.exitCode) {
  console.log('[validate_economy] 战斗产出、资源账本、建筑解锁、建造队列、离线收益与跨关迁移通过');
}
