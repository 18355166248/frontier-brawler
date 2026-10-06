class_name FBEnemyThreats
extends Node2D
## 远程威胁只随 Run 的 60Hz tick 推进，渲染不触发伤害；换房统一清空。

var arrows: Array[Dictionary] = []
var bursts: Array[Dictionary] = []
var warnings: Array[Dictionary] = []
var released: Dictionary = {}
var shots := 0
var casts := 0

func clear_all() -> void:
	arrows.clear()
	bursts.clear()
	warnings.clear()
	released.clear()
	queue_redraw()

func remote_owner() -> FBActor:
	for a in arrows:
		var owner: FBActor = a.owner.get_ref()
		if is_instance_valid(owner):
			return owner
	return null

static func vulnerable(hero: FBActor) -> bool:
	return not hero.is_dead() and hero.invulnerability == 0 and not hero.state.in_window("invuln") and not hero.state.in_window("airborne") and hero.launch_remaining == 0

static func swept_touch(start: Vector2, end: Vector2, center: Vector2, half: Vector2) -> bool:
	# 线段对扩张命中盒做 slab 检查，不能只看终点，否则高速箭会穿过玩家。
	var near := 0.0
	var far := 1.0
	var direction := end - start
	for axis in 2:
		if absf(direction[axis]) < 0.00001:
			if absf(start[axis] - center[axis]) > half[axis]:
				return false
		else:
			var a := (center[axis] - half[axis] - start[axis]) / direction[axis]
			var b := (center[axis] + half[axis] - start[axis]) / direction[axis]
			near = maxf(near, minf(a, b))
			far = minf(far, maxf(a, b))
			if near > far:
				return false
	return true

func step(actors: Array[FBActor], hero: FBActor, combat: FBCombat) -> void:
	warnings.clear()
	for burst in bursts.duplicate():
		burst.life -= 1
		if burst.life <= 0:
			bursts.erase(burst)
	for actor in actors:
		if actor.is_dead() or actor.stun > 0:
			continue
		var id := actor.get_instance_id()
		if actor.kind == "archer" and actor.state.id == "archerAim":
			warnings.append({"kind": "line", "origin": actor.attack_origin, "target": actor.attack_origin + actor.attack_direction * 420, "progress": actor.state.frame / 42.0})
		elif actor.kind == "archer" and actor.state.id == "archerShoot" and released.get(id, -1) != actor.attack_serial:
			released[id] = actor.attack_serial
			shots += 1
			arrows.append({"owner": weakref(actor), "position": actor.attack_origin, "velocity": actor.attack_direction * 6.2,
				"life": 90, "direction_x": actor.attack_direction.x, "distance": 0.0})
		elif actor.kind == "mage" and actor.state.id == "lanternCast":
			var release_frame: int = actor.state.definition().releaseFrame
			if actor.state.frame < release_frame:
				warnings.append({"kind": "zone", "target": actor.attack_target, "progress": float(actor.state.frame) / release_frame})
			elif released.get(id, -1) != actor.attack_serial:
				# 蓄势期间受击/死亡会退出 cast，取消落点；释放后爆发仅结算一次。
				released[id] = actor.attack_serial
				casts += 1
				bursts.append({"target": actor.attack_target, "life": 12})
				if vulnerable(hero):
					var delta := hero.position - actor.attack_target
					var normalized := Vector2(delta.x / (44 + hero.radius), delta.y / 30)
					if normalized.length_squared() <= 1:
						combat.deal(actor, hero, {"damage": 14, "knockback": 2.0, "hitStop": 5})
	for arrow in arrows.duplicate():
		var previous: Vector2 = arrow.position
		arrow.position += arrow.velocity
		arrow.distance += (arrow.velocity as Vector2).length()
		arrow.life -= 1
		var owner: FBActor = arrow.owner.get_ref()
		# 已释放箭保留短时飞行，发射者死亡不撤箭；换房/重开由 clear_all 清理。
		if not is_instance_valid(owner) or arrow.life <= 0 or arrow.distance > 420:
			arrows.erase(arrow)
			continue
		if vulnerable(hero) and swept_touch(previous, arrow.position, hero.position, Vector2(hero.radius + 7, 15)):
			combat.deal(owner, hero, {"damage": 11, "knockback": 2.0, "hitStop": 4, "direction_x": arrow.direction_x})
			arrows.erase(arrow)
	queue_redraw()

func _draw() -> void:
	for warning in warnings:
		var color := Color(1.0, 0.73, 0.35, 0.55 + float(warning.progress) * 0.3)
		if warning.kind == "line":
			draw_line(warning.origin, warning.target, Color(0.95, 0.46, 0.18, 0.15), 18, true)
			draw_dashed_line(warning.origin, warning.target, color, 2, 10, true)
		else:
			draw_set_transform(warning.target, 0, Vector2(1, 18.0/44.0))
			draw_circle(Vector2.ZERO, 44, Color(0.40, 0.80, 0.96, 0.15))
			draw_arc(Vector2.ZERO, 44, 0, TAU, 48, Color(0.68, 0.94, 1, 0.9), 2, true)
			draw_arc(Vector2.ZERO, 40, -PI/2, -PI/2 + TAU * float(warning.progress), 48, Color(0.85, 0.78, 1, 0.95), 3, true)
			draw_set_transform(Vector2.ZERO)
	for arrow in arrows:
		var at: Vector2 = arrow.position + Vector2(0, -42)
		var direction: Vector2 = (arrow.velocity as Vector2).normalized()
		draw_line(at - direction * 19, at, Color("efdfad"), 2.2, true)
		draw_line(at - direction * 4 + direction.orthogonal() * 3, at, Color("ffffff"), 1.5, true)
		draw_line(at - direction * 4 - direction.orthogonal() * 3, at, Color("ffffff"), 1.5, true)
	for burst in bursts:
		var strength := float(burst.life)/12.0
		draw_set_transform(burst.target, 0, Vector2(1, 18.0/44.0))
		draw_circle(Vector2.ZERO, 44, Color(0.58, 0.87, 1, strength * 0.55))
		draw_arc(Vector2.ZERO, 44, 0, TAU, 48, Color(0.82, 0.75, 1, strength), 3, true)
		draw_set_transform(Vector2.ZERO)
		draw_line(burst.target, burst.target + Vector2(0, -70), Color(0.72, 0.95, 1, strength), 5, true)
