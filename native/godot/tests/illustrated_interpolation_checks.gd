extends SceneTree

var checks := 0

func _init() -> void:
	call_deferred("run")

func run() -> void:
	for kind in ["hero", "grunt", "boss"]:
		for render_hz in [120, 240]:
			for direction in [-1, 1]:
				await check_stride(kind, render_hz, direction)
	await check_turn()
	print("ILLUSTRATED_INTERPOLATION_PASS checks=%d (slow input, acceleration, depth movement, freeze at 120/240 Hz)" % checks)
	quit()

func check_stride(kind: String, render_hz: int, direction: int) -> void:
	var actor := FBActor.new()
	actor.kind = kind
	actor.state.change("move")
	var visual := FBIllustratedActor.new()
	actor.add_child(visual)
	root.add_child(actor)
	visual.set_process(false)
	actor.facing = direction
	visual.facing_visual = direction
	var frames_per_tick := render_hz / 60
	var phase := 0.0
	var prior_sample := 0.0
	var stride_length := FBIllustratedActor.stride_distance(kind)
	var rig_scale := 1.42 if kind == "boss" else (0.96 if kind == "grunt" else 1.0)
	var planted_x: float = visual.pose.rear_foot.x * rig_scale * direction
	for tick in 24:
		# 同一场景覆盖慢摇杆、渐起步及纯纵深位移；这些速度都不等于角色 speed。
		var displacement := Vector2(0.16 + tick * 0.04, 0) if tick < 16 else Vector2(0, 0.2)
		displacement.x *= direction
		var old_phase := phase
		phase += displacement.length() / stride_length * TAU
		actor.previous_position = actor.position
		actor.position += displacement
		actor.visual_tick += 1
		actor.state.frame += 1
		for subframe in frames_per_tick:
			visual._process(1.0 / render_hz)
			var fraction := float(subframe + 1) / frames_per_tick
			var expected_phase := lerpf(old_phase, phase, fraction)
			assert(visual.global_position.distance_to(actor.previous_position.lerp(actor.position, fraction)) < 0.0001, "Visual feet must interpolate adjacent world positions")
			if tick < 16:
				assert(absf(visual.global_position.x + visual.pose.rear_foot.x * rig_scale * direction - planted_x) < 0.001, "Planted foot slides in world space")
			var expected := FBIllustratedActor.sample_pose("move", actor.state.frame - 1.0 + fraction, actor.state.definition(), expected_phase, kind)
			assert((visual.pose.rear_foot as Vector2).distance_to(expected.rear_foot) < 0.0001, "%s %dHz rear foot moved faster than measured displacement" % [kind, render_hz])
			assert((visual.pose.front_foot as Vector2).distance_to(expected.front_foot) < 0.0001, "%s %dHz front foot phase diverged" % [kind, render_hz])
			# 当前测试始终处于同一支撑阶段，后脚应持续向后，tick 边界不能反弹。
			if checks > 0 and prior_sample != 0.0:
				assert(visual.pose.rear_foot.x <= prior_sample + 0.0001, "Stride reversed at logical tick boundary")
			prior_sample = visual.pose.rear_foot.x
			checks += 1
	var frozen_pose: Dictionary = visual.pose.duplicate(true)
	for i in 6:
		visual._process(1.0 / render_hz)
		assert(visual.pose.rear_foot == frozen_pose.rear_foot and visual.pose.front_foot == frozen_pose.front_foot, "Hitstop advanced gait without a logical tick")
		checks += 1
	actor.queue_free()
	await process_frame

func check_turn() -> void:
	var actor := FBActor.new()
	var visual := FBIllustratedActor.new()
	actor.add_child(visual)
	root.add_child(actor)
	visual.set_process(false)
	for tick in 12:
		actor.tick({"move": Vector2.RIGHT})
		visual._process(1.0 / 60)
	var last_hand: Vector2 = visual.global_position + Vector2(visual.pose.hand.x * visual.facing_visual, visual.pose.hand.y)
	for tick in 7:
		actor.tick({"move": Vector2.LEFT})
		for subframe in 2:
			visual._process(1.0 / 120)
			var hand: Vector2 = visual.global_position + Vector2(visual.pose.hand.x * visual.facing_visual, visual.pose.hand.y)
			assert(hand.distance_to(last_hand) < 15, "Facing change teleported the sword hand")
			last_hand = hand
			checks += 1
	assert(visual.facing_visual == -1 and visual.turn_age >= 0.075, "Turn must finish in the responsive five-tick window")
	visual.facing_visual = actor.facing
	visual.turn_age = 1.0
	visual.action = "slash2"
	visual.pose.blade = 5.3
	actor.state.change("slash3")
	actor.state.frame = 1
	actor.visual_tick += 1
	visual._process(1.0 / 120)
	assert(absf(angle_difference(5.3, visual.pose.blade)) < 0.12, "Combo transition takes a full reverse rotation across the angle wrap")
	checks += 1
	actor.queue_free()
	await process_frame
