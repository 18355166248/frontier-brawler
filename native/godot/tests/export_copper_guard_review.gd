extends SceneTree
## Actual renderer evidence; requires the macOS display driver, not headless dummy.
var game: Control
const OUT := "res://output/copper-guard-v2/engine/"

func _initialize() -> void:
	call_deferred("capture")

func capture() -> void:
	root.size = Vector2i(1280, 720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	game.set_physics_process(false)
	game.audio.muted = true
	game.run.start()
	game.run.room_index = 4
	game.run.enter_room({})
	# Physics is disabled above; leave the normal HUD visible for gameplay framing.
	game.run.paused = false
	game.room.hero.position = Vector2(500, 450)
	game.room.hero.previous_position = game.room.hero.position
	var boss: FBActor = game.room.actors[1]
	boss.position = Vector2(810, 450)
	boss.previous_position = boss.position
	boss.facing = -1
	for a in game.room.actors:
		a.get_node("Visual").set_process(false)
	await create_timer(0.3).timeout # Finish the existing home-overlay presentation tween.
	DirAccess.make_dir_recursive_absolute(OUT)
	for shot in [["idle", 0], ["bossSlam", 38], ["bossSlam", 44], ["bossCharge", 20], ["bossRush", 3], ["bossNova", 24], ["bossNova", 30], ["bossSummon", 22], ["hit", 3], ["death", 40]]:
		boss.hp = 0 if shot[0] == "death" else boss.max_hp
		boss.dead_frames = shot[1] if shot[0] == "death" else 0
		boss.state.change("hit" if shot[0] == "death" else shot[0])
		boss.state.frame = shot[1] if shot[0] != "death" else 0
		boss.visual_tick += 1
		boss.get_node("Visual")._process(1.0/60)
		game.room.hero.get_node("Visual")._process(1.0/60)
		game.hud.refresh(game.run)
		await process_frame
		await RenderingServer.frame_post_draw
		var image := root.get_texture().get_image()
		assert(not image.is_empty(), "actual viewport image must exist")
		var file := OUT + str(shot[0]) + "-" + str(shot[1]) + ".png"
		assert(image.save_png(file) == OK)
		print("COPPER_GUARD_RENDERED ", file)
	# Independent full right-facing pose view; actual same Sprite2D renderer.
	boss.hp = boss.max_hp
	boss.dead_frames = 0
	boss.facing = 1
	boss.state.change("idle")
	boss.visual_tick += 1
	boss.get_node("Visual")._process(1.0/60)
	await process_frame
	await RenderingServer.frame_post_draw
	assert(root.get_texture().get_image().save_png(OUT + "idle-right.png") == OK)
	print("COPPER_GUARD_RENDER_PASS")
	game.free()
	quit()
