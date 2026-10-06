extends SceneTree
var checks := 0
func _initialize() -> void:
	call_deferred("run_checks")
func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok, message)
func write_json(path: String, value: Variant) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(JSON.stringify(value))
	f.close()
func run_checks() -> void:
	root.size = Vector2i(1280,720)
	var path := "res://output/progress-checks/data.json"
	DirAccess.make_dir_recursive_absolute("res://output/progress-checks")
	for suffix in ["", ".bak", ".tmp"]:
		if FileAccess.file_exists(path + suffix):
			DirAccess.remove_absolute(path + suffix)
	var store := FBProgressStore.new()
	store.path = path
	store.persistent = true
	store.data.completions = 1
	store.data.unlocked = ["scout-coat"]
	store.data.equipped = "scout-coat"
	check(store.save_progress(), "initial atomic save succeeds")
	store.data.completions = 2
	check(store.save_progress(), "second save keeps valid backup")
	write_json(path, "corrupt")
	var recovered := FBProgressStore.new()
	recovered.path = path
	recovered.persistent = true
	recovered.load_progress()
	check(recovered.data.completions == 1 and recovered.data.equipped == "scout-coat", "corrupt main recovers intact backup")
	check(recovered.save_progress(), "recovered save can replace corrupt main")
	write_json(path, {"version":1,"completions":4,"best_frames":1200,"unlocked":["scout-coat"],"equipped":"scout-coat"})
	check(store.decode(path).version == 2 and store.decode(path).checkpoint.is_empty(), "v1 migration adds v2 defaults")
	write_json(path, {"version":99})
	var future := FBProgressStore.new()
	future.path = path
	future.persistent = true
	future.load_progress()
	check(future.future_version and not future.save_progress() and FileAccess.get_file_as_string(path).contains("99"), "future save preserved instead of overwritten")
	var invalid := store.data.duplicate(true)
	invalid.unlocked = ["unknown"]
	write_json(path, invalid)
	check(store.decode(path).is_empty(), "unknown relic rejected")
	invalid = store.data.duplicate(true)
	invalid.completions = "wrong"
	write_json(path, invalid)
	check(store.decode(path).is_empty(), "wrong numeric type rejected")
	var impossible := FBProgressStore.new()
	impossible.persistent = true
	impossible.path = "res://output/nonexistent-progress-directory/data.json"
	check(not impossible.save_progress() and impossible.write_failed, "write failure reported without crashing")
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game.run.start()
	game.run.room_index = 1
	game.run.enter_room({})
	for enemy in game.room.actors:
		if enemy.kind != "hero": enemy.hp = 0
	for i in 40: game.run.step({})
	check(game.run.phase == "reward" and not game.room.door_open, "first battle clear opens growth before exit")
	game.run.choose_upgrade("arcane")
	check(game.run.phase == "cleared" and game.room.door_open, "growth selection unlocks next room")
	check(is_equal_approx(game.room.hero.cooldown_multiplier,0.85), "arcane applies cooldown reduction")
	game.room.hero.tick({"yone_q":true})
	check(game.room.hero.skills.cooldowns.q == 36, "arcane reduces real Q cooldown from 42 to 36")
	game.run.room_index = FBData.room_index("reward")
	game.run.enter_room({})
	check(game.run.phase == "cleared", "old rest room cannot award second growth")
	game.run.choose_upgrade("guardian")
	check(game.run.upgrade == "arcane", "growth cannot be replaced after selection")
	game.run.progress.data.unlocked = FBProgressStore.RELICS.keys()
	for id in FBProgressStore.RELICS:
		game.run.progress.data.equipped = id
		game.run.start()
		var h: FBActor = game.room.hero
		check(h.hp == h.max_hp, "equipped relic starts at full modified health")
		if id == "wind-sabers": check(is_equal_approx(h.damage_multiplier,1.08), "wind relic increases attacks")
		if id == "scout-coat": check(h.max_hp == 176, "coat adds 16 base HP")
		if id == "execution-charm": check(h.heal_bonus == 6, "charm adds execution healing")
	game.run.room_index = 2
	game.run.enter_room({"hp":121,"energy":48})
	game.run.combat.kills = 6
	game.run.elapsed_frames = 600
	game.run.save_checkpoint()
	check(game.run.can_resume(), "valid room-entry checkpoint available")
	game.run.resume()
	check(game.run.room_index == 2 and game.room.hero.hp == 121 and game.room.hero.energy == 48 and game.run.combat.kills == 6 and game.run.elapsed_frames == 600, "resume restores room-entry stats and counters")
	check(game.room.alive_enemies() == 8 and game.run.threats.arrows.is_empty(), "resume rebuilds encounter and clears transient projectiles")
	game.run.progress.data.equipped = "scout-coat"
	game.run.start()
	game.run.room_index = 2
	game.run.enter_room({"hp":176})
	game.run.progress.data.equipped = "wind-sabers"
	game.run.resume()
	check(game.room.hero.hp == 160 and game.room.hero.max_hp == 160, "switching coat before resume clamps checkpoint health")
	game.run.progress.data.checkpoint.hp = -1
	check(not game.run.can_resume(), "bad checkpoint cannot resume")
	game.run.start()
	game.run.room_index = FBData.room_index("boss")
	game.run.enter_room({})
	game.room.actors[1].hp = 0
	game.hud.refresh(game.run)
	check(game.hud.hint.text.contains("护卫 3") and game.hud.remaining.text.contains("3"), "boss dead HUD identifies remaining support")
	game.run.room_index = 1
	game.run.enter_room({})
	check(game.room.actors[4].engagement_delay == 45, "rear melee enters combat with short delay")
	var enemy: FBActor = game.room.actors[1]
	enemy.hp = 0
	enemy.dead_frames = 150
	enemy.visual_tick += 1
	enemy.get_node("Visual")._process(0)
	check(is_equal_approx(enemy.get_node("Visual").modulate.a,0.5), "corpse fades after hold at 150 ticks")
	enemy.dead_frames = 180
	enemy.visual_tick += 1
	enemy.get_node("Visual")._process(0)
	check(enemy.get_node("Visual").modulate.a == 0, "corpse invisible at 180 ticks")
	game._command("home")
	await process_frame
	await process_frame
	for button in game.hud.overlay.find_children("*","Button",true,false):
		check(Rect2(Vector2.ZERO,Vector2(1280,720)).encloses(button.get_global_rect()), "home progression button stays inside viewport")
	game.free()
	await process_frame
	print("PROGRESS_CHECKS_PASS checks=",checks)
	quit()
