class_name FBIllustratedActor
extends Node2D
## 手绘骨架只读战斗状态；关节和衣摆每次渲染采样，伤害仍由固定逻辑帧决定。

const INK := Color("17272a")
const PAPER := Color("f2dfb4")
const GOLD := Color("b8a273")
const CLOTH := Color("31575b")
const SHADE := Color("203c43")
const LIGHT := Color("5d8280")
const SCARF := Color("ba5145")

@onready var actor: FBActor = get_parent()
var legacy_preview := false
var pose: Dictionary = {}
var transition_pose: Dictionary = {}
var action := "idle"
var render_frame := 0.0
var tick_fraction := 0.0
var last_tick := -1
var blend_age := 1.0
var animation_time := 0.0
var gait_time := 0.0
var previous_gait_time := 0.0
var gait_weight := 0.0
var facing_visual := 1.0
var turn_pose: Dictionary = {}
var turn_age := 1.0
var render_lift := 0.0
var last_lift := 0.0
var last_position := Vector2.ZERO

func _ready() -> void:
	var old_sprite := get_node_or_null("Sprite")
	if old_sprite:
		old_sprite.hide()
	last_position = actor.position
	facing_visual = -1.0 if actor.kind != "hero" else actor.facing
	action = actor.state.id
	pose = sample_pose(action, 0.0, actor.state.definition(), 0.0, actor.kind)
	set_process(true)

func _process(delta: float) -> void:
	if not is_instance_valid(actor):
		return
	var tick: int = actor.get("visual_tick") if actor.get("visual_tick") != null else actor.state.frame + actor.dead_frames
	var progressed := tick != last_tick
	if progressed:
		last_tick = tick
		tick_fraction = 0.0
		last_lift = render_lift
		previous_gait_time = gait_time
		# 步幅绑定真实位移，慢走不会高速踏步；非行走位移（受击/突进）不推进步态。
		var distance := actor.position.distance_to(last_position)
		if actor.state.id == "move":
			gait_time += minf(distance, 8.0) / stride_distance(actor.kind) * TAU
		last_position = actor.position
		animation_time += 1.0 / 60.0
	# 转身先把旧关节换算到新朝向坐标，再插值到新姿态，避免整副骨架过零时突然镜像跳位。
	if actor.facing != int(facing_visual):
		turn_pose = pose.duplicate(true)
		for key in turn_pose:
			if turn_pose[key] is Vector2:
				turn_pose[key].x *= -1
		turn_pose.blade = PI - float(turn_pose.blade)
		turn_age = 0.0
		facing_visual = actor.facing
	var old_fraction := tick_fraction
	tick_fraction = minf(1.0, tick_fraction + delta * 60.0)
	var visual_delta := (tick_fraction - old_fraction) / 60.0
	# 最大只前推一个逻辑帧，命中定格/暂停时，衣摆、落地和出刀都随逻辑一起冻结。
	render_frame = maxf(0.0, actor.state.frame - 1.0 + tick_fraction)
	if action != actor.state.id:
		transition_pose = pose.duplicate(true)
		action = actor.state.id
		blend_age = 0.0
	blend_age += visual_delta
	gait_weight = move_toward(gait_weight, 1.0 if action == "move" else 0.0, visual_delta * 10.0)
	# 相邻实测步态间插值；按最高跑速外推会在慢走的下一 tick 回退，高刷新率尤其明显。
	var rendered_stride := lerpf(previous_gait_time, gait_time, tick_fraction)
	var desired := sample_pose(action, render_frame, actor.state.definition(), rendered_stride, actor.kind)
	desired["cloth_time"] = animation_time + tick_fraction / 60.0
	if blend_age < 0.08 and not transition_pose.is_empty():
		var transition_weight := smoothstep(0.0, 0.08, blend_age)
		pose = blend_pose(transition_pose, desired, transition_weight)
		# 动作内仍遵循完整挥刀曲线；跨动作接招只走最短角度，避免 2π 表示差导致反向绕圈。
		pose.blade = lerp_angle(transition_pose.blade, desired.blade, transition_weight)
	else:
		pose = desired
	turn_age += visual_delta
	if turn_age < 0.075 and not turn_pose.is_empty():
		var turn_weight := smoothstep(0.0, 0.075, turn_age)
		var target_blade: float = pose.blade
		pose = blend_pose(turn_pose, pose, turn_weight)
		pose.blade = lerp_angle(turn_pose.blade, target_blade, turn_weight)
	# 只平滑子节点，碰撞和 Y 排序仍使用权威脚底坐标；出生或切场不从原点插入。
	position = actor.previous_position.lerp(actor.position, tick_fraction) - actor.position if actor.visual_tick > 0 else Vector2.ZERO
	render_lift = lerpf(actor.previous_visual_height, actor.visual_height, tick_fraction)
	modulate.a = 1.0 - smoothstep(18, 42, maxf(0, actor.dead_frames - 1 + tick_fraction)) if actor.is_dead() else 1.0
	queue_redraw()

