extends SceneTree
## 使用正式角色场景，验证锚点、原战斗窗口、定格、中断和死亡生命周期。
var checks := 0
const ACTOR := preload("res://scenes/actor.tscn")

func _initialize() -> void:
	call_deferred("run")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok, message)

func step(hero: FBActor, input: Dictionary = {}) -> void:
	hero.tick(input)
	hero.get_node("Visual")._process(1.0 / 60.0)

func run() -> void:
	var hero: FBActor = ACTOR.instantiate()
	hero.position = Vector2(300, 430)
	root.add_child(hero)
	var visual: FBWuduHeroVisual = hero.get_node("Visual")
	visual.set_process(false)
	check(visual.uses_pack and visual.animations.size() == 12, "main actor enables exactly 12 pack actions")
	var count := 0
	for id in visual.animations:
		var art: Dictionary = visual.animations[id]
		var duration := 0
		for frame in art.frames:
			duration += int(frame.duration_ms)
			count += 1
		check(duration == int(art.duration_ms), id + " retains exact source frame durations")
		check(art.loop == (id in ["idle", "move"]), id + " loop contract")
		check((visual.sheets[id] as Texture2D).get_size() == Vector2(art.frame_count * 640, 640), id + " atlas imported")
	check(count == 66, "66 body frames")
	for direction in [-1, 1]:
		hero.facing = direction
		visual._process(0)
		check(visual.body_root.to_global(Vector2.ZERO).distance_to(hero.position) < 0.001, "mirroring retains world pivot")
		check(visual.body.offset == -visual.PIVOT and not visual.body.flip_h, "noncentral pivot belongs to mirrored parent")
	for i in 18:
		step(hero, {"move": Vector2(0.2, 0)})
	check(visual.movement_speed_scale < 0.25 and visual.pack_action == "move", "slow movement slows art cycle")
	step(hero, {"attack": true})
	check(hero.state.id == "slash" and visual.pack_action == "slash" and visual.movement_speed_scale == 1.0, "attack restores independent timing after slow move")
	for id in ["slash", "slash2", "slash3", "airSlash", "skill", "execute"]:
		hero.state.change(id)
		var box: Dictionary = hero.state.definition().hitboxes[0]
		hero.state.frame = int(box.activeFrom)
		hero.visual_tick += 1
		visual._process(1.0 / 60)
		check(visual.pack_action == id and visual.pack_frame == 2 and visual.trail.visible, id + " cut pose and trail match original hitbox start")
		var frozen := [visual.pack_frame, visual.pack_time_ms, visual.trail.modulate.a, visual.body_root.position, visual.position]
		for i in 12:
			visual._process(1.0 / 120)
		check(frozen == [visual.pack_frame, visual.pack_time_ms, visual.trail.modulate.a, visual.body_root.position, visual.position], id + " hitstop freezes body and trail")
	# 相同 slash 重起，及一串提前取消都必须立刻清掉旧刀光/尘土。
	hero.state.change("slash")
	hero.state.frame = 8
	hero.visual_tick += 1
	visual._process(1.0 / 60)
	check(visual.trail.visible, "slash trail active before interruption")
	hero.state.change("slash")
	hero.visual_tick += 1
	visual._process(1.0 / 60)
	check(visual.pack_frame == 0 and not visual.trail.visible, "same action restart stops prior trail")
	for i in 10:
		hero.state.change("dash")
		hero.state.frame = 1
		hero.visual_tick += 1
		visual._process(1.0 / 60)
		check(visual.dust.visible, "dash starts dust")
		hero.state.frame = 12
		step(hero, {"attack": true})
		check(hero.state.id == "slash" and not visual.dust.visible and not visual.trail.visible, "original dash cancel stops old effects")
	# 跳跃仍在原27帧落地，素材自己的抬升不加第二遍。
	hero.state.buffers.clear()
	hero.state.change("idle")
	hero.jump_cooldown = 0
	step(hero, {"jump": true})
	for i in 15:
		step(hero)
	var art_frame: Dictionary = visual.animations.jump.frames[visual.pack_frame]
	check(is_equal_approx(visual.body_root.position.y, float(art_frame.art_lift_px) * visual.ART_SCALE - hero.visual_height), "jump compensates baked art lift")
	step(hero, {"attack": true})
	check(hero.state.id == "airSlash" and visual.pack_action == "airSlash", "original jump cancel enters air slash")
	while hero.state.frame < 16:
		step(hero)
	check(hero.visual_height == 0 and visual.dust.visible, "original airSlash landing emits ground dust")
	step(hero, {"attack": true})
	check(hero.state.id == "slash" and not visual.dust.visible, "landing cancel removes old dust")
	hero.hp = 0
	hero.state.change("hit")
	for i in 30:
		step(hero)
	check(visual.pack_action == "death" and is_equal_approx(visual.modulate.a, 1.0), "death holds full opacity for first500ms")
	for i in 6:
		step(hero)
	check(is_equal_approx(visual.modulate.a, 0.5), "death fades during final200ms")
	for i in 30:
		step(hero)
	check(visual.pack_action == "death" and visual.pack_frame == 4 and visual.modulate.a == 0, "death never returns to idle")
	hero.free()
	for kind in ["grunt", "boss", "hero"]:
		var actor: FBActor = ACTOR.instantiate()
		actor.kind = kind
		if kind == "hero":
			actor.get_node("Visual").use_wudu_hero = false
		root.add_child(actor)
		var original: FBWuduHeroVisual = actor.get_node("Visual")
		check(not original.uses_pack and original.body == null and not original.pose.is_empty(), kind + " retains original illustrated renderer")
		actor.free()
	hero = ACTOR.instantiate()
	root.add_child(hero)
	check(hero.get_node("Visual").pack_action == "idle" and hero.get_node("Visual").modulate.a == 1, "fresh hero starts visible with no death/effects residue")
	hero.free()
	for fault in ["bad-animation", "bad-effects", "bad-schema", "missing-texture"]:
		await check_broken_pack(fault)
	print("WUDU_HERO_CHECKS_PASS checks=", checks)
	quit()

