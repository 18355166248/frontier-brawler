extends SceneTree
## 正式主场景+正常输入+真实OpenGL渲染。敌人高血量/静止为验证前置条件。
const OUT := "res://output/yone-mvp/"
var game: Control
var records: Array[Dictionary] = []
var target: FBActor
var ticks := 0
var clip_frames := 0
var capture_clip := false

func _initialize() -> void:
	call_deferred("review")

func step(input: Dictionary = {}) -> void:
	# 离线视觉驱动不被用户切回Codex的焦点暂停打断；正式GUI仍保留失焦暂停。
	game.run.paused = false
	game.controls.enabled = true
	if game.hud.last_phase == "paused":
		game.hud.show_phase(game.run)
	for actor in game.room.actors:
		if actor.kind != "hero":
			actor.stun = maxi(actor.stun, 10000) # 仅测试固定AI；仍保留原受击位移和击飞落地。
	game.controls.movement = input.get("move", Vector2.ZERO)
	game.controls.joystick_id = 98
	for key in ["attack", "dash", "jump", "skill", "execute"] + FBYoneSkills.INPUTS:
		if input.get(key, false):
			game.controls.pending[key] = true
	game._physics_process(1.0 / 60)
	for actor in game.room.actors:
		actor.get_node("Visual")._process(1.0 / 60)
	ticks += 1
	await process_frame
	await RenderingServer.frame_post_draw
	if capture_clip and ticks % 6 == 0:
		root.get_texture().get_image().save_png(OUT + "clip/%03d.png" % clip_frames)
		clip_frames += 1

func frames(count: int) -> void:
	for i in count:
		await step()

func approach_target() -> void:
	await wait_ready("", true, true)
	for i in 180:
		var delta: Vector2 = target.position - game.room.hero.position
		if absf(delta.x) <= 55 and absf(delta.y) <= 10:
			return
		await step({"move": delta.normalized()})
	assert(false, "approach did not reach original J depth/reach")

func wait_ready(key := "", vulnerability := false, grounded := false) -> void:
	for i in 800:
		var h: FBActor = game.room.hero
		if h.state.can_interrupt() and h.stun == 0 and game.run.combat.freeze_frames == 0 and (key == "" or h.skills.can_use(key)) and (not vulnerability or target.invulnerability == 0) and (not grounded or target.launch_remaining == 0):
			return
		await step()
	assert(false, "combo readiness timed out")

func to_frame(action: String, frame: int) -> void:
	for i in 100:
		if game.room.hero.state.id == action and game.room.hero.state.frame >= frame:
			return
		await step()
	assert(false, "combo did not reach " + action)

func shot(name: String) -> void:
	await process_frame
	await RenderingServer.frame_post_draw
	assert(root.get_texture().get_image().save_png(OUT + name + ".png") == OK)
	var h: FBActor = game.room.hero
	var s := h.skills
	records.append({"shot": name, "tick": ticks, "action": h.state.id, "frame": h.state.frame,
		"hero": [h.position.x, h.position.y], "target_hp": target.hp if is_instance_valid(target) else 0,
		"target": [target.position.x, target.position.y] if is_instance_valid(target) else [],
		"target_launch_remaining": target.launch_remaining if is_instance_valid(target) else 0,
		"q_stacks": s.q_stacks, "shield": s.shield, "e_active": s.e_active, "e_remaining": s.e_remaining,
		"cooldowns": s.cooldowns.duplicate(), "echo_total": s.echo_total, "echo_count": s.echo_count})
	print("YONE_REVIEW_SHOT ", JSON.stringify(records[-1]))

func reset() -> void:
	game._command("start")
	game.run.room_index = 1
	game.run.enter_room({})
	game.room.hero.position = Vector2(450, 445)
	game.room.hero.previous_position = game.room.hero.position
	game.room.camera.position = Vector2(550, 315)
	game.room.camera.reset_smoothing()
	for actor in game.room.actors:
		if actor.kind != "hero":
			actor.hp = 3000
			actor.max_hp = 3000
			actor.stun = 10000
			actor.position = Vector2(1100, 490)
	target = game.room.actors[1]
	target.position = Vector2(505, 445)
	game.controls.clear()
	await step()

