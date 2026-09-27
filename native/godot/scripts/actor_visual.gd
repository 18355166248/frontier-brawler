extends Node2D

@onready var actor: FBActor = get_parent()
@onready var sprite: Sprite2D = $Sprite
var rows: Array = []
var loaded := false
# 仅供动作对照场使用；正常游戏始终使用修正后的采样。
var legacy_preview := false

func _ready() -> void:
	var sheet: Dictionary = FBData.all().sheets[actor.kind]
	rows = sheet.rows
	sprite.texture = load(sheet.path)
	sprite.vframes = rows.size()
	loaded = sprite.texture != null

func _process(_delta: float) -> void:
	var state := actor.state
	var d := state.definition()
	var pose := FBAnimationPose.sample(state.id, state.frame, d, legacy_preview, actor.kind)
	if actor.is_dead() and not legacy_preview:
		pose = {"action": "hit", "column": 2}
	var row := rows.find(pose.action)
	if row < 0:
		row = 0
	var progress := clampf(float(state.frame) / float(d.frames), 0, 0.999)
	sprite.frame = row * 4 + int(pose.column)
	sprite.flip_h = actor.facing < 0
	var size_scale := 1.55 if actor.kind == "boss" else 1.25
	sprite.scale = Vector2.ONE * size_scale
	sprite.offset = Vector2.ZERO
	sprite.rotation = 0
	sprite.position.x = 0
	var lift := actor.visual_height
	if legacy_preview and state.id in ["jump", "airSlash"]:
		lift = sin(progress * PI) * 48
	var bob := 0.0
	if state.id == "move":
		bob = absf(sin(progress * TAU * 2)) * 2 if legacy_preview else FBAnimationPose.walk_bob(state.frame, int(d.frames))
	sprite.position.y = -42 * size_scale - lift - bob
	if not legacy_preview:
		var weight := actor.visual_weight
		# 图集脚底 y=90，相对 96px 格中心偏移 42px；变形绕脚底，避免缩放造成悬浮。
		sprite.offset = Vector2(0, -42)
		sprite.position = Vector2(weight.z * actor.facing, -lift - bob)
		sprite.rotation = weight.x * actor.facing
		sprite.scale = Vector2(1.0 + weight.y, 1.0 - weight.y) * size_scale
		if actor.is_dead():
			var fall := smoothstep(0, 16, actor.dead_frames)
			sprite.rotation = lerpf(weight.x, -1.15, fall) * actor.facing
			sprite.position.x = lerpf(weight.z, -10, fall) * actor.facing
			# 倒地后刀尖/披风随旋转会探入地面，略抬视觉根部，保持尸体在脚底附近。
			sprite.position.y -= 24 * size_scale * fall
			sprite.scale = Vector2.ONE * size_scale
	sprite.modulate = Color(1.2, 0.65, 0.38) if actor.boss_phase == 2 else Color.WHITE
	if not actor.is_dead() and actor.invulnerability > 0 and actor.invulnerability % 6 < 3:
		sprite.modulate = Color(2, 1.5, 1.2)
	modulate.a = (clampf(1.0 - actor.dead_frames / 24.0, 0, 1) if legacy_preview else 1.0 - smoothstep(12, 30, actor.dead_frames)) if actor.is_dead() else 1.0
	queue_redraw()

