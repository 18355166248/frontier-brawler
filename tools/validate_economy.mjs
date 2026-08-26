#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/core/economy.ts';",
      "export * from './src/core/run.ts';",
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
const { applyResourceChanges, createProfile, createStageProfile } = economy;

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

if (!process.exitCode) {
  console.log('[validate_economy] 三资源原子收支、失败回滚与跨关深拷贝通过');
}
