extends SceneTree

var checks := 0
var game: Control
var run: FBRun
var room: FBRoom
var actor_scene := preload("res://scenes/actor.tscn")

func _initialize() -> void:
	call_deferred("validate")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok, message)

func pair() -> Array[FBActor]:
	var hero: FBActor = actor_scene.instantiate()
	var enemy: FBActor = actor_scene.instantiate()
	enemy.kind = "grunt"
	root.add_child(hero)
	root.add_child(enemy)
	hero.position = Vector2(200, 400)
	enemy.position = Vector2(240, 400)
	return [hero, enemy]

func validate() -> void:
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	run = game.get_node("Run")
	room = run.room
	check(run.phase == "home", "cold start stays on home")
	var actors := pair()
	var hero := actors[0]
	var enemy := actors[1]
	var combat := FBCombat.new()
	hero.state.change("slash")
	hero.state.frame = 7
	combat.resolve(actors)
	check(enemy.hp == 42, "no hit before frame 8")
	hero.state.frame = 8
	combat.resolve(actors)
	check(enemy.hp == 30, "original 12 damage")
	enemy.invulnerability = 0
	combat.resolve(actors)
	check(enemy.hp == 30, "hit deduplicated")
	enemy.state.change("dash")
	enemy.state.frame = 2
	hero.state.hit_targets.clear()
	combat.resolve(actors)
	check(enemy.hp == 30, "dash invulnerability")
	enemy.state.change("jump")
	enemy.state.frame = 10
	combat.resolve(actors)
	check(enemy.hp == 30, "airborne avoids ground hit")
	enemy.state.change("idle")
	enemy.position.y += 100
	combat.resolve(actors)
	check(enemy.hp == 30, "depth-separated actor is outside the hitbox")
	enemy.position.y -= 100
	enemy.state.change("idle")
	hero.state.change("slash")
	hero.state.frame = 5
	hero.tick({"attack": true})
	for i in 7:
		hero.tick({})
	check(hero.state.id == "slash2", "eight-frame input buffer")
	check(hero.perfect_count == 1, "perfect cancel")
	hero.state.change("jump")
	hero.state.frame = 10
	hero.energy = 100
	hero.tick({"skill": true, "dash": true})
	check(hero.state.id == "jump", "no airborne ground action")
	hero.state.change("idle")
	hero.state.buffers.clear()
	hero.energy = 49
	hero.tick({"skill": true})
	check(hero.state.id == "idle" and hero.energy == 49, "skill cannot spend missing energy")
	hero.state.buffers.clear()
	hero.state.change("idle")
	hero.hp = 100
	enemy.hp = 10
	enemy.invulnerability = 0
	enemy.position = hero.position + Vector2(40, 0)
	check(combat.execute_target(hero, actors) == enemy, "execute threshold")
	hero.tick({"execute": true}, enemy)
	for i in 4:
		hero.tick({})
	combat.resolve(actors)
	check(enemy.is_dead() and hero.hp == 114 and combat.executes == 1, "execute kills and heals")
	hero.free()
	enemy.free()
	var director := FBEnemyDirector.new()
	actors = pair()
	hero = actors[0]
	enemy = actors[1]
	enemy.position.x = 650
	for i in 300:
		director.update(actors, hero)
		enemy.tick(director.intent(enemy, hero))
	check(enemy.position.x < 320, "enemy approaches while holding token")
	hero.free()
	enemy.free()
	var boss: FBActor = actor_scene.instantiate()
	boss.kind = "boss"
	root.add_child(boss)
	hero = actor_scene.instantiate()
	root.add_child(hero)
	boss.hp = 145
	combat.deal(hero, boss, {"damage": 12, "knockback": 3, "hitStop": 5})
	check(boss.boss_phase == 2 and boss.state.id == "bossSummon", "boss crosses half health once")
	boss.state.change("idle")
	combat.deal(hero, boss, {"damage": 12, "knockback": 3, "hitStop": 5})
	check(boss.state.id != "bossSummon", "boss phase does not retrigger")
	boss.free()
	hero.free()
	game._command("start")
	check(run.phase == "cleared" and room.room_id == "v0", "start gate")
	room.hero.position = Vector2(room.arena.end.x - 30, room.arena.get_center().y)
	run.step({})
	check(room.room_id == "v1" and run.phase == "fighting", "walk to next room")
	var before := room.hero.position
	game.toggle_pause()
	for i in 30:
		run.step({"move": Vector2.RIGHT, "attack": true})
	check(room.hero.position == before, "pause freezes simulation")
	game.toggle_pause()
	var key := InputEventKey.new()
	key.physical_keycode = KEY_J
	key.pressed = true
	game.controls._input(key)
	check(game.controls.sample().get("attack", false), "InputMap routes J to attack")
	key.physical_keycode = KEY_SHIFT
	game.controls._input(key)
	check(game.controls.sample().get("dash", false), "InputMap routes Shift to dash")
	var touch := InputEventScreenTouch.new()
	touch.index = 7
	touch.pressed = true
	touch.position = game.controls.get_global_transform_with_canvas() * Vector2(130, 120)
	game.controls._input(touch)
	check(game.controls.joystick_id == 7, "touch screen coordinates reach joystick")
	touch.pressed = false
	touch.canceled = true
	game.controls._input(touch)
	check(game.controls.joystick_id == -999, "canceled touch releases joystick")
	game.controls.pending.attack = true
	run.combat.freeze_frames = 2
	game._physics_process(1.0 / 60)
	check(game.controls.pending.has("attack"), "hitstop preserves pending attack edge")
	run.combat.freeze_frames = 0
	game.controls.clear()
	game.controls.press(1, Vector2(110, 110))
	game.controls.press(2, Vector2(428, 108))
	check(game.controls.sample().get("attack", false), "multitouch attack")
	game.controls.release(1)
	check(game.controls.movement == Vector2.ZERO and game.controls.fingers.has(2), "independent fingers")
	game.controls.clear()
	check(game.controls.fingers.is_empty(), "touch clear")
	game._notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	check(run.paused and not game.controls.enabled, "background pauses")
	game._notification(Node.NOTIFICATION_APPLICATION_FOCUS_IN)
	check(run.paused, "manual resume required")
	game._command("start")
	run.room_index = 3
	run.enter_room({})
	var hp := room.hero.hp
	run.choose_upgrade("guardian")
	check(room.hero.max_hp == 184 and room.hero.hp == hp + 24, "guardian adds health from base stats")
	run.choose_upgrade("offense")
	check(run.upgrade == "guardian", "reward cannot be claimed twice")
	game._command("start")
	var reached := await play_stage()
	check(reached, "bot reaches loot via real combat")
	if reached:
		run.claim_loot("wind-sabers")
		var completed := run.completions
		run.claim_loot("scout-coat")
		check(run.phase == "complete" and run.completions == completed, "settle once")
		print("BOT_SUMMARY ", run.summary().replace("\n", " | "))
	for i in 3:
		game._command("start")
		await process_frame
		check(room.actors.size() == 1 and room.actor_root.get_child_count() == 1, "restart cleans actors")
		check(run.combat.kills == 0 and run.upgrade == "" and run.combat.freeze_frames == 0, "restart resets state")
	room.hero.hp = 0
	run.step({})
	check(run.phase == "dead", "defeat")
	game._command("stress")
	check(room.actors.size() == 50, "50 actual actors")
	var start := Time.get_ticks_usec()
	for i in 600:
		run.step({"attack": i % 12 == 0})
	print("HEADLESS_50_UNITS_MS_PER_TICK ", (Time.get_ticks_usec() - start) / 600000.0)
	check(room.alive_enemies() == 49, "sustained stress")
	print("GODOT_VALIDATION_PASS checks=", checks)
	game.queue_free()
	await process_frame
	quit()