func review() -> void:
	DirAccess.make_dir_recursive_absolute(OUT + "clip")
	root.size = Vector2i(1280, 720)
	root.gui_disable_input = true # 测试输入由step发出；不让外部点按重启改变当前fixture。
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	await process_frame
	await reset()
	await shot("01-ready")
	await step({"yone_q": true})
	await to_frame("windThrust", 6)
	await shot("02-q-one")
	await wait_ready("q", true)
	await step({"yone_q": true})
	await to_frame("windThrust", 6)
	assert(game.room.hero.skills.q_stacks == 2)
	await shot("03-q-armed")
	await wait_ready("q", true)
	capture_clip = true
	await step({"yone_e": true})
	await to_frame("spiritStart", 6)
	await shot("04-spirit-anchor")
	await wait_ready("q", true)
	await step({"yone_q": true})
	await to_frame("windRush", 6)
	await shot("05-q3-launch")
	await wait_ready("r", true)
	await step({"yone_r": true, "move": (target.position - game.room.hero.position).normalized()})
	await to_frame("fateSever", 12)
	await shot("06-r-telegraph")
	await to_frame("fateSever", 18)
	await shot("07-r-gather")
	await wait_ready("w", true)
	var delta: Vector2 = target.position - game.room.hero.position
	var w_hp := target.hp
	await step({"yone_w": true, "move": delta.normalized()})
	await to_frame("guardSweep", 7)
	assert(game.room.hero.skills.shield > 0 and target.hp < w_hp and target.launch_remaining > 0, "W must actually hit while R target remains airborne")
	await shot("08-w-air-shield")
	await approach_target()
	delta = target.position - game.room.hero.position
	var j_hp := target.hp
	await step({"attack": true, "move": delta.normalized()})
	await to_frame("slash", 8)
	assert(target.hp < j_hp, "ground J followup must actually damage after R landing")
	await shot("09-j-ground-followup")
	await wait_ready("e")
	var before := target.hp
	await step({"yone_e": true})
	assert(not game.room.hero.skills.e_active and target.hp < before and game.room.hero.skills.echo_count > 0)
	await shot("10-return-echo")
	await frames(18)
	capture_clip = false
	# 第二套短连段：J→Q→J→W→旧K；每次实际输入在原取消点或判定保护结束后。
	await reset()
	var combo_hp := target.hp
	await step({"attack": true})
	await to_frame("slash", 8)
	assert(target.hp < combo_hp)
	await wait_ready("q", true)
	await step({"yone_q": true})
	await to_frame("windThrust", 6)
	await wait_ready("", true)
	await approach_target()
	combo_hp = target.hp
	await step({"attack": true, "move": (target.position - game.room.hero.position).normalized()})
	await to_frame("slash", 8)
	assert(target.hp < combo_hp, "second J in short combo actually hits")
	await wait_ready("w", true)
	await step({"yone_w": true})
	await to_frame("guardSweep", 7)
	await wait_ready()
	await step({"dash": true, "move": Vector2.LEFT})
	await to_frame("dash", 8)
	assert(game.room.hero.skills.shield > 0 and target.hp < 3000)
	await shot("11-short-combo-dash")
	# 击飞→旧跳跃/空中斩→落地W：保留旧跳斩状态机。
	await reset()
	for i in 2:
		await wait_ready("q", true)
		await step({"yone_q": true})
		await to_frame("windThrust", 6)
	await wait_ready("q", true)
	await step({"yone_q": true})
	await to_frame("windRush", 6)
	await wait_ready()
	await step({"jump": true})
	await to_frame("jump", 17)
	var air_hp := target.hp
	await step({"attack": true})
	await to_frame("airSlash", 6)
	await shot("12-jump-slash")
	assert(target.hp < air_hp and target.launch_remaining == 0, "old airSlash only hits target after landing")
	await frames(25)
	await wait_ready("w", true)
	delta = target.position - game.room.hero.position
	await step({"yone_w": true, "move": delta.normalized()})
	await to_frame("guardSweep", 7)
	await shot("13-ground-sweep")
	await reset()
	await step({"move": Vector2.LEFT})
	await frames(12)
	await step({"yone_q": true, "move": Vector2.LEFT})
	await to_frame("windThrust", 6)
	await shot("14-left-thrust")
	await reset()
	await shot("15-restarted")
	var output := FileAccess.open(OUT + "render-review.json", FileAccess.WRITE)
	output.store_string(JSON.stringify({"environment": "macOS Apple M2 / Godot4.7.2 OpenGL / 1280x720", "method": "Main scene normal input, high-HP stationary enemies as test preconditions; scripted rendering is not manual keyboard or performance coverage", "samples": records, "clip_frames": clip_frames}, "\t"))
	output.close()
	game.audio.stop()
	game.queue_free()
	await process_frame
	await create_timer(0.3).timeout
	print("YONE_MVP_REVIEW_PASS shots=", records.size(), " clip_frames=", clip_frames)
	quit()
