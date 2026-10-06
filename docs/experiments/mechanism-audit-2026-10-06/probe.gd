extends SceneTree
const ACTOR = preload("res://scenes/actor.tscn")
func _initialize():
	call_deferred("probe")
func actor(kind: String, pos: Vector2) -> FBActor:
	var a: FBActor = ACTOR.instantiate()
	a.kind = kind
	a.position = pos
	root.add_child(a)
	a.get_node("Visual").set_process(false)
	return a
func probe():
	var hero = actor("hero", Vector2(200, 430))
	var low = actor("grunt", Vector2(240, 430))
	var boss = actor("boss", Vector2(255, 430))
	low.hp = 8
	hero.hp = 100
	var actors: Array[FBActor] = [hero, low, boss]
	var combat = FBCombat.new()
	var target = combat.execute_target(hero, actors)
	hero.tick({"execute": true}, target)
	for i in 5:
		combat.resolve(actors)
		hero.tick({})
	print("AUDIT_EXECUTE selected=", target.kind, " low_hp=", low.hp, " boss_hp=", boss.hp, " executes=", combat.executes, " hero_hp=", hero.hp)
	for a in actors: a.free()
	hero = actor("hero", Vector2(200, 430))
	var first = actor("grunt", Vector2(240, 430))
	var second = actor("grunt", Vector2(250, 430))
	actors = [hero, first, second]
	hero.state.change("slash2")
	hero.state.frame = 6
	hero.state.perfect_pending = true
	combat = FBCombat.new()
	combat.resolve(actors)
	print("AUDIT_PERFECT first_damage=",42-first.hp," second_damage=",42-second.hp)
	hero.state.perfect_pending = true
	hero.state.change("hit")
	hero.state.change("idle")
	print("AUDIT_PERFECT_AFTER_INTERRUPTION pending=",hero.state.perfect_pending)
	hero.skills.shield = 42
	hero.skills.shield_remaining = 120
	hero.state.change("idle")
	hero.stun = 0
	combat = FBCombat.new()
	var before = hero.hp
	combat.deal(first,hero,{"damage":12,"knockback":3.2,"hitStop":5})
	print("AUDIT_FULL_SHIELD hp_lost=",before-hero.hp," state=",hero.state.id," stun=",hero.stun," freeze=",combat.freeze_frames)
	for a in actors: a.free()
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game.run.start()
	game.run.room_index = FBData.room_index("boss")
	game.run.enter_room({})
	hero = game.room.hero
	hero.hp = 100000
	boss = game.room.actors[1]
	boss.boss_phase = 2
	var seen: Dictionary = {}
	for i in 1800:
		game.run.step({})
		seen[boss.state.id] = true
	print("AUDIT_BOSS_PHASE2 states=",seen.keys())
	game.free()
	await process_frame
	quit()
