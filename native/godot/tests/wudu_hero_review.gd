extends SceneTree
## 真实主场景/OpenGL 截图；正式输入/规则推进，测试布置处决低血目标及受击样本。
var game: Control
var records: Array[Dictionary] = []
const OUT := "res://output/wudu-import/"

func _initialize() -> void:
	call_deferred("review")

func step(input: Dictionary = {}) -> void:
	game.controls.movement = input.get("move", Vector2.ZERO)
	game.controls.joystick_id = 98
	for id in ["attack", "dash", "jump", "skill", "execute"]:
		if input.get(id, false):
			game.controls.pending[id] = true
	game._physics_process(1.0 / 60.0)
	# 截图采当前完整逻辑帧；不以脚本无等待的渲染频率冒充实时性能。
	for actor in game.room.actors:
		actor.get_node("Visual")._process(1.0 / 60.0)
	await process_frame
	await RenderingServer.frame_post_draw

func shot(name: String) -> void:
	await process_frame
	await RenderingServer.frame_post_draw
	var hero: FBActor = game.room.hero
	var visual: FBWuduHeroVisual = hero.get_node("Visual")
	var file := OUT + name + ".png"
	assert(root.get_texture().get_image().save_png(file) == OK)
	var screen_point: Vector2 = visual.get_global_transform_with_canvas().origin
	records.append({"shot": name, "action": visual.pack_action, "logic_action": hero.state.id,
		"logic_frame": hero.state.frame, "art_frame": visual.pack_frame, "art_ms": visual.pack_time_ms,
		"facing": hero.facing, "height": hero.visual_height, "trail": visual.trail.visible,
		"dust": visual.dust.visible, "alpha": visual.modulate.a, "pivot_screen": [screen_point.x, screen_point.y]})
	print("WUDU_REVIEW_SHOT ", JSON.stringify(records[-1]))

func reset() -> void:
	game._command("start")
	game.run.paused = false
	game.room.hero.position = Vector2(450, 445)
	game.room.hero.previous_position = game.room.hero.position
	game.room.camera.position = Vector2(520, 315)
	game.room.camera.reset_smoothing()
	game.controls.clear()
	await step()

func advance_to(id: String, frame: int) -> void:
	for i in 65:
		if game.room.hero.state.id == id and game.room.hero.state.frame >= frame:
			return
		await step()
	assert(false, "Review did not reach " + id)

func review() -> void:
	DirAccess.make_dir_recursive_absolute(OUT)
	root.size = Vector2i(1280, 720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	await process_frame
	await reset()
	await shot("01-idle-right")
	for i in 25:
		await step({"move": Vector2.RIGHT})
	await shot("02-move-right")
	for i in 25:
		await step({"move": Vector2.LEFT})
	await shot("03-move-left")
	for i in 12:
		await step()
	await shot("04-idle-left")
	await reset()
	await step({"attack": true})
	await advance_to("slash", 8)
	await shot("05-slash")
	await step({"attack": true})
	await advance_to("slash2", 6)
	await shot("06-slash2")
	await step({"attack": true})
	await advance_to("slash3", 5)
	await shot("07-slash3")
	await reset()
	await step({"dash": true, "move": Vector2.LEFT})
	await advance_to("dash", 8)
	await shot("08-dash-left")
	await reset()
	await step({"jump": true})
	await advance_to("jump", 16)
	await shot("09-jump-apex")
	await step({"attack": true})
	await advance_to("airSlash", 6)
	await shot("10-airSlash")
	await advance_to("airSlash", 16)
	await shot("11-airSlash-land")
	await reset()
	game.room.hero.energy = 100 # 视觉 QA 资源前置条件，不改变正式起始资源。
	await step({"skill": true})
	await advance_to("skill", 14)
	await shot("12-skill")
	await reset()
	var target: FBActor = game.room.spawn("grunt", game.room.hero.position + Vector2(40, 0))
	target.hp = 5 # 处决合法目标测试前置条件。
	await step({"execute": true})
	await advance_to("execute", 5)
	await shot("13-execute")
	await reset()
	target = game.room.spawn("grunt", game.room.hero.position + Vector2(35, 0))
	target.facing = -1
	target.state.change("slash")
	target.state.frame = int(target.state.definition().hitboxes[0].activeFrom)
	game.run.combat.resolve(game.room.actors) # 使用正式碰撞、伤害、受击和定格。
	await advance_to("hit", 5)
	await shot("14-hit")
	game.room.hero.hp = 1 # 死亡美术 QA 前置条件。
	game.room.hero.invulnerability = 0
	game.room.hero.state.change("idle")
	target.state.change("slash")
	target.state.frame = int(target.state.definition().hitboxes[0].activeFrom)
	game.run.combat.resolve(game.room.actors)
	await step()
	for i in 35:
		await step()
	await shot("15-death-body")
	for i in 6:
		await step()
	await shot("16-death-fade")
	for i in 20:
		await step()
	await shot("17-death-finished")
	await reset()
	await shot("18-restarted")
	var file := FileAccess.open(OUT + "render-review.json", FileAccess.WRITE)
	file.store_string(JSON.stringify({"environment": "macOS Apple M2, Godot4.7.2 OpenGL Compatibility,1280x720",
		"method": "Main scene real renderer, scripted normal input; execute/hit/death fixtures described in test source; not a claim of manual keyboard coverage", "samples": records}, "\t"))
	game.audio.stop()
	game.queue_free()
	await process_frame
	await create_timer(0.3).timeout
	print("WUDU_HERO_REVIEW_PASS shots=", records.size())
	quit()
