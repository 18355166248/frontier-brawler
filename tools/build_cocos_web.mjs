import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'native/cocos-poc');
const config = join(project, 'build-web-mobile.json');
const creator = process.env.COCOS_CREATOR_PATH
  ?? '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator';

function run(command, args, cwd, accepted = [0]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) {
    throw new Error(`${command} 失败，退出码 ${result.status ?? 'unknown'}`);
  }
}

if (!existsSync(creator)) throw new Error(`Cocos Creator CLI 不存在：${creator}`);

// Web 预览也必须使用与 APK 相同的共享核心、动作行序和素材，避免预览成另一套实现。
run(process.execPath, [join(root, 'tools/build_cocos_core.mjs')], root);
run(process.execPath, [join(root, 'tools/validate_cocos_sprite_map.mjs')], root);
run(process.execPath, [join(root, 'tools/validate_cocos_camera.mjs')], root);
run(process.execPath, [join(root, 'tools/sync_cocos_art.mjs')], root);
run(
  creator,
  ['--project', project, '--build', `configPath=${config}`],
  root,
  // Cocos Creator 3.8.x 的命令行成功构建会返回 36。
  [0, 36],
);

const output = join(project, 'build/web-mobile');
const pwaSource = join(project, 'web-pwa');
const indexPath = join(output, 'index.html');
const index = await readFile(indexPath, 'utf8');
const pwaHead = `
  <meta name="theme-color" content="#090d10">
  <meta name="screen-orientation" content="portrait">
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="icon" href="./frontier-icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="./frontier-icon.svg">
`;
const registration = `
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./service-worker.js').catch(function (error) {
        console.warn('[frontier-brawler] service worker unavailable', error);
      });
    });
  }
</script>
`;
// Creator 每次构建都会重写 index.html；PWA 壳必须在构建后确定性注入，不能手改产物。
const patchedIndex = index
  .replace('content="width=device-width,user-scalable=no,', 'content="viewport-fit=cover,width=device-width,user-scalable=no,')
  .replace('  <link rel="stylesheet"', `${pwaHead}\n  <link rel="stylesheet"`)
  .replace('\n</body>', `${registration}\n</body>`)
  .replace('<title>Cocos Creator | frontier-brawler-web</title>', '<title>边境乱斗</title>');
if (patchedIndex === index) throw new Error('Cocos Web index.html 结构变化，PWA 注入点失效');
await writeFile(indexPath, patchedIndex);
await Promise.all([
  copyFile(join(pwaSource, 'manifest.webmanifest'), join(output, 'manifest.webmanifest')),
  copyFile(join(pwaSource, 'frontier-icon.svg'), join(output, 'frontier-icon.svg')),
]);
const cacheVersion = createHash('sha256').update(patchedIndex).digest('hex').slice(0, 12);
const serviceWorker = (await readFile(join(pwaSource, 'service-worker.js'), 'utf8'))
  .replaceAll('__CACHE_VERSION__', cacheVersion);
await writeFile(join(output, 'service-worker.js'), serviceWorker);

const manifest = JSON.parse(await readFile(join(output, 'manifest.webmanifest'), 'utf8'));
if (
  manifest.display !== 'standalone'
  || manifest.orientation !== 'portrait'
  || !patchedIndex.includes('navigator.serviceWorker.register')
  || !patchedIndex.includes('viewport-fit=cover')
  || serviceWorker.includes('__CACHE_VERSION__')
) {
  throw new Error('Cocos Web PWA 后处理校验失败');
}

console.log(`Cocos Web PWA: ${indexPath}`);
