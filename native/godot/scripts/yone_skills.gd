class_name FBYoneSkills
extends RefCounted
## 英雄四技能权威状态。全部期限用同一逻辑tick；没有Timer/Tween或动画回调结算。

const INPUTS := ["yone_q", "yone_w", "yone_e", "yone_r"]
var owner: FBActor
var cooldowns := {"q": 0, "w": 0, "e": 0, "r": 0}
var q_stacks := 0
var q_remaining := 0
var shield := 0.0
var shield_remaining := 0
var e_active := false
var e_anchor := Vector2.ZERO
var e_facing := 1
var e_remaining := 0
var ledger: Dictionary = {}
var echo_pending: Dictionary = {}
var echo_total := 0.0
var echo_count := 0
var return_count := 0
var cast_direction := Vector2.RIGHT
var cast_origin := Vector2.ZERO
var cast_serial := 0
var cast_hits := 0
var r_released := false
var r_end := Vector2.ZERO
var r_targets: Array[int] = []
var r_slots: Dictionary = {}

func attach(actor: FBActor) -> void:
	owner = actor

func tick() -> void:
	if owner.is_dead():
		clear_transients()
		return
	for key in cooldowns:
		cooldowns[key] = maxi(0, int(cooldowns[key]) - 1)
	q_remaining = maxi(0, q_remaining - 1)
	if q_remaining == 0:
		q_stacks = 0
	shield_remaining = maxi(0, shield_remaining - 1)
	if shield_remaining == 0:
		shield = 0.0
	if e_active:
		e_remaining -= 1
		if e_remaining <= 0:
			begin_return() # 到期强制回归，不被动作/受击硬直无限拖延。

func can_use(key: String) -> bool:
	return not owner.is_dead() and (key == "e" and e_active or cooldowns[key] == 0)

func try_intent(movement: Vector2) -> bool:
	if owner.state.in_window("airborne"):
		return false
	# 回归先于新进攻；所有输入仍受原can_interrupt与8帧缓冲控制。
	for key in ["e", "r", "w", "q"]:
		var input: String = "yone_" + key
		if not owner.state.has_buffer(input) or not can_use(key):
			continue
		owner.state.consume(input)
		if key == "e" and e_active:
			begin_return()
			return true
		owner.lock_direction(movement)
		cast_direction = Vector2(owner.locked_direction.x, owner.locked_direction.y * FBActor.DEPTH_SCALE).normalized()
		cast_origin = owner.position
		cast_serial += 1
		cast_hits = 0
		owner.state.perfect_pending = false
		owner.locomotion_velocity = Vector2.ZERO
		cooldowns[key] = int(FBData.yone()[key].cooldown)
		match key:
			"q":
				if q_stacks == 2:
					q_stacks = 0
					q_remaining = 0
					owner.state.change("windRush")
				else:
					owner.state.change("windThrust")
			"w":
				owner.state.change("guardSweep")
			"e":
				e_anchor = owner.position
				e_facing = owner.facing
				e_active = true
				e_remaining = int(FBData.yone().e.duration)
				ledger.clear()
				echo_total = 0.0
				echo_count = 0
				owner.state.change("spiritStart")
			"r":
				r_released = false
				r_targets.clear()
				r_slots.clear()
				r_end = (cast_origin + cast_direction * float(FBData.yone().r.reach)).clamp(owner.arena_bounds.position, owner.arena_bounds.end)
				owner.state.change("fateSever")
		return true
	return false

func begin_return() -> void:
	if not e_active or owner.is_dead():
		return
	e_active = false
	e_remaining = 0
	echo_pending = ledger.duplicate()
	ledger.clear()
	return_count += 1
	owner.position = e_anchor.clamp(owner.arena_bounds.position, owner.arena_bounds.end)
	owner.knockback = Vector2.ZERO
	owner.locomotion_velocity = Vector2.ZERO
	owner.stun = 0
	owner.visual_height = 0.0
	owner.state.perfect_pending = false
	owner.state.change("spiritReturn") # 没有判定框，不沿回归路径造成伤害。
	owner.state.consume("yone_e")

func record_damage(target: FBActor, amount: float) -> void:
	if not e_active or amount <= 0:
		return
	var id := target.get_instance_id()
	if not ledger.has(id):
		ledger[id] = {"target": weakref(target), "damage": 0.0}
	ledger[id].damage += amount