static func blend_pose(from: Dictionary, to: Dictionary, weight: float) -> Dictionary:
	var result := to.duplicate()
	for key in to:
		if not from.has(key):
			continue
		if to[key] is Vector2:
			result[key] = (from[key] as Vector2).lerp(to[key], weight)
		elif to[key] is float:
			result[key] = lerpf(from[key], to[key], weight)
	return result

static func sample_pose(id: String, frame: float, definition: Dictionary, stride: float, kind: String = "hero") -> Dictionary:
	var t := frame / maxf(1.0, float(definition.get("frames", 48)))
	var breathe := sin(t * TAU) * 0.65
	var p := {"hip": Vector2(0, -43 + breathe), "chest": Vector2(0, -73 + breathe),
		"head": Vector2(0, -85 + breathe), "rear_foot": Vector2(-10, -1), "front_foot": Vector2(11, 0),
		"rear_hand": Vector2(-17, -52 + breathe), "hand": Vector2(20, -60 + breathe),
		"blade": -0.72, "twist": 0.0, "cloth": 0.0, "cloth_time": 0.0, "fall": 0.0}
	if id == "move":
		var fast := kind != "boss"
		var stride_size := 19.5 if fast else 13.0
		var a := fposmod(stride / TAU, 1.0)
		var b := fposmod(a + 0.5, 1.0)
		p.rear_foot = stride_foot(a, stride_size) + Vector2(-2, -1)
		p.front_foot = stride_foot(b, stride_size) + Vector2(2, 0)
		var bob := -absf(sin(stride * 2.0)) * 2.7
		p.hip = Vector2(-1, -42 + bob)
		p.chest = Vector2(7, -71 + bob)
		p.head = Vector2(8, -84 + bob)
		p.rear_hand = Vector2(-5 + cos(stride) * 14, -56 + sin(stride) * 4)
		p.hand = Vector2(19 - cos(stride) * 9, -62 - sin(stride) * 4)
		p.blade = -0.64 + cos(stride) * 0.18
		p.cloth = 1.0
	elif id in ["slash", "slash2", "slash3", "skill", "execute", "airSlash", "bossSlam", "bossSweep", "bossCleave", "bossAttack"]:
		var boxes: Array = definition.get("hitboxes", [])
		var impact := float(boxes[0].activeFrom) if not boxes.is_empty() else float(definition.get("frames", 30)) * 0.45
		var end := float(boxes[0].activeTo) if not boxes.is_empty() else impact + 5.0
		var preparation := smoothstep(0.0, maxf(1.0, impact - 1.0), frame)
		var release := smoothstep(maxf(0.0, impact - 2.0), maxf(impact + 2.0, end - 1.0), frame)
		var recover := smoothstep(end + 1.0, float(definition.get("frames", 30)) - 1.0, frame)
		var hit_pose := attack_pose(id, release, preparation)
		p = blend_pose(p, hit_pose, 1.0 - recover * 0.85)
		p.cloth = sin(release * PI) * 2.0 + preparation * 0.5
	elif id in ["dash", "bossRush", "bossWindup"]:
		var push := sin(clampf(t, 0, 1) * PI)
		p.hip = Vector2(-9, -31)
		p.chest = Vector2(13, -52)
		p.head = Vector2(21, -66)
		p.rear_foot = Vector2(-31, -3 - push * 4)
		p.front_foot = Vector2(16, -3)
		p.rear_hand = Vector2(-18, -54)
		p.hand = Vector2(-7, -53)
		p.blade = -2.75
		p.cloth = 2.0
	elif id == "jump":
		var tuck := sin(t * PI)
		p.hip = Vector2(0, -40)
		p.chest = Vector2(7, -72)
		p.head = Vector2(6, -85)
		p.rear_foot = Vector2(-14, -10 - tuck * 16)
		p.front_foot = Vector2(15, -5 - tuck * 8)
		p.hand = Vector2(26, -80)
		p.rear_hand = Vector2(-21, -65)
		p.blade = -1.1
		p.cloth = 1.5
	elif id == "hit":
		var recoil := sin(minf(1.0, t * 1.8) * PI)
		p.hip += Vector2(-6 * recoil, 4 * recoil)
		p.chest += Vector2(-15 * recoil, 2 * recoil)
		p.head += Vector2(-18 * recoil, 3 * recoil)
		p.hand = Vector2(15, -48)
		p.rear_hand = Vector2(-26, -69)
		p.blade = 0.28
	elif id == "bossSummon":
		var rise := sin(t * PI)
		p.hand = Vector2(25, -65 - rise * 30)
		p.rear_hand = Vector2(-30, -63 - rise * 25)
		p.blade = -1.4
		p.chest += Vector2(0, -rise * 3)
		p.head += Vector2(0, -rise * 4)
	if kind == "boss":
		p.head += Vector2(0, -4)
		p.rear_hand += Vector2(-3, 0)
		if id in ["idle", "move"]:
			p.hand += Vector2(0, 6)
			p.blade = -1.16
	return p

