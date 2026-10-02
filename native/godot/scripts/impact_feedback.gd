extends Node2D
## 独立的命中表现层：只接受已结算事件，不改变伤害、角色位置或模拟时钟。

const MAX_SPARKS := 144
const MAX_ACCENTS := 18
const MAX_LABELS := 12
const CREAM := Color("fff2c7")
const AMBER := Color("eaa654")
const INK := Color("17262e")

var reduced_motion := false:
	set(value):
		reduced_motion = value
		if value:
			shake_amount = 0.0
var shake_amount := 0.0
var particles: Array[Dictionary] = []
var accents: Array[Dictionary] = []
var labels: Array[Dictionary] = []
var font: Font = ThemeDB.fallback_font
var _random := RandomNumberGenerator.new()
var _impact_index := 0

func _ready() -> void:
	_random.seed = 87291

func hit(at: Vector2, amount: float, killed: bool, perfect: bool) -> void:
	# at 是扣除跳跃高度后的脚底；胸口火花与头顶数值必须使用同一视觉坐标系。
	var center := at + Vector2(0, -49)
	var strong := killed or perfect or amount >= 45.0
	var power := 1.3 if killed else (1.1 if strong else 0.85)
	var direction := -1.0 if _impact_index % 2 else 1.0
	var angle := -0.58 if direction > 0 else -2.48
	_impact_index += 1
	accents.append({"at": center, "angle": angle, "age": 0.0, "life": 0.19 if strong else 0.14, "power": power, "perfect": perfect})
	if accents.size() > MAX_ACCENTS:
		accents.pop_front()
	var count := (13 if killed else 8) if not reduced_motion else 4
	for i in count:
		var spread := angle + _random.randf_range(-1.2, 1.2)
		if i % 3 == 0:
			spread += PI
		var velocity := Vector2.from_angle(spread) * _random.randf_range(100.0, 290.0) * power
		var life := _random.randf_range(0.2, 0.46)
		particles.append({"at": center, "previous": center, "velocity": velocity, "age": 0.0, "life": life,
			"width": _random.randf_range(1.1, 2.2), "debris": i % 4 == 0, "rotation": _random.randf_range(-PI, PI)})
	while particles.size() > MAX_SPARKS:
		particles.pop_front()
	# 连击数字仅错开少量横向距离，避免覆盖人物，也不把大伤害放大到遮住战场。
	labels.append({"at": at + Vector2(8 + (_impact_index % 3 - 1) * 15, -105), "age": 0.0,
		"life": 0.68, "text": str(maxi(0, roundi(amount))), "strong": strong, "perfect": perfect})
	if labels.size() > MAX_LABELS:
		labels.pop_front()
	if not reduced_motion:
		shake_amount = minf(5.5, maxf(shake_amount, 3.8 if killed else (2.8 if perfect else 1.6)))
	queue_redraw()

func reset() -> void:
	particles.clear()
	accents.clear()
	labels.clear()
	shake_amount = 0.0
	_impact_index = 0
	queue_redraw()

func advance(delta: float) -> void:
	# 主场景统一推进；暂停不调用，命中停顿可继续推进，以保留刀锋划过的瞬时读感。
	var dt := maxf(delta, 0.0)
	shake_amount = 0.0 if reduced_motion else move_toward(shake_amount, 0.0, dt * 25.0)
	for particle in particles:
		particle.age += dt
		particle.previous = particle.at
		particle.at += particle.velocity * dt
		particle.velocity *= exp(-dt * (2.0 if particle.debris else 5.4))
		particle.velocity.y += dt * (340.0 if particle.debris else 60.0)
		particle.rotation += dt * 5.0
	for accent in accents:
		accent.age += dt
	for label in labels:
		label.age += dt
	particles = particles.filter(func(p: Dictionary) -> bool: return p.age < p.life)
	accents = accents.filter(func(p: Dictionary) -> bool: return p.age < p.life)
	labels = labels.filter(func(p: Dictionary) -> bool: return p.age < p.life)
	queue_redraw()

func _draw() -> void:
	for accent in accents:
		var progress: float = accent.age / accent.life
		var opacity := (1.0 - progress) * 0.9
		var length: float = lerpf(39.0, 67.0, 1.0 - pow(1.0 - progress, 3)) * accent.power
		draw_set_transform(accent.at, accent.angle)
		# 窄墨痕托住乳白刀光：只在接触点短暂出现，禁止全屏高亮闪烁。
		var blade := PackedVector2Array([Vector2(-length * 0.6, 0), Vector2(-7, -5.0 * (1 - progress)),
			Vector2(length, -1), Vector2(7, 3.0 * (1 - progress))])
		draw_colored_polygon(blade, Color(INK, opacity * 0.72))
		draw_line(Vector2(-length * 0.46, 0), Vector2(length * 0.88, -0.5), Color(CREAM, opacity), maxf(0.5, 2.3 * (1.0 - progress)), true)
		draw_set_transform(Vector2.ZERO)
		if accent.perfect:
			draw_arc(accent.at, lerpf(9, 28, progress), -2.0, 0.6, 16, Color(CREAM, opacity * 0.55), 1.1, true)
	for particle in particles:
		var progress: float = particle.age / particle.life
		var opacity := pow(1.0 - progress, 1.4)
		var color := CREAM.lerp(AMBER, progress)
		color.a = opacity
		if particle.debris:
			draw_set_transform(particle.at, particle.rotation)
			draw_colored_polygon(PackedVector2Array([Vector2(-2, 0), Vector2(0, -1), Vector2(3, 0.5), Vector2(-1, 1.4)]), Color(AMBER, opacity * 0.75))
			draw_set_transform(Vector2.ZERO)
		else:
			var velocity: Vector2 = particle.velocity
			var tail := velocity.normalized() * clampf(velocity.length() * 0.043, 2, 13)
			draw_line(particle.at - tail, particle.at, color, particle.width * (1.0 - progress * 0.6), true)
	for label in labels:
		var age: float = label.age
		var rise := (1.0 - exp(-age * 6.0)) * (15.0 if reduced_motion else 29.0)
		var at: Vector2 = label.at - Vector2(0, rise)
		var opacity := 1.0 - smoothstep(0.36, float(label.life), age)
		var size := 21 if label.strong else 17
		var text_width := font.get_string_size(label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		at.x -= text_width * 0.5
		draw_string_outline(font, at, label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 3, Color(INK, opacity * 0.85))
		draw_string(font, at, label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(CREAM if label.perfect else AMBER, opacity))
