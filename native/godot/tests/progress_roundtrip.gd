extends SceneTree
## 两次独立引擎进程读写，避免只用同一对象证明跨重启持久化。
func _initialize() -> void:
	call_deferred("run_check")
func run_check() -> void:
	var writing := "--write-progress" in OS.get_cmdline_user_args()
	var path := "res://output/progress-roundtrip/data.json"
	DirAccess.make_dir_recursive_absolute("res://output/progress-roundtrip")
	if writing:
		for suffix in ["", ".bak", ".tmp"]:
			if FileAccess.file_exists(path + suffix): DirAccess.remove_absolute(path + suffix)
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	if writing:
		game.run.progress.path = path
		game.run.progress.persistent = true
		game.run.start()
		for relic in FBProgressStore.RELICS:
			game.run.set_phase("loot")
			game.run.claim_loot(relic)
		game.run.start()
		game.run.upgrade = "arcane"
		game.run.room_index = 2
		game.run.enter_room({"hp":121,"energy":48})
		game.run.progress.data.muted = true
		game.run.progress.data.reduced_motion = true
		assert(game.run.progress.save_progress())
		print("PROGRESS_WRITE_PASS")
	else:
		assert(game.run.completions == 3)
		assert(game.run.progress.data.completions == 3 and game.run.progress.data.unlocked.size() == 3)
		assert(game.run.progress.data.muted and game.run.progress.data.reduced_motion)
		assert(game.run.can_resume())
		game.run.resume()
		assert(game.run.upgrade == "arcane" and game.room.hero.hp == 121 and game.room.hero.energy == 48)
		assert(game.room.alive_enemies() == 8)
		print("PROGRESS_READ_PASS")
	game.audio.stop()
	game.free()
	await process_frame
	await create_timer(0.3).timeout
	quit()
