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
var buttons: Dictionary = {}
var touch_visible := OS.has_feature("mobile")
var safe_insets := Vector4.ZERO
const TITLES := {"attack": "攻击 J", "dash": "闪避 K", "jump": "跳跃 L", "skill": "技能 U", "execute": "处决 I"}
var unavailable: Dictionary = {}

func _ready() -> void:
	layout_controls()
	resized.connect(layout_controls)

func layout_controls() -> void:
	joystick = Vector2(114 + safe_insets.x, size.y - 108 - safe_insets.w)
	var right := size.x - safe_insets.z
	var bottom := size.y - safe_insets.w
	buttons = {"attack": Vector2(right - 105, bottom - 120), "dash": Vector2(right - 222, bottom - 82), "jump": Vector2(right - 318, bottom - 95), "skill": Vector2(right - 202, bottom - 192), "execute": Vector2(right - 93, bottom - 231)}
	queue_redraw()

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
	for action in buttons:
		if event.is_action_pressed(action) and not event.is_echo():
			pending[action] = true
	if event is InputEventScreenTouch:
		touch_visible = true
		if event.pressed and not event.canceled:
			press(event.index, get_global_transform_with_canvas().affine_inverse() * event.position)
		else:
			release(event.index)
	elif event is InputEventScreenDrag:
		drag(event.index, get_global_transform_with_canvas().affine_inverse() * event.position)
	elif touch_visible and event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
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
	for action in buttons:
		if point.distance_to(buttons[action]) <= (43 if action == "attack" else 36):
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
	if not touch_visible or not enabled:
		return
	var font := get_theme_font("font")
	draw_circle(joystick, 67, Color(0.04, 0.09, 0.11, 0.55))
	draw_arc(joystick, 67, 0, TAU, 48, Color("46645e"), 1.5)
	draw_circle(joystick + stick, 28, Color(0.30, 0.44, 0.41, 0.7))
	draw_circle(joystick + stick, 21, Color("739b83"))
	for action in buttons:
		var point: Vector2 = buttons[action]
		var radius := 43.0 if action == "attack" else 33.0
		var active: bool = action in fingers.values()
		var color := Color("87c5a3") if active else Color(0.10, 0.20, 0.22, 0.68)
		if unavailable.get(action, false):
			color = Color("18282d")
		draw_circle(point, radius, color)
		draw_arc(point, radius, 0, TAU, 40, Color("759383"), 1)
		draw_string(font, point + Vector2(-30, 5), TITLES[action], HORIZONTAL_ALIGNMENT_CENTER, 60, 13, Color("e2e3c9"))