static func stride_distance(kind: String) -> float:
	# 支撑期占 60%，脚后移距离必须抵消这段世界位移；包含角色缩放才能真正锁住落脚点。
	return (26.0 * 1.42 if kind == "boss" else 39.0 * (0.96 if kind == "grunt" else 1.0)) / 0.6

static func stride_foot(phase: float, stride_size: float) -> Vector2:
	# 前半周期支撑脚向后匀速滚动；后半周期抬脚收腿回摆，脚尖不会划地或同时漂浮。
	if phase < 0.6:
		return Vector2(lerpf(stride_size, -stride_size, phase / 0.6), 0)
	var flight := (phase - 0.6) / 0.4
	return Vector2(lerpf(-stride_size, stride_size, smoothstep(0, 1, flight)), -sin(flight * PI) * 16)

static func attack_pose(id: String, release: float, preparation: float) -> Dictionary:
	var windup_hand := Vector2(-16, -88)
	var end_hand := Vector2(33, -51)
	var windup_angle := -2.15
	var end_angle := 0.65
	var hip_from := Vector2(-8, -40)
	var hip_to := Vector2(8, -39)
	var chest_from := Vector2(-11, -72)
	var chest_to := Vector2(15, -68)
	if id == "slash2":
		windup_hand = Vector2(-12, -40)
		end_hand = Vector2(28, -84)
		windup_angle = 2.6
		end_angle = 5.35
	elif id in ["slash3", "execute", "bossSlam"]:
		windup_hand = Vector2(-5, -100)
		end_hand = Vector2(29, -36)
		windup_angle = -2.18
		end_angle = 0.78
		hip_to.y = -33
		chest_to = Vector2(19, -61)
	elif id == "skill":
		windup_hand = Vector2(-22, -67)
		end_hand = Vector2(33, -64)
		windup_angle = -3.5
		end_angle = 2.4
		chest_to = Vector2(10, -73)
	elif id == "airSlash":
		windup_hand = Vector2(2, -96)
		end_hand = Vector2(30, -48)
		windup_angle = -1.85
		end_angle = 0.75
	var hand := Vector2(20, -60).lerp(windup_hand, preparation).lerp(end_hand, release)
	var hip := Vector2(0, -43).lerp(hip_from, preparation).lerp(hip_to, release)
	var chest := Vector2(0, -73).lerp(chest_from, preparation).lerp(chest_to, release)
	return {"hip": hip, "chest": chest, "head": chest + Vector2(-2, -13),
		"rear_foot": Vector2(-17 - release * 6, -1), "front_foot": Vector2(16 + release * 8, 0),
		"hand": hand, "rear_hand": hand + Vector2(-9, 6) if id in ["slash3", "execute", "bossSlam"] else Vector2(-21, -58).lerp(Vector2(-8, -61), release),
		"blade": lerpf(lerpf(-0.72, windup_angle, preparation), end_angle, release), "twist": sin(release * PI), "fall": 0.0}

