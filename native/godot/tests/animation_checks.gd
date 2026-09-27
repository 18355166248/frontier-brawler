extends RefCounted

static func run(root: Window, check: Callable, game: Control) -> void:
	var clips := {
		"hero": ["idle", "move", "slash", "slash2", "slash3", "jump", "airSlash", "dash", "hit", "skill", "execute"],
		"grunt": ["idle", "move", "slash", "hit"],
		"boss": ["idle", "move", "hit", "bossSlam", "bossCharge", "bossRush", "bossNova", "bossSummon"],
	}
	for kind in clips:
		var rows: Array = FBData.all().sheets[kind].rows
		for id in clips[kind]:
			var definition := FBData.action(id, kind == "hero")
			var valid := true
			for frame in int(definition.frames):
				var pose := FBAnimationPose.sample(id, frame, definition, false, kind)
				valid = valid and rows.has(pose.action) and pose.column >= 0 and pose.column < 4
			check.call(valid, "%s/%s all frames resolve to available art" % [kind, id])
			if not definition.hitboxes.is_empty():
				var box: Dictionary = definition.hitboxes[0]
				var strike := FBAnimationPose.sample(id, int(box.activeFrom), definition, false, kind)
				check.call(strike.column == (1 if kind == "grunt" else 2), "%s/%s strike uses this sheet's contact drawing" % [kind, id])
				check.call(FBAnimationPose.sample(id, int(definition.frames) - 1, definition, false, kind).action == "idle", "%s/%s recovery reaches neutral" % [kind, id])
	var scene := load("res://scenes/actor.tscn")
	for kind in ["grunt", "boss"]:
		var hero: FBActor = scene.instantiate()
		var enemy: FBActor = scene.instantiate()
		enemy.kind = kind
		root.add_child(hero)
		root.add_child(enemy)
		hero.position = Vector2(200, 400)
		enemy.position = Vector2(240, 400)
		var director := FBEnemyDirector.new()
		var actors: Array[FBActor] = [hero, enemy]
		director.update(actors, hero)
		enemy.tick(director.intent(enemy, hero))
		var attack := "slash" if kind == "grunt" else "bossSlam"
		var total := int(FBData.action(attack, false).frames)
		var completed := true
		for frame in range(1, total):
			completed = completed and enemy.state.id == attack and enemy.state.frame == frame
			director.update(actors, hero)
			enemy.tick(director.intent(enemy, hero))
		director.update(actors, hero)
		check.call(completed and enemy.state.id == "idle", kind + " completes recovery without restarting attack")
		check.call(not director.tokens.has(enemy) and enemy.attack_cooldown > 0, kind + " releases attack token and enters cooldown")
		enemy.visual_height = 38
		enemy.state.change("hit")
		enemy.stun = 12
		enemy.tick({})
		check.call(enemy.visual_height == 33, kind + " aerial hit descends instead of snapping")
		enemy.hp = 0
		for i in 31:
			enemy.tick({})
		enemy.get_node("Visual")._process(0)
		check.call(is_zero_approx(enemy.get_node("Visual").modulate.a) and enemy.visual_height == 0, kind + " death settles and fully fades")
		hero.free()
		enemy.free()
	game._command("start")
	game.effects.hit(Vector2.ZERO, 12, false, false)
	game.run.paused = true
	var life: float = game.effects.labels[0].life
	game._physics_process(1.0 / 60)
	check.call(game.effects.labels[0].life == life, "pause freezes hit labels and particles")
	game.run.paused = false
	game.run.combat.freeze_frames = 3
	game._physics_process(1.0 / 60)
	check.call(game.effects.labels[0].life < life, "sparks can settle during brief hitstop")
	game.run.advance_room()
	check.call(game.effects.labels.is_empty() and game.effects.particles.is_empty(), "changing rooms clears old hit effects")
	game.room.hero.hp = 0
	game.run.combat.freeze_frames = 0
	game.run.step({})
	var at: Vector2 = game.room.hero.position
	for i in 31:
		game.run.step({"move": Vector2.RIGHT, "attack": true})
	check.call(game.run.phase == "dead" and game.room.hero.dead_frames >= 30 and game.room.hero.position == at, "defeat finishes death visuals without restarting gameplay")
	game._command("home")
