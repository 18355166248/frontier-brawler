extends SceneTree
## 在真实 Viewport 派发鼠标/键盘事件，检查 GUI 命中与 InputMap；不声称操作了 macOS 系统键盘。
var game: Control
var checks := 0

func _initialize() -> void:
	call_deferred("validate")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok, message)

func click_button(button: Button) -> void:
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.position = button.get_global_rect().get_center()
	press.global_position = press.position
	press.pressed = true
	root.push_input(press, true)
	var release := press.duplicate()
	release.pressed = false
	root.push_input(release, true)
	await process_frame

func action_key(code: int, pressed: bool) -> void:
	var event := InputEventKey.new()
	event.physical_keycode = code
	event.keycode = code
	event.pressed = pressed
	Input.parse_input_event(event)

func validate() -> void:
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	await process_frame
	var buttons: Array = game.hud.content.find_children("*", "Button", true, false)
	check(buttons.size() == 1, "home exposes the playable first-level entry")
	await click_button(buttons[0])
	check(game.run.phase == "cleared" and game.controls.enabled, "mouse click on home starts playable level")
	check(not game.hud.overlay.visible and get_root().gui_get_focus_owner() == null, "closing home releases menu focus")
	var at: Vector2 = game.room.hero.position
	action_key(KEY_D, true)
	for i in 12:
		await physics_frame
	action_key(KEY_D, false)
	for i in 6:
		await physics_frame
	check(game.room.hero.position.x > at.x + 15, "physical D through InputMap moves the player")
	check(game.room.hero.locomotion_velocity.is_zero_approx(), "key release stops after short braking")
	action_key(KEY_J, true)
	await physics_frame
	await physics_frame
	action_key(KEY_J, false)
	check(game.room.hero.state.id == "slash", "physical J starts illustrated attack")
	await click_button(game.hud.get_node("Top/Pause"))
	check(game.run.paused and game.hud.overlay.visible, "top pause button opens overlay")
	at = game.room.hero.position
	for i in 6:
		await physics_frame
	check(game.room.hero.position == at, "paused overlay does not advance world")
	buttons = game.hud.content.find_children("*", "Button", true, false)
	await click_button(buttons[0])
	check(not game.run.paused and game.controls.enabled, "continue button restores control")
	await click_button(game.hud.get_node("Top/Mute"))
	check(game.audio.muted and not game.audio._ambience.playing, "mute button stops active ambient audio")
	await click_button(game.hud.get_node("Top/Mute"))
	check(not game.audio.muted and game.audio._ambience.playing, "unmute restores current combat ambience")
	game.run.room_index = FBData.room_index("reward")
	game.run.enter_room({})
	await process_frame
	await process_frame
	buttons = game.hud.content.find_children("*", "Button", true, false)
	check(buttons.size() == 3, "reward presents three actual interactive cards")
	for button in buttons:
		check(Rect2(Vector2.ZERO, Vector2(1280, 720)).encloses(button.get_global_rect()), "reward card stays inside canvas")
	await click_button(buttons[2])
	check(game.run.upgrade == "guardian" and game.run.phase == "cleared", "card click applies selected upgrade and resumes the level")
	check(game.hud.health.size.y <= 8 and game.hud.energy.size.y <= 4, "thin HUD bars retain designed height")
	game.audio.stop()
	game.queue_free()
	await process_frame
	await create_timer(0.3).timeout
	print("LANDSCAPE_UI_PASS checks=", checks)
	quit()
