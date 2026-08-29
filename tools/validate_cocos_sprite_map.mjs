#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/runtime/cocos-sprite-map.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  logLevel: 'silent',
});
const source = bundled.outputFiles[0]?.text;
if (!source) throw new Error('无法加载 Cocos 动作映射');
const mapping = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const sheets = [
  ['public/art/hero-v2.json', mapping.COCOS_HERO_ROWS],
  ['public/art/enemy-grunt-v2.json', mapping.COCOS_GRUNT_ROWS],
  ['public/art/enemy-boss-v2.json', mapping.COCOS_BOSS_ROWS],
];
for (const [path, expectedRows] of sheets) {
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  if (JSON.stringify(metadata.rowOrder) !== JSON.stringify(expectedRows)) {
    throw new Error(`[validate_cocos_sprite_map] ${path} 行序与 Cocos 映射不一致`);
  }
}

const heroActions = [
  'idle', 'move', 'heavyCharge', 'heavy', 'slash', 'slash2', 'slash3', 'heavyCharged',
  'arcanePulse', 'dash', 'jump', 'hit', 'skill', 'execute', 'airSlash',
];
for (const action of heroActions) {
  const resolved = mapping.resolveCocosSpriteAction('hero', action);
  if (resolved.fallback || !mapping.COCOS_HERO_ROWS.includes(resolved.row)) {
    throw new Error(`[validate_cocos_sprite_map] hero ${action} 未映射：${JSON.stringify(resolved)}`);
  }
}

for (const action of mapping.COCOS_BOSS_ROWS) {
  const resolved = mapping.resolveCocosSpriteAction('boss', action);
  if (resolved.fallback || resolved.row !== action) {
    throw new Error(`[validate_cocos_sprite_map] boss ${action} 未映射`);
  }
}

console.log('[validate_cocos_sprite_map] PASS: sheet rows and reachable hero/boss actions');
