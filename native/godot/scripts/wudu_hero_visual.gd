class_name FBWuduHeroVisual
extends FBIllustratedActor
## 仅替换英雄的表现。敌人/回退仍运行原关节绘制；所有规则与状态时钟只读。

const PACK := "res://assets/wudu-hero/wudu_hero_v2_runtime/"
const ART_SCALE := 0.30 # 约 90px 身体高度，接近原英雄；画布和长刀留白不参与碰撞。
const PIVOT := Vector2(288, 560)
const FRAME_COUNTS := {"idle": 4, "move": 6, "slash": 6, "slash2": 6, "slash3": 6, "dash": 5,
	"jump": 6, "airSlash": 6, "skill": 6, "execute": 6, "hit": 4, "death": 5}
@export var use_wudu_hero := true
@export_dir var pack_directory := PACK
var uses_pack := false
var animations: Dictionary = {}
var effect_bindings: Dictionary = {}
var sheets: Dictionary = {}
var trails: Dictionary = {}
var body_root: Node2D
var body: Sprite2D
var trail: Sprite2D
var dust: Sprite2D
var pack_action := ""
var logical_action := ""
var pack_frame := 0
var pack_time_ms := 0.0
var loop_time_ms := 0.0
var previous_loop_ms := 0.0
var movement_speed_scale := 1.0
var previous_state_frame := -1
var dust_start_tick := -1000
var dust_owner := ""
var dust_texture: Texture2D

func _ready() -> void:
	super._ready()
	if actor.kind != "hero" or not use_wudu_hero or "--illustrated-hero" in OS.get_cmdline_user_args():
		return
	if not load_pack():
		push_warning("Wudu hero assets invalid or missing; using original illustrated hero.")
		return
	uses_pack = true
	body_root = Node2D.new()
	add_child(body_root)
	body = sprite(body_root)
	body.region_enabled = true
	trail = sprite(body_root)
	trail.hide()
	dust = sprite(self)
	dust.texture = dust_texture
	dust.hframes = 4
	dust.hide()
	# 独立计时，不使用 AnimatedSprite 的全局 speed_scale，移动速度无法污染出刀。
	last_tick = actor.visual_tick
	_process(0.0)

func read_manifest(file: String) -> Dictionary:
	var path := pack_directory.path_join(file)
	if not FileAccess.file_exists(path):
		return {}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK or not parser.data is Dictionary:
		return {}
	return parser.data

func read_texture(file: String, size: Vector2) -> Texture2D:
	var path := pack_directory.path_join(file)
	if not FileAccess.file_exists(path) or not ResourceLoader.exists(path, "Texture2D"):
		return null
	var texture := load(path) as Texture2D
	return texture if texture != null and texture.get_size() == size else null

