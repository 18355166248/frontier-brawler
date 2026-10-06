extends SceneTree
var checks := 0
func _initialize() -> void:
	call_deferred("run_checks")
func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok,message)
func run_checks() -> void:
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game.run.start()
	game.run.room_index = 2
	game.run.enter_room({})
	var valid: Dictionary = game.run.progress.data.checkpoint.duplicate(true)
	for key in valid:
		if key == "phase": continue
		var bad := valid.duplicate(true)
		bad.erase(key)
		game.run.progress.data.checkpoint = bad
		var before: FBActor = game.room.hero
		game.run.resume()
		check(not game.run.can_resume() and game.room.hero == before, "missing " + key + " rejected before replacing scene")
	for key in valid:
		var wrong := valid.duplicate(true)
		wrong[key] = []
		check(FBProgressStore.checkpoint(wrong).is_empty(), "wrong type rejected for " + key)
	for value in [-1, 10001, 0.5, "10", null]:
		var wrong := valid.duplicate(true)
		wrong.cooldowns.q = value
		check(FBProgressStore.checkpoint(wrong).is_empty(), "invalid cooldown rejected")
	var wrong_phase := valid.duplicate(true)
	wrong_phase.phase = "loot"
	check(FBProgressStore.checkpoint(wrong_phase).is_empty(), "ordinary room cannot restore boss reward")
	var old := valid.duplicate(true)
	old.erase("phase")
	check(FBProgressStore.checkpoint(old).phase == "entry", "released v2 checkpoint without phase remains supported")
	var path := "res://output/review-v2-checks/progress.json"
	DirAccess.make_dir_recursive_absolute("res://output/review-v2-checks")
	var store := FBProgressStore.new()
	store.path = path
	store.persistent = true
	store.data.checkpoint = valid
	check(store.save_progress(), "valid checkpoint saved")
	check(store.save_progress(), "backup created")
	var broken := store.data.duplicate(true)
	broken.checkpoint.erase("upgrade")
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(JSON.stringify(broken))
	file.close()
	var recovered := FBProgressStore.new()
	recovered.path = path
	recovered.persistent = true
	recovered.load_progress()
	check(FBProgressStore.checkpoint(recovered.data.checkpoint).room_id == "v2", "nested checkpoint corruption falls back to valid backup")
	game.run.start()
	game.run.room_index = 1
	game.run.enter_room({})
	var hero: FBActor = game.room.hero
	var enemy: FBActor = game.room.actors[1]
	hero.position = Vector2(200,430)
	enemy.position = Vector2(210,480)
	enemy.hp = 8
	check(not FBCombat.executable(hero,enemy), "depth miss not offered for execution")
	enemy.position = Vector2(240,430)
	enemy.invulnerability = 1
	check(not FBCombat.executable(hero,enemy), "invulnerable target not offered")
	enemy.invulnerability = 0
	enemy.launch_remaining = 10
	check(not FBCombat.executable(hero,enemy), "launched target not offered")
	enemy.launch_remaining = 0
	check(FBCombat.executable(hero,enemy), "reachable ground low-hp target offered")
	game.run.room_index = 3
	game.run.enter_room({})
	var director := FBEnemyDirector.new()
	hero = game.room.hero
	hero.position = Vector2(800,455)
	var slots: Array[int] = []
	for a in game.room.actors:
		if a.kind != "grunt": continue
		a.engagement_delay = 0
		director.intent(a,hero)
		var slot: int = director.wait_slots[a.get_instance_id()]
		check(not slots.has(slot), "nine waiting soldiers have distinct slots")
		slots.append(slot)
	var dead: FBActor = game.room.actors[1]
	var survivor: FBActor = game.room.actors[2]
	var preserved: int = director.wait_slots[survivor.get_instance_id()]
	dead.hp = 0
	for a in game.room.actors: a.attack_cooldown = 1000
	director.update(game.room.actors,hero)
	check(not director.wait_slots.has(dead.get_instance_id()) and director.wait_slots[survivor.get_instance_id()] == preserved, "death releases slot without reordering survivors")
	hero.position.x = game.room.arena.position.x
	director.update(game.room.actors,hero)
	var points: Array[Vector2] = []
	for a in game.room.actors:
		if a.kind != "grunt" or a.is_dead(): continue
		director.intent(a,hero)
		var point := (hero.position + FBEnemyDirector.waiting_offset(director.wait_slots[a.get_instance_id()])).clamp(a.arena_bounds.position,a.arena_bounds.end)
		for other in points: check(point.distance_to(other) >= 30,"wall-clamped waiting positions remain apart")
		points.append(point)
	game.run.room_index = FBData.room_index("boss")
	game.run.enter_room({})
	var boss: FBActor = game.room.actors[1]
	boss.state.change("bossNova")
	boss.launch(30,45)
	check(boss.state.id == "bossNova" and boss.launch_remaining == 0,"boss armor keeps telegraphed attack")
	var original_position := boss.position
	hero = game.room.hero
	hero.state.change("fateSever")
	hero.skills.r_slots[boss.get_instance_id()] = original_position + Vector2(100,0)
	hero.skills.on_hit(boss)
	check(boss.position == original_position and boss.state.id == "bossNova", "R keeps armored boss telegraph position")
	hero.state.change("idle")
	boss.state.change("idle")
	boss.launch(30,45)
	check(boss.state.id == "hit" and boss.launch_remaining == 12 and boss.launch_height == 18,"boss vulnerable window allows short launch")
	enemy = game.room.actors[2]
	enemy.launch(30,45)
	check(enemy.launch_remaining == 30,"ordinary soldiers retain full launch")
	for a in game.room.actors:
		if a.kind != "hero": a.hp = 0
	for i in 40: game.run.step({})
	check(game.run.phase == "loot" and game.run.progress.data.checkpoint.phase == "loot","boss clear saves pending loot")
	game._command("home")
	game.run.resume()
	check(game.run.phase == "loot" and game.room.alive_enemies() == 0,"continue pending loot never respawns boss or guards")
	var completed: int = game.run.completions
	game.run.claim_loot("scout-coat")
	game.run.claim_loot("scout-coat")
	check(game.run.completions == completed+1 and game.run.progress.data.checkpoint.is_empty(),"pending reward settles once and clears checkpoint")
	game.audio.stop()
	game.free()
	await process_frame
	await create_timer(0.3).timeout
	print("REVIEW_V2_CHECKS_PASS checks=",checks)
	quit()