func check_broken_pack(fault: String) -> void:
	# 只在被忽略的 output/ 构造损坏副本，永不改动正式素材。
	var source := FBWuduHeroVisual.PACK
	var copy := "res://output/wudu-import/invalid-pack/" + fault + "/"
	DirAccess.make_dir_recursive_absolute(copy + "sheets")
	DirAccess.make_dir_recursive_absolute(copy + "effects")
	for directory in ["", "sheets/", "effects/"]:
		for file in DirAccess.get_files_at(source + directory):
			assert(DirAccess.copy_absolute(source + directory + file, copy + directory + file) == OK, "copy isolated fault fixture")
	var damaged := "effects.json" if fault == "bad-effects" else "animation.json"
	if fault in ["bad-animation", "bad-effects"]:
		var file := FileAccess.open(copy + damaged, FileAccess.WRITE)
		file.store_string("{broken json")
		file.close()
	elif fault == "bad-schema":
		var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(copy + damaged))
		data.animations.slash.frames[0].erase("art_lift_px")
		var file := FileAccess.open(copy + damaged, FileAccess.WRITE)
		file.store_string(JSON.stringify(data))
		file.close()
	else:
		check(DirAccess.remove_absolute(copy + "sheets/idle.png") == OK, "remove isolated idle texture")
	var actor: FBActor = ACTOR.instantiate()
	var visual: FBWuduHeroVisual = actor.get_node("Visual")
	visual.pack_directory = copy
	root.add_child(actor)
	visual.set_process(false)
	check(not visual.uses_pack and visual.body == null and not visual.pose.is_empty(), fault + " switches wholly to illustrated hero")
	for i in 40:
		step(actor, {"attack": i == 0, "move": Vector2.RIGHT})
	check(not visual.pose.is_empty() and visual.modulate.a == 1 and actor.position.x > 0, fault + " fallback still ticks and draws without null access")
	actor.free()
	await process_frame
