extends SceneTree
var checks := 0
var actors: Array[FBActor] = []
var combat: FBCombat
var h: FBActor
var target: FBActor

func _initialize() -> void:
	call_deferred("validate")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		assert(ok, message)
		quit(1)

func setup() -> void:
	for actor in actors:
		actor.free()
	actors.clear()
	combat = FBCombat.new()
	h = actor("hero", Vector2(200, 430))
	target = actor("grunt", Vector2(245, 430))
	target.hp = 1000
	target.max_hp = 1000

func actor(kind: String, at: Vector2) -> FBActor:
	var a := FBActor.new()
	a.kind = kind
	a.position = at
	a.arena_bounds = Rect2(40, 390, 1360, 130)
	root.add_child(a)
	actors.append(a)
	return a

func step(input: Dictionary = {}) -> void:
	for a in actors:
		a.tick(input if a == h else {})
	combat.resolve(actors)

func frames(count: int) -> void:
	for i in count:
		step()

func cast(key: String, count := 25) -> void:
	step({"yone_" + key: true})
	frames(count)

func validate() -> void:
	setup()
	cast("q", 5)
	check(target.hp == 986 and h.skills.q_stacks == 1, "Q first hit grants one stack")
	frames(4)
	check(target.hp == 986 and h.skills.q_stacks == 1, "Q active frames deduplicate hits and stacks")
	frames(35)
	cast("q")
	check(h.skills.q_stacks == 2 and target.hp == 972, "second separate Q hit arms third thrust")
	frames(20)
	cast("q", 6)
	check(h.state.id == "windRush" and h.skills.q_stacks == 0, "third Q consumes both stacks")
	check(target.hp == 952 and target.launch_remaining > 0, "Q3 swept path hits and launches")
	var pos := h.position
	frames(8)
	check(h.position.x > pos.x and target.hp == 952, "Q3 continuous displacement and per-cast dedup")
	setup()
	target.position.y = 510
	cast("q")
	check(h.skills.q_stacks == 0 and target.hp == 1000, "Q whiff grants no stack")
	h.skills.q_stacks = 2
	h.skills.q_remaining = 1
	step()
	check(h.skills.q_stacks == 0, "stack expiry uses logic clock")
	setup()
	var behind := actor("grunt", Vector2(155, 430))
	var side := actor("grunt", Vector2(240, 500))
	var second := actor("grunt", Vector2(255, 460))
	var third := actor("grunt", Vector2(260, 415))
	var fourth := actor("grunt", Vector2(272, 430))
	cast("w")
	check(target.hp == 984 and behind.hp == 42 and side.hp == 42, "W forward sector excludes rear and outside-angle target")
	check(second.hp == 26 and third.hp == 26 and fourth.hp == 26, "W multi-target damage deduplicates")
	check(h.skills.shield == 42, "W shield is capped across multiple hits")
	var before := h.hp
	combat.deal(behind, h, {"damage": 50, "knockback": 0, "hitStop": 0})
	check(h.hp == before - 8 and h.skills.shield == 0, "shield absorbs actual incoming damage")
	setup()
	target.position = Vector2(600, 430)
	cast("w")
	check(h.skills.shield == 0, "W miss grants no shield")
	h.skills.shield = 10
	h.skills.shield_remaining = 1
	step()
	check(h.skills.shield == 0, "shield expires")
	setup()
	cast("e", 12)
	var anchor := h.skills.e_anchor
	check(h.skills.e_active and h.position.x > anchor.x, "E anchors body and moves spirit")
	cast("q")
	check(target.hp == 986 and h.skills.ledger.size() == 1, "E records actual Q damage per target")
	var hp := h.hp
	var cd: int = h.skills.cooldowns.e
	cast("e", 0)
	check(not h.skills.e_active and h.position == anchor and h.hp == hp, "second E returns without heal")
	check(h.skills.cooldowns.e == cd - 1 and target.hp == 981.1, "return preserves cooldown and settles 35 percent actual damage")
	check(h.skills.echo_count == 1 and h.skills.ledger.is_empty(), "echo consumes per-target ledger")
	combat.resolve(actors)
	check(target.hp == 981.1, "repeated resolve cannot settle echo twice")
	frames(16)
	cast("e", 0)
	check(not h.skills.e_active and h.state.id != "spiritStart", "E return does not reset its cooldown")
	setup()
	cast("e", 12)
	h.skills.record_damage(target, 20)
	h.skills.e_remaining = 1
	h.stun = 100
	h.state.change("hit")
	step()
	check(not h.skills.e_active and h.state.id == "spiritReturn" and target.hp == 993, "E timeout returns even during stun")
	setup()
	cast("e", 12)
	h.skills.record_damage(target, 20)
	actors.erase(target)
	h.skills.begin_return()
	combat.resolve(actors)
	check(target.hp == 1000 and h.skills.echo_count == 0, "removed target receives no echo")
	target.free()
	setup()
	cast("e", 12)
	h.skills.record_damage(target, 20)
	target.hp = 0
	h.skills.begin_return()
	combat.resolve(actors)
	check(h.skills.echo_count == 0, "dead target receives no echo")
	setup()
	cast("e", 12)
	h.skills.record_damage(target, 20)
	h.hp = 1
	combat.deal(target, h, {"damage": 10, "knockback": 0, "hitStop": 0})
	check(not h.skills.e_active and h.skills.ledger.is_empty(), "death clears E before settling")
	combat.resolve(actors)
	check(target.hp == 1000, "death never produces echo")
	setup()
	cast("e", 12)
	target.hp = 10
	combat.deal(h, target, {"damage": 100, "knockback": 0, "hitStop": 0})
	check(h.skills.ledger[target.get_instance_id()].damage == 10, "E ledger records HP lost without overkill")
	setup()
	var extra := actor("grunt", Vector2(380, 430))
	var outside := actor("grunt", Vector2(320, 510))
	cast("r", 16)
	check(target.hp == 1000 and h.position.x == 200, "R respects 18-frame windup")
	step()
	check(target.hp == 964 and extra.hp == 6 and outside.hp == 42, "R line hits normal-health targets only within line")
	check(h.position.x > 380 and target.launch_remaining > 0 and extra.launch_remaining > 0, "R passes behind furthest target and launches")
	check(target.position.distance_to(extra.position) >= target.radius + extra.radius, "R gives gathered targets separate positions")
	check(h.arena_bounds.has_point(target.position) and h.arena_bounds.has_point(extra.position), "gather stays inside ground bounds")
	frames(4)
	check(target.hp == 964 and extra.hp == 6, "R active-frame dedup after gathering")
	setup()
	target.launch(30, 45)
	h.state.change("slash")
	h.state.frame = 8
	combat.resolve(actors)
	check(target.hp == 1000, "old J cannot hit launched targets")
	h.state.change("airSlash")
	h.state.frame = 6
	combat.resolve(actors)
	check(target.hp == 1000, "old airSlash cannot hit launched targets")
	h.state.change("guardSweep")
	h.state.frame = 7
	combat.resolve(actors)
	check(target.hp == 984 and target.launch_remaining > 0, "new W hits launched targets")
	setup()
	target.position = Vector2(700, 500)
	cast("r")
	check(target.hp == 1000 and h.position.x == 530, "R can whiff and still moves full configured range")
	setup()
	h.position = Vector2(1390, 450)
	h.skills.q_stacks = 2
	h.skills.q_remaining = 60
	cast("q")
	check(h.position.x <= h.arena_bounds.end.x, "Q3 clamps arena boundary")
	setup()
	h.state.change("slash")
	h.state.frame = 1
	step({"yone_w": true})
	frames(10)
	check(h.state.id != "guardSweep", "input expires before unavailable cancel window")
	h.state.change("slash")
	h.state.frame = 7
	step({"yone_q": true})
	frames(5)
	check(h.state.id == "windThrust", "eight-frame buffer casts at original cancel point")
	setup()
	cast("q", 5)
	step({"attack": true})
	frames(4)
	check(h.state.id == "slash", "Q recovery cancels into original J attack")
	setup()
	h.state.change("jump")
	h.state.frame = 17
	step({"yone_r": true})
	check(h.state.id == "jump" and h.skills.cooldowns.r == 0, "R cannot replace airborne action")
	for a in actors:
		a.free()
	actors.clear()
	await validate_main()
	print("YONE_MVP_CHECKS_PASS checks=", checks)
	quit()

