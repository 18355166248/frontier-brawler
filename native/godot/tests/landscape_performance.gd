extends SceneTree
## 实时主循环测量：保留主场景自动 60 Hz 物理，不采用录像的固定帧离线时钟。
var game: Control
var frame_samples: Array[float] = []
var recording := false
var tick := 0

func _initialize() -> void:
	Engine.max_fps = 60
	call_deferred("measure")

func _process(delta: float) -> bool:
	if recording:
		frame_samples.append(delta * 1000)
	return false

func _physics_process(_delta: float) -> bool:
	if recording:
		tick += 1
		game.controls.pending.attack = tick % 10 == 0
		game.controls.joystick_id = 99
		game.controls.movement = Vector2.RIGHT * 0.12
	return false

func measure() -> void:
	DirAccess.make_dir_recursive_absolute("res://output")
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game._command("start")
	game.run.room_index = 2
	game.run.enter_room({})
	game.room.hero.position = Vector2(600, 450)
	game.room.hero.previous_position = game.room.hero.position
	# 仅延长性能样本；玩家与三名敌人走真实 AI/战斗/受击路径，不用于平衡或通关证明。
	for actor in game.room.actors:
		actor.hp = 100000
		actor.max_hp = 100000
	game.run.paused = false
	game.controls.enabled = true
	await create_timer(1.0).timeout
	recording = true
	await create_timer(12.0).timeout
	recording = false
	frame_samples.sort()
	var total := 0.0
	for sample in frame_samples:
		total += sample
	var report := {"environment": "Apple M2 macOS GL Compatibility, 1280x720, cap 60 FPS", "actors": game.room.actors.size(), "samples": frame_samples.size(), "physics_ticks": tick, "mean_frame_ms": total / frame_samples.size(), "p95_frame_ms": frame_samples[int(frame_samples.size() * 0.95)], "peak_frame_ms": frame_samples[-1], "duration_seconds": 12, "static_memory_mb": OS.get_static_memory_usage() / 1048576.0}
	var file := FileAccess.open("res://output/mistward-live-performance.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "\t"))
	print("LANDSCAPE_LIVE_PERFORMANCE ", JSON.stringify(report))
	assert(tick >= 690 and frame_samples.size() >= 690, "First level must sustain near 60 FPS at its four-actor maximum")
	game.audio.stop()
	game.queue_free()
	await process_frame
	await create_timer(0.3).timeout
	quit()