static func knee_joint(hip: Vector2, foot: Vector2, bend: float = 1.0, length_a: float = 23.5, length_b: float = 24.0) -> Vector2:
	var diff := foot - hip
	var distance := clampf(diff.length(), 0.01, length_a + length_b - 0.01)
	var direction := diff.normalized()
	var along := (length_a * length_a - length_b * length_b + distance * distance) / (2.0 * distance)
	var height := sqrt(maxf(0.0, length_a * length_a - along * along))
	return hip + direction * along + Vector2(-direction.y, direction.x) * height * bend

func _draw() -> void:
	if pose.is_empty() or not is_instance_valid(actor):
		return
	var boss := actor.kind == "boss"
	var rig_scale := 1.42 if boss else (0.96 if actor.kind == "grunt" else 1.0)
	_draw_shadow(rig_scale)
	_draw_telegraph()
	var turn := signf(facing_visual)
	if turn == 0:
		turn = actor.facing
	# 换向由关节过渡承担，保持人物厚度，不把身体压成纸片。
	var width := 1.0
	var fall := smoothstep(0, 22, maxf(0, actor.dead_frames - 1 + tick_fraction)) if actor.is_dead() else 0.0
	var root_offset := Vector2(-8 * actor.facing * fall, -render_lift - 12 * fall)
	draw_set_transform(root_offset, -1.42 * actor.facing * fall, Vector2(turn * width * rig_scale, rig_scale))
	_draw_character()
	_draw_sword_trail()
	draw_set_transform(Vector2.ZERO)
	if not actor.is_dead() and actor.kind != "hero":
		_draw_health(rig_scale)

