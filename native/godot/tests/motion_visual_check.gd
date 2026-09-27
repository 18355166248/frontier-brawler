extends SceneTree

func _initialize() -> void:
	call_deferred("capture")

func capture() -> void:
	var lab = load("res://scenes/motion_lab.tscn").instantiate()
	root.add_child(lab)
	lab.set_physics_process(false)
	DirAccess.make_dir_recursive_absolute("res://output/motion-review")
	for config in [["jump-chain", 19, "jump-cancel"], ["jump-chain", 34, "landing"], ["slash", 23, "recovery"], ["move", 9, "walk"]]:
		lab.select_mode(config[0])
		for i in int(config[1]):
			lab.step_once()
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://output/motion-review/" + config[2] + ".png")
	print("MOTION_VISUAL_CAPTURE_PASS")
	lab.queue_free()
	await process_frame
	quit()