func validate_main() -> void:
	var game: Control = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game._command("start")
	for i in 4:
		var key: String = FBYoneSkills.INPUTS[i]
		var event := InputEventKey.new()
		event.physical_keycode = KEY_1 + i
		event.pressed = true
		game.controls._input(event)
		check(game.controls.sample().get(key, false), "numeric key routes " + key)
		game.controls._input(event)
		event.echo = true
		game.controls.pending.clear()
		game.controls._input(event)
		check(not game.controls.pending.has(key), "key repeat cannot repeatedly cast " + key)
	var hero: FBActor = game.room.hero
	hero.skills.q_stacks = 2
	hero.skills.q_remaining = 200
	hero.skills.e_active = true
	hero.skills.e_anchor = hero.position
	hero.skills.e_remaining = 180
	hero.skills.cooldowns.r = 120
	hero.skills.shield = 30
	hero.skills.shield_remaining = 100
	game.run.paused = true
	for i in 10:
		game.run.step({})
	check(hero.skills.e_remaining == 180 and hero.skills.cooldowns.r == 120 and hero.skills.shield_remaining == 100, "pause freezes all skill clocks")
	game.run.paused = false
	game.run.combat.freeze_frames = 10
	for i in 10:
		game.run.step({})
	check(hero.skills.e_remaining == 180 and hero.skills.q_remaining == 200, "hitstop freezes E and stacks")
	game.controls.pending.yone_r = true
	game._command("start")
	var next: FBActor = game.room.hero
	check(next != hero and next.skills.cooldowns.r == 0 and not next.skills.e_active and next.skills.shield == 0 and next.skills.q_stacks == 0, "restart clears all skill state")
	check(game.controls.pending.is_empty(), "restart clears all old input edges")
	next.skills.cooldowns.e = 200
	next.skills.e_active = true
	next.skills.e_anchor = next.position
	game.run.phase = "cleared"
	game.run.advance_room()
	check(game.room.hero.skills.cooldowns.e == 200 and not game.room.hero.skills.e_active, "room change carries cooldown but clears spirit and body")
	game.audio.stop()
	game.queue_free()
	await process_frame
	await create_timer(0.3).timeout
