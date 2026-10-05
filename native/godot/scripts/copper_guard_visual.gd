class_name FBCopperGuardVisual
extends FBWuduHeroVisual
## Boss-only raster presentation. Hero pack and grunt renderer stay on their existing paths.

const BOSS_PACK := "res://assets/copper-guard-v2/"
const BOSS_PIVOT := Vector2(308, 560)
const BOSS_SCALE := 0.38
const BOSS_COUNTS := {"idle": 4, "move": 8, "slam": 6, "charge": 5, "rush": 5,
	"nova": 6, "summon": 5, "hit": 6, "death": 4, "sweep": 6}
const BOSS_STATES := {"idle": "idle", "move": "move", "bossSlam": "slam", "bossCharge": "charge",
	"bossRush": "rush", "bossNova": "nova", "bossSummon": "summon", "hit": "hit"}
@export var use_copper_guard := true
@export_dir var boss_pack_directory := BOSS_PACK
var uses_boss_pack := false
var boss_animations: Dictionary = {}
var boss_sheets: Dictionary = {}
var boss_root: Node2D
var boss_body: Sprite2D
var boss_action := ""
var boss_frame := 0
var boss_time_ms := 0.0
var boss_loop_ms := 0.0
var boss_previous_loop_ms := 0.0
var boss_previous_state_frame := -1

func _ready() -> void:
	super._ready()
	if actor.kind != "boss" or not use_copper_guard or "--illustrated-boss" in OS.get_cmdline_user_args():
		return
	if not load_boss_pack():
		push_warning("Copper guard pack invalid; using original illustrated boss.")
		return
	# Enable only after all states and all textures are validated atomically.
	boss_root = Node2D.new()
	add_child(boss_root)
	boss_body = Sprite2D.new()
	boss_body.centered = false
	boss_body.offset = -BOSS_PIVOT
	boss_body.region_enabled = true
	boss_body.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	boss_root.add_child(boss_body)
	uses_boss_pack = true
	last_tick = actor.visual_tick
	_process(0.0)

func load_boss_pack() -> bool:
	var path := boss_pack_directory.path_join("animation.json")
	if not FileAccess.file_exists(path):
		return false
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK or not parser.data is Dictionary:
		return false
	var manifest: Dictionary = parser.data
	if not numbers_match(manifest.get("canvas_px"), [640, 640]) or not numbers_match(manifest.get("pivot_px"), [308, 560]) or manifest.get("art_scale") != BOSS_SCALE or manifest.get("stride_world_px") != 60 or not manifest.get("animations") is Dictionary:
		return false
	var candidates: Dictionary = manifest.animations
	if candidates.size() != BOSS_COUNTS.size():
		return false
	var textures: Dictionary = {}
	for id in BOSS_COUNTS:
		if not candidates.get(id) is Dictionary:
			return false
		var a: Dictionary = candidates[id]
		if a.get("sheet") != id + ".png" or a.get("frame_count") != BOSS_COUNTS[id] or not a.get("frames") is Array or a.frames.size() != BOSS_COUNTS[id] or a.get("loop") != (id in ["idle", "move"]):
			return false
		var total := 0.0
		for i in a.frames.size():
			var f = a.frames[i]
			if not f is Dictionary or not numbers_match(f.get("rect_px"), [i * 640, 0, 640, 640]) or not is_number(f.get("duration_ms")) or f.duration_ms <= 0:
				return false
			total += float(f.duration_ms)
		if not is_number(a.get("duration_ms")) or a.duration_ms != total:
			return false
		if id in ["slam", "nova", "rush"]:
			if not numbers_match(a.get("impact_ms"), [500, 610] if id == "slam" else ([500, 600] if id == "nova" else [0, 280])):
				return false
		var texture_path := boss_pack_directory.path_join(a.sheet)
		if not FileAccess.file_exists(texture_path) or not ResourceLoader.exists(texture_path, "Texture2D"):
			return false
		var texture := load(texture_path) as Texture2D
		if texture == null or texture.get_size() != Vector2(BOSS_COUNTS[id] * 640, 640):
			return false
		textures[id] = texture
	if float(candidates.death.duration_ms) > 600.0:
		return false # Final corpse must be reached before the existing 40-tick loot transition.
	boss_animations = candidates
	boss_sheets = textures
	return true

