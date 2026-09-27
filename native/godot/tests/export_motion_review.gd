extends SceneTree

func _initialize() -> void:
	var sheet: Dictionary = FBData.all().sheets.hero
	var states := ["idle", "move", "slash", "slash2", "slash3"]
	for legacy in [true, false]:
		var root := "res://output/motion-review-source/" + ("before" if legacy else "after")
		DirAccess.make_dir_recursive_absolute(root)
		DirAccess.copy_absolute(sheet.path, root + "/hero.png")
		var frames: Array = []
		var tags: Array = []
		var recipe_states: Array = []
		for id in states:
			var definition := FBData.action(id, true)
			var begin := frames.size()
			var previous := -1
			var held_ticks := 0
			for tick in int(definition.frames):
				var pose := FBAnimationPose.sample(id, tick, definition, legacy)
				var row: int = sheet.rows.find(pose.action)
				var cell := row * 4 + int(pose.column)
				if cell != previous:
					if held_ticks > 0:
						frames[-1].duration = roundi(held_ticks * 1000.0 / 60.0)
					held_ticks = 0
					frames.append({"filename": str(frames.size()), "frame": {"x": int(pose.column) * 96, "y": row * 96, "w": 96, "h": 96}, "duration": 1, "trimmed": false, "rotated": false})
					previous = cell
				held_ticks += 1
			frames[-1].duration = roundi(held_ticks * 1000.0 / 60.0)
			tags.append({"name": id, "from": begin, "to": frames.size() - 1, "direction": "forward"})
			recipe_states.append({"name": id, "loop": definition.get("loop", false)})
		write_json(root + "/aseprite.json", {"frames": frames, "meta": {"image": "hero.png", "frameTags": tags}})
		write_json(root + "/recipe.json", {"version": 1, "kind": "motion", "title": "Frontier 主角 · " + ("原播放" if legacy else "收招修正") + "（仅姿态与时间）", "cell": [96, 96], "anchor": [0.5, 0.9375], "resample": "nearest", "states": recipe_states, "source": {"provider": "godot-runtime-sampler", "note": "hero-v2 原素材 + FBAnimationPose 实际采样；不含角色位移/腾空/命中反馈"}})
	print("MOTION_REVIEW_EXPORTED")
	quit()

func write_json(path: String, data: Dictionary) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(JSON.stringify(data, "\t") + "\n")
