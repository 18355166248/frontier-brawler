class_name FBEnemyDirector
extends RefCounted

var tokens: Array[FBActor] = []
var attacked: Dictionary = {}
var tick_count := 0

func update(actors: Array[FBActor], hero: FBActor) -> void:
	tick_count += 1
	# 一次攻击释放后才交还名额，防止同屏敌人同时打出不可反击的硬直链。
	for actor in tokens.duplicate():
		if is_instance_valid(actor) and actor.state.id not in ["idle", "move", "hit"]:
			attacked[actor.get_instance_id()] = true
		if not is_instance_valid(actor) or actor.is_dead() or actor.state.id == "hit" or (attacked.has(actor.get_instance_id()) and actor.state.id in ["idle", "move"]):
			tokens.erase(actor)
			if is_instance_valid(actor):
				attacked.erase(actor.get_instance_id())
				actor.attack_cooldown = int(FBData.all().enemies[actor.kind].tokenCooldown)
	var candidates: Array[FBActor] = []
	for actor in actors:
		if actor.kind != "hero" and not actor.is_dead() and actor.attack_cooldown == 0 and not tokens.has(actor):
			candidates.append(actor)
	candidates.sort_custom(func(a: FBActor, b: FBActor): return a.position.distance_squared_to(hero.position) < b.position.distance_squared_to(hero.position))
	for actor in candidates:
		if tokens.size() >= 2:
			break
		tokens.append(actor)

func intent(actor: FBActor, hero: FBActor) -> Dictionary:
	if not actor.state.can_interrupt():
		return {}
	var delta := hero.position - actor.position
	var distance := maxf(0.001, delta.length())
	var profile: Dictionary = FBData.all().enemies[actor.kind]
	if tokens.has(actor):
		if absf(delta.x) > 1:
			actor.facing = 1 if delta.x > 0 else -1
		if distance <= profile.reach and absf(delta.y) < (40 if actor.kind == "boss" else 22):
			return {"attack": true}
		return {"move": delta / distance}
	if distance < profile.standoff * 0.85:
		return {"move": -delta / distance}
	if distance > profile.standoff * 1.25:
		return {"move": delta / distance}
	return {"move": Vector2(0, sin(tick_count * 0.025 + actor.get_index()) * 0.5)}

func separate(actors: Array[FBActor], arena: Rect2) -> void:
	for i in actors.size():
		var a := actors[i]
		if a.is_dead():
			continue
		for j in range(i + 1, actors.size()):
			var b := actors[j]
			if b.is_dead():
				continue
			var delta := b.position - a.position
			delta.y *= 1.6
			var distance := delta.length()
			if distance >= a.radius + b.radius:
				continue
			# 完全重叠时指定稳定分离方向，避免零向量使单位永久叠在一起。
			var normal := delta / distance if distance > 0.001 else Vector2.RIGHT
			var push := normal * (a.radius + b.radius - distance) * 0.5
			push.y /= 1.6
			a.position -= push
			b.position += push
	for actor in actors:
		actor.position = actor.position.clamp(arena.position, arena.end)