func _draw_character() -> void:
	var hero := actor.kind == "hero"
	var boss := actor.kind == "boss"
	var cloth := CLOTH if hero else (Color("465453") if boss else Color("84564a"))
	var highlight := LIGHT if hero else (Color("748080") if boss else Color("ae7b5b"))
	var shade := SHADE if hero else (Color("2b3639") if boss else Color("533f3b"))
	var hip: Vector2 = pose.hip
	var chest: Vector2 = pose.chest
	var head: Vector2 = pose.head
	var front: Vector2 = pose.front_foot
	var rear: Vector2 = pose.rear_foot
	var hand: Vector2 = pose.hand
	var rear_hand: Vector2 = pose.rear_hand
	var wind: float = pose.get("cloth", 0.0)
	var cloth_clock: float = pose.get("cloth_time", 0.0)
	var sash_root := chest + Vector2(-4, -6)
	_draw_scarf(sash_root, wind, cloth_clock, Color("ba5145") if hero else Color("817853"))
	# 远腿/远臂先绘制，衣摆盖住髋关节，近腿与握刀手最后覆盖，保持三分之四视角层次。
	_draw_leg(hip + Vector2(-5, 0), rear, shade, true)
	_draw_arm(chest + Vector2(-7, 3), rear_hand, shade, true)
	_draw_scabbard(hip)
	_draw_leg(hip + Vector2(5, 1), front, cloth, false)
	var tail := sin(cloth_clock * 9.0 - 1.0) * (2 + wind * 3)
	_poly([hip + Vector2(-12, -8), hip + Vector2(10, -4), hip + Vector2(13, 18), hip + Vector2(0, 15), hip + Vector2(-20 - wind * 6, 24 + tail)], shade)
	_poly([hip + Vector2(-5, -7), hip + Vector2(11, -6), hip + Vector2(17, 16), hip + Vector2(4, 20), hip + Vector2(-2, 8)], cloth)
	_line(hip + Vector2(8, 1), hip + Vector2(12, 15), highlight, 1.1)
	_poly([chest + Vector2(-12, -4), chest + Vector2(8, -5), chest + Vector2(14, 6), hip + Vector2(10, 2), hip + Vector2(-11, 0), chest + Vector2(-14, 10)], cloth)
	_poly([chest + Vector2(-11, -2), chest + Vector2(-4, 0), hip + Vector2(-1, -1), hip + Vector2(-10, 0)], shade, false)
	_poly([chest + Vector2(-2, -3), chest + Vector2(9, -4), chest + Vector2(7, 6), hip + Vector2(-4, -6), hip + Vector2(-7, -8)], highlight, false)
	_line(chest + Vector2(7, 1), hip + Vector2(-5, -5), GOLD, 1.2)
	_line(chest + Vector2(1, 12), hip + Vector2(6, -7), shade, 1.3)
	# 多层绑带与护肩形成可辨识装备轮廓，避免用圆柱替代人体结构。
	_draw_armor(chest, hip, boss)
	_poly([hip + Vector2(-12, -5), hip + Vector2(12, -6), hip + Vector2(12, 0), hip + Vector2(-12, 1)], Color("563e31"))
	_poly([hip + Vector2(-1, -5), hip + Vector2(5, -5), hip + Vector2(5, 0), hip + Vector2(-1, 0)], GOLD)
	_line(hip + Vector2(1, -4), hip + Vector2(1, -1), PAPER, 1)
	_draw_head(head, boss, hero)
	_draw_arm(chest + Vector2(9, 3), hand, cloth, false)
	_draw_weapon(hand, float(pose.blade), boss, hero)
	_disk(hand, 3.2, Color("b78d68"), true)
	_line(hand + Vector2(-2, 0), hand + Vector2(1, 2), Color("eed0a0"), 1.0)
	if hero:
		_poly([chest + Vector2(-9, -7), chest + Vector2(8, -7), chest + Vector2(9, -2), chest + Vector2(-5, 1), chest + Vector2(-10, -2)], SCARF)
		_line(chest + Vector2(-7, -5), chest + Vector2(5, -4), Color("e07960"), 1.5)
	if actor.invulnerability > 0 and actor.state.id == "hit":
		draw_arc(chest, 24, -2.8, -0.3, 14, Color(1, 0.78, 0.52, 0.5), 1.2, true)

func _draw_shadow(rig_scale: float) -> void:
	var shadow := clampf(1.0 - actor.visual_height / 110.0, 0.5, 1.0)
	draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.23))
	draw_circle(Vector2.ZERO, 23 * rig_scale * shadow, Color(0.05, 0.11, 0.11, 0.12 * shadow))
	draw_circle(Vector2.ZERO, 17 * rig_scale * shadow, Color(0.03, 0.08, 0.09, 0.2 * shadow))
	draw_set_transform(Vector2.ZERO)

func _draw_scarf(root: Vector2, wind: float, time: float, color: Color) -> void:
	var points: Array[Vector2] = []
	var lower: Array[Vector2] = []
	for i in 9:
		var u := i / 8.0
		var x := -(u * (31.0 + wind * 11.0))
		var y := sin(u * 6.5 - time * 6.0) * (2.0 + wind * 2.0) * u + u * 10 - wind * u * 6
		points.append(root + Vector2(x, y))
		lower.push_front(root + Vector2(x + u * 2, y + lerpf(7, 2, u)))
	points.append_array(lower)
	_poly(points, color)
	var upper := PackedVector2Array(points.slice(0, 9))
	draw_polyline(upper, color.lightened(0.18), 1.1, true)

func _draw_leg(hip: Vector2, foot: Vector2, cloth: Color, far: bool) -> void:
	var knee := knee_joint(hip, foot + Vector2(-1, -3), -1.0)
	_segment(hip, knee, 7.5, 6.2, cloth)
	_segment(knee, foot + Vector2(-1, -4), 5.3, 4.0, Color("354044") if far else Color("414b4a"))
	var shin := (foot - knee).normalized()
	var normal := Vector2(-shin.y, shin.x)
	for i in 4:
		var c := knee.lerp(foot, 0.28 + i * 0.13)
		_line(c - normal * 4.0, c + normal * 4.0 + shin * 1.2, Color("71817c") if not far else Color("50615f"), 1.1)
	_poly([foot + Vector2(-5, -6), foot + Vector2(4, -6), foot + Vector2(6, -2), foot + Vector2(11, -1), foot + Vector2(11, 1), foot + Vector2(-5, 1)], Color("293336"))
	_line(foot + Vector2(-4, 0), foot + Vector2(10, 0), Color("9d8b6c"), 1.1)
	_line(hip + Vector2(2, 4), knee + Vector2(3, -4), cloth.lightened(0.18), 1.1)

