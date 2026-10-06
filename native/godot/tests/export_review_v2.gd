extends SceneTree
## 主场景实际渲染；人工清场用于展示恢复面板，不作为战斗难度证据。
const OUT := "res://output/review-v2/"
var game: Control
func _initialize() -> void:
	call_deferred("capture")
func shot(name: String) -> void:
	game.hud.refresh(game.run)
	for actor in game.room.actors: actor.get_node("Visual")._process(1.0/60)
	await process_frame
	await RenderingServer.frame_post_draw
	assert(root.get_texture().get_image().save_png(OUT + name + ".png") == OK)
func capture() -> void:
	root.size = Vector2i(1280,720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.run.progress = FBProgressStore.new()
	game.run.progress.persistent = false
	game.audio.muted = true
	DirAccess.make_dir_recursive_absolute(OUT)
	game.run.start()
	game.run.room_index = 3
	game.run.enter_room({})
	game.room.presentation_paused = true
	game.room.camera.position.x = 800
	game.room.hero.position = Vector2(800,455)
	game.room.hero.previous_position = game.room.hero.position
	for actor in game.room.actors: actor.get_node("Visual").set_process(false)
	for i in 180:
		game.room.hero.hp = 160
		game.run.step({})
		game.effects.advance(1.0/60)
	await shot("crowd")
	game.run.room_index = FBData.room_index("boss")
	game.run.enter_room({})
	for actor in game.room.actors:
		if actor.kind != "hero": actor.hp = 0
	for i in 40: game.run.step({})
	game._command("home")
	await create_timer(0.4).timeout
	await shot("continue-loot")
	game.run.resume()
	assert(game.run.phase == "loot" and game.room.alive_enemies() == 0)
	await create_timer(0.4).timeout
	await shot("restored-loot")
	game.audio.stop()
	game.free()
	print("REVIEW_V2_RENDER_PASS")
	quit()
