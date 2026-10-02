extends SceneTree

func _init() -> void:
	var samples := 0
	for hero in [true, false]:
		var actions: Dictionary = FBData.all()["player_actions" if hero else "enemy_actions"]
		for id in actions:
			var definition: Dictionary = actions[id]
			for step in int(definition.frames) * 4:
				var frame := step / 4.0
				var pose := FBIllustratedActor.sample_pose(id, frame, definition, frame / 33 * TAU, "hero" if hero else "boss")
				for key in ["hip", "chest", "head", "rear_foot", "front_foot", "hand", "rear_hand"]:
					assert(pose[key] is Vector2 and (pose[key] as Vector2).is_finite(), "%s:%s has invalid joint" % [id, key])
				assert(is_finite(pose.blade), "%s invalid blade angle" % id)
				samples += 1
	# 一个完整步态中始终有一只支撑脚，且抬脚期和落脚期交替，不能双脚贴地滑行。
	var front_flight := false
	var rear_flight := false
	for i in 120:
		var phase := i / 120.0
		var rear := FBIllustratedActor.stride_foot(phase, 19.5)
		var front := FBIllustratedActor.stride_foot(fposmod(phase + 0.5, 1.0), 19.5)
		assert(rear.y == 0 or front.y == 0, "Both feet leave support during walking")
		front_flight = front_flight or front.y < -10
		rear_flight = rear_flight or rear.y < -10
	assert(front_flight and rear_flight, "Both legs must have distinct swing phases")
	# 连续关节采样须无帧边界跳变，且非线性出刀必须跨越足够角度。
	for id in ["slash", "slash2", "slash3", "skill", "execute", "airSlash"]:
		var d := FBData.action(id, true)
		var previous := FBIllustratedActor.sample_pose(id, 0, d, 0)
		var angles: Array[float] = []
		for i in int(d.frames) * 8:
			var p := FBIllustratedActor.sample_pose(id, i / 8.0, d, 0)
			assert((p.hand as Vector2).distance_to(previous.hand) < 9, "%s hand discontinuity" % id)
			angles.append(p.blade)
			previous = p
		assert(angles.max() - angles.min() > 1.0, "%s sword has no readable arc" % id)
	print("ILLUSTRATED_POSE_PASS: %d quarter-frame samples; continuous strikes; alternating grounded stride" % samples)
	quit()