func _draw_arm(shoulder: Vector2, hand: Vector2, cloth: Color, far: bool) -> void:
	var elbow := knee_joint(shoulder, hand, 1.0 if far else -1.0, 17.0, 18.0)
	_segment(shoulder, elbow, 7.5, 5.5, cloth)
	_segment(elbow, hand, 5, 3.4, Color("394746") if far else Color("4a514a"))
	var dir := (hand - elbow).normalized()
	var normal := Vector2(-dir.y, dir.x)
	for i in 3:
		var at := elbow.lerp(hand, 0.36 + i * 0.16)
		_line(at - normal * 3.6, at + normal * 3.6 + dir, Color("a08c6b"), 1.1)
	_line(shoulder + Vector2(2, 1), elbow + Vector2(2, -1), cloth.lightened(0.18), 1.1)
	if far:
		_disk(hand, 3, Color("9b7757"), true)

func _draw_armor(chest: Vector2, hip: Vector2, boss: bool) -> void:
	var bronze := Color("71694f") if boss else Color("625241")
	_poly([chest + Vector2(3, -5), chest + Vector2(13, -5), chest + Vector2(19, 4), chest + Vector2(17, 10), chest + Vector2(8, 7)], bronze)
	_line(chest + Vector2(7, -3), chest + Vector2(13, -3), GOLD, 1.6)
	for i in 3:
		_line(chest + Vector2(9, 1 + i * 2), chest + Vector2(16, 3 + i * 2), bronze.lightened(0.18), 1)
	if boss:
		_poly([chest + Vector2(-15, -6), chest + Vector2(-3, -6), chest + Vector2(0, 4), chest + Vector2(-17, 8), chest + Vector2(-23, 2)], bronze)
		_poly([chest + Vector2(-9, 5), chest + Vector2(9, 5), hip + Vector2(9, -4), hip + Vector2(-7, -4)], Color("525e5b"))
		for i in 4:
			var y := 8 + i * 4
			_line(chest + Vector2(-8, y), chest + Vector2(9, y), GOLD, 1)
		_disk(chest + Vector2(0, 12), 3, Color("d19a54"), true)

func _draw_scabbard(hip: Vector2) -> void:
	var from := hip + Vector2(-8, -5)
	var to := hip + Vector2(-33, 24)
	_segment(from, to, 2.8, 1.9, Color("28383b"))
	_line(to + Vector2(-1, -2), to + Vector2(1, 0), GOLD, 2)
	_line(from + Vector2(1, 0), to + Vector2(1, 0), Color("72634d"), 0.8)

