class_name FBData
extends RefCounted

static var cache: Dictionary = {}

static func all() -> Dictionary:
	if cache.is_empty():
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/first_stage.json"))
		assert(parsed is Dictionary and parsed.get("schema") == 1, "首关数据缺失或版本错误")
		cache = parsed
	return cache

static func action(id: String, hero: bool) -> Dictionary:
	return all()["player_actions" if hero else "enemy_actions"][id]

static func arena(size_id: String) -> Rect2:
	var a: Dictionary = all().arenas[size_id]
	return Rect2(a.minX, a.minY, a.maxX - a.minX, a.maxY - a.minY)
