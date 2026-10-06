class_name FBMistwardRoom
extends FBRoom
## 横屏首关：环境与镜头只负责表现，伤害和出入口仍由固定步长战斗流程决定。

var scene_time := 0.0
var presentation_paused := false
var camera_shake := Vector2.ZERO
var backdrop: Texture2D
var stone_edge: Texture2D
var look_ahead := 0.0
@export var use_environment_redesign := true
@export_dir var gate_directory := "res://assets/environment/gates"
@export var use_checkpoint_gate := true
@export_dir var checkpoint_directory := "res://assets/environment/checkpoint"
const CHECKPOINT_SCRIPT := preload("res://scripts/checkpoint_gate.gd")
var checkpoint_gate: Node2D
const GATE_CANVAS := Vector2(640, 1024)
const GATE_PIVOT := Vector2(320, 960)
const GATE_SCALE := 0.2
const GATE_DEPTH_AXIS := Vector2(0.82, 0.24)
const GATE_FILES := {"frame": "gate-frame.png", "closed": "gate-closed-panels.png", "mist": "gate-open-mist.png", "boss_accent": "gate-boss-accent.png"}
const ROOM_LOOKS := {
	"v0": {"title": "松影初径", "tint": Color(0.78, 0.88, 0.90), "fog": Color(0.46, 0.70, 0.73), "far_stones": [0.16, 0.66], "near_stones": [0.32, 0.77]},
	"v1": {"title": "守灯古道", "tint": Color(0.76, 0.87, 0.88), "fog": Color(0.42, 0.66, 0.68), "far_stones": [0.28, 0.72], "near_stones": [0.15, 0.54]},
	"v2": {"title": "风过石坪", "tint": Color(0.74, 0.85, 0.91), "fog": Color(0.49, 0.65, 0.78), "far_stones": [0.18, 0.62, 0.85], "near_stones": [0.32, 0.77]},
	"vm": {"title": "白灯幽径", "tint": Color(0.82, 0.86, 0.94), "fog": Color(0.60, 0.62, 0.82), "far_stones": [0.18, 0.62], "near_stones": [0.32, 0.77]},
	"vr": {"title": "灯下小憩", "tint": Color(0.86, 0.89, 0.85), "fog": Color(0.66, 0.71, 0.61), "far_stones": [0.26], "near_stones": [0.50]},
	"v3": {"title": "铜面山门", "tint": Color(0.71, 0.81, 0.88), "fog": Color(0.39, 0.54, 0.66), "far_stones": [0.10, 0.63], "near_stones": [0.28, 0.80]}
}
var has_east_exit := true
var exit_leads_to_boss := false
var next_room_title := ""
var gate_layers: Dictionary = {}
var gate_font: SystemFont

func redesigned() -> bool:
	return use_environment_redesign and "--classic-environment" not in OS.get_cmdline_user_args()

func checkpoint_enabled() -> bool:
	return redesigned() and use_checkpoint_gate and "--previous-gate" not in OS.get_cmdline_user_args() and checkpoint_gate != null and checkpoint_gate.assets_ready

func room_look() -> Dictionary:
	return ROOM_LOOKS.get(room_id, ROOM_LOOKS.v0)

func presentation_title() -> String:
	return str(room_look().title) if redesigned() else "雾隐古道"

func exit_anchor() -> Vector2:
	# 表现锚与原过关起点相合；没有编辑 Run 的坐标谓词。
	return Vector2(arena.end.x - 45, arena.get_center().y)

func exit_cue() -> String:
	if not has_east_exit:
		return ""
	if not door_open:
		return "封印未解 · 肃清敌人"
	return ("山门已开 · " if exit_leads_to_boss else "前路已开 · ") + next_room_title + " →"

func configure_exit(definition: Dictionary) -> void:
	has_east_exit = definition.get("doors", {}).has("east")
	exit_leads_to_boss = false
	next_room_title = "前行"
	if not has_east_exit:
		return
	for next in FBData.all().stage.rooms:
		if next.id == definition.doors.east:
			exit_leads_to_boss = next.kind == "boss"
			next_room_title = str(ROOM_LOOKS.get(next.id, {"title": "前行"}).title)
			break