func load_pack() -> bool:
	# 先完整验证再创建新图层/启用分支，坏包不会留下半初始化 Sprite 或空白英雄。
	var manifest := read_manifest("animation.json")
	var fx := read_manifest("effects.json")
	if not numbers_match(manifest.get("canvas_px"), [640, 640]) or not numbers_match(manifest.get("pivot_px"), [288, 560]) or not manifest.get("animations") is Dictionary or not fx.get("effects") is Array:
		return false
	var candidates: Dictionary = manifest.animations
	if candidates.size() != FRAME_COUNTS.size() or fx.effects.size() != 7:
		return false
	var candidate_sheets: Dictionary = {}
	var candidate_trails: Dictionary = {}
	var candidate_bindings: Dictionary = {}
	for id in FRAME_COUNTS:
		if not candidates.get(id) is Dictionary:
			return false
		var a: Dictionary = candidates[id]
		if not a.get("frames") is Array or a.frames.size() != FRAME_COUNTS[id] or a.get("frame_count") != FRAME_COUNTS[id] or a.get("sheet") != "sheets/" + id + ".png" or a.get("loop") != (id in ["idle", "move"]):
			return false
		var total := 0.0
		for i in a.frames.size():
			if not a.frames[i] is Dictionary:
				return false
			var f: Dictionary = a.frames[i]
			if not numbers_match(f.get("rect_px"), [i * 640, 0, 640, 640]) or not is_number(f.get("duration_ms")) or f.duration_ms <= 0 or not is_number(f.get("art_lift_px")):
				return false
			total += float(f.duration_ms)
		if total != a.get("duration_ms"):
			return false
		if id in ["slash", "slash2", "slash3", "airSlash", "skill", "execute"]:
			var hit = a.get("proposed_hit_window_ms")
			if not hit is Dictionary or not is_number(hit.get("start")) or not is_number(hit.get("end_exclusive")):
				return false
			if hit.start <= 0 or hit.start >= hit.end_exclusive or hit.end_exclusive >= total:
				return false
		var texture := read_texture(a.sheet, Vector2(FRAME_COUNTS[id] * 640, 640))
		if texture == null:
			return false
		candidate_sheets[id] = texture
	var candidate_dust: Texture2D
	for effect in fx.effects:
		if not effect is Dictionary or not numbers_match(effect.get("canvas_px"), [640, 640]) or not numbers_match(effect.get("pivot_px"), [288, 560]):
			return false
		if effect.get("name") == "dust":
			if effect.get("sheet") != "effects/dust_sheet.png" or not effect.get("frames") is Array or effect.frames.size() != 4:
				return false
			candidate_dust = read_texture(effect.sheet, Vector2(2560, 640))
			for i in 4:
				if not effect.frames[i] is Dictionary or effect.frames[i].get("file") != "effects/dust_%02d.png" % i or read_texture(effect.frames[i].file, Vector2(640, 640)) == null:
					return false
		else:
			var binding = effect.get("proposed_binding")
			if not binding is Dictionary or not is_number(binding.get("start_ms")) or not is_number(binding.get("duration_ms")):
				return false
			var id: String = str(binding.get("animation", ""))
			if id not in ["slash", "slash2", "slash3", "airSlash", "skill", "execute"] or candidate_trails.has(id) or effect.get("file") != "effects/" + id + "_trail.png" or binding.start_ms < 0 or binding.duration_ms <= 0:
				return false
			var texture := read_texture(effect.file, Vector2(640, 640))
			if texture == null:
				return false
			candidate_trails[id] = texture
			candidate_bindings[id] = binding
	if candidate_trails.size() != 6 or candidate_dust == null:
		return false
	animations = candidates
	sheets = candidate_sheets
	trails = candidate_trails
	effect_bindings = candidate_bindings
	dust_texture = candidate_dust
	return true

static func is_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func numbers_match(value: Variant, expected: Array) -> bool:
	# JSON 数字为 float；Array 整体相等会把 int/float 当成不同成员类型。
	if not value is Array or value.size() != expected.size():
		return false
	for i in expected.size():
		if not is_number(value[i]) or float(value[i]) != float(expected[i]):
			return false
	return true

func sprite(parent: Node2D) -> Sprite2D:
	var node := Sprite2D.new()
	node.centered = false
	node.offset = -PIVOT
	node.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	parent.add_child(node)
	return node

