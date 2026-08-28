#!/usr/bin/env node

/** 生产包门禁：保证可部署到子目录，并阻止开发验收入口被带进正式产物。 */
import { access, readFile, readdir } from 'node:fs/promises';
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

// public/ 素材由运行时字符串加载，不会经过 Vite import 图；只看 JS 构建成功无法
// 发现漏拷贝。直接从最终脚本提取所有 PNG 路径，再逐一核对发布目录。
const runtimeArt = [...new Set(source.match(/art\/[a-z0-9_./-]+\.png/gi) ?? [])];
if (!runtimeArt.length) throw new Error('[validate_release] 生产脚本没有引用任何正式素材');
for (const relativePath of runtimeArt) {
  await access(join(distRoot, relativePath)).catch(() => {
    throw new Error(`[validate_release] 运行时素材未进入生产包：${relativePath}`);
  });
  const signature = await readFile(join(distRoot, relativePath));
  if (signature.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`[validate_release] 运行时素材不是有效 PNG：${relativePath}`);
  }
}

console.log(
  `[validate_release] PASS: relative assets, ${runtimeArt.length} runtime PNGs, production bundle, dev-hook stripping`,
);
