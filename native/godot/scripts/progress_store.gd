class_name FBProgressStore
extends RefCounted
## 只存纯数据；测试默认内存模式，避免回归写入玩家真实进度。
const RELICS := {
	"wind-sabers": {"label": "疾风双刃", "description": "下次出行：普攻伤害 +8%"},
	"scout-coat": {"label": "斥候轻甲", "description": "下次出行：基础生命 +16"},
	"execution-charm": {"label": "处决护符", "description": "下次出行：处决回复 +6"}
}
var path := "user://progress-v2.json"
var persistent := DisplayServer.get_name() != "headless"
var write_failed := false
var future_version := false
var data := {"version": 2, "completions": 0, "best_frames": 0, "unlocked": [], "equipped": "", "muted": false, "reduced_motion": false, "checkpoint": {}}

func decode(file_path: String) -> Dictionary:
	if not FileAccess.file_exists(file_path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(file_path))
	if not parsed is Dictionary:
		return {}
	var version: Variant = parsed.get("version", 0)
	if not version is float and not version is int:
		return {}
	if version > 2:
		future_version = true
		return {}
	if int(version) not in [1, 2] or float(version) != int(version):
		return {}
	var required := ["completions", "best_frames", "unlocked", "equipped"]
	if int(version) == 2:
		required.append_array(["muted", "reduced_motion", "checkpoint"])
	for key in required:
		if not parsed.has(key):
			return {}
	# v1 仅有成绩和遗物，升级时补全设置与检查点；未知未来版本禁止覆盖。
	var result := data.duplicate(true)
	result.merge(parsed, true)
	result.version = 2
	if not result.completions is float and not result.completions is int:
		return {}
	if not result.best_frames is float and not result.best_frames is int:
		return {}
	if result.completions < 0 or result.best_frames < 0 or not result.unlocked is Array or not result.equipped is String or not result.muted is bool or not result.reduced_motion is bool or not result.checkpoint is Dictionary:
		return {}
	for relic in result.unlocked:
		if not relic is String or not RELICS.has(relic):
			return {}
	if result.equipped != "" and not result.unlocked.has(result.equipped):
		return {}
	return result

func load_progress() -> void:
	if not persistent:
		return
	var loaded := decode(path)
	if loaded.is_empty() and not future_version:
		loaded = decode(path + ".bak")
	if not loaded.is_empty():
		data = loaded

func save_progress() -> bool:
	if not persistent:
		return true
	if future_version:
		write_failed = true
		return false
	var file := FileAccess.open(path + ".tmp", FileAccess.WRITE)
	if file == null:
		write_failed = true
		return false
	file.store_string(JSON.stringify(data))
	file.flush()
	var error := file.get_error()
	file.close()
	if error != OK:
		write_failed = true
		return false
	# 仅用完整可解析的主档更新备份，损坏主档不会覆盖上一份好数据。
	var previous := decode(path)
	if future_version:
		write_failed = true
		return false
	if not previous.is_empty():
		if DirAccess.copy_absolute(path, path + ".bak") != OK:
			write_failed = true
			return false
	write_failed = DirAccess.rename_absolute(path + ".tmp", path) != OK
	return not write_failed
