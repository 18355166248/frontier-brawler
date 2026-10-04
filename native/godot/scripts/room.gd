class_name FBRoom
extends Node2D

signal populated

const ACTOR := preload("res://scenes/actor.tscn")
var actors: Array[FBActor] = []
var hero: FBActor
var arena := Rect2(40, 300, 880, 200)
var door_open := false
var room_id := "v0"
@onready var actor_root: Node2D = $Actors
@onready var camera: Camera2D = $Camera

func populate(definition: Dictionary, profile: Dictionary, stress_count := 0) -> void:
	# 先脱离树再延迟释放，重开同一帧不会让旧单位参与新战斗。
	for actor in actors:
		actor_root.remove_child(actor)
		actor.queue_free()
	actors.clear()
	arena = FBData.arena(definition.size)
	room_id = definition.id
	door_open = false
	hero = spawn("hero", Vector2(arena.position.x + 100, arena.get_center().y))
	hero.hp = profile.get("hp", 160.0)
	hero.max_hp = profile.get("max_hp", 160.0)
	hero.energy = profile.get("energy", 0.0)
	hero.skills.cooldowns = profile.get("yone_cooldowns", hero.skills.cooldowns).duplicate()
	var count: int = definition.encounter.size() if stress_count == 0 else stress_count - 1
	for i in count:
		var kind: String = definition.encounter[i] if stress_count == 0 else "grunt"
		var x := arena.position.x + arena.size.x * (0.5 + 0.4 * float(i % 7) / 7)
		var y := arena.position.y + 30 + fmod(i * 63.0, maxf(50, arena.size.y - 60))
		spawn(kind, Vector2(x, y))
	camera.position = Vector2(hero.position.x + 70, 315)
	camera.reset_smoothing()
	queue_redraw()
	populated.emit()

func spawn(kind: String, point: Vector2) -> FBActor:
	var actor: FBActor = ACTOR.instantiate()
	actor.kind = kind
	actor.position = point
	actor.arena_bounds = arena
	actor_root.add_child(actor)
	actors.append(actor)
	return actor

func alive_enemies() -> int:
	var count := 0
	for actor in actors:
		if actor.kind != "hero" and not actor.is_dead():
			count += 1
	return count

func _process(_delta: float) -> void:
	if is_instance_valid(hero):
		camera.position.x = clampf(hero.position.x + 70, 245, 715)
	queue_redraw()

func _draw() -> void:
	# 场景装饰仅负责呈现；边界和出生点由关卡数据驱动。
	draw_rect(Rect2(-600, -600, 2200, 1300), Color("101d22"))
	for layer in 3:
		var c := Color("1b2b30").lightened(layer * 0.035)
		for i in range(-2, 10):
			var x := i * 155.0 + layer * 37
			var roof := 155.0 + sin(i * 2.3 + layer) * 30 + layer * 18
			draw_rect(Rect2(x, roof, 114, 150), c)
			draw_colored_polygon(PackedVector2Array([Vector2(x - 12, roof), Vector2(x + 56, roof - 54), Vector2(x + 126, roof)]), c)
			if layer == 2:
				draw_rect(Rect2(x + 45, roof + 20, 16, 24), Color("aa8450"))
	draw_rect(Rect2(-100, 265, 1160, 370), Color("33403d"))
	for row in 10:
		var y := 277 + row * 33
		draw_line(Vector2(-100, y), Vector2(1100, y), Color(0.65, 0.67, 0.52, 0.08), 1)
		for col in 15:
			var x := col * 86 + (42 if row % 2 else 0)
			draw_line(Vector2(x, y), Vector2(x + 5, y + 32), Color(0.02, 0.08, 0.09, 0.2), 1)
	draw_rect(arena, Color(0.6, 0.7, 0.57, 0.07))
	for x in [32, 928]:
		draw_rect(Rect2(x - 9, 210, 18, 130), Color("5a6251"))
		draw_circle(Vector2(x, 224), 17, Color(1, 0.64, 0.23, 0.1))
		draw_circle(Vector2(x, 224), 6, Color("ffc078"))
	if door_open:
		var p := Vector2(arena.end.x - 25, arena.get_center().y)
		draw_arc(p, 35, 0, TAU, 32, Color("78d8b4"), 3)
		draw_colored_polygon(PackedVector2Array([p + Vector2(-7, -12), p + Vector2(10, 0), p + Vector2(-7, 12)]), Color("bff3c9"))
