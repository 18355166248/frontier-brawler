class_name FBInput
extends Control

signal pause_requested
var enabled := false
var movement := Vector2.ZERO
var pending: Dictionary = {}
var fingers: Dictionary = {}
var joystick_id := -999
var joystick := Vector2(105, 114)
var stick := Vector2.ZERO
const BUTTONS := {"attack": Vector2(428, 108), "dash": Vector2(330, 153), "jump": Vector2(240, 115), "skill": Vector2(350, 57), "execute": Vector2(448, 31)}
const TITLES := {"attack": "攻击 J", "dash": "闪避 K", "jump": "跳跃 L", "skill": "技能 U", "execute": "处决 I"}
var unavailable: Dictionary = {}

func clear() -> void:
	for action in ["move_left", "move_right", "move_up", "move_down", "attack", "dash", "jump", "skill", "execute"]:
		Input.action_release(action)
	pending.clear()
	fingers.clear()
	joystick_id = -999
	stick = Vector2.ZERO
	movement = Vector2.ZERO
	queue_redraw()

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") and not event.is_echo():
		pause_requested.emit()
		return
	if not enabled:
		return
	for action in BUTTONS:
		if event.is_action_pressed(action) and not event.is_echo():
			pending[action] = true
	if event is InputEventScreenTouch:
		if event.pressed and not event.canceled:
			press(event.index, get_global_transform_with_canvas().affine_inverse() * event.position)
		else:
			release(event.index)
	elif event is InputEventScreenDrag:
		drag(event.index, get_global_transform_with_canvas().affine_inverse() * event.position)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			press(-1, get_local_mouse_position())
		else:
			release(-1)
	elif event is InputEventMouseMotion and fingers.has(-1):
		drag(-1, get_local_mouse_position())

func press(id: int, point: Vector2) -> void:
	if point.y < 0 or point.y > size.y:
		return
	if point.distance_to(joystick) < 82 and joystick_id == -999:
		joystick_id = id
		fingers[id] = "move"
		drag(id, point)
		return
	for action in BUTTONS:
		if point.distance_to(BUTTONS[action]) <= (43 if action == "attack" else 36):
			fingers[id] = action
			pending[action] = true
			queue_redraw()
			return

func drag(id: int, point: Vector2) -> void:
	if id == joystick_id:
		stick = (point - joystick).limit_length(48)
		movement = stick / 48
		queue_redraw()

func release(id: int) -> void:
	fingers.erase(id)
	if id == joystick_id:
		joystick_id = -999
		movement = Vector2.ZERO
		stick = Vector2.ZERO
	queue_redraw()

func sample() -> Dictionary:
	if not enabled:
		return {}
	var keyboard := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var result := pending.duplicate()
	pending.clear()
	result.move = movement if joystick_id != -999 else keyboard.limit_length(1)
	return result

func _draw() -> void:
	var font := get_theme_font("font")
	draw_rect(Rect2(Vector2.ZERO, size), Color("0c181d"))
	draw_line(Vector2(24, 0), Vector2(size.x - 24, 0), Color("3e514e"), 1)
	draw_circle(joystick, 67, Color("162b30"))
	draw_arc(joystick, 67, 0, TAU, 48, Color("46645e"), 1.5)
	draw_circle(joystick + stick, 28, Color("496e65"))
	draw_circle(joystick + stick, 21, Color("739b83"))
	for action in BUTTONS:
		var point: Vector2 = BUTTONS[action]
		var radius := 43.0 if action == "attack" else 33.0
		var active: bool = action in fingers.values()
		var color := Color("87c5a3") if active else Color("2a4746")
		if unavailable.get(action, false):
			color = Color("18282d")
		draw_circle(point, radius, color)
		draw_arc(point, radius, 0, TAU, 40, Color("759383"), 1)
		draw_string(font, point + Vector2(-30, 5), TITLES[action], HORIZONTAL_ALIGNMENT_CENTER, 60, 13, Color("e2e3c9"))
	draw_string(font, Vector2(40, 207), "WASD 移动 · 连按 J 连招 · 红色区域为敌人预警", HORIZONTAL_ALIGNMENT_CENTER, 460, 13, Color("819e96"))
