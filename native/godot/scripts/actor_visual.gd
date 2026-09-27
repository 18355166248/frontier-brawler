extends Node2D

@onready var actor: FBActor = get_parent()
@onready var sprite: Sprite2D = $Sprite
var rows: Array = []
var loaded := false
# 缺失动作只在表现层映射；不能为了有动画而改变战斗动作或命中时间。
const ALIASES := {"slash3": "slash2", "skill": "slash2", "execute": "slash2", "airSlash": "slash2", "jump": "move"}

func _ready() -> void:
	var sheet: Dictionary = FBData.all().sheets[actor.kind]
	rows = sheet.rows
	sprite.texture = load(sheet.path)
	sprite.vframes = rows.size()
	loaded = sprite.texture != null

func _process(_delta: float) -> void:
	var state := actor.state
	var d := state.definition()
	var mapped: String = ALIASES.get(state.id, state.id)
	var row := rows.find(mapped)
	if row < 0:
		row = 0
	var progress := clampf(float(state.frame) / float(d.frames), 0, 0.999)
	# 出手帧对齐到图集第三格，避免四帧均分把剑落下放到伤害结算之后。
	var column := mini(3, int(progress * 4))
	var boxes: Array = d.hitboxes
	if not boxes.is_empty():
		var first: Dictionary = boxes[0]
		if state.frame < first.activeFrom:
			column = mini(1, int(2.0 * state.frame / maxf(1, first.activeFrom)))
		elif state.frame < first.activeTo:
			column = 2
		else:
			column = 3
	sprite.frame = row * 4 + column
	sprite.flip_h = actor.facing < 0
	var size_scale := 1.55 if actor.kind == "boss" else 1.25
	sprite.scale = Vector2.ONE * size_scale
	var lift := 0.0
	if state.id in ["jump", "airSlash"]:
		lift = sin(progress * PI) * 48
	var bob := absf(sin(progress * TAU * 2)) * 2 if state.id == "move" else 0.0
	sprite.position.y = -42 * size_scale - lift - bob
	sprite.modulate = Color(1.2, 0.65, 0.38) if actor.boss_phase == 2 else Color.WHITE
	if actor.invulnerability > 0 and actor.invulnerability % 6 < 3:
		sprite.modulate = Color(2, 1.5, 1.2)
	modulate.a = clampf(1.0 - actor.dead_frames / 24.0, 0, 1) if actor.is_dead() else 1.0
	queue_redraw()

func _draw() -> void:
	if not is_instance_valid(actor):
		return
	draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.35))
	draw_circle(Vector2.ZERO, actor.radius * 1.25, Color(0, 0, 0, 0.3))
	draw_set_transform(Vector2.ZERO)
	if actor.is_dead():
		return
	if not loaded:
		draw_circle(Vector2(0, -25), 22, Color.CYAN if actor.kind == "hero" else Color.CORAL)
	var state := actor.state
	var d := state.definition()
	if actor.kind != "hero" and d.has("telegraph") and state.frame < d.telegraph.until:
		var progress := float(state.frame) / float(d.telegraph.until)
		for box in d.hitboxes:
			var center := Vector2(box.offset.x * actor.facing, box.offset.y)
			var area := Rect2(center - Vector2(box.halfWidth, box.halfDepth), Vector2(box.halfWidth, box.halfDepth) * 2)
			draw_rect(area, Color(0.97, 0.33, 0.2, 0.12 + progress * 0.22))
			draw_rect(area, Color(1, 0.53, 0.24, 0.85), false, 2)
			draw_line(area.position, area.position + Vector2(area.size.x * progress, 0), Color(1, 0.9, 0.6), 3)
	if actor.kind == "hero" and not d.hitboxes.is_empty():
		var box: Dictionary = d.hitboxes[0]
		if state.frame >= box.activeFrom and state.frame < box.activeTo + 3:
			var center := Vector2(20 * actor.facing, -25)
			if box.get("radial", false):
				draw_arc(Vector2.ZERO, box.halfWidth, 0, TAU, 40, Color(0.4, 1, 0.85, 0.8), 4)
			else:
				var start := -1.2 if actor.facing > 0 else PI - 1.2
				draw_arc(center, 45, start, start + 2.4, 16, Color(0.6, 1, 0.83, 0.9), 5)
	if actor.kind != "hero":
		var y := -135.0 if actor.kind == "boss" else -112.0
		draw_rect(Rect2(-24, y, 48, 4), Color(0.07, 0.09, 0.1))
		draw_rect(Rect2(-24, y, 48 * actor.hp / actor.max_hp, 4), Color(0.95, 0.42, 0.28))
		if actor.hp / actor.max_hp < 0.25:
			draw_arc(Vector2(0, -30), 32, 0, TAU, 24, Color(1, 0.8, 0.3), 2)
