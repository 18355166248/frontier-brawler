extends Node2D

var particles: Array[Dictionary] = []
var labels: Array[Dictionary] = []
var font := ThemeDB.fallback_font

func hit(at: Vector2, amount: float, killed: bool, perfect: bool) -> void:
	labels.append({"at": at + Vector2(0, -80), "text": str(roundi(amount)), "life": 0.75, "perfect": perfect})
	for i in (12 if killed else 7):
		var angle := i * TAU / 7.0
		particles.append({"at": at + Vector2(0, -35), "velocity": Vector2.from_angle(angle) * (90 + i * 12), "life": 0.35})

func reset() -> void:
	particles.clear()
	labels.clear()

func _process(delta: float) -> void:
	for p in particles:
		p.life -= delta
		p.at += p.velocity * delta
	for label in labels:
		label.life -= delta
		label.at.y -= delta * 40
	particles = particles.filter(func(p: Dictionary): return p.life > 0)
	labels = labels.filter(func(p: Dictionary): return p.life > 0)
	queue_redraw()

func _draw() -> void:
	for p in particles:
		draw_circle(p.at, 2, Color(1, 0.83, 0.5, p.life / 0.35))
	for label in labels:
		var color := Color("94ffcc") if label.perfect else Color("ffe6ad")
		color.a = minf(1, label.life * 3)
		draw_string(font, label.at, label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 24, color)