func load_gate_layers() -> void:
	gate_layers.clear()
	var candidates: Dictionary = {}
	# 新素材必须完整且共享画布；未到位时沿用已存在的旧表现。
	for key in ["frame", "closed", "mist", "boss_accent"]:
		var path := gate_directory.path_join(GATE_FILES[key])
		if not ResourceLoader.exists(path):
			return
		var texture := load(path) as Texture2D
		if texture == null or texture.get_size() != GATE_CANVAS:
			return
		candidates[key] = texture
	gate_layers = candidates

func _ready() -> void:
	if ResourceLoader.exists("res://assets/environment/mistward-backdrop.png"):
		backdrop = load("res://assets/environment/mistward-backdrop.png")
	if ResourceLoader.exists("res://assets/environment/stone-edge.png"):
		var texture := load("res://assets/environment/stone-edge.png") as Texture2D
		if texture and texture.get_size() == Vector2(768, 192):
			stone_edge = texture
	camera.zoom = Vector2.ONE * 1.36
	gate_font = SystemFont.new()
	gate_font.font_names = PackedStringArray(["PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "sans-serif"])
	load_gate_layers()
	checkpoint_gate = CHECKPOINT_SCRIPT.new()
	checkpoint_gate.asset_directory = checkpoint_directory
	add_child(checkpoint_gate)
	move_child(checkpoint_gate, 0) # 和旧门一样处于角色绘制后方。

func populate(definition: Dictionary, profile: Dictionary, stress_count := 0) -> void:
	# 房间是单次实例边界，先脱离树再延迟释放，防止重开残留参与新战斗。
	for actor in actors:
		actor_root.remove_child(actor)
		actor.queue_free()
	actors.clear()
	var width := 1540.0 if definition.size == "wide" else 1360.0
	arena = Rect2(40, 390 if definition.kind != "boss" else 365, width, 130 if definition.kind != "boss" else 170)
	room_id = definition.id
	configure_exit(definition)
	door_open = false
	if checkpoint_gate != null:
		checkpoint_gate.position = exit_anchor()
		checkpoint_gate.reset_exit(exit_leads_to_boss)
		checkpoint_gate.visible = checkpoint_enabled() and has_east_exit
	hero = spawn("hero", Vector2(arena.position.x + 115, arena.get_center().y))
	hero.hp = profile.get("hp", 160.0)
	hero.max_hp = profile.get("max_hp", 160.0)
	hero.energy = profile.get("energy", 0.0)
	hero.skills.cooldowns = profile.get("yone_cooldowns", hero.skills.cooldowns).duplicate()
	var count: int = definition.encounter.size() if stress_count == 0 else stress_count - 1
	for i in count:
		var kind: String = definition.encounter[i] if stress_count == 0 else "grunt"
		var x := arena.position.x + arena.size.x * (0.48 + 0.36 * float(i % 7) / 7)
		var y := arena.position.y + 25 + fmod(i * 49.0, maxf(50, arena.size.y - 50))
		# 普通遭遇按三条纵深错位排兵，远程留在后排；扩容时不再重复七列坐标。
		# 压测与 Boss 房沿用原有散开坐标，避免改变压测负载和 Boss 出生点。
		if stress_count == 0 and definition.kind == "normal":
			if kind in ["archer", "mage"]:
				x = arena.position.x + arena.size.x * 0.78
				y = arena.get_center().y
			else:
				x = arena.position.x + arena.size.x * 0.45 + floorf(i / 3.0) * 92 + (i % 3) * 18
				y = arena.get_center().y + ((i % 3) - 1) * 36
		spawn(kind, Vector2(x, y))
	look_ahead = 70
	camera.position = Vector2(470, 290)
	camera.reset_smoothing()
	populated.emit()
	queue_redraw()

func _process(delta: float) -> void:
	if presentation_paused:
		return
	scene_time += delta
	if checkpoint_gate != null:
		checkpoint_gate.visible = checkpoint_enabled() and has_east_exit
		checkpoint_gate.advance(delta, door_open)
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
		var x := cam - 530 - (cam - 470) * 0.04
		var tint: Color = room_look().tint if redesigned() else Color(0.78, 0.88, 0.9)
		draw_texture_rect(backdrop, Rect2(x, -3, 1060, 596), false, tint)
	_draw_ground(cam)
	if redesigned():
		_draw_hero_contact()
		if has_east_exit and not checkpoint_enabled():
			_draw_gate(exit_anchor())
	else:
		_draw_lantern(Vector2(arena.end.x - 115, 369), (arena.end.x - 115) * 0.1)
		_draw_gate_legacy(Vector2(arena.end.x - 25, arena.get_center().y))
	# 低对比雾带与落叶保留运动感，叶片不遮挡角色轮廓和敌人预警。
	var fog_color: Color = room_look().fog if redesigned() else Color(0.46, 0.7, 0.73)
	for i in 3 if redesigned() else 5:
		var y := 335 + i * 48.0
		var x := cam - 570 + sin(scene_time * 0.1 + i) * 110
		draw_set_transform(Vector2(x + 500, y), 0, Vector2(10, 0.22))
		fog_color.a = 0.019 if redesigned() else 0.022
		draw_circle(Vector2.ZERO, 70, fog_color)
		draw_set_transform(Vector2.ZERO)
	for i in 12 if redesigned() else 20:
		var x := cam - 700 + fposmod(i * 121.8 + scene_time * (13 + i % 4), 1400)
		var y := 125 + fposmod(i * 43.6 + scene_time * 9, 420)
		var center := Vector2(x, y + sin(scene_time + i) * 7)
		var tangent := Vector2(cos(scene_time * 2 + i) * 4, 2)
		draw_line(center - tangent, center + tangent, Color(0.8, 0.66, 0.38, 0.36), 1.5, true)

func _draw_ground(cam: float) -> void:
	if not redesigned():
		_draw_ground_legacy(cam)
		return
	# 只改善原石地的明度、接缝密度和层次；可走边界仍是 arena。
	var top := arena.position.y
	var near_edge := arena.end.y + 14.0
	if top < 390:
		# Boss 原有更深的地面必须有落脚底色，不能透出背景云海像悬空平台。
		draw_rect(Rect2(cam - 1100, top, 2200, 390 - top), Color("1e363b"))
	draw_rect(Rect2(cam - 1100, top, 2200, 900 - top), Color(0.08, 0.16, 0.18, 0.43))
	draw_rect(Rect2(cam - 1100, top + 4, 2200, arena.size.y), Color(0.34, 0.45, 0.42, 0.08))
	for row in int(ceil(arena.size.y / 29.0)) + 1:
		var y := top + row * 29.0
		for column in range(-3, 20):
			var x := column * 110 + (52 if row % 2 else 0)
			var tint := 0.035 + fposmod(sin(column * 42.1 + row * 2.1) * 14.5, 0.025)
			draw_rect(Rect2(x + 4, y + 3, 102, 24), Color(0.48, 0.61, 0.57, tint))
			if (column + row * 3) % 3 == 0:
				draw_line(Vector2(x + 7, y + 28), Vector2(x + 99, y + 28), Color(0.025, 0.07, 0.08, 0.17), 1, true)
	# 薄的远边光与近边暗带在世界坐标中固定，Boss 更深的地面也能正确读出。
	draw_line(Vector2(cam - 1100, top + 1), Vector2(cam + 1100, top + 1), Color(0.48, 0.63, 0.57, 0.26), 2, true)
	draw_line(Vector2(cam - 1100, top + 5), Vector2(cam + 1100, top + 5), Color(0.02, 0.08, 0.09, 0.22), 2, true)
	for i in range(-1, 10):
		var x := i * 216.0 + 31
		for blade in 3:
			draw_line(Vector2(x + blade * 3, top + 3), Vector2(x + blade * 5 - 5, top - 6 - blade * 3), Color(0.23, 0.36, 0.30, 0.58), 1.5, true)
	if stone_edge:
		for fraction in room_look().far_stones:
			_draw_stone_edge(Vector2(arena.position.x + arena.size.x * float(fraction), top + 2), 0.78)
	draw_rect(Rect2(cam - 1100, near_edge + 8, 2200, 400), Color(0.02, 0.05, 0.065, 0.60))
	draw_line(Vector2(cam - 1100, near_edge + 7), Vector2(cam + 1100, near_edge + 7), Color(0.16, 0.27, 0.26, 0.32), 2, true)
	if stone_edge:
		for fraction in room_look().near_stones:
			_draw_stone_edge(Vector2(arena.position.x + arena.size.x * float(fraction), arena.end.y + 22), 0.86)

func _draw_stone_edge(at: Vector2, opacity: float) -> void:
	# 低矮真实贴图只在边缘；主体高约18世界单位，无碰撞也不假装大障碍。
	draw_texture_rect(stone_edge, Rect2(at - Vector2(384, 160) * 0.2, Vector2(768, 192) * 0.2), false, Color(1, 1, 1, opacity))

func _draw_hero_contact() -> void:
	if not is_instance_valid(hero) or hero.is_dead():
		return
	var visual := hero.get_node("Visual") as Node2D
	var at := hero.position + visual.position
	var strength := clampf(1.0 - hero.visual_height / 110.0, 0.5, 1.0)
	draw_set_transform(at, 0, Vector2(1.45, 0.22))
	draw_circle(Vector2.ZERO, 16 * strength, Color(0.015, 0.035, 0.045, 0.17 * strength))
	draw_circle(Vector2.ZERO, 10 * strength, Color(0.01, 0.025, 0.035, 0.18 * strength))
	draw_set_transform(Vector2.ZERO)

func _draw_ground_legacy(cam: float) -> void:
	var top := 391.0
	draw_colored_polygon(PackedVector2Array([Vector2(cam - 1100, top), Vector2(cam + 1100, top), Vector2(cam + 1100, 900), Vector2(cam - 1100, 900)]), Color(0.035, 0.075, 0.09, 0.60))
	for row in 8:
		var y := top + row * 27
		for column in range(-3, 20):
			var x := column * 98 + (45 if row % 2 else 0)
			var tint := 0.03 + fposmod(sin(column * 42.1 + row * 2.1) * 14.5, 0.035)
			draw_rect(Rect2(x + 3, y + 2, 92, 23), Color(0.42, 0.57, 0.55, tint))
			draw_line(Vector2(x + 2, y + 26), Vector2(x + 96, y + 26), Color(0.03, 0.05, 0.06, 0.19), 1, true)
	for i in range(-1, 11):
		var x := i * 178.0
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
	if gate_layers.size() != 4:
		_draw_gate_legacy(at)
		return
	# 门平面沿道路纵深收窄：左柱后退、右柱靠前；竖轴保持直立，触发锚不动。
	# 四层共享同一投影，门板、门框、薄雾和红帘不会错位。
	draw_set_transform_matrix(Transform2D(GATE_DEPTH_AXIS, Vector2.DOWN, at))
	var rect := Rect2(-GATE_PIVOT * GATE_SCALE, GATE_CANVAS * GATE_SCALE)
	if not door_open:
		draw_texture_rect(gate_layers.closed, rect, false)
	else:
		var opacity := 0.28 + sin(scene_time * 1.7) * 0.02
		draw_texture_rect(gate_layers.mist, rect, false, Color(1, 1, 1, opacity))
	draw_texture_rect(gate_layers.frame, rect, false)
	if exit_leads_to_boss:
		draw_texture_rect(gate_layers.boss_accent, rect, false)
	draw_set_transform_matrix(Transform2D.IDENTITY)
	# 文案是原生字体，和实体封印/通透入口共同表达状态。
	var cue := "肃清封印" if not door_open else ("铜面山门 →" if exit_leads_to_boss else "前路已开 →")
	draw_string(gate_font, at + Vector2(-57, -190), cue, HORIZONTAL_ALIGNMENT_CENTER, 114, 13, Color("e6ddbb"))

func _draw_gate_legacy(at: Vector2) -> void:
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
