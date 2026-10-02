class_name FBMistwardRoom
extends FBRoom
## 横屏关卡草稿：独立保存视觉方案，主入口在 HUD/相机集成完成前仍使用 room.gd。

var scene_time := 0.0
var presentation_paused := false
var camera_shake := Vector2.ZERO
var backdrop: Texture2D
var look_ahead := 0.0

func _ready() -> void:
	if ResourceLoader.exists("res://assets/environment/mistward-backdrop.png"):
		backdrop = load("res://assets/environment/mistward-backdrop.png")
	camera.zoom = Vector2.ONE * 1.36

func populate(definition: Dictionary, profile: Dictionary, stress_count := 0) -> void:
	# 房间是单次实例边界，先脱离树再延迟释放，防止重开残留参与新战斗。
	for actor in actors:
		actor_root.remove_child(actor)
		actor.queue_free()
	actors.clear()
	var width := 1540.0 if definition.size == "wide" else 1360.0
	arena = Rect2(40, 390 if definition.kind != "boss" else 365, width, 130 if definition.kind != "boss" else 170)
	room_id = definition.id
	door_open = false
	hero = spawn("hero", Vector2(arena.position.x + 115, arena.get_center().y))
	hero.hp = profile.get("hp", 160.0)
	hero.max_hp = profile.get("max_hp", 160.0)
	hero.energy = profile.get("energy", 0.0)
	var count: int = definition.encounter.size() if stress_count == 0 else stress_count - 1
	for i in count:
		var kind: String = definition.encounter[i] if stress_count == 0 else "grunt"
		var x := arena.position.x + arena.size.x * (0.48 + 0.36 * float(i % 7) / 7)
		var y := arena.position.y + 25 + fmod(i * 49.0, maxf(50, arena.size.y - 50))
		spawn(kind, Vector2(x, y))
	look_ahead = 70
	camera.position = Vector2(470, 290)
	camera.reset_smoothing()
	populated.emit()
	queue_redraw()

func _process(delta: float) -> void:
	if not presentation_paused:
		scene_time += delta
	if is_instance_valid(hero):
		# 镜头看向行进方向，限制在关卡边缘；焦点切换不直接拉动角色或战斗坐标。
		look_ahead = lerpf(look_ahead, hero.facing * 62.0, 1 - exp(-delta * 3.5))
		var half_width := get_viewport_rect().size.x / camera.zoom.x * 0.5
		var desired := clampf(hero.position.x + look_ahead, half_width - 10, arena.end.x - half_width + 40)
		camera.position.x = lerpf(camera.position.x, desired, 1 - exp(-delta * 4.5))
	camera.offset = camera_shake
	queue_redraw()

func _draw() -> void:
	var cam := camera.position.x if is_instance_valid(camera) else 470.0
	draw_rect(Rect2(cam - 1100, -600, 2200, 1600), Color("132c38"))
	if backdrop:
		# 背景仅缓慢视差移动，地面和可交互对象仍保持世界坐标，避免脚滑。
		var x := cam - 690 - (cam - 470) * 0.13
		draw_texture_rect(backdrop, Rect2(x, -56, 1380, 790), false, Color(0.78, 0.88, 0.9))
	_draw_ground(cam)
	for x in [70.0, 465.0, 1060.0, arena.end.x - 55]:
		_draw_lantern(Vector2(x, 369), x * 0.1)
	_draw_gate(Vector2(arena.end.x - 25, arena.get_center().y))
	# 低对比雾带与落叶保留运动感，叶片不遮挡角色轮廓和敌人预警。
	for i in 5:
		var y := 335 + i * 48.0
		var x := cam - 570 + sin(scene_time * 0.1 + i) * 110
		draw_set_transform(Vector2(x + 500, y), 0, Vector2(10, 0.22))
		draw_circle(Vector2.ZERO, 70, Color(0.46, 0.7, 0.73, 0.022))
		draw_set_transform(Vector2.ZERO)
	for i in 20:
		var x := cam - 700 + fposmod(i * 121.8 + scene_time * (13 + i % 4), 1400)
		var y := 125 + fposmod(i * 43.6 + scene_time * 9, 420)
		var center := Vector2(x, y + sin(scene_time + i) * 7)
		var tangent := Vector2(cos(scene_time * 2 + i) * 4, 2)
		draw_line(center - tangent, center + tangent, Color(0.8, 0.66, 0.38, 0.36), 1.5, true)