func _process(delta: float) -> void:
	if not uses_boss_pack:
		super._process(delta)
		return
	var next: String = "death" if actor.is_dead() else str(BOSS_STATES.get(actor.state.id, "idle"))
	var progressed := actor.visual_tick != last_tick
	if boss_action != next or (progressed and next not in ["idle", "move", "death"] and actor.state.frame < boss_previous_state_frame):
		boss_action = next
		boss_loop_ms = 0.0
		boss_previous_loop_ms = 0.0
	if progressed:
		var ticks := maxi(1, actor.visual_tick - last_tick)
		boss_previous_loop_ms = boss_loop_ms
		if next == "move":
			boss_loop_ms += actor.position.distance_to(last_position) / 60.0 * float(boss_animations.move.duration_ms)
		elif next == "idle":
			boss_loop_ms += ticks * 1000.0 / 60.0
		last_position = actor.position
		last_tick = actor.visual_tick
		boss_previous_state_frame = actor.state.frame
		tick_fraction = 0.0
	tick_fraction = minf(1.0, tick_fraction + maxf(0.0, delta) * 60.0)
	position = actor.previous_position.lerp(actor.position, tick_fraction) - actor.position if actor.visual_tick > 0 else Vector2.ZERO
	render_lift = lerpf(actor.previous_visual_height, actor.visual_height, tick_fraction)
	render_frame = maxf(0.0, actor.state.frame - 1.0 + tick_fraction)
	var a: Dictionary = boss_animations[next]
	if next in ["idle", "move"]:
		boss_time_ms = lerpf(boss_previous_loop_ms, boss_loop_ms, tick_fraction)
	elif next == "death":
		boss_time_ms = maxf(0.0, actor.dead_frames - 1.0 + tick_fraction) * 1000.0 / 60.0
	else:
		boss_time_ms = boss_visual_time(next, render_frame)
	var time := fposmod(boss_time_ms, float(a.duration_ms)) if a.loop else boss_time_ms
	boss_frame = frame_at(a.frames, time)
	var rect: Array = a.frames[boss_frame].rect_px
	boss_body.texture = boss_sheets[next]
	boss_body.region_rect = Rect2(rect[0], rect[1], rect[2], rect[3])
	boss_root.scale = Vector2(actor.facing * BOSS_SCALE, BOSS_SCALE)
	boss_root.position.y = -render_lift
	modulate.a = 1.0 # Death keeps the final corpse; game clear/loot logic is untouched.
	queue_redraw()

func boss_visual_time(id: String, logical_frame: float) -> float:
	var art: Dictionary = boss_animations[id]
	var rule := actor.state.definition()
	var boxes: Array = rule.get("hitboxes", [])
	if art.has("impact_ms") and not boxes.is_empty():
		var impact: Array = art.impact_ms
		var box: Dictionary = boxes[0]
		if logical_frame < float(box.activeFrom):
			return remap(logical_frame, 0, box.activeFrom, 0, impact[0])
		if logical_frame < float(box.activeTo):
			return remap(logical_frame, box.activeFrom, box.activeTo, impact[0], impact[1])
		return remap(logical_frame, box.activeTo, rule.frames, impact[1], art.duration_ms)
	return remap(logical_frame, 0, rule.frames, 0, art.duration_ms)

func _draw() -> void:
	if not uses_boss_pack:
		super._draw()
		return
	_draw_shadow(1.42)
	_draw_telegraph()
	if not actor.is_dead():
		_draw_health(1.42)
