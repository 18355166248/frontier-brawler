extends SceneTree
## 保留正式排兵与血量，只移动玩家缩短入场距离；随后由正式 Run.step 推进群战。
const OUT := "res://output/crowd-review-v1/"
var game: Control

func _initialize() -> void:
	call_deferred("capture")

func shot(name: String) -> void:
	for actor in game.room.actors:
		actor.get_node("Visual")._process(1.0 / 60)
	game.hud.refresh(game.run)
	await process_frame
	await RenderingServer.frame_post_draw
	assert(root.get_texture().get_image().save_png(OUT + name + ".png") == OK)

func capture() -> void:
	root.size = Vector2i(1280, 720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game._command("start")
	DirAccess.make_dir_recursive_absolute(OUT)
	await create_timer(0.4).timeout
	for index in [1, 2, 3, FBData.room_index("boss")]:
		game.run.room_index = index
		game.run.enter_room({})
		game.room.presentation_paused = true
		game.room.camera.position.x = 880
		game.room.hero.position = Vector2(620, 455)
		game.room.hero.previous_position = game.room.hero.position
		for actor in game.room.actors:
			actor.get_node("Visual").set_process(false)
		await shot("room-%d" % index)
		if index != 3:
			continue
		for tick in 360:
			var hero: FBActor = game.room.hero
			var target: FBActor
			var distance := INF
			for actor in game.room.actors:
				if actor.kind != "hero" and not actor.is_dead() and actor.position.distance_squared_to(hero.position) < distance:
					target = actor
					distance = actor.position.distance_squared_to(hero.position)
			var input: Dictionary = {}
			if target:
				var offset := target.position - hero.position
				input.move = offset.normalized() if absf(offset.x) > 42 or absf(offset.y) > 12 else Vector2(signf(offset.x), 0) * 0.12
				input.attack = tick % 10 == 0
				input.skill = hero.energy >= 50 and tick % 35 == 0
				input.execute = target.hp / target.max_hp < 0.25
			game.run.step(input)
			game.effects.advance(1.0 / 60)
			if tick % 6 == 0:
				await shot("motion-%03d" % (tick / 6))
			if tick == 120:
				await shot("crowd-combat")
		print("CROWD_RENDER kills=", game.run.combat.kills, " hp=", hero_hp(), " remaining=", game.room.alive_enemies())
	game.free()
	print("CROWD_RENDER_PASS")
	quit()

func hero_hp() -> float:
	return game.room.hero.hp
