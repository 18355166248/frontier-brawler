extends SceneTree
## 独立进程验证待领奖持久化；人工清场只用于隔离结算，不代替完整通关测试。
const PATH := "res://output/loot-roundtrip/progress.json"
func _initialize() -> void:
	call_deferred("run_check")
func run_check() -> void:
	var writing := "--write-loot" in OS.get_cmdline_user_args()
	DirAccess.make_dir_recursive_absolute("res://output/loot-roundtrip")
	if writing:
		for suffix in ["", ".bak", ".tmp"]:
			if FileAccess.file_exists(PATH + suffix): DirAccess.remove_absolute(PATH + suffix)
	var game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.audio.muted = true
	if writing:
		game.run.start()
		game.run.room_index = FBData.room_index("boss")
		game.run.enter_room({})
		game.run.combat.kills = 28
		game.run.total_perfect = 20
		game.room.hero.perfect_count = 7
		for actor in game.room.actors:
			if actor.kind != "hero": actor.hp = 0
		for i in 40: game.run.step({})
		assert(game.run.phase == "loot" and game.run.progress.data.checkpoint.phase == "loot")
		print("LOOT_WRITE_PASS")
	else:
		assert(game.run.can_resume())
		game.run.resume()
		assert(game.run.phase == "loot" and game.room.alive_enemies() == 0)
		assert(game.run.combat.kills == 28 and game.run.total_perfect == 27 and game.room.hero.perfect_count == 0)
		game.run.claim_loot("scout-coat")
		game.run.claim_loot("scout-coat")
		assert(game.run.completions == 1 and game.run.progress.data.checkpoint.is_empty())
		var saved := FBProgressStore.new()
		saved.path = PATH
		saved.persistent = true
		saved.load_progress()
		assert(saved.data.completions == 1 and saved.data.checkpoint.is_empty())
		assert(saved.data.equipped == "scout-coat" and saved.data.unlocked.has("scout-coat"))
		print("LOOT_READ_PASS")
	game.audio.stop()
	game.free()
	await process_frame
	await create_timer(0.3).timeout
	quit()
