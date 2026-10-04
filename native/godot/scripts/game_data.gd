class_name FBData
extends RefCounted

static var cache: Dictionary = {}
static var yone_cache: Dictionary = {}

static func all() -> Dictionary:
	if cache.is_empty():
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/first_stage.json"))
		assert(parsed is Dictionary and parsed.get("schema") == 1, "首关数据缺失或版本错误")
		cache = parsed
	return cache

static func action(id: String, hero: bool) -> Dictionary:
	if hero and yone().actions.has(id):
		return yone().actions[id]
	return all()["player_actions" if hero else "enemy_actions"][id]

static func yone() -> Dictionary:
	if yone_cache.is_empty():
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/yone_mvp.json"))
		assert(parsed is Dictionary and parsed.get("schema") == 1, "技能MVP配置缺失")
		yone_cache = parsed
	return yone_cache

static func arena(size_id: String) -> Rect2:
	var a: Dictionary = all().arenas[size_id]
	return Rect2(a.minX, a.minY, a.maxX - a.minX, a.maxY - a.minY)
