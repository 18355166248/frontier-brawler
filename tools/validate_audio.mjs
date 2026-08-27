#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: "export * from './src/audio/game-audio.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'audio-validation-entry.ts',
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
if (!source) throw new Error('无法加载音效核心');
const { audioCuesForWorldEvents, GameAudio } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const empty = { damage: [], hitStop: 0, executes: [], skillCasts: [], bossPhaseShifts: [] };
const cues = audioCuesForWorldEvents({
  ...empty,
  damage: [
    { attacker: 1, target: 2, damage: 10, at: { x: 0, y: 0 }, killed: false },
    { attacker: 1, target: 3, damage: 10, at: { x: 0, y: 0 }, killed: false },
    { attacker: 4, target: 1, damage: 5, at: { x: 0, y: 0 }, killed: false },
    { attacker: 1, target: 5, damage: 20, at: { x: 0, y: 0 }, killed: true },
    { attacker: 1, target: 6, damage: 4, at: { x: 0, y: 0 }, killed: false, guarded: true },
    { attacker: 1, target: 7, damage: 12, at: { x: 0, y: 0 }, killed: false, backstab: true },
  ],
  executes: [{ at: { x: 0, y: 0 }, healed: 10 }],
  skillCasts: [
    { at: { x: 0, y: 0 }, radius: 10, power: 'light' },
    { at: { x: 0, y: 0 }, radius: 20, power: 'heavy' },
  ],
  bossPhaseShifts: [{ at: { x: 0, y: 0 }, phase: 2 }],
}, 1);

const expected = [
  'enemyHit', 'playerHit', 'kill', 'guard', 'criticalHit',
  'execute', 'skillLight', 'skillHeavy', 'bossPhase',
];
const guardedKillCues = audioCuesForWorldEvents({
  ...empty,
  damage: [{
    attacker: 1,
    target: 2,
    damage: 1,
    at: { x: 0, y: 0 },
    killed: true,
    guarded: true,
  }],
}, 1);
const missing = expected.filter((cue) => !cues.includes(cue));
if (missing.length || cues.length !== expected.length) {
  console.error(`[validate_audio] FAIL: 事件分类错误 ${JSON.stringify(cues)}`);
  process.exitCode = 1;
} else if (guardedKillCues.join(',') !== 'kill') {
  console.error(`[validate_audio] FAIL: 致命格挡没有优先播放击杀音 ${guardedKillCues}`);
  process.exitCode = 1;
} else if (audioCuesForWorldEvents(empty, 1).length !== 0) {
  console.error('[validate_audio] FAIL: 空事件产生了音效');
  process.exitCode = 1;
} else {
  // Node 没有 AudioContext：解锁失败和未解锁播放都必须静默降级，不能抛错。
  const audio = new GameAudio();
  audio.play('confirm');
  if (await audio.unlock()) {
    console.error('[validate_audio] FAIL: 无 Web Audio 环境错误地解锁成功');
    process.exitCode = 1;
  } else {
    console.log('[validate_audio] PASS: event cues, deduplication, unsupported-browser fallback');
  }
}