func _draw_ground(cam: float) -> void:
	var top := 391.0
	draw_colored_polygon(PackedVector2Array([Vector2(cam - 1100, top), Vector2(cam + 1100, top), Vector2(cam + 1100, 900), Vector2(cam - 1100, 900)]), Color(0.035, 0.075, 0.09, 0.60))
	for row in 8:
		var y := top + row * 27
		for column in range(-3, 20):
			var x := column * 98 + (45 if row % 2 else 0)
			var tint := 0.03 + fposmod(sin(column * 42.1 + row * 2.1) * 14.5, 0.035)
			draw_rect(Rect2(x + 3, y + 2, 92, 23), Color(0.42, 0.57, 0.55, tint))
			draw_line(Vector2(x + 2, y + 26), Vector2(x + 96, y + 26), Color(0.03, 0.05, 0.06, 0.19), 1, true)
	for i in range(-3, 25):
		var x := i * 75.0
		var y := 393 + sin(i * 3.2) * 7
		for blade in 5:
			draw_line(Vector2(x + blade * 3, y + 6), Vector2(x + blade * 5 - 6, y - 5 - blade * 2), Color(0.17, 0.31, 0.28, 0.8), 1.5, true)
	# 前景暗石边缘形成取景层，不属于碰撞障碍。
	draw_rect(Rect2(cam - 1100, 566, 2200, 400), Color(0.02, 0.05, 0.065, 0.68))
	for i in range(-2, 20):
		var x := i * 118.0
		draw_colored_polygon(PackedVector2Array([Vector2(x, 589), Vector2(x + 13, 559), Vector2(x + 80, 558), Vector2(x + 110, 588)]), Color("101e23"))
		draw_line(Vector2(x + 14, 558), Vector2(x + 81, 558), Color(0.23, 0.36, 0.32, 0.6), 2, true)

func _draw_lantern(at: Vector2, phase: float) -> void:
	draw_rect(Rect2(at - Vector2(4, 73), Vector2(8, 94)), Color("263634"))
	draw_line(at + Vector2(-20, -72), at + Vector2(18, -78), Color("48544a"), 4, true)
	var center := at + Vector2(13 + sin(scene_time * 1.2 + phase) * 1.5, -48)
	for i in range(5, 0, -1):
		draw_circle(center, i * 10, Color(1, 0.64, 0.23, 0.012))
	draw_rect(Rect2(center - Vector2(7, 12), Vector2(14, 25)), Color("b07136"))
	draw_rect(Rect2(center - Vector2(4, 10), Vector2(8, 21)), Color("edc279"))
	draw_line(center + Vector2(-9, -13), center + Vector2(9, -13), Color("3c3027"), 3, true)
	draw_line(center + Vector2(-9, 14), center + Vector2(9, 14), Color("3c3027"), 3, true)
	draw_line(center + Vector2(0, -12), center + Vector2(0, 12), Color("b98342"), 1, true)

func _draw_gate(at: Vector2) -> void:
	var glow := Color("b9cfaa") if door_open else Color("655a4b")
	for side in [-1, 1]:
		var x: float = at.x + float(side) * 31.0
		draw_rect(Rect2(x - 5, at.y - 165, 10, 168), Color("453f32"))
		draw_rect(Rect2(x - 3, at.y - 158, 3, 152), Color("847455"))
	draw_line(at + Vector2(-49, -170), at + Vector2(49, -170), Color("393d31"), 12, true)
	draw_line(at + Vector2(-48, -178), at + Vector2(48, -178), Color("8c7f5e"), 3, true)
	if door_open:
		var opacity := 0.11 + sin(scene_time * 2) * 0.025
		draw_rect(Rect2(at - Vector2(26, 158), Vector2(52, 158)), Color(0.58, 0.84, 0.65, opacity))
		draw_arc(at + Vector2(0, -45), 17, 0, TAU, 32, glow, 1.5, true)
		draw_polyline(PackedVector2Array([at + Vector2(-5, -52), at + Vector2(4, -45), at + Vector2(-5, -38)]), glow, 2, true)
