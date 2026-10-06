extends SceneTree
const ACTOR := preload("res://scenes/actor.tscn")
func _initialize() -> void:
	call_deferred("probe")
func actor(kind: String, at: Vector2) -> FBActor:
	var a: FBActor = ACTOR.instantiate()
	a.kind = kind
	a.position = at
	root.add_child(a)
	a.get_node("Visual").set_process(false)
	return a
func probe() -> void:
	var hero := actor("hero",Vector2(200,430))
	var enemy := actor("grunt",Vector2(210,480))
	enemy.hp = 8
	var actors: Array[FBActor] = [hero,enemy]
	var combat := FBCombat.new()
	var target := combat.execute_target(hero,actors)
	hero.tick({"execute":true},target)
	for i in 35:
		combat.resolve(actors)
		hero.tick({})
	print("REVIEW_EXECUTE_DEPTH offered=",target==enemy," distance=",Vector2(10,50).length()," hp_after=",enemy.hp," executes=",combat.executes)
	for a in actors: a.free()
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	game.run.start()
	game.run.room_index = 2
	game.run.enter_room({})
	game.run.progress.data.checkpoint.erase("upgrade")
	print("REVIEW_MISSING_UPGRADE can_resume=",game.run.can_resume())
	game.run.resume()
	print("REVIEW_AFTER_RESUME phase=",game.run.phase," room=",game.room.room_id)
	game.run.start()
	game.run.room_index = 3
	game.run.enter_room({})
	var first: FBActor = game.room.actors[1]
	var seventh: FBActor = game.room.actors[7]
	for waiting in [first,seventh]:
		waiting.engagement_delay = 0
		waiting.position = game.room.hero.position + Vector2(100,0)
	var director := FBEnemyDirector.new()
	print("REVIEW_WAIT_SLOTS index=",first.get_index(),",",seventh.get_index()," same_intent=",director.intent(first,game.room.hero)==director.intent(seventh,game.room.hero)," intent=",director.intent(first,game.room.hero))
	game.run.room_index = FBData.room_index("boss")
	game.run.enter_room({})
	var boss: FBActor = game.room.actors[1]
	hero = game.room.hero
	hero.position = Vector2(500,450)
	boss.position = Vector2(555,450)
	boss.state.change("bossNova")
	boss.state.frame = 20
	hero.state.change("windRush")
	hero.skills.on_hit(boss)
	print("REVIEW_BOSS_ARMOR superarmor=",FBData.action("bossNova",false).superArmor," after_launch=",boss.state.id," stun=",boss.stun)
	for opponent in game.room.actors:
		if opponent.kind != "hero": opponent.hp = 0
	for i in 40: game.run.step({})
	var victory: String = game.run.phase
	game._command("home")
	game.run.resume()
	print("REVIEW_LOOT_RESUME before=",victory," after=",game.run.phase," alive=",game.room.alive_enemies())
	game.audio.stop()
	game.free()
	await process_frame
	await create_timer(0.3).timeout
	quit()
