extends SceneTree
## 实际主场景图形审阅；观察 Boss 时设置二阶段并隔离生命，用于招式可读性而非难度验收。
const OUT := "res://output/mechanism-review/"
var game: Control
func _initialize() -> void:
	call_deferred("capture")
func shot(name: String) -> void:
	if game.run.phase in ["home", "reward"]:
		await create_timer(0.3).timeout
	game.hud.refresh(game.run)
	for actor in game.room.actors: actor.get_node("Visual")._process(1.0/60)
	await process_frame
	await RenderingServer.frame_post_draw
	assert(root.get_texture().get_image().save_png(OUT + name + ".png") == OK)
func arrange(index: int) -> void:
	game.run.room_index = index
	game.run.enter_room({})
	game.room.presentation_paused = true
	game.room.camera.position.x = 760
	game.room.hero.position = Vector2(600,455)
	game.room.hero.previous_position = game.room.hero.position
	for actor in game.room.actors: actor.get_node("Visual").set_process(false)
func capture() -> void:
	root.size = Vector2i(1280,720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.run.progress = FBProgressStore.new()
	game.run.progress.persistent = false
	game.audio.muted = true
	game.run.start()
	DirAccess.make_dir_recursive_absolute(OUT)
	await create_timer(0.4).timeout
	arrange(3)
	await shot("crowd-entry")
	for i in 150:
		game.run.step({"attack":i%10==0,"move":Vector2(0.15,0)})
		game.effects.advance(1.0/60)
	await shot("crowd-combat")
	arrange(FBData.room_index("boss"))
	var boss: FBActor = game.room.actors[1]
	boss.boss_phase = 2
	boss.hp = 130
	boss.position = Vector2(685,455)
	boss.previous_position = boss.position
	var captured := {}
	for i in 1200:
		# 观察窗口保持玩家存活，未将该短片当作正常战斗或平衡样本。
		game.room.hero.hp = 160
		game.run.step({})
		game.effects.advance(1.0/60)
		if boss.state.id in ["bossNova","bossCharge","bossRush"] and boss.state.frame >= (2 if boss.state.id == "bossRush" else 12) and not captured.has(boss.state.id):
			await shot(boss.state.id)
			captured[boss.state.id] = true
		if captured.size() == 3: break
	assert(captured.size() == 3)
	boss.hp = 0
	await shot("clear-support")
	game.run.progress.data.unlocked = FBProgressStore.RELICS.keys()
	game.run.progress.data.equipped = "wind-sabers"
	game.run.progress.data.completions = 3
	game.run.progress.data.best_frames = 6000
	game.run.completions = 3
	game.run.start()
	game._command("home")
	await shot("progress-home")
	game.run.start()
	game.run.room_index = 1
	game.run.enter_room({})
	for enemy in game.room.actors:
		if enemy.kind != "hero": enemy.hp = 0
	for i in 40: game.run.step({})
	assert(game.run.phase == "reward")
	await shot("early-growth")
	game.free()
	print("MECHANISM_RENDER_PASS states=",captured.keys())
	quit()
