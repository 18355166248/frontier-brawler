extends SceneTree
## 真实 Godot 主场景渲染，审阅站位手动安排；攻击/箭矢/法术经过正式逻辑 tick。
const OUT := "res://output/enemy-roster-v2/"
var game: Control

func _initialize() -> void:
	call_deferred("capture")

func shot(name: String) -> void:
	for actor in game.room.actors:
		actor.get_node("Visual")._process(1.0/60)
	game.hud.refresh(game.run)
	await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	assert(not image.is_empty())
	assert(image.save_png(OUT + name + ".png") == OK)
	print("ENEMY_RENDERED ", name)

func arrange(index: int) -> void:
	game.run.room_index = index
	game.run.enter_room({})
	for actor in game.room.actors.duplicate():
		if actor.kind == "grunt" and actor != game.room.actors[1]:
			game.room.actors.erase(actor)
			actor.free()
	game.room.hero.position = Vector2(480, 455)
	game.room.hero.previous_position = game.room.hero.position
	game.room.hero.hp = 160
	game.room.camera.position.x = 650
	game.room.presentation_paused = true
	for actor in game.room.actors:
		actor.get_node("Visual").set_process(false)
		if actor != game.room.hero:
			actor.position = Vector2(650 if actor.kind == "grunt" else 850, 455)
			actor.previous_position = actor.position
			actor.facing = -1

func capture() -> void:
	root.size = Vector2i(1280, 720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game._command("start")
	DirAccess.make_dir_recursive_absolute(OUT)
	await create_timer(0.4).timeout
	arrange(2)
	await shot("archer-room")
	var archer: FBActor = game.room.actors[2]
	archer.tick({"attack": true, "target": game.room.hero.position})
	for i in 25:
		archer.tick({})
		game.run.threats.step(game.room.actors, game.room.hero, game.run.combat)
	await shot("archer-aim")
	for i in 32:
		archer.tick({})
		game.run.threats.step(game.room.actors, game.room.hero, game.run.combat)
	await shot("archer-arrow")
	arrange(3)
	var mage: FBActor = game.room.actors[2]
	mage.tick({"attack": true, "target": game.room.hero.position})
	for i in 42:
		mage.tick({})
		game.run.threats.step(game.room.actors, game.room.hero, game.run.combat)
	await shot("mage-warning")
	for i in 11:
		mage.tick({})
		game.run.threats.step(game.room.actors, game.room.hero, game.run.combat)
	await shot("mage-burst")
	# 三类同屏仅作轮廓比较，不加入首见法师的正常遭遇。
	var extra: FBActor = game.room.spawn("archer", Vector2(980, 465))
	extra.get_node("Visual").set_process(false)
	game.room.actors[1].position = Vector2(660, 465)
	mage.position = Vector2(810, 465)
	for actor in game.room.actors:
		actor.state.change("idle")
		actor.previous_position = actor.position
		actor.visual_tick += 1
	game.run.threats.clear_all()
	await shot("three-types")
	# 正式 Run.step 驱动的短片：手动站位只缩短空场距离，其后 AI、伤害和定格都走运行时。
	game.room.hero.hp = 160
	game.room.hero.state.change("idle")
	game.room.hero.stun = 0
	game.room.hero.invulnerability = 0
	game.effects.reset()
	game.run.combat.freeze_frames = 0
	game.run.director = FBEnemyDirector.new()
	game.run.paused = false
	for tick in 180:
		game.run.step({"move": Vector2(0, sin(tick * 0.04) * 0.16)})
		game.effects.advance(1.0/60)
		if tick % 3 == 0:
			await shot("motion-%03d" % (tick/3))
	game.free()
	print("ENEMY_ROSTER_RENDER_PASS")
	quit()
