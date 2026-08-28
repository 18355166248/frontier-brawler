#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: "export * from './src/render/tutorial.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'tutorial-entry.ts',
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
if (!source) throw new Error('无法加载首次引导核心');
const { selectFirstRunTutorialHint } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const base = {
  stageIndex: 1,
  completedStageRuns: 0,
  roomId: 'v1',
  phase: 'fighting',
  touchMode: true,
  depthMoved: 0,
  dashUses: 0,
  executeUses: 0,
  dashReady: true,
  telegraphActive: false,
  executableInRange: false,
};
const expectKind = (state, kind) => {
  const hint = selectFirstRunTutorialHint(state);
  if (hint?.kind !== kind) throw new Error(`[validate_tutorial] 期望 ${kind}，实际 ${hint?.kind ?? 'none'}`);
};

expectKind(base, 'movement');
expectKind({ ...base, telegraphActive: true }, 'dash');
expectKind({ ...base, telegraphActive: true, executableInRange: true }, 'execute');
expectKind({ ...base, depthMoved: 100, dashUses: 1 }, 'execute');
if (selectFirstRunTutorialHint({ ...base, completedStageRuns: 1 }) !== null) {
  throw new Error('[validate_tutorial] 首次通关后仍显示引导');
}
if (selectFirstRunTutorialHint({ ...base, stageIndex: 2 }) !== null) {
  throw new Error('[validate_tutorial] 引导泄漏到后续关卡');
}
if (selectFirstRunTutorialHint({ ...base, phase: 'stageComplete' }) !== null) {
  throw new Error('[validate_tutorial] 结算页仍显示战斗引导');
}

console.log('[validate_tutorial] PASS: context priority, first-run gate, stage/phase isolation');
