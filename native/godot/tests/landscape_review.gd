extends SceneTree
## 真实主场景渲染审阅：模拟玩家输入，画面不使用姿态图替代，录像与游戏同为 60 Hz。
var game: Control
var samples: Array[float] = []
var observed_actions: Dictionary = {}

func _initialize() -> void:
	call_deferred("review")

func shot(name: String) -> void:
	await process_frame
	await RenderingServer.frame_post_draw
	var result := root.get_texture().get_image().save_png("res://output/mistward-" + name + ".png")
	assert(result == OK, "Cannot write screenshot")

func review() -> void:
	DirAccess.make_dir_recursive_absolute("res://output")
	root.size = Vector2i(1280, 720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await create_timer(0.5).timeout
	await shot("home")
	game._command("start")
	game.run.advance_room()
	# 审阅初始站位只用于缩短空场等待；之后走位、连招、命中和受击全部经过正式游戏输入。
	game.room.hero.position = Vector2(350, 455)
	game.room.hero.previous_position = game.room.hero.position
	game.room.camera.position.x = 500
	game.run.paused = false
	game.controls.enabled = true
	game.set_physics_process(false)
	for tick in 600:
		var movement := Vector2.ZERO
		if tick < 58:
			movement = Vector2.RIGHT
		elif tick >= 90 and tick < 115:
			movement = Vector2.LEFT
		elif tick >= 135 and tick < 170:
			movement = Vector2.RIGHT
		elif tick >= 220 and tick < 250:
			movement = Vector2(0, 1)
		elif tick >= 250 and tick < 280:
			movement = Vector2(0, -1)
		if tick >= 300:
			var target := closest_enemy()
			if target:
				var difference: Vector2 = target.position - game.room.hero.position
				movement = difference.normalized() if difference.length() > 46 else Vector2(signf(difference.x) * 0.12, 0)
		game.controls.movement = movement
		game.controls.joystick_id = 98
		if tick in [175, 195, 212, 315, 330, 348, 370, 390, 410, 430, 450, 470, 490, 510, 530, 550, 570, 590]:
			game.controls.pending.attack = true
		if tick == 280:
			game.controls.pending.jump = true
		if tick == 296:
			game.controls.pending.attack = true
		if tick == 118:
			game.controls.pending.dash = true
		if tick == 560:
			game.controls.pending.skill = true
		var start := Time.get_ticks_usec()
		game._physics_process(1.0 / 60.0)
		observed_actions[game.room.hero.state.id] = true
		await process_frame
		await RenderingServer.frame_post_draw
		if tick > 10:
			samples.append((Time.get_ticks_usec() - start) / 1000.0)
		if tick in [40, 185, 303, 440]:
			await shot("action-%d" % tick)
	print("REVIEW_ACTIONS ", observed_actions.keys())
	for required in ["move", "idle", "dash", "jump", "airSlash", "slash", "slash2", "slash3", "hit"]:
		assert(observed_actions.has(required), "Actual review did not exercise " + required)
	game.toggle_pause()
	await shot("paused")
	game.toggle_pause()
	game.run.room_index = 3
	game.run.enter_room({})
	await create_timer(0.3).timeout
	await shot("reward")
	game.run.choose_upgrade("guardian")
	game.run.advance_room()
	game.room.hero.position = Vector2(500, 445)
	game.room.hero.previous_position = game.room.hero.position
	game.room.camera.position.x = 670
	for actor in game.room.actors:
		if actor.kind == "boss":
			actor.position = Vector2(650, 445)
			actor.previous_position = actor.position
	game.controls.clear()
	for tick in 180:
		game._physics_process(1.0 / 60)
		await process_frame
		await RenderingServer.frame_post_draw
		if tick == 53 or tick == 120:
			await shot("boss-%d" % tick)
	# 下述阶段是界面状态截图，完整通关证明由 validate.gd 的不改血量战斗机器人提供。
	game.run.set_phase("loot")
	await create_timer(0.3).timeout
	await shot("loot")
	game.run.claim_loot("wind-sabers")
	await create_timer(0.3).timeout
	await shot("complete")
	samples.sort()
	var total := 0.0
	for sample in samples:
		total += sample
	var result := {"environment": "macOS Apple M2 GL Compatibility, real render at 1280x720; not mobile", "samples": samples.size(), "mean_frame_ms": total / samples.size(), "p95_frame_ms": samples[int(samples.size() * 0.95)], "scope": "first combat room, 3 actors, UI and effects included"}
	var record_name := "movie-render-timing" if "--capture-movie" in OS.get_cmdline_user_args() else "mistward-performance"
	var file := FileAccess.open("res://output/" + record_name + ".json", FileAccess.WRITE)
	file.store_string(JSON.stringify(result, "\t"))
	print("LANDSCAPE_REVIEW_PASS ", JSON.stringify(result))
	game.audio.stop()
	game.queue_free()
	await process_frame
	await create_timer(0.3).timeout
	quit()

func closest_enemy() -> FBActor:
	var target: FBActor
	var best := INF
	for actor in game.room.actors:
		if actor.kind == "hero" or actor.is_dead():
			continue
		var distance: float = actor.position.distance_squared_to(game.room.hero.position)
		if distance < best:
			best = distance
			target = actor
	return target
