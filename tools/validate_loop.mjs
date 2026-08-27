#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: "export * from './src/dev/loop-validation.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'loop-validation-entry.ts',
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
if (!source) throw new Error('无法加载循环验收核心');
const { LoopValidationStore } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const memory = new Map();
const storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
};
const store = new LoopValidationStore(storage);
const ids = Array.from({ length: 5 }, (_, index) => store.recordDefeat(`stage-${index}`, new Date(index)));
store.recordBaseChoice(ids[0]);
store.recordBaseChoice(ids[1]);
store.recordBaseUse(ids[2]);
const report = store.report();
if (
  report.defeats !== 5 ||
  report.baseChoices !== 3 ||
  report.baseUses !== 1 ||
  report.baseChoiceRate !== 0.6 ||
  report.baseUseRate !== 0.2 ||
  !report.passesChoiceTarget
) {
  console.error(`[validate_loop] FAIL: 比例口径错误 ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else if (store.recordBaseChoice('missing')) {
  console.error('[validate_loop] FAIL: 不存在的样本被更新');
  process.exitCode = 1;
} else {
  const reloaded = new LoopValidationStore(storage);
  if (reloaded.samples().length !== 5) {
    console.error('[validate_loop] FAIL: 样本没有跨刷新保留');
    process.exitCode = 1;
  } else {
    reloaded.clear();
    if (reloaded.report().defeats !== 0) {
      console.error('[validate_loop] FAIL: 清除样本失败');
      process.exitCode = 1;
    } else {
      console.log('[validate_loop] PASS: defeat sampling, base choice/use attribution, target report');
    }
  }
}
