#!/usr/bin/env node

/** 生产包门禁：保证可部署到子目录，并阻止开发验收入口被带进正式产物。 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const distRoot = join(process.cwd(), 'dist');
const html = await readFile(join(distRoot, 'index.html'), 'utf8');
const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+assets\/[^"]+)"/g)].map((match) => match[1]);
if (!assetRefs.length || assetRefs.some((ref) => !ref.startsWith('./assets/'))) {
  throw new Error(`[validate_release] 生产资源不是相对路径：${assetRefs.join(', ') || 'none'}`);
}

const assetNames = await readdir(join(distRoot, 'assets'));
const scripts = assetNames.filter((name) => name.endsWith('.js'));
if (!scripts.length) throw new Error('[validate_release] 没有生成生产脚本');
const source = (await Promise.all(scripts.map((name) => readFile(join(distRoot, 'assets', name), 'utf8')))).join('\n');
for (const marker of ['__game', '验收面板', 'professionReport', 'validationPanelModel']) {
  if (source.includes(marker)) throw new Error(`[validate_release] 开发入口泄漏到生产包：${marker}`);
}

console.log('[validate_release] PASS: relative assets, production bundle, dev-hook stripping');
