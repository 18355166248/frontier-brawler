import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('../native/godot', import.meta.url));
const binary = process.env.GODOT_BIN || 'godot';
for (const [args, marker] of [
  [['--headless', '--editor', '--path', project, '--import'], null],
  [['--headless', '--path', project, '--script', 'tests/validate.gd'], 'GODOT_VALIDATION_PASS'],
  [['--headless', '--path', project, '--script', 'tests/illustrated_pose_checks.gd'], 'ILLUSTRATED_POSE_PASS'],
  [['--headless', '--path', project, '--script', 'tests/illustrated_interpolation_checks.gd'], 'ILLUSTRATED_INTERPOLATION_PASS'],
  [['--headless', '--path', project, '--script', 'tests/feedback_checks.gd'], 'FEEDBACK_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/landscape_ui_checks.gd'], 'LANDSCAPE_UI_PASS'],
  [['--headless', '--path', project, '--script', 'tests/wudu_hero_checks.gd'], 'WUDU_HERO_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/copper_guard_checks.gd'], 'COPPER_GUARD_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/yone_mvp_checks.gd'], 'YONE_MVP_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/environment_checks.gd'], 'ENVIRONMENT_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/enemy_roster_checks.gd'], 'ENEMY_ROSTER_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/mechanism_checks.gd'], 'MECHANISM_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/progress_checks.gd'], 'PROGRESS_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/review_v2_checks.gd'], 'REVIEW_V2_CHECKS_PASS'],
  [['--headless', '--path', project, '--script', 'tests/progress_roundtrip.gd', '--', '--write-progress'], 'PROGRESS_WRITE_PASS'],
  [['--headless', '--path', project, '--script', 'tests/progress_roundtrip.gd', '--', '--progress-path=res://output/progress-roundtrip/data.json'], 'PROGRESS_READ_PASS'],
  [['--headless', '--path', project, '--script', 'tests/loot_roundtrip.gd', '--', '--progress-path=res://output/loot-roundtrip/progress.json', '--write-loot'], 'LOOT_WRITE_PASS'],
  [['--headless', '--path', project, '--script', 'tests/loot_roundtrip.gd', '--', '--progress-path=res://output/loot-roundtrip/progress.json'], 'LOOT_READ_PASS'],
]) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  // Godot 某些脚本错误仍退出 0；必须同时检查错误输出和测试完成标志。
  if (result.error || result.status !== 0 || /SCRIPT ERROR:|ERROR:|CHECK FAILED/.test(output) || (marker && !output.includes(marker))) {
    console.error(output, result.error || '');
    process.exit(1);
  }
  if (marker) console.log(output.trim());
}
