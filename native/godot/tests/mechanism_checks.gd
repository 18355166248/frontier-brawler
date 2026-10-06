extends SceneTree
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
func actor(kind: String, at: Vector2) -> FBActor:
	var a: FBActor = ACTOR.instantiate()
	a.kind = kind
	a.position = at
	root.add_child(a)
	a.get_node("Visual").set_process(false)
	return a
func run_checks() -> void:
	var hero := actor("hero", Vector2(200, 430))
	var low := actor("grunt", Vector2(240, 430))
	var boss := actor("boss", Vector2(255, 430))
	low.hp = 8
	hero.hp = 100
	var actors: Array[FBActor] = [hero, low, boss]
	var combat := FBCombat.new()
	hero.tick({"execute": true}, combat.execute_target(hero, actors))
	for i in 5:
		combat.resolve(actors)
		hero.tick({})
	check(low.is_dead() and boss.hp == 280, "execute only locked low-hp target, never neighboring full boss")
	check(combat.executes == 1 and hero.hp == 114, "execution count and heal once")
	low.hp = 8
	low.invulnerability = 0
	low.stun = 0
	low.state.change("idle")
	hero.state.change("idle")
	hero.tick({"execute": true}, low)
	low.hp = 30
	hero.state.frame = 5
	combat.resolve(actors)
	check(low.hp == 30 and combat.executes == 1, "healed target loses execute eligibility at contact")
	low.hp = 8
	low.position.x = 280
	combat.resolve(actors)
	check(low.hp == 8, "out of execution distance does not die")
	low.position.x = 240
	hero.state.change("slash2", true)
	hero.state.frame = 6
	low.hp = 42
	boss.hp = 280
	combat.resolve(actors)
	check(is_equal_approx(low.hp, 21.3) and is_equal_approx(boss.hp, 259.3), "perfect slash grants all targets 15 percent")
	for next in ["hit", "dash", "idle", "slash"]:
		hero.state.change("slash2", true)
		hero.state.change(next)
		check(not hero.state.perfect_pending, "perfect cannot leak into " + next)
	hero.state.change("slash2", true)
	hero.state.frame = 25
	hero.state.advance()
	check(not hero.state.perfect_pending, "missed perfect expires when action ends")
	hero.state.change("slash")
	hero.state.frame = 12
	hero.tick({"attack": true})
	check(hero.state.id == "slash2" and hero.state.perfect_pending, "normal input perfect chain still works")
	hero.skills.shield = 42
	hero.skills.shield_remaining = 120
	hero.state.change("slash")
	hero.stun = 0
	hero.invulnerability = 0
	combat = FBCombat.new()
	var before := hero.hp
	combat.deal(low, hero, {"damage":12,"knockback":3.2,"hitStop":5})
	check(hero.hp == before and hero.skills.shield == 30 and hero.state.id == "slash" and hero.stun == 0 and combat.freeze_frames == 0, "full shield preserves action without hitstop")
	combat.deal(low, hero, {"damage":40,"knockback":3.2,"hitStop":5})
	check(hero.hp == before - 10 and hero.skills.shield == 0 and hero.state.id == "hit" and hero.stun == 12, "shield overflow causes normal damage and stun")
	var director := FBEnemyDirector.new()
	director.tokens.append(boss)
	boss.position = hero.position + Vector2(90,0)
	boss.boss_phase = 2
	boss.state.change("idle")
	boss.attack_serial = 0
	check(director.intent(boss, hero).action == "bossNova", "phase2 starts close nova")
	boss.attack_serial = 1
	check(director.intent(boss, hero).action == "bossSlam", "phase2 includes punishable slam")
	boss.stun = 0
	boss.attack_serial = 2
	boss.position = hero.position + Vector2(300,0)
	var intent := director.intent(boss, hero)
	boss.tick(intent)
	check(boss.state.id == "bossCharge", "phase2 starts ranged telegraphed charge")
	for i in 23:
		boss.tick({})
	check(boss.state.id == "bossRush", "charge chains to rush at 24 ticks")
	boss.state.change("idle")
	boss.boss_phase = 1
	check(not director.intent(boss, hero).has("attack"), "phase1 cannot start phase2 charge")
	for a in actors:
		a.free()
	await process_frame
	print("MECHANISM_CHECKS_PASS checks=",checks)
	quit()
