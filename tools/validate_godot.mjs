import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('../native/godot', import.meta.url));
const binary = process.env.GODOT_BIN || 'godot';
for (const args of [
  ['--headless', '--editor', '--path', project, '--import'],
  ['--headless', '--path', project, '--script', 'tests/validate.gd'],
]) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  // Godot 某些脚本错误仍退出 0；必须同时检查错误输出和测试完成标志。
  if (result.error || result.status !== 0 || /SCRIPT ERROR:|ERROR:|CHECK FAILED/.test(output) || (args.includes('tests/validate.gd') && !output.includes('GODOT_VALIDATION_PASS'))) {
    console.error(output, result.error || '');
    process.exit(1);
  }
  if (args.includes('tests/validate.gd')) console.log(output.trim());
}
