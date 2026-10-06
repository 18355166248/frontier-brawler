extends SceneTree
## 使用真实 Actor/Run 检查远程事件、威胁预算和生命周期，不以截图代替命中测试。
const ACTOR := preload("res://scenes/actor.tscn")
var checks := 0

func _initialize() -> void:
	call_deferred("run_checks")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok, message)

func actor(kind: String, point: Vector2) -> FBActor:
	var a: FBActor = ACTOR.instantiate()
	a.kind = kind
	a.position = point
	root.add_child(a)
	a.get_node("Visual").set_process(false)
	return a

func run_checks() -> void:
	var hero := actor("hero", Vector2(350, 430))
	var archer := actor("archer", Vector2(100, 430))
	var mage := actor("mage", Vector2(120, 465))
	var grunt := actor("grunt", Vector2(300, 430))
	var actors: Array[FBActor] = [hero, archer, mage, grunt]
	var threats := FBEnemyThreats.new()
	root.add_child(threats)
	var combat := FBCombat.new()
	for a in [archer, mage, grunt]:
		var visual: FBEnemyRosterVisual = a.get_node("Visual")
		check(visual.uses_enemy_pack and not visual.uses_pack and not visual.uses_boss_pack, a.kind + " complete pack loaded independently")
		check(visual.enemy_body.offset == Vector2(-308, -560), "enemy flips about foot anchor")
		var before: int = a.visual_tick
		for i in 12:
			visual._process(1.0/60)
		check(a.visual_tick == before, "rendering cannot advance enemy logic")
	var fallback: FBActor = ACTOR.instantiate()
	fallback.kind = "archer"
	fallback.get_node("Visual").enemy_pack_directory = "res://output/missing-enemy-pack"
	root.add_child(fallback)
	check(not fallback.get_node("Visual").uses_enemy_pack and fallback.get_node("Visual").enemy_root == null, "missing pack falls back atomically")
	fallback.free()
	archer.tick({"attack": true, "target": hero.position})
	threats.step(actors, hero, combat)
	check(archer.state.id == "archerAim" and threats.warnings.size() == 1 and threats.arrows.is_empty(), "archer warns before release")
	var target := archer.attack_target
	var line: Vector2 = threats.warnings[0].target
	hero.position.y += 55
	for i in 40:
		archer.tick({})
		threats.step(actors, hero, combat)
	check(archer.state.id == "archerAim" and archer.state.frame == 41 and threats.shots == 0, "full 42-frame warning retained")
	check(archer.attack_target == target and threats.warnings[0].target == line, "target motion cannot retarget arrow warning")
	archer.tick({})
	threats.step(actors, hero, combat)
	check(archer.state.id == "archerShoot" and threats.shots == 1 and threats.arrows.size() == 1, "aim chains to release exactly once")
	var hp := hero.hp
	for i in 15:
		archer.tick({})
		threats.step(actors, hero, combat)
	check(threats.shots == 1 and hero.hp == hp, "shoot cannot duplicate arrow and depth sidestep avoids it")
	archer.hp = 0
	hero.position = Vector2(260, 430)
	for i in 20:
		threats.step(actors, hero, combat)
	check(hero.hp == hp - 11 and threats.arrows.is_empty(), "released arrow survives shooter death and deals once")
	check(FBEnemyThreats.swept_touch(Vector2(0, 0), Vector2(200, 0), Vector2(100, 0), Vector2(20, 15)), "swept collision catches high-speed crossing")
	check(not FBEnemyThreats.swept_touch(Vector2(0, 40), Vector2(200, 40), Vector2(100, 0), Vector2(20, 15)), "sweep respects depth")
	hero.invulnerability = 0
	hero.state.change("jump")
	hero.state.frame = 10
	check(not threats.vulnerable(hero), "jump avoids ground arrows and zones")
	hero.state.change("dash")
	hero.state.frame = 2
	check(not threats.vulnerable(hero), "dash immunity also applies to remote attacks")
	hero.state.change("idle")
	hero.position = Vector2(350, 455)
	mage.tick({"attack": true, "target": hero.position})
	threats.step(actors, hero, combat)
	var zone := mage.attack_target
	hero.position.y = 510
	for i in 52:
		mage.tick({})
		threats.step(actors, hero, combat)
	check(threats.casts == 0 and threats.warnings[0].target == zone, "mage freezes its ground point for all 54 warning frames")
	mage.tick({})
	threats.step(actors, hero, combat)
	check(threats.casts == 1 and hero.hp == hp - 11, "leaving locked zone avoids its one burst")
	for i in 40:
		mage.tick({})
		threats.step(actors, hero, combat)
	check(threats.casts == 1, "mage recovery cannot repeat burst")
	threats.clear_all()
	mage.stun = 0
	mage.state.change("idle")
	mage.tick({"attack": true, "target": hero.position})
	threats.step(actors, hero, combat)
	check(threats.warnings.size() == 1, "new cast creates a new warning")
	combat.deal(hero, mage, {"damage": 1, "knockback": 0, "hitStop": 0})
	for i in 80:
		mage.tick({})
		threats.step(actors, hero, combat)
	check(threats.warnings.is_empty() and threats.casts == 1, "hit cancels unreleased spell instead of postponing it")
	mage.stun = 0
	mage.state.change("idle")
	mage.tick({"attack": true, "target": hero.position})
	mage.hp = 0
	threats.step(actors, hero, combat)
	check(threats.warnings.is_empty() and threats.casts == 1, "death cancels unreleased spell")
	mage.hp = mage.max_hp
	mage.stun = 0
	mage.state.change("idle")
	hero.invulnerability = 0
	hero.state.change("idle")
	mage.tick({"attack": true, "target": hero.position})
	var zone_hp := hero.hp
	for i in 98:
		mage.tick({})
		threats.step(actors, hero, combat)
	check(hero.hp == zone_hp - 14 and threats.casts == 2, "standing in zone receives exactly one 14-damage burst")
	archer.hp = archer.max_hp
	archer.state.change("idle")
	archer.attack_cooldown = 0
	mage.hp = mage.max_hp
	mage.state.change("idle")
	mage.attack_cooldown = 0
	mage.stun = 0
	var director := FBEnemyDirector.new()
	director.visible_x = Vector2(80, 500)
	director.waiting[archer.get_instance_id()] = 500
	director.update(actors, hero)
	check(director.tokens.has(archer) and not director.tokens.has(mage), "wait priority gives far archer a turn; only one remote token")
	var hidden := FBEnemyDirector.new()
	hidden.visible_x = Vector2(200, 500)
	hidden.update(actors, hero)
	check(not hidden.tokens.has(archer) and not hidden.tokens.has(mage), "offscreen enemies cannot start remote warning")
	var occupied := FBEnemyDirector.new()
	occupied.update(actors, hero, archer)
	check(occupied.tokens.size() == 1 and occupied.tokens[0] == grunt, "released remote threat still reserves one slot and excludes another caster")
	hero.position = archer.position + Vector2(30, 0)
	for i in 32:
		director.intent(archer, hero)
	check(archer.retreat_frames == 0 and archer.retreat_cooldown == 180, "backstep ends after finite 32 intent ticks")
	director.intent(archer, hero)
	check(archer.retreat_frames == 0, "backstep cannot immediately restart")
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game._command("start")
	# 检查真实配置与排兵，避免怪物数变多后仍只验证旧的两人样本。
	for index in [1, 2, 3]:
		game.run.room_index = index
		game.run.enter_room({})
		check(game.room.alive_enemies() == [6, 8, 10][index - 1], "crowd encounter count progresses 6/8/10")
		var remote_count := 0
		var points: Array[Vector2] = []
		for enemy in game.room.actors:
			if enemy.kind == "hero":
				continue
			remote_count += 1 if FBEnemyDirector.is_remote(enemy) else 0
			check(game.room.arena.has_point(enemy.position) and not points.has(enemy.position), "crowd spawn is distinct and inside arena")
			points.append(enemy.position)
		check(remote_count == (0 if index == 1 else 1), "extra crowd comes from melee, remote count stays bounded")
		game.run.director.update(game.room.actors, game.room.hero)
		check(game.run.director.tokens.size() <= 2, "crowd does not expand simultaneous attack budget")
	game.run.room_index = 1
	game.run.enter_room({})
	var crowd: Array[FBActor] = game.room.actors
	var player: FBActor = game.room.hero
	player.position = Vector2(400, 455)
	player.facing = 1
	for i in range(1, 4):
		crowd[i].position = player.position + Vector2(40 + i * 4, (i - 2) * 8)
	player.state.change("slash")
	player.state.frame = 8
	game.run.combat.resolve(crowd)
	check(crowd[1].hp == 30 and crowd[2].hp == 30 and crowd[3].hp == 30, "one real slash hits three clustered soldiers")
	game.run.room_index = 2
	game.run.enter_room({})
	var a: FBActor
	for candidate in game.room.actors:
		if candidate.kind == "archer":
			a = candidate
	a.state.change("archerShoot")
	a.attack_origin = a.position
	a.attack_direction = Vector2.LEFT
	game.run.threats.step(game.room.actors, game.room.hero, game.run.combat)
	check(game.run.threats.arrows.size() == 1, "actual run owns its arrow manager")
	var arrow_at: Vector2 = game.run.threats.arrows[0].position
	game.run.paused = true
	for i in 8:
		game.run.step({})
	check(game.run.threats.arrows[0].position == arrow_at, "pause freezes projectiles")
	game.run.paused = false
	game.run.combat.freeze_frames = 8
	for i in 8:
		game.run.step({})
	check(game.run.threats.arrows[0].position == arrow_at, "hitstop freezes projectiles")
	game.run.enter_room({})
	check(game.run.threats.arrows.is_empty() and game.run.threats.warnings.is_empty(), "room replacement clears remote state")
	game.run.room_index = FBData.room_index("boss")
	game.run.enter_room({})
	check(game.room.alive_enemies() == 4, "boss room has boss and three soldiers")
	var bosses := 0
	var soldiers := 0
	for enemy in game.room.actors:
		bosses += 1 if enemy.kind == "boss" else 0
		soldiers += 1 if enemy.kind == "grunt" else 0
		if enemy.kind == "boss":
			enemy.hp = 0
	check(bosses == 1 and soldiers == 3, "boss support is three melee soldiers")
	for i in 50:
		game.run.step({})
	check(game.run.phase == "fighting" and game.room.alive_enemies() == 3, "boss death cannot settle with soldiers alive")
	check(game.run.director.tokens.size() <= 2, "boss support shares the same attack budget")
	for enemy in game.room.actors:
		if enemy.kind == "grunt":
			enemy.hp = 0
	for i in 41:
		game.run.step({})
	check(game.run.phase == "loot", "boss and support clear leads to loot")
	game._command("home")
	check(game.run.threats.arrows.is_empty(), "home also clears remote state")
	game.queue_free()
	for a0 in actors:
		a0.free()
	threats.free()
	await process_frame
	print("ENEMY_ROSTER_CHECKS_PASS checks=", checks)
	quit()