func play_stage() -> bool:
	# 机器人只注入正式输入，不改血量、不清怪；不计入真人平衡样本。
	for tick in 36000:
		if run.phase == "loot":
			return true
		if run.phase == "dead":
			print("BOT_DEAD room=", room.room_id, " kills=", run.combat.kills)
			return false
		if run.phase == "reward":
			run.choose_upgrade("guardian")
		var hero := room.hero
		var input: Dictionary = {}
		if run.phase == "cleared":
			input.move = (Vector2(room.arena.end.x, room.arena.get_center().y) - hero.position).normalized()
		else:
			var target: FBActor = null
			var distance := INF
			for actor in room.actors:
				if actor.kind != "hero" and not actor.is_dead() and actor.position.distance_squared_to(hero.position) < distance:
					target = actor
					distance = actor.position.distance_squared_to(hero.position)
			if target:
				var offset := target.position - hero.position
				input.move = offset.normalized() if absf(offset.x) > 42 or absf(offset.y) > 12 else Vector2(signf(offset.x), 0) * 0.01
				input.attack = tick % 10 == 0
				input.skill = hero.energy >= 50 and tick % 35 == 0
				input.execute = target.hp / target.max_hp < 0.25
				if target.kind == "boss" and target.state.id == "bossSlam" and target.state.frame > 15 and target.state.frame < 51:
					input = {"move": Vector2(0, -1 if hero.position.y > room.arena.get_center().y else 1), "jump": target.state.frame >= 29}
		run.step(input)
		if tick % 300 == 0:
			await process_frame
	print("BOT_TIMEOUT room=", room.room_id)
	return false