func _draw() -> void:
	if not is_instance_valid(actor):
		return
	draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.35))
	var shadow := 1.0 if legacy_preview else clampf(1.0 - actor.visual_height / 100.0, 0.55, 1.0)
	draw_circle(Vector2.ZERO, actor.radius * 1.25 * shadow, Color(0, 0, 0, 0.3 * shadow))
	draw_set_transform(Vector2.ZERO)
	if actor.is_dead():
		return
	if not loaded:
		draw_circle(Vector2(0, -25), 22, Color.CYAN if actor.kind == "hero" else Color.CORAL)
	var state := actor.state
	var d := state.definition()
	if actor.kind != "hero" and d.has("telegraph") and state.frame < d.telegraph.until:
		var progress := float(state.frame) / float(d.telegraph.until)
		if not legacy_preview and d.hitboxes.is_empty() and d.telegraph.shape.kind == "line":
			# 蓄力动作本身无 hitbox，预警读取自己的形状，不能因此完全不显示冲锋方向。
			var shape: Dictionary = d.telegraph.shape
			var begin := Vector2(0, -shape.width / 2.0)
			if actor.facing < 0:
				begin.x -= shape.length
			var area := Rect2(begin, Vector2(shape.length, shape.width))
			draw_rect(area, Color(0.97, 0.33, 0.2, 0.12 + progress * 0.22))
			draw_rect(area, Color(1, 0.53, 0.24, 0.85), false, 2)
		for box in d.hitboxes:
			var center := Vector2(box.offset.x * actor.facing, box.offset.y)
			var area := Rect2(center - Vector2(box.halfWidth, box.halfDepth), Vector2(box.halfWidth, box.halfDepth) * 2)
			draw_rect(area, Color(0.97, 0.33, 0.2, 0.12 + progress * 0.22))
			draw_rect(area, Color(1, 0.53, 0.24, 0.85), false, 2)
			draw_line(area.position, area.position + Vector2(area.size.x * progress, 0), Color(1, 0.9, 0.6), 3)
	if not d.hitboxes.is_empty() and (actor.kind == "hero" or not legacy_preview):
		var box: Dictionary = d.hitboxes[0]
		if state.frame >= box.activeFrom and state.frame < box.activeTo + 3:
			var release := clampf(float(state.frame - box.activeFrom) / maxf(1, box.activeTo + 3 - box.activeFrom), 0, 1)
			var alpha := 0.9 if legacy_preview else (1.0 - release) * 0.85
			var color := Color(0.6, 1, 0.83, alpha) if actor.kind == "hero" else Color(1, 0.57, 0.3, alpha)
			var center := Vector2(20 * actor.facing, -25 - actor.visual_height)
			if box.get("radial", false):
				# 范围保持判定外沿，内环扩散表达释放，避免玩家误读伤害范围。
				if not legacy_preview:
					draw_set_transform(Vector2.ZERO, 0, Vector2(1, float(box.halfDepth) / box.halfWidth))
				draw_arc(Vector2.ZERO, box.halfWidth, 0, TAU, 40, color, 3)
				if not legacy_preview:
					draw_arc(Vector2.ZERO, box.halfWidth * lerpf(0.25, 1.0, release), 0, TAU, 40, color, 2)
				draw_set_transform(Vector2.ZERO)
			else:
				var start := -1.2 if actor.facing > 0 else PI - 1.2
				var sweep := 2.4 if legacy_preview else lerpf(0.45, 2.4, release)
				draw_arc(center, 45, start, start + sweep, 16, color, 5)
	if not legacy_preview and state.id == "bossSummon":
		var phase: float = float(state.frame) / d.frames
		draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.45))
		draw_arc(Vector2.ZERO, 35 + 20 * sin(phase * PI), phase * TAU, phase * TAU + PI * 1.5, 32, Color(1, 0.52, 0.25, sin(phase * PI) * 0.7), 3)
		draw_set_transform(Vector2.ZERO)
	if not legacy_preview and state.id in ["dash", "bossRush"] and state.frame < 12:
		var fade := sin(state.frame / 12.0 * PI) * 0.35
		for i in 3:
			var at := Vector2(-actor.facing * (20 + i * 7), -12 - i * 15)
			draw_line(at, at - Vector2(actor.facing * 18, 0), Color(0.7, 0.85, 0.8, fade), 2)
	if actor.kind != "hero":
		var y := -135.0 if actor.kind == "boss" else -112.0
		draw_rect(Rect2(-24, y, 48, 4), Color(0.07, 0.09, 0.1))
		draw_rect(Rect2(-24, y, 48 * actor.hp / actor.max_hp, 4), Color(0.95, 0.42, 0.28))
		if actor.hp / actor.max_hp < 0.25:
			draw_arc(Vector2(0, -30), 32, 0, TAU, 24, Color(1, 0.8, 0.3), 2)