func _draw_head(head: Vector2, boss: bool, hero: bool) -> void:
	if boss:
		_poly([head + Vector2(-9, -9), head + Vector2(6, -12), head + Vector2(12, -3), head + Vector2(9, 11), head + Vector2(1, 15), head + Vector2(-10, 9)], Color("b7ab85"))
		_poly([head + Vector2(-9, -8), head + Vector2(-1, -10), head + Vector2(0, 12), head + Vector2(-10, 8)], Color("736e5a"), false)
		_poly([head + Vector2(4, -5), head + Vector2(10, -1), head + Vector2(7, 5), head + Vector2(2, 1)], Color("384644"))
		_line(head + Vector2(3, -1), head + Vector2(8, 0), Color("ffbc63"), 1.5)
		_line(head + Vector2(0, 7), head + Vector2(6, 8), INK, 1.2)
		_poly([head + Vector2(-9, -7), head + Vector2(-15, -17), head + Vector2(-9, -14), head + Vector2(-4, -8)], Color("7e7459"))
		_poly([head + Vector2(6, -8), head + Vector2(14, -18), head + Vector2(13, -7)], Color("c4b788"))
		_line(head + Vector2(-4, -6), head + Vector2(-4, 8), Color("4c5550"), 1)
		return
	_poly([head + Vector2(-7, -5), head + Vector2(5, -6), head + Vector2(9, 0), head + Vector2(8, 8), head + Vector2(3, 12), head + Vector2(-5, 8)], Color("c19e77"))
	_poly([head + Vector2(-7, -5), head + Vector2(0, -3), head + Vector2(0, 10), head + Vector2(-6, 8)], Color("75654f"), false)
	_line(head + Vector2(3, 2), head + Vector2(7, 2), INK, 1.4)
	_line(head + Vector2(5, 8), head + Vector2(8, 7), Color("6f5544"), 1)
	if hero:
		# 宽帽檐遮住上半脸；竹编纹理顺锥面辐射，剪影在缩小后仍是主角的识别点。
		_poly([head + Vector2(-24, -2), head + Vector2(-3, -20), head + Vector2(24, -3), head + Vector2(14, 2), head + Vector2(-13, 3)], PAPER)
		_poly([head + Vector2(-24, -2), head + Vector2(-3, -20), head + Vector2(-5, -2)], Color("c5b48a"), false)
		_poly([head + Vector2(-24, -2), head + Vector2(-13, 3), head + Vector2(14, 2), head + Vector2(24, -3), head + Vector2(1, -1)], Color("796f55"), false)
		for i in 9:
			var x := -20.0 + i * 5
			_line(head + Vector2(-3, -18), head + Vector2(x, -2), Color(0.55, 0.48, 0.33, 0.52), 0.7)
		_line(head + Vector2(-16, -7), head + Vector2(17, -7), Color("aa966f"), 0.85)
		_line(head + Vector2(-11, -12), head + Vector2(9, -12), Color("b7a279"), 0.8)
		_line(head + Vector2(-23, -2), head + Vector2(23, -3), Color("f7e8c4"), 1.4)
		_line(head + Vector2(-7, 2), head + Vector2(1, 14), Color("d5c094"), 0.75)
	else:
		_poly([head + Vector2(-10, -2), head + Vector2(-6, -12), head + Vector2(4, -12), head + Vector2(10, -4), head + Vector2(8, -1)], Color("655d4f"))
		_poly([head + Vector2(-8, 5), head + Vector2(10, 4), head + Vector2(7, 11), head + Vector2(-5, 10)], Color("9e7659"))
		_line(head + Vector2(-6, 6), head + Vector2(8, 6), Color("b49c75"), 1)

func _draw_weapon(hand: Vector2, angle: float, boss: bool, hero: bool) -> void:
	var axis := Vector2.from_angle(angle)
	var normal := Vector2(-axis.y, axis.x)
	if boss:
		var butt := hand - axis * 31
		var tip := hand + axis * 56
		_line(butt, tip, INK, 4.8)
		_line(butt, tip, Color("95866c"), 2.6)
		_poly([tip - axis * 10 - normal * 2, tip + axis * 16 - normal * 1, tip + axis * 7 + normal * 12, tip - axis * 10 + normal * 8], Color("b8c2af"))
		_line(tip + axis * 15, tip + axis * 7 + normal * 11, Color("f5e6bd"), 1.7)
		_line(hand + axis * 25, hand + axis * 30, SCARF, 5)
	else:
		var tip := hand + axis * (45 if hero else 35)
		var guard := hand + axis * 6
		_poly([guard - normal * 2.1, tip - normal * 1.0, tip + axis * 5 - normal * 3.0, tip + normal * 2.3, guard + normal * 3], Color("b1c6c0"))
		_line(guard + normal * 2, tip + normal * 2, Color("f7f0d6"), 1.45)
		_line(guard - normal * 5, guard + normal * 5, GOLD, 3)
		_line(hand - axis * 8, guard - axis * 2, INK, 4)
		for i in 3:
			var c := hand - axis * (2 + i * 2)
			_line(c - normal * 1.5, c + normal * 1.5 + axis, GOLD, 0.8)

