extends Node2D
## 只读权威状态的程序特效；复用现有12动作，不把占位素材称为专属动作原画。
const WIND := Color(0.52, 0.94, 0.94, 0.85)
const SPIRIT := Color(0.74, 0.48, 0.91, 0.65)
@onready var room: FBRoom = get_parent().get_node("Room")

func _process(_delta: float) -> void:
	queue_redraw()

func _draw() -> void:
	if not is_instance_valid(room.hero) or room.hero.is_dead():
		return
	var h := room.hero
	var s := h.skills
	var visual: FBWuduHeroVisual = h.get_node("Visual")
	var p := h.previous_position.lerp(h.position, visual.tick_fraction)
	var direction := s.cast_direction
	var frame := maxf(0.0, h.state.frame - 1.0 + visual.tick_fraction)
	if s.e_active:
		draw_line(s.e_anchor - Vector2(0, 8), p - Vector2(0, 8), SPIRIT, 1.5, true)
		draw_arc(s.e_anchor, 24, 0, TAU, 48, SPIRIT, 2, true)
		if visual.uses_pack:
			draw_set_transform(s.e_anchor, 0, Vector2(s.e_facing * visual.ART_SCALE, visual.ART_SCALE))
			draw_texture_rect_region(visual.sheets.idle, Rect2(-visual.PIVOT, Vector2(640, 640)), Rect2(0, 0, 640, 640), Color(0.74, 0.55, 1, 0.38))
			draw_set_transform(Vector2.ZERO)
		draw_arc(p - Vector2(0, 43), 42, 0, TAU, 48, Color(SPIRIT, 0.28), 2, true)
	if s.shield > 0:
		draw_arc(p - Vector2(0, 45), 49, 0, TAU, 48, Color(0.62, 0.84, 1, 0.58), 2.5, true)
		for side in [-1, 1]:
			draw_line(p + Vector2(side * 46, -57), p + Vector2(side * 46, -28), WIND, 3, true)
	match h.state.id:
		"windThrust":
			if frame >= 4 and frame < 11:
				var tip := p + direction * float(FBData.yone().q.reach)
				draw_line(p - Vector2(0, 34), tip - Vector2(0, 34), WIND, 5, true)
				draw_line(p - Vector2(0, 34), tip - Vector2(0, 34), Color(1, 1, 0.88, 0.9), 1.5, true)
		"windRush":
			if frame < 15:
				for i in 4:
					var center := p - direction * (12 + i * 15) - Vector2(0, 28)
					draw_arc(center, 22 + i * 3, direction.angle() - 1.4, direction.angle() + 1.4, 24, Color(WIND, 0.8 - i * 0.16), 2, true)
		"guardSweep":
			if frame >= 5 and frame < 12:
				var angle := direction.angle()
				var half: float = FBData.yone().w.half_angle
				var points := PackedVector2Array([p - Vector2(0, 15)])
				for i in 25:
					points.append(p + Vector2.from_angle(angle - half + half * 2 * i / 24) * float(FBData.yone().w.reach) - Vector2(0, 15))
				draw_colored_polygon(points, Color(0.6, 0.84, 0.93, 0.12))
				draw_polyline(points.slice(1), WIND, 3, true)
		"spiritReturn":
			draw_arc(p - Vector2(0, 37), 15 + frame * 2, 0, TAU, 48, Color(SPIRIT, maxf(0, 0.7 - frame / 24)), 2, true)
		"fateSever":
			var origin := s.cast_origin
			var end := s.r_end
			var normal := direction.orthogonal() * float(FBData.yone().r.width)
			if frame < 18:
				draw_colored_polygon(PackedVector2Array([origin + normal, end + normal, end - normal, origin - normal]), Color(0.81, 0.58, 0.77, 0.16))
				draw_line(origin, end, SPIRIT, 2, true)
			else:
				var alpha := clampf((32 - frame) / 14, 0, 1)
				draw_line(origin - Vector2(0, 30), end - Vector2(0, 30), Color(WIND, alpha), 8, true)
				for slot in s.r_slots.values():
					draw_line(end - Vector2(0, 28), slot - Vector2(0, 28), Color(SPIRIT, alpha * 0.65), 2, true)
