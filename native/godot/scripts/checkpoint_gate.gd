class_name FBCheckpointGate
extends Node2D
## 只表现原门状态：升起有界、可暂停、可在换房/重开时立即重置。
const CANVAS := Vector2(768, 1024)
const PIVOT := Vector2(384, 810)
const WORLD_SCALE := 0.2
const OPEN_SECONDS := 0.38
const APERTURE := [Vector2(234, 260), Vector2(500, 332), Vector2(500, 823), Vector2(234, 751)]
const CUE_RECT := Rect2(-57, -186, 114, 20)
const FILES := {"gate-frame.png": Vector2(768, 1024), "portcullis.png": Vector2(512, 1024), "boss-pennant.png": Vector2(256, 512)}
var asset_directory := "res://assets/environment/checkpoint"
var shutter_shader_path := "res://shaders/gate_shutter.gdshader"
var assets_ready := false
var opening_progress := 0.0
var is_open := false
var leads_to_boss := false
var barrier: Polygon2D
var shutter_material: ShaderMaterial
var pennant: Sprite2D
var cue: Label

func _ready() -> void:
	var textures: Dictionary = {}
	for filename in FILES:
		var path := asset_directory.path_join(filename)
		if not ResourceLoader.exists(path):
			return
		var texture := load(path) as Texture2D
		if texture == null or texture.get_size() != FILES[filename]:
			return
		textures[filename] = texture
	if not ResourceLoader.exists(shutter_shader_path):
		return
	var shader := load(shutter_shader_path) as Shader
	if shader == null or shader.get_mode() != Shader.MODE_CANVAS_ITEM:
		return
	# 非null并不代表编译成功；让引擎编译/反射实际可赋值的uniform后再建节点。
	var opening_ready := false
	for uniform in shader.get_shader_uniform_list():
		if uniform.name == "opening" and uniform.type == TYPE_FLOAT:
			opening_ready = true
	if not opening_ready:
		return
	barrier = Polygon2D.new()
	# Polygon2D数组属性返回副本，统一赋值而非逐项修改属性。
	var points := PackedVector2Array()
	for point in APERTURE:
		points.append((point - PIVOT) * WORLD_SCALE)
	barrier.polygon = points
	barrier.texture = textures["portcullis.png"]
	barrier.uv = PackedVector2Array([Vector2.ZERO, Vector2(512, 0), Vector2(512, 1024), Vector2(0, 1024)])
	shutter_material = ShaderMaterial.new()
	shutter_material.shader = shader
	barrier.material = shutter_material
	add_child(barrier)
	var frame := Sprite2D.new()
	frame.texture = textures["gate-frame.png"]
	frame.centered = false
	frame.position = -PIVOT * WORLD_SCALE
	frame.scale = Vector2.ONE * WORLD_SCALE
	add_child(frame)
	pennant = Sprite2D.new()
	pennant.texture = textures["boss-pennant.png"]
	pennant.centered = false
	pennant.position = Vector2(-32, -95) - Vector2(128, 24) * 0.07
	pennant.scale = Vector2.ONE * 0.07
	add_child(pennant)
	cue = Label.new()
	cue.position = CUE_RECT.position
	cue.size = CUE_RECT.size
	cue.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cue.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "sans-serif"])
	cue.add_theme_font_override("font", font)
	cue.add_theme_font_size_override("font_size", 13)
	cue.add_theme_color_override("font_color", Color("e6ddbb"))
	cue.add_theme_color_override("font_outline_color", Color("13212c"))
	cue.add_theme_constant_override("outline_size", 2)
	add_child(cue)
	assets_ready = true
	refresh_visuals()

func reset_exit(boss: bool) -> void:
	leads_to_boss = boss
	is_open = false
	opening_progress = 0.0
	refresh_visuals()

func advance(delta: float, opened: bool) -> void:
	is_open = opened
	opening_progress = minf(1.0, opening_progress + maxf(0, delta) / OPEN_SECONDS) if opened else 0.0
	refresh_visuals()

func refresh_visuals() -> void:
	if not assets_ready:
		return
	shutter_material.set_shader_parameter("opening", smoothstep(0, 1, opening_progress))
	barrier.visible = opening_progress < 1.0
	pennant.visible = leads_to_boss
	cue.text = "肃清解封" if not is_open else ("解封中 · 可前行" if opening_progress < 1 else ("铜面山门 →" if leads_to_boss else "前路已开 →"))
