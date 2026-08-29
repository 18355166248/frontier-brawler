#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/run.ts';",
      "export * from './src/core/stages.ts';",
      "export * from './src/core/world.ts';",
      "export * from './src/core/level.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'native-stage-entry.ts',
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
if (!source) throw new Error('无法加载原生第一关验证核心');
const { EMPTY_INPUT, Run, STAGES, createProfile, doorPosition } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const run = new Run(STAGES[0], createProfile());
const unconfirmedPosition = { ...run.player.pos };
run.step({ ...EMPTY_INPUT, moveX: 1, attack: true });
if (
  run.phase !== 'professionSelect'
  || run.player.pos.x !== unconfirmedPosition.x
  || run.player.pos.y !== unconfirmedPosition.y
  || JSON.stringify(run.availableProfessions) !== JSON.stringify(['swift'])
) {
  throw new Error('[validate_native_stage] 初次职业选择没有冻结，或职业解锁门禁错误');
}
run.setProfession('heavy');
run.enterRoom('v1', null);

function settleTransition() {
  for (let frame = 0; frame < 24; frame += 1) run.step(EMPTY_INPUT);
}

function clearCombatRoom(expectedRoom, nextRoom) {
  if (run.room.id !== expectedRoom) {
    throw new Error(`[validate_native_stage] 预期 ${expectedRoom}，实际 ${run.room.id}`);
  }
  for (const entity of run.world.entities) {
    if (entity.team === 'enemy') entity.dead = true;
  }
  for (let frame = 0; frame < 44; frame += 1) run.step(EMPTY_INPUT);
  if (run.phase !== 'cleared') {
    throw new Error(`[validate_native_stage] ${expectedRoom} 清房后阶段错误：${run.phase}`);
  }
  const exit = doorPosition(run.world.arena, 'east');
  run.player.pos = { ...exit };
  run.step(EMPTY_INPUT);
  if (run.room.id !== nextRoom) {
    throw new Error(`[validate_native_stage] ${expectedRoom} 未进入 ${nextRoom}`);
  }
  settleTransition();
}

settleTransition();
clearCombatRoom('v1', 'v2');
clearCombatRoom('v2', 'vr');

if (run.phase !== 'choosing' || run.pendingChoice?.length !== 3) {
  throw new Error('[validate_native_stage] 奖励房没有进入三选一');
}
const frozenPlayer = { ...run.player.pos };
const frozenFrames = run.overallSummary().frames;
for (let frame = 0; frame < 30; frame += 1) {
  run.step({ ...EMPTY_INPUT, moveX: 1, attack: true, attackHeld: true });
}
if (
  run.phase !== 'choosing'
  || run.player.pos.x !== frozenPlayer.x
  || run.player.pos.y !== frozenPlayer.y
  || run.overallSummary().frames !== frozenFrames
) {
  throw new Error('[validate_native_stage] 奖励选择层没有冻结战斗与统计');
}
run.chooseUpgrade(run.pendingChoice[0]);
const rewardExit = doorPosition(run.world.arena, 'east');
run.player.pos = { ...rewardExit };
run.step(EMPTY_INPUT);
if (run.room.id !== 'v3') throw new Error('[validate_native_stage] 奖励房没有进入 Boss 房');
settleTransition();

for (const entity of run.world.entities) {
  if (entity.team === 'enemy') entity.dead = true;
}
run.step(EMPTY_INPUT);
if (run.phase !== 'equipmentChoice' || !run.pendingEquipment?.[0]) {
  throw new Error('[validate_native_stage] Boss 清空后没有进入战利品选择');
}
run.chooseEquipment(run.pendingEquipment[0]);
if (run.phase !== 'stageComplete') {
  throw new Error(`[validate_native_stage] 领取战利品后未通关：${run.phase}`);
}

console.log('[validate_native_stage] PASS: profession → v1 → v2 → reward → boss → loot → complete');
