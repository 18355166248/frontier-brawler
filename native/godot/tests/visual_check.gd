extends SceneTree

var game: Control

func _initialize() -> void:
	call_deferred("capture")

func shot(name: String) -> void:
	await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	image.save_png("res://output/" + name + ".png")

func capture() -> void:
	DirAccess.make_dir_recursive_absolute("res://output")
	root.size = Vector2i(1280, 720)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	await create_timer(0.6).timeout
	await shot("home")
	game._command("start")
	game.run.advance_room()
	game.room.hero.position = Vector2(410, 410)
	await create_timer(1.0).timeout
	game.run.paused = false
	await shot("combat")
	game.run.room_index = 3
	game.run.enter_room({})
	await shot("reward")
	game.run.choose_upgrade("guardian")
	game.run.advance_room()
	game.room.hero.position = Vector2(430, 400)
	await create_timer(1.0).timeout
	await shot("boss")
	game._command("stress")
	await create_timer(1.0).timeout
	game.run.paused = false
	game.frame_samples.clear()
	await create_timer(12.0).timeout
	await shot("stress")
	var samples: Array[float] = game.frame_samples.duplicate()
	samples.sort()
	var sum := 0.0
	for value in samples:
		sum += value
	var result := {"environment": "macOS desktop GL Compatibility; not mobile", "actors": game.room.actors.size(), "samples": samples.size(), "mean_frame_ms": sum / max(1, samples.size()), "p95_frame_ms": samples[int(samples.size() * 0.95)] if not samples.is_empty() else 0, "static_memory_mb": OS.get_static_memory_usage() / 1048576.0}
	var file := FileAccess.open("res://output/render-performance.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(result, "\t") + "\n")
	print("RENDER_PERFORMANCE ", JSON.stringify(result))
	game.queue_free()
	await process_frame
	quit()
