extends SceneTree

func _initialize() -> void:
	call_deferred("capture")

func capture() -> void:
	var lab = load("res://scenes/motion_lab.tscn").instantiate()
	root.add_child(lab)
	lab.set_physics_process(false)
	DirAccess.make_dir_recursive_absolute("res://output/all-motion-review")
	var captured := 0
	for kind in lab.MODES:
		lab.select_kind(kind)
		for item in lab.MODES[kind]:
			lab.select_mode(item[1])
			var milestones: Array = [7, 19, 45]
			if item[1] not in ["combo", "jump-chain", "boss-chain", "death"]:
				var definition := FBData.action(item[1], kind == "hero")
				for box in definition.hitboxes:
					milestones.append(maxi(0, int(box.activeFrom) - 1))
					milestones.append(int(box.activeTo) - 2)
			elif item[1] == "boss-chain":
				milestones.append(24)
			for tick in 90:
				lab.step_once()
				if tick in milestones:
					await process_frame
					await RenderingServer.frame_post_draw
					root.get_texture().get_image().save_png("res://output/all-motion-review/%s-%s-%02d.png" % [kind, item[1], tick + 1])
					captured += 1
	# 使用实际控件信号验证暂停/逐帧按钮，不冒充系统键鼠验收。
	lab.select_kind("hero")
	lab.select_mode("move")
	for child in lab.get_children():
		if child is Button and child.text == "前进一帧":
			child.pressed.emit()
	assert(lab.clock == 1 and not lab.playing)
	print("ALL_MOTION_VISUAL_PASS screenshots=", captured, " scenarios=24")
	lab.queue_free()
	await process_frame
	quit()
