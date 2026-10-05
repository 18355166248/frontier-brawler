extends SceneTree
## Integration checks with the real actor scene and unchanged combat/run clocks.
const ACTOR := preload("res://scenes/actor.tscn")
var checks := 0
var failed := false

func _initialize() -> void:
	call_deferred("run")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		failed = true
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok, message)

func actor(kind: String, modern := true) -> FBActor:
	var a: FBActor = ACTOR.instantiate()
	a.kind = kind
	a.position = Vector2(440, 430)
	a.get_node("Visual").use_copper_guard = modern
	root.add_child(a)
	a.get_node("Visual").set_process(false)
	return a

func sample(a: FBActor, id: String, frame: int) -> void:
	a.state.change(id)
	a.state.frame = frame
	a.visual_tick += 1
	a.get_node("Visual")._process(1.0 / 60.0)

func run() -> void:
	var boss := actor("boss")
	var visual: FBCopperGuardVisual = boss.get_node("Visual")
	check(visual.uses_boss_pack and not visual.uses_pack, "only Boss enables the new Boss pack")
	var positions := 0
	for id in visual.boss_animations:
		var a: Dictionary = visual.boss_animations[id]
		positions += a.frames.size()
		check((visual.boss_sheets[id] as Texture2D).get_size() == Vector2(a.frames.size()*640, 640), id + " actual imported atlas size")
		check(a.loop == (id in ["idle", "move"]), id + " loop type")
	check(positions == 55, "55 play positions including shared neutral holds; not 55 new drawings")
	check(not visual.BOSS_STATES.values().has("sweep"), "reference-only sweep does not invent a combat state")
	for state in visual.BOSS_STATES:
		sample(boss, state, 0)
		check(visual.boss_action == visual.BOSS_STATES[state], state + " maps existing logical state")
		var rule := boss.state.definition()
		var before := JSON.stringify(rule)
		for f in int(rule.frames):
			sample(boss, state, f)
			check(visual.boss_frame >= 0 and visual.boss_frame < visual.boss_animations[visual.boss_action].frames.size(), state + " available source frame")
		check(JSON.stringify(rule) == before, state + " visual sampling leaves rule dictionary unchanged")
	for state in ["bossSlam", "bossNova", "bossRush"]:
		var box: Dictionary = FBData.action(state, false).hitboxes[0]
		sample(boss, state, int(box.activeFrom))
		check(visual.boss_frame == (0 if state == "bossRush" else 3), state + " contact drawing at original activeFrom")
		var frozen := [visual.boss_frame, visual.boss_time_ms, visual.boss_root.position, visual.position]
		for i in 20:
			visual._process(1.0/120)
		check(frozen == [visual.boss_frame, visual.boss_time_ms, visual.boss_root.position, visual.position], state + " hitstop freezes visuals")
		sample(boss, state, int(box.activeTo))
		check(visual.boss_frame == (3 if state == "bossRush" else 4), state + " original activeTo enters recovery")
	sample(boss, "move", 1)
	boss.previous_position = boss.position
	boss.position.x += .2
	boss.visual_tick += 1
	visual._process(1.0/60)
	check(visual.boss_loop_ms < 3, "slow walking advances by real displacement")
	sample(boss, "bossSlam", 44)
	check(visual.boss_time_ms == 500 and visual.boss_frame == 3, "slow walk does not slow subsequent attack")
	sample(boss, "bossSlam", 0)
	check(visual.boss_frame == 0, "same attack restart returns to fresh anticipation")
	for facing in [-1, 1]:
		boss.facing = facing
		visual._process(0)
		check(visual.boss_body.offset == -visual.BOSS_PIVOT and is_equal_approx(visual.boss_root.scale.x, facing*visual.BOSS_SCALE) and not visual.boss_body.flip_h, "flip belongs to parent around foot pivot")
	var hero := actor("hero")
	var grunt := actor("grunt")
	check(hero.get_node("Visual").uses_pack and not hero.get_node("Visual").uses_boss_pack, "hero keeps existing 12-action pack")
	check(not grunt.get_node("Visual").uses_pack and not grunt.get_node("Visual").uses_boss_pack, "grunt keeps original illustrated rendering")
	var legacy := actor("boss", false)
	check(not legacy.get_node("Visual").uses_boss_pack and legacy.get_node("Visual").boss_root == null, "explicit Boss rollback creates no sprite nodes")
	# Native ticks and combat resolution are identical for modern/rollback actors.
	for a in [boss, legacy]:
		a.hp = 280
		a.state.change("idle")
		a.position = Vector2(500, 430)
		a.previous_position = a.position
		a.facing = -1
	var modern_target := actor("hero")
	var old_target := actor("hero")
	for a in [modern_target, old_target]:
		a.position = Vector2(470, 430)
	var combat_a := FBCombat.new()
	var combat_b := FBCombat.new()
	for i in 100:
		var input := {"move": Vector2.LEFT * .4, "attack": i == 0}
		boss.tick(input)
		legacy.tick(input)
		visual._process(1.0/60)
		legacy.get_node("Visual")._process(1.0/60)
		var current: Array[FBActor] = [modern_target, boss]
		var previous: Array[FBActor] = [old_target, legacy]
		combat_a.resolve(current)
		combat_b.resolve(previous)
		check(boss.position == legacy.position and boss.state.id == legacy.state.id and boss.state.frame == legacy.state.frame and modern_target.hp == old_target.hp and combat_a.freeze_frames == combat_b.freeze_frames, "modern/rollback native motion and damage match")
	# Real boss-room clear still enters loot on exactly tick 40, corpse stays visible.
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game.run.start()
	game.run.room_index = 4
	game.run.enter_room({})
	var dead: FBActor = game.room.actors[1]
	dead.get_node("Visual").set_process(false)
	dead.hp = 0
	for i in 39:
		game.run.step({})
		dead.get_node("Visual")._process(1.0/60)
	check(game.run.phase == "fighting", "original pre-clear 39 ticks")
	game.run.step({})
	dead.get_node("Visual")._process(1.0/60)
	check(game.run.phase == "loot" and dead.dead_frames == 40, "loot still begins at original 40 ticks")
	check(dead.get_node("Visual").boss_frame == 3 and dead.get_node("Visual").modulate.a == 1.0, "corpse finishes before loot and does not fade")
	for i in 60:
		game.run.step({})
		dead.get_node("Visual")._process(1.0/60)
	check(dead.dead_frames == 40 and dead.get_node("Visual").boss_frame == 3 and dead.get_node("Visual").modulate.a == 1.0, "loot freezes final corpse instead of advancing gameplay")
	game.run.start()
	game.run.room_index = 4
	game.run.enter_room({})
	var restarted: FBActor = game.room.actors[1]
	check(restarted.hp == 280 and restarted.dead_frames == 0 and restarted.get_node("Visual").boss_action == "idle", "restart creates fresh alive Boss")
	# Manifest failures must fall back before allocating any sprite root.
	var fixture := "res://output/copper-guard-v2/bad-pack"
	DirAccess.make_dir_recursive_absolute(fixture)
	for text in ["{broken", "{}", "{\"canvas_px\":[640,640],\"pivot_px\":[308,560],\"art_scale\":0.38,\"stride_world_px\":60,\"animations\":{}}"]:
		var file := FileAccess.open(fixture + "/animation.json", FileAccess.WRITE)
		file.store_string(text)
		file.close()
		var broken: FBActor = ACTOR.instantiate()
		broken.kind = "boss"
		broken.get_node("Visual").boss_pack_directory = fixture
		root.add_child(broken)
		check(not broken.get_node("Visual").uses_boss_pack and broken.get_node("Visual").boss_root == null, "broken manifest falls back atomically")
		broken.free()
	var missing: FBActor = ACTOR.instantiate()
	missing.kind = "boss"
	missing.get_node("Visual").boss_pack_directory = fixture + "/missing"
	root.add_child(missing)
	check(not missing.get_node("Visual").uses_boss_pack, "missing assets keep original Boss")
	missing.free()
	game.free()
	for a in [boss, legacy, hero, grunt, modern_target, old_target]:
		a.free()
	if failed:
		quit(1)
	else:
		print("COPPER_GUARD_CHECKS_PASS checks=", checks)
		quit()