func _draw_sword_trail() -> void:
	if actor.is_dead():
		return
	var definition := actor.state.definition()
	var boxes: Array = definition.get("hitboxes", [])
	if boxes.is_empty():
		return
	var active_from := float(boxes[0].activeFrom)
	var active_to := float(boxes[0].activeTo)
	if render_frame < active_from - 1 or render_frame > active_to + 3:
		return
	var release := clampf((render_frame - active_from + 1) / maxf(1, active_to - active_from + 4), 0, 1)
	var color := Color("c3e6d5") if actor.kind == "hero" else Color("e6ae71")
	color.a = sin(release * PI) * 0.82
	var center: Vector2 = pose.chest + Vector2(7, 8)
	var radius := 62.0 if actor.kind == "hero" else 66.0
	var angle := float(pose.blade)
	var span := 1.55 * sin(release * PI)
	var outer: Array[Vector2] = []
	var inner: Array[Vector2] = []
	for i in 17:
		var u := i / 16.0
		var a := angle - span + span * u
		outer.append(center + Vector2.from_angle(a) * radius)
		inner.push_front(center + Vector2.from_angle(a) * (radius - sin(u * PI) * 8))
	outer.append_array(inner)
	if absf(span) > 0.01:
		_poly(outer, color, false)
		draw_arc(center, radius, angle - span * 0.8, angle, 18, Color(1, 0.97, 0.81, color.a), 1.4, true)

func _draw_telegraph() -> void:
	if actor.kind == "hero" or actor.is_dead():
		return
	var definition := actor.state.definition()
	if not definition.has("telegraph") or render_frame >= float(definition.telegraph.until):
		return
	var t := render_frame / maxf(1, definition.telegraph.until)
	var boxes: Array = definition.get("hitboxes", [])
	var shape: Dictionary = definition.telegraph.get("shape", {})
	if boxes.is_empty() and shape.get("kind", "") == "line":
		var begin := Vector2(-float(shape.length) if actor.facing < 0 else 0.0, -float(shape.width) * 0.5)
		draw_style_box(_telegraph_style(t), Rect2(begin, Vector2(shape.length, shape.width)))
	for box in boxes:
		var center := Vector2(float(box.offset.x) * actor.facing, box.offset.y)
		var half := Vector2(box.halfWidth, box.halfDepth)
		draw_style_box(_telegraph_style(t), Rect2(center - half, half * 2))
		draw_line(center - Vector2(half.x, 0), center + Vector2(half.x * (2 * t - 1), 0), Color(1, 0.7, 0.4, 0.6), 1.3, true)

func _telegraph_style(progress: float) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.79, 0.28, 0.16, 0.08 + progress * 0.14)
	style.border_color = Color(0.95, 0.54, 0.31, 0.42 + progress * 0.3)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	return style

func _draw_health(rig_scale: float) -> void:
	var y := -120.0 * rig_scale - render_lift
	var half := 23.0 if actor.kind == "grunt" else 32.0
	draw_line(Vector2(-half, y), Vector2(half, y), Color("243336"), 4)
	draw_line(Vector2(-half, y), Vector2(lerpf(-half, half, clampf(actor.hp / actor.max_hp, 0, 1)), y), Color("c58158"), 2)
	if actor.hp / actor.max_hp < 0.25:
		draw_arc(Vector2(0, y - 9), 4, 0, TAU, 16, Color("edd399"), 1.1, true)

func _poly(points: Array, color: Color, outline: bool = true) -> void:
	var packed := PackedVector2Array(points)
	draw_colored_polygon(packed, color)
	if outline:
		packed.append(packed[0])
		draw_polyline(packed, INK, 1.35, true)

func _line(from: Vector2, to: Vector2, color: Color, width: float) -> void:
	draw_line(from, to, color, width, true)

func _disk(at: Vector2, radius: float, color: Color, outline: bool) -> void:
	draw_circle(at, radius, color)
	if outline:
		draw_arc(at, radius, 0, TAU, 16, INK, 1.0, true)

func _segment(from: Vector2, to: Vector2, start_width: float, end_width: float, color: Color) -> void:
	var direction := (to - from).normalized()
	var normal := Vector2(-direction.y, direction.x)
	_poly([from + normal * start_width, to + normal * end_width, to - normal * end_width, from - normal * start_width], color)
