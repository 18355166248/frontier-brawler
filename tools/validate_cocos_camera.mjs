#!/usr/bin/env node

import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/runtime/cocos-camera.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  logLevel: 'silent',
});
const source = bundled.outputFiles[0]?.text;
if (!source) throw new Error('无法加载 Cocos 相机投影');
const camera = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const arena = { minX: 0, maxX: 960, minY: 0, maxY: 360 };
const origin = camera.worldToCocosScreen(480, 180, 480, arena);
const horizontal = camera.worldToCocosScreen(576, 180, 480, arena);
const vertical = camera.worldToCocosScreen(480, 276, 480, arena);
const dx = Math.abs(horizontal.x - origin.x);
const dy = Math.abs(vertical.y - origin.y);
if (dx !== 96 || dy !== 96 || dx !== dy) {
  throw new Error(`[validate_cocos_camera] 非等比投影：dx=${dx}, dy=${dy}`);
}
if (vertical.y >= origin.y) {
  throw new Error('[validate_cocos_camera] 世界纵深方向没有映射到屏幕下方');
}
if (camera.clampCocosCameraX(-100, arena) !== 238) {
  throw new Error('[validate_cocos_camera] 左边界没有限制完整视口');
}
if (camera.clampCocosCameraX(1200, arena) !== 722) {
  throw new Error('[validate_cocos_camera] 右边界没有限制完整视口');
}

console.log('[validate_cocos_camera] PASS: isotropic 1:1 projection and camera bounds');