func _process(delta: float) -> void:
	if not uses_pack:
		super._process(delta)
		return
	var logical := "death" if actor.is_dead() else actor.state.id
	var next: String = logical if logical == "death" else str(actor.state.definition().get("visual", logical))
	var progressed := actor.visual_tick != last_tick
	# 同名动作再次起手也重置；idle/move 的逻辑循环不截断独立美术周期。
	var restarted := progressed and next not in ["idle", "move", "death"] and actor.state.frame < previous_state_frame
	if logical_action != logical or pack_action != next or restarted:
		logical_action = logical
		pack_action = next
		movement_speed_scale = 1.0
		loop_time_ms = 0.0
		previous_loop_ms = 0.0
		trail.hide()
		dust.hide()
		dust_start_tick = -1000
		dust_owner = next
		if next == "dash":
			dust_start_tick = actor.visual_tick
	if progressed:
		var ticks := maxi(1, actor.visual_tick - last_tick)
		previous_loop_ms = loop_time_ms
		movement_speed_scale = 1.0
		if next == "move":
			var distance := actor.position.distance_to(last_position)
			movement_speed_scale = distance / maxf(0.001, actor.speed * ticks)
		loop_time_ms += ticks * 1000.0 / 60.0 * movement_speed_scale
		if next in ["jump", "airSlash"] and actor.previous_visual_height > 0 and actor.visual_height == 0:
			dust_start_tick = actor.visual_tick
		last_tick = actor.visual_tick
		tick_fraction = 0.0
		last_position = actor.position
		previous_state_frame = actor.state.frame
	tick_fraction = minf(1.0, tick_fraction + maxf(0.0, delta) * 60.0)
	position = actor.previous_position.lerp(actor.position, tick_fraction) - actor.position if actor.visual_tick > 0 else Vector2.ZERO
	render_lift = lerpf(actor.previous_visual_height, actor.visual_height, tick_fraction)
	render_frame = maxf(0.0, actor.state.frame - 1.0 + tick_fraction)
	if next in ["idle", "move"]:
		pack_time_ms = lerpf(previous_loop_ms, loop_time_ms, tick_fraction)
	elif next == "death":
		pack_time_ms = maxf(0.0, actor.dead_frames - 1.0 + tick_fraction) * 1000.0 / 60.0
	else:
		pack_time_ms = visual_time(next, render_frame)
	var definition: Dictionary = animations[next]
	var time := fposmod(pack_time_ms, float(definition.duration_ms)) if definition.loop else pack_time_ms
	pack_frame = frame_at(definition.frames, time)
	var frame: Dictionary = definition.frames[pack_frame]
	var rect: Array = frame.rect_px
	body.texture = sheets[next]
	body.region_rect = Rect2(rect[0], rect[1], rect[2], rect[3])
	# 镜像承载画布与偏移的父节点，围绕脚底 (288,560) 而非图像中心翻转。
	body_root.scale = Vector2(actor.facing * ART_SCALE, ART_SCALE)
	# 先抵消本帧烘入的美术抬升，再使用原逻辑高度；纵深排序仍在 Actor 地面原点。
	body_root.position.y = float(frame.art_lift_px) * ART_SCALE - render_lift
	modulate.a = 1.0 - clampf((pack_time_ms - 500.0) / 200.0, 0.0, 1.0) if next == "death" else 1.0
	update_effects(time)
	queue_redraw()

func visual_time(id: String, logical_frame: float) -> float:
	var art: Dictionary = animations[id]
	var rule := actor.state.definition()
	var boxes: Array = rule.hitboxes
	if art.has("proposed_hit_window_ms") and not boxes.is_empty():
		# 美术建议窗口映射到既有判定窗口；绝不把建议值写回伤害/取消/位移。
		var hit: Dictionary = art.proposed_hit_window_ms
		var box: Dictionary = boxes[0]
		if logical_frame < float(box.activeFrom):
			return remap(logical_frame, 0, box.activeFrom, 0, hit.start)
		if logical_frame < float(box.activeTo):
			return remap(logical_frame, box.activeFrom, box.activeTo, hit.start, hit.end_exclusive)
		return remap(logical_frame, box.activeTo, rule.frames, hit.end_exclusive, art.duration_ms)
	if id == "jump":
		# 原逻辑第27帧落地；素材450ms进入land。提前输入跳劈仍由原取消点决定。
		var landing: float = rule.airborne.to
		if logical_frame < landing:
			return remap(logical_frame, 0, landing, 0, 450)
		return remap(logical_frame, landing, rule.frames, 450, art.duration_ms)
	if rule.has("visual"):
		return remap(logical_frame, 0, rule.frames, 0, art.duration_ms)
	return logical_frame * 1000.0 / 60.0

static func frame_at(frames: Array, time_ms: float) -> int:
	var end := 0.0
	for i in frames.size():
		end += float(frames[i].duration_ms)
		if time_ms < end:
			return i
	return frames.size() - 1

func update_effects(time_ms: float) -> void:
	trail.hide()
	if effect_bindings.has(pack_action):
		var binding: Dictionary = effect_bindings[pack_action]
		var age := time_ms - float(binding.start_ms)
		if age >= 0.0 and age < float(binding.duration_ms):
			trail.texture = trails[pack_action]
			trail.modulate.a = 1.0 - age / float(binding.duration_ms)
			trail.show()
	var dust_ms := (actor.visual_tick - dust_start_tick - 1.0 + tick_fraction) * 1000.0 / 60.0
	dust.visible = dust_owner == pack_action and dust_ms >= 0.0 and dust_ms < 220.0
	if dust.visible:
		dust.frame = 0 if dust_ms < 40 else (1 if dust_ms < 90 else (2 if dust_ms < 150 else 3))
		dust.modulate.a = 1.0 - dust_ms / 220.0
		dust.scale = Vector2(actor.facing * ART_SCALE, ART_SCALE)

func _draw() -> void:
	if not uses_pack:
		super._draw()
		return
	_draw_shadow(1.0)
