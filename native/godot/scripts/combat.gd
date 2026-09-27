class_name FBCombat
extends RefCounted

signal hit(target: FBActor, damage: float, killed: bool, perfect: bool)
signal phase_shift(actor: FBActor)
var freeze_frames := 0
var kills := 0
var executes := 0
var damage_taken := 0.0

func execute_target(hero: FBActor, actors: Array[FBActor]) -> FBActor:
	var best: FBActor = null
	var distance := 62.0
	for actor in actors:
		if actor.kind == "hero" or actor.is_dead() or actor.hp / actor.max_hp >= 0.25:
			continue
		var d := hero.position.distance_to(actor.position)
		if d <= distance:
			distance = d
			best = actor
	return best

func resolve(actors: Array[FBActor]) -> void:
	for attacker in actors:
		if attacker.is_dead():
			continue
		for box in attacker.state.definition().hitboxes:
			if attacker.state.frame < box.activeFrom or attacker.state.frame >= box.activeTo:
				continue
			var center := attacker.position + Vector2(box.offset.x * attacker.facing, box.offset.y)
			for target in actors:
				if target.is_dead() or (target.kind == "hero") == (attacker.kind == "hero"):
					continue
				if target.invulnerability > 0 or target.state.in_window("invuln"):
					continue
				if target.state.in_window("airborne") and not box.get("hitsAir", false):
					continue
				if attacker.state.hit_targets.has(target.get_instance_id()):
					continue
				var delta := (target.position - center).abs()
				var half_depth := 12.0 if target.kind == "hero" else roundf(target.radius * 0.78)
				if delta.x <= box.halfWidth + target.radius and delta.y <= box.halfDepth + half_depth:
					attacker.state.hit_targets[target.get_instance_id()] = true
					deal(attacker, target, box)

func deal(attacker: FBActor, target: FBActor, box: Dictionary) -> void:
	var damage: float = box.damage
	if attacker.kind == "hero":
		damage *= attacker.skill_multiplier if attacker.state.id == "skill" else attacker.damage_multiplier
	var perfect := attacker.state.perfect_pending
	if perfect:
		damage *= 1.15
		attacker.state.perfect_pending = false
	var execution := attacker.state.id == "execute"
	if execution:
		damage = target.hp
	target.hp = maxf(0, target.hp - damage)
	if target.state.definition().get("superArmor", false):
		target.invulnerability = maxi(target.invulnerability, 6)
	else:
		target.knockback = Vector2(box.knockback * attacker.facing, 0)
		target.stun = 12
		target.invulnerability = 20
		target.state.change("hit")
	if target.kind == "hero":
		damage_taken += damage
	elif target.is_dead():
		kills += 1
	elif target.kind == "boss" and target.boss_phase == 1 and target.hp / target.max_hp <= 0.5:
		# 首关教学 Boss 只切阶段与留输出窗，不召唤后期敌人。
		target.boss_phase = 2
		target.state.change("bossSummon")
		phase_shift.emit(target)
	if attacker.kind == "hero":
		attacker.energy = minf(100, attacker.energy + (25 if execution else 7))
	if execution and target.is_dead():
		executes += 1
		attacker.hp = minf(attacker.max_hp, attacker.hp + 14 + attacker.heal_bonus)
	freeze_frames = maxi(freeze_frames, int(box.hitStop) + (4 if target.is_dead() else 0))
	hit.emit(target, damage, target.is_dead(), perfect)
