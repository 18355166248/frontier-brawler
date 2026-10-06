class_name FBEnemyRosterVisual
extends FBCopperGuardVisual
## 三基础怪物使用统一脚底画布；英雄、Boss 与坏包回退仍沿用父类。

const ENEMY_PACK := "res://assets/enemy-roster-v2/"
@export var use_enemy_roster := true
@export_dir var enemy_pack_directory := ENEMY_PACK
var uses_enemy_pack := false
var enemy_animations: Dictionary = {}
var enemy_sheets: Dictionary = {}
var enemy_root: Node2D
var enemy_body: Sprite2D
var enemy_action := ""
var enemy_frame := 0
var enemy_time_ms := 0.0
var enemy_loop_ms := 0.0
var enemy_previous_loop_ms := 0.0
var enemy_previous_state_frame := -1

func _ready() -> void:
	super._ready()
	if actor.kind not in ["grunt", "archer", "mage"] or not use_enemy_roster or "--illustrated-enemies" in OS.get_cmdline_user_args():
		return
	if not load_enemy_pack():
		push_warning("Enemy pack invalid; falling back to illustrated enemy: " + actor.kind)
		return
	enemy_root = Node2D.new()
	add_child(enemy_root)
	enemy_body = Sprite2D.new()
	enemy_body.centered = false
	enemy_body.offset = -BOSS_PIVOT
	enemy_body.region_enabled = true
	enemy_body.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	enemy_root.add_child(enemy_body)
	uses_enemy_pack = true
	last_tick = actor.visual_tick
	_process(0)

func load_enemy_pack() -> bool:
	var directory := enemy_pack_directory.path_join(actor.kind)
	var path := directory.path_join("animation.json")
	if not FileAccess.file_exists(path):
		return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary or parsed.get("version") != 1 or parsed.get("kind") != actor.kind or not numbers_match(parsed.get("canvas_px"), [640, 640]) or not numbers_match(parsed.get("pivot_px"), [308, 560]) or parsed.get("art_scale") != 0.30 or parsed.get("stride_world_px") != 58 or not parsed.get("animations") is Dictionary:
		return false
	var required := ["idle", "move", "hit", "death"]
	required.append_array(["archerAim", "archerShoot"] if actor.kind == "archer" else (["lanternCast"] if actor.kind == "mage" else ["slash"]))
	var candidates: Dictionary = parsed.animations
	var textures: Dictionary = {}
	# 整套动作与贴图先验证，成功后一次启用；坏包不能把旧怪物遮成空白。
	for id in required:
		if not candidates.get(id) is Dictionary:
			return false
		var a: Dictionary = candidates[id]
		if a.get("sheet") != id + ".png" or not a.get("frames") is Array or a.frames.is_empty() or a.frames.size() > 16 or a.get("frame_count") != a.frames.size() or a.get("loop") != (id in ["idle", "move"]):
			return false
		var total := 0.0
		for i in a.frames.size():
			var f = a.frames[i]
			if not f is Dictionary or not numbers_match(f.get("rect_px"), [i * 640, 0, 640, 640]) or not is_number(f.get("duration_ms")) or f.duration_ms <= 0:
				return false
			total += float(f.duration_ms)
		if not is_number(a.get("duration_ms")) or float(a.duration_ms) != total:
			return false
		if id == "slash" and not numbers_match(a.get("impact_ms"), [133, 217]):
			return false
		var file := directory.path_join(a.sheet)
		if not ResourceLoader.exists(file, "Texture2D"):
			return false
		var texture := load(file) as Texture2D
		if texture == null or texture.get_size() != Vector2(640 * a.frames.size(), 640):
			return false
		textures[id] = texture
	if float(candidates.death.duration_ms) > 600:
		return false
	enemy_animations = candidates
	enemy_sheets = textures
	return true

func _process(delta: float) -> void:
	if not uses_enemy_pack:
		super._process(delta)
		return
	var next: String = "death" if actor.is_dead() else (actor.state.id if enemy_animations.has(actor.state.id) else "idle")
	var progressed := actor.visual_tick != last_tick
	if enemy_action != next or (progressed and next not in ["idle", "move", "death"] and actor.state.frame < enemy_previous_state_frame):
		enemy_action = next
		enemy_loop_ms = 0.0
		enemy_previous_loop_ms = 0.0
	if progressed:
		enemy_previous_loop_ms = enemy_loop_ms
		if next == "move":
			enemy_loop_ms += actor.position.distance_to(last_position) / 58.0 * float(enemy_animations.move.duration_ms)
		elif next == "idle":
			enemy_loop_ms += maxi(1, actor.visual_tick - last_tick) * 1000.0 / 60.0
		last_position = actor.position
		last_tick = actor.visual_tick
		enemy_previous_state_frame = actor.state.frame
		tick_fraction = 0.0
	# 渲染只插值两个已完成逻辑帧，暂停/定格不会偷偷推进动画或远程事件。
	tick_fraction = minf(1, tick_fraction + maxf(0, delta) * 60)
	position = actor.previous_position.lerp(actor.position, tick_fraction) - actor.position if actor.visual_tick > 0 else Vector2.ZERO
	render_lift = lerpf(actor.previous_visual_height, actor.visual_height, tick_fraction)
	render_frame = maxf(0, actor.state.frame - 1.0 + tick_fraction)
	var a: Dictionary = enemy_animations[next]
	if next in ["idle", "move"]:
		enemy_time_ms = lerpf(enemy_previous_loop_ms, enemy_loop_ms, tick_fraction)
	elif next == "death":
		enemy_time_ms = maxf(0, actor.dead_frames - 1.0 + tick_fraction) * 1000.0/60.0
	else:
		enemy_time_ms = remap(render_frame, 0, actor.state.definition().frames, 0, a.duration_ms)
		if next == "slash":
			var box: Dictionary = actor.state.definition().hitboxes[0]
			if render_frame < box.activeFrom:
				enemy_time_ms = remap(render_frame, 0, box.activeFrom, 0, 133)
			elif render_frame < box.activeTo:
				enemy_time_ms = remap(render_frame, box.activeFrom, box.activeTo, 133, 217)
			else:
				enemy_time_ms = remap(render_frame, box.activeTo, actor.state.definition().frames, 217, a.duration_ms)
	enemy_frame = frame_at(a.frames, fposmod(enemy_time_ms, float(a.duration_ms)) if a.loop else enemy_time_ms)
	var rect: Array = a.frames[enemy_frame].rect_px
	enemy_body.texture = enemy_sheets[next]
	enemy_body.region_rect = Rect2(rect[0], rect[1], rect[2], rect[3])
	enemy_root.scale = Vector2(actor.facing * 0.30, 0.30)
	enemy_root.position.y = -render_lift
	modulate.a = 1.0
	queue_redraw()

func _draw() -> void:
	if not uses_enemy_pack:
		super._draw()
		return
	_draw_shadow(1)
	_draw_telegraph()
	if not actor.is_dead():
		_draw_health(1)
