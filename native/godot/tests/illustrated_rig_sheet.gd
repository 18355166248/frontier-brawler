extends SceneTree

func _init() -> void:
	call_deferred("run")

func run() -> void:
	root.content_scale_size = Vector2i(1280, 760)
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	root.size = Vector2i(1280, 760)
	var background := ColorRect.new()
	background.color = Color("d0d0b9")
	background.size = Vector2(1280, 760)
	root.add_child(background)
	var entries := [
		["hero", "idle", 0, 0.0, "THE WANDERER"], ["hero", "move", 10, 1.1, "RUN / SUPPORT"],
		["hero", "slash", 9, 0.0, "SWORD / RELEASE"], ["hero", "slash3", 2, 0.0, "HEAVY / WINDUP"],
		["grunt", "idle", 0, 0.0, "ASH BANDIT"], ["hero", "jump", 14, 0.0, "JUMP / TUCK"],
		["boss", "idle", 0, 0.0, "THE BRONZE WARDEN"], ["boss", "bossSlam", 43, 0.0, "WARDEN / SLAM"]]
	for i in entries.size():
		var entry: Array = entries[i]
		var actor := FBActor.new()
		actor.kind = entry[0]
		actor.position = Vector2(155 + (i % 4) * 320, 335 + (i / 4) * 350)
		actor.scale = Vector2.ONE * 1.8
		var visual := FBIllustratedActor.new()
		actor.add_child(visual)
		root.add_child(actor)
		actor.facing = 1
		actor.state.change(entry[1])
		actor.state.frame = entry[2]
		visual.set_process(false)
		visual.facing_visual = 1
		visual.render_frame = entry[2]
		visual.pose = FBIllustratedActor.sample_pose(entry[1], entry[2], actor.state.definition(), entry[3], entry[0])
		visual.pose.cloth_time = 1.2
		visual.queue_redraw()
		var title := Label.new()
		title.text = entry[4]
		title.position = Vector2(25 + (i % 4) * 320, 24 + (i / 4) * 350)
		title.add_theme_font_size_override("font_size", 14)
		title.add_theme_color_override("font_color", Color("334c4d"))
		root.add_child(title)
	await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	# 全新检出没有被忽略的 output 目录，先创建并检查写入结果，避免误报截图成功。
	var directory_error := DirAccess.make_dir_recursive_absolute("res://output")
	if directory_error != OK:
		push_error("Cannot create illustration output directory: %s" % directory_error)
		quit(1)
		return
	var save_error := image.save_png("res://output/illustrated_rig_sheet.png")
	if save_error != OK:
		push_error("Cannot save illustrated rig sheet: %s" % save_error)
		quit(1)
		return
	print("ILLUSTRATED_RIG_SHEET_SAVED")
	quit()
