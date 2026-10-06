extends SceneTree
## 视觉接入的风险检查：出口真实性、资源降级、原门谓词、HUD可走区域与安全边距。
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

func validate() -> void:
	root.size = Vector2i(1280, 720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	game.set_physics_process(false)
	game.audio.muted = true
	game._command("start")
	var room: FBMistwardRoom = game.room
	check(room.gate_layers.size() == 4, "all aligned gate layers load")
	check(room.stone_edge != null, "stone-edge runtime texture loads")
	for index in FBData.all().stage.rooms.size():
		var definition: Dictionary = FBData.all().stage.rooms[index]
		var boss: bool = definition.kind == "boss"
		game.run.room_index = index
		game.run.enter_room({})
		check(room.has_east_exit == definition.doors.has("east"), "exit follows room topology")
		check(room.exit_leads_to_boss == (definition.kind == "reward"), "Boss accent belongs to reward exit")
		check(room.hero.position == Vector2(155, 450 if boss else 455), "spawn stays grounded")
		check(room.arena == Rect2(40, 365 if boss else 390, 1540 if definition.size == "wide" else 1360, 170 if boss else 130), "combat bounds follow room size")
		check(room.alive_enemies() == definition.encounter.size(), "actual enemies match the configured encounter")
		check(room.exit_anchor() == Vector2(room.arena.end.x - 45, room.arena.get_center().y), "exit anchor follows trigger")
		if boss:
			check(room.exit_cue().is_empty(), "Boss has no onward cue")

	# 缺图是实际资源失败路径，不能留下部分图层或改变关卡状态。
	var directory := room.gate_directory
	room.gate_directory = "res://output/nonexistent-environment-check-pack"
	room.load_gate_layers()
	check(room.gate_layers.is_empty(), "missing pack falls back atomically")
	check(not room.has_east_exit, "resource fallback does not invent Boss exit")
	room.gate_directory = directory
	room.load_gate_layers()
	check(room.gate_layers.size() == 4, "reloading valid pack restores visual layers")

	game.run.room_index = 1
	game.run.enter_room({})
	room.hero.position = Vector2(room.arena.end.x - 40, room.arena.get_center().y)
	room.hero.previous_position = room.hero.position
	game.run.step({})
	check(game.run.room_index == 1 and game.run.phase == "fighting", "visible locked door does not bypass original clear condition")
	game.run.set_phase("cleared") # 出入口边界测试前置；自然清怪证明由渲染驱动另提供。
	room.door_open = true
	room.hero.position.y = room.arena.get_center().y + 49
	game.run.step({})
	check(game.run.room_index == 1, "visual gate does not broaden original 48-unit depth predicate")
	room.hero.position.y = room.arena.get_center().y
	game.run.step({})
	check(game.run.room_index == 2, "original x/depth crossing still advances without new animation wait")

	if room.checkpoint_enabled():
		var gate = room.checkpoint_gate
		check(gate.assets_ready and gate.get_child_count() == 4, "checkpoint loads the coherent frame/barrier/banner family")
		room.door_open = false
		room.presentation_paused = false
		room._process(0.0)
		check(gate.opening_progress == 0 and gate.barrier.visible and gate.cue.text.contains("肃清"), "locked gate has a barrier and a non-color cue")
		room.door_open = true
		room._process(0.1)
		check(gate.opening_progress > 0 and gate.opening_progress < 1 and gate.cue.text.contains("可前行"), "unseal animation starts without introducing a gameplay wait")
		var progress: float = gate.opening_progress
		room.presentation_paused = true
		room._process(1.0)
		check(gate.opening_progress == progress, "pause freezes portcullis animation")
		room.presentation_paused = false
		room._process(0.5)
		check(gate.opening_progress == 1 and not gate.barrier.visible, "unseal completes within its bound and leaves the aperture clear")
		room.door_open = false
		room._process(0.01)
		check(gate.opening_progress == 0 and gate.barrier.visible, "closing interrupts the old presentation immediately")
		game.run.room_index = FBData.room_index("reward")
		game.run.enter_room({})
		check(gate.opening_progress == 0 and gate.pennant.visible, "new reward-room gate resets and signals the Boss approach")
		game.run.room_index = FBData.room_index("boss")
		game.run.enter_room({})
		check(not gate.visible, "Boss room does not invent an east gate")
		game._command("start")
		check(gate.opening_progress == 0 and not gate.pennant.visible, "restart resets animation and Boss marker")
		room.use_checkpoint_gate = false
		room._process(0.0)
		check(not room.checkpoint_enabled() and not gate.visible, "previous gate remains a complete visual rollback")
		room.use_checkpoint_gate = true
		room._process(0.0)
		var missing = FBCheckpointGate.new()
		missing.asset_directory = "res://output/nonexistent-checkpoint-pack"
		room.add_child(missing)
		await process_frame
		check(not missing.assets_ready and missing.get_child_count() == 0, "missing checkpoint pack does not create partial visual layers")
		missing.queue_free()
		await check_broken_shutter("compile-invalid", "shader_type canvas_item;\nuniform float opening = 0.0;\nvoid fragment() { COLOR = NONEXISTENT_REVIEW_SYMBOL; }\n")
		await check_broken_shutter("missing-uniform", "shader_type canvas_item;\nvoid fragment() { COLOR = texture(TEXTURE, UV); }\n")
		await check_broken_shutter("wrong-uniform-type", "shader_type canvas_item;\nuniform bool opening = false;\nvoid fragment() { COLOR = texture(TEXTURE, UV); }\n")

	game._command("start")
	game.hud.announce("连势 · 完美衔接")
	game.hud.refresh(game.run)
	if room.redesigned():
		check(game.hud.hint.text.contains("前路已开") and game.hud.hint.text.contains("→"), "open cue takes priority over ending combat notice and uses text/direction")
		var legal_near_body := Rect2(300, 540, 660, 154)
		for button in game.hud.skill_buttons.values():
			check(not button.get_global_rect().intersects(legal_near_body), "ability HUD frees the legal near-depth fighter silhouette")
		check(not game.hud.hint.get_global_rect().intersects(legal_near_body), "onward hint frees near-depth silhouette")
		game.controls.touch_visible = true
		game.hud.apply_safe_insets(Vector4(40, 24, 48, 28))
		game.hud.refresh(game.run)
		var safe := Rect2(40, 24, 1192, 668)
		for button in game.hud.skill_buttons.values():
			check(safe.encloses(button.get_global_rect()), "ability button stays inside simulated landscape safe area")
		check(safe.encloses(game.hud.get_node("Top/Pause").get_global_rect()), "pause stays inside safe area")
		check(not game.hud.footer.visible, "touch mode hides desktop key footer")
		game.hud.apply_safe_insets(Vector4.ZERO)
		game.controls.touch_visible = false
	else:
		check(game.hud.skill_buttons.q.position.y == 571, "classic flag restores existing HUD layout")

	game.toggle_pause()
	var old_time := room.scene_time
	room._process(0.5)
	check(room.scene_time == old_time, "pause freezes environment mist and gate pulse")
	game.toggle_pause()
	game._command("start")
	check(room.has_east_exit and not room.exit_leads_to_boss and room.door_open, "restart resets exit type and open state")
	game.audio.stop()
	game.queue_free()
	await process_frame
	print("ENVIRONMENT_CHECKS_PASS checks=", checks)
	quit()

func check_broken_shutter(fault: String, shader_code: String) -> void:
	var folder := "res://output/checkpoint-shader-faults/"
	check(DirAccess.make_dir_recursive_absolute(folder) == OK, "create isolated shader fault fixture")
	var path := folder + fault + ".gdshader"
	var file := FileAccess.open(path, FileAccess.WRITE)
	assert(file != null, "write isolated shader fault fixture")
	file.store_string(shader_code)
	file.close()
	var room: FBMistwardRoom = game.room
	var previous: Node2D = room.checkpoint_gate
	var door_open: bool = room.door_open
	var east_exit: bool = room.has_east_exit
	var broken := FBCheckpointGate.new()
	broken.shutter_shader_path = path
	room.checkpoint_gate = broken
	# 仅抑制这一已知故障的预期编译报错，检查前立即恢复；独立探针另保留原始报错。
	var error_messages := Engine.print_error_messages
	if fault == "compile-invalid":
		Engine.print_error_messages = false
	room.add_child(broken)
	Engine.print_error_messages = error_messages
	check(not broken.assets_ready and broken.get_child_count() == 0 and broken.shutter_material == null, fault + " fails before any visual nodes are initialized")
	check(not room.checkpoint_enabled() and room.gate_layers.size() == 4, fault + " keeps the complete previous gate eligible")
	room._process(0.5)
	check(not broken.visible and room.door_open == door_open and room.has_east_exit == east_exit, fault + " fallback advances safely without changing original door rules")
	room.checkpoint_gate = previous
	room._process(0.0)
	broken.queue_free()
	assert(DirAccess.remove_absolute(path) == OK, "remove isolated shader fault fixture")
	await process_frame
