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

static func checkpoint(raw: Variant) -> Dictionary:
	# 保存读取、继续按钮和恢复共用一份校验，不能先重建场景再发现缺字段。
	if not raw is Dictionary or raw.is_empty():
		return {}
	for key in ["room_id", "upgrade", "hp", "energy", "elapsed_frames", "kills", "executes", "perfect", "cooldowns"]:
		if not raw.has(key):
			return {}
	if not raw.room_id is String or not raw.upgrade is String or raw.upgrade not in ["", "offense", "arcane", "guardian"]:
		return {}
	for key in ["hp", "energy", "elapsed_frames", "kills", "executes", "perfect"]:
		if (not raw[key] is float and not raw[key] is int) or not is_finite(float(raw[key])):
			return {}
	if raw.hp <= 0 or raw.hp > 300 or raw.energy < 0 or raw.energy > 100:
		return {}
	for key in ["elapsed_frames", "kills", "executes", "perfect"]:
		if raw[key] < 0 or raw[key] > 10000000 or float(raw[key]) != int(raw[key]):
			return {}
	if not raw.cooldowns is Dictionary:
		return {}
	for key in ["q", "w", "e", "r"]:
		var value: Variant = raw.cooldowns.get(key)
		if (not value is float and not value is int) or not is_finite(float(value)) or value < 0 or value > 10000 or float(value) != int(value):
			return {}
	var phase: Variant = raw.get("phase", "entry") # 兼容已发布的版本2房间入口档。
	if phase not in ["entry", "loot"]:
		return {}
	for definition in FBData.all().stage.rooms:
		if definition.id == raw.room_id and (phase != "loot" or definition.kind == "boss"):
			var result: Dictionary = raw.duplicate(true)
			result.phase = phase
			return result
	return {}

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
	if not result.checkpoint.is_empty():
		var normalized := checkpoint(result.checkpoint)
		if normalized.is_empty():
			return {} # 主档检查点损坏时尝试上一份完整备份，而不是展示无法恢复的继续按钮。
		result.checkpoint = normalized
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