func on_hit(target: FBActor) -> void:
	cast_hits += 1
	match owner.state.id:
		"windThrust":
			if cast_hits == 1:
				q_stacks = mini(2, q_stacks + 1)
				q_remaining = int(FBData.yone().q.stack_expiry)
		"windRush":
			target.launch(int(FBData.yone().q.launch_frames), float(FBData.yone().q.launch_height))
		"guardSweep":
			var w: Dictionary = FBData.yone().w
			shield = maxf(shield, minf(w.shield_cap, w.shield_base + (cast_hits - 1) * w.shield_per_extra))
			shield_remaining = int(w.shield_duration)
		"fateSever":
			if r_slots.has(target.get_instance_id()):
				target.position = r_slots[target.get_instance_id()]
				target.previous_position = target.position # 聚拢用程序风线，避免敌人身体横穿整屏。
				target.knockback = Vector2.ZERO
				target.launch(int(FBData.yone().r.launch_frames), float(FBData.yone().r.launch_height))

func absorb(amount: float) -> float:
	var absorbed := minf(shield, amount)
	shield -= absorbed
	return amount - absorbed

func clear_transients() -> void:
	q_stacks = 0
	q_remaining = 0
	shield = 0.0
	shield_remaining = 0
	e_active = false
	e_anchor = Vector2.ZERO
	e_remaining = 0
	ledger.clear()
	echo_pending.clear()
	r_targets.clear()
	r_slots.clear()
	for input in INPUTS:
		owner.state.consume(input)

func prepare_r(actors: Array[FBActor]) -> void:
	if r_released:
		return
	r_released = true
	var furthest := -1.0
	var targets: Array[FBActor] = []
	for target in actors:
		if target.kind == "hero" or target.is_dead() or target.invulnerability > 0 or target.state.in_window("invuln"):
			continue
		if touches_segment(target, cast_origin, r_end, float(FBData.yone().r.width)):
			targets.append(target)
			r_targets.append(target.get_instance_id())
			furthest = maxf(furthest, (target.position - cast_origin).dot(cast_direction))
	if furthest >= 0:
		var distance := minf(float(FBData.yone().r.reach), furthest + float(FBData.yone().r.behind_target))
		r_end = (cast_origin + cast_direction * distance).clamp(owner.arena_bounds.position, owner.arena_bounds.end)
	owner.position = r_end
	# 在合法地面上找接近终点的格位，兼顾墙边、多目标半径，避免所有人叠一个点。
	var spacing := 36.0
	for target in targets:
		spacing = maxf(spacing, target.radius * 2 + float(FBData.yone().r.gather_padding))
	var bounds := owner.arena_bounds.grow(-spacing * 0.5)
	var center := (r_end - cast_direction * spacing).clamp(bounds.position, bounds.end)
	var available: Array[Vector2] = []
	for row in range(int(bounds.size.y / spacing) + 1):
		for col in range(int(bounds.size.x / spacing) + 1):
			var point := bounds.position + Vector2(col * spacing, row * spacing)
			if point.distance_to(owner.position) >= spacing:
				available.append(point)
	available.sort_custom(func(a: Vector2, b: Vector2): return a.distance_squared_to(center) < b.distance_squared_to(center))
	for i in targets.size():
		if i < available.size():
			r_slots[targets[i].get_instance_id()] = available[i]

func damage_box(box: Dictionary) -> Dictionary:
	var result := box.duplicate()
	match owner.state.id:
		"windThrust": result.damage = FBData.yone().q.damage
		"windRush": result.damage = FBData.yone().q.rush_damage
		"guardSweep": result.damage = FBData.yone().w.damage
		"fateSever": result.damage = FBData.yone().r.damage
	result.ability = true
	return result

func touches(target: FBActor, shape: String) -> bool:
	match shape:
		"thrust":
			return touches_segment(target, owner.position + cast_direction * 8, owner.position + cast_direction * float(FBData.yone().q.reach), float(FBData.yone().q.width))
		"sweep":
			return touches_segment(target, owner.previous_position - cast_direction * 8, owner.position + cast_direction * 18, float(FBData.yone().q.rush_width))
		"sector":
			var delta := target.position - owner.position
			var range_limit: float = FBData.yone().w.reach + target.radius
			if delta.length() > range_limit:
				return false
			if delta.length() <= target.radius:
				return true
			return delta.normalized().dot(cast_direction) >= cos(float(FBData.yone().w.half_angle))
		"line":
			return r_targets.has(target.get_instance_id())
	return false

static func touches_segment(target: FBActor, from: Vector2, to: Vector2, width: float) -> bool:
	var path := to - from
	var t := clampf((target.position - from).dot(path) / maxf(path.length_squared(), 0.001), 0.0, 1.0)
	return target.position.distance_to(from + path * t) <= width + target.radius * 0.78
