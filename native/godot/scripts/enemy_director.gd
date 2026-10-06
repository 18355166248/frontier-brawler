class_name FBEnemyDirector
extends RefCounted

var tokens: Array[FBActor] = []
var attacked: Dictionary = {}
var tick_count := 0
var waiting: Dictionary = {}
var granted_at: Dictionary = {}
var visible_x := Vector2(-100000, 100000)
var active_remote: FBActor

static func is_remote(actor: FBActor) -> bool:
	return actor.kind in ["archer", "mage"]

func update(actors: Array[FBActor], hero: FBActor, remote: FBActor = null) -> void:
	tick_count += 1
	active_remote = remote
	# 一次攻击释放后才交还名额，防止同屏敌人同时打出不可反击的硬直链。
	for actor in tokens.duplicate():
		if is_instance_valid(actor) and actor.state.id not in ["idle", "move", "hit"]:
			attacked[actor.get_instance_id()] = true
		if not is_instance_valid(actor) or actor.is_dead() or actor.state.id == "hit" or (attacked.has(actor.get_instance_id()) and actor.state.id in ["idle", "move"] and actor != active_remote) or tick_count - int(granted_at.get(actor.get_instance_id(), tick_count)) > 240:
			tokens.erase(actor)
			if is_instance_valid(actor):
				attacked.erase(actor.get_instance_id())
				granted_at.erase(actor.get_instance_id())
				actor.attack_cooldown = int(FBData.all().enemies[actor.kind].tokenCooldown)
	var candidates: Array[FBActor] = []
	for actor in actors:
		if actor.kind != "hero" and not actor.is_dead() and actor.attack_cooldown == 0 and not tokens.has(actor):
			var key := actor.get_instance_id()
			waiting[key] = int(waiting.get(key, 0)) + 1
			if actor.engagement_delay > 0 or actor.stun > 0 or actor.state.id not in ["idle", "move"]:
				continue
			if is_remote(actor) and (actor.position.x < visible_x.x or actor.position.x > visible_x.y):
				continue
			candidates.append(actor)
	# 等待时间优先，距离仅用于平局；远程不能因为站得远而永远拿不到攻击名额。
	candidates.sort_custom(func(a: FBActor, b: FBActor):
		# Boss 最长等候 90 帧后优先获取一个名额，护卫仍共享另一个名额。
		var ap: bool = a.kind == "boss" and int(waiting.get(a.get_instance_id(), 0)) >= 90
		var bp: bool = b.kind == "boss" and int(waiting.get(b.get_instance_id(), 0)) >= 90
		if ap != bp:
			return ap
		var aw: int = waiting.get(a.get_instance_id(), 0)
		var bw: int = waiting.get(b.get_instance_id(), 0)
		return aw > bw if aw != bw else a.position.distance_squared_to(hero.position) < b.position.distance_squared_to(hero.position))
	for actor in candidates:
		var external := 1 if is_instance_valid(active_remote) and not tokens.has(active_remote) else 0
		if tokens.size() + external >= int(FBData.all().stage.maxAttackers):
			break
		if is_remote(actor):
			var remote_busy := is_instance_valid(active_remote)
			for holder in tokens:
				remote_busy = remote_busy or is_remote(holder)
			if remote_busy:
				continue
		tokens.append(actor)
		waiting[actor.get_instance_id()] = 0
		granted_at[actor.get_instance_id()] = tick_count

func intent(actor: FBActor, hero: FBActor) -> Dictionary:
	# 玩家取消窗口不等于 AI 可以重复起手；敌人先完成收招再归还名额和进入冷却。
	if actor.engagement_delay > 0 or actor.state.id not in ["idle", "move"]:
		return {}
	var delta := hero.position - actor.position
	var distance := maxf(0.001, delta.length())
	var profile: Dictionary = FBData.all().enemies[actor.kind]
	if is_remote(actor):
		# 后撤最多 32 个逻辑帧，结束后 3 秒内不能再次后撤；墙角也能被玩家抓住。
		if distance < 95 and actor.retreat_cooldown == 0:
			actor.retreat_frames = 32
			actor.retreat_cooldown = 180
		if actor.retreat_frames > 0:
			actor.retreat_frames -= 1
			return {"move": -delta / distance}
	if tokens.has(actor):
		if attacked.has(actor.get_instance_id()):
			return {} # 已射箭仍占威胁名额，不能利用 idle 重复起手。
		if absf(delta.x) > 1:
			actor.facing = 1 if delta.x > 0 else -1
		if is_remote(actor) and (actor.position.x < visible_x.x or actor.position.x > visible_x.y):
			return {"move": delta / distance}
		# 一阶段先教重砸；二阶段轮换近身爆发、重砸、锁方向冲锋，避免只改提示。
		if actor.kind == "boss" and actor.boss_phase == 2:
			var next := (actor.attack_serial + 1) % 3
			var action := "bossCharge" if next == 0 or (next == 1 and distance > 125) else ("bossNova" if next == 1 else "bossSlam")
			var reach := 360.0 if action == "bossCharge" else (125.0 if action == "bossNova" else 96.0)
			if distance <= reach and absf(delta.y) < (60 if action == "bossCharge" else 50):
				return {"attack": true, "target": hero.position, "action": action}
			return {"move": delta / distance}
		if distance <= profile.reach and absf(delta.y) < (140 if actor.kind == "mage" else (40 if actor.kind == "boss" else 22)):
			return {"attack": true, "target": hero.position.clamp(actor.arena_bounds.position + Vector2(44, 18), actor.arena_bounds.end - Vector2(44, 18)) if actor.kind == "mage" else hero.position}
		return {"move": delta / distance}
	# 小兵等候圈靠近刀锋覆盖范围，方便一刀扫中多人；攻击资格仍由两个名额控制。
	var standoff: float = 68.0 if actor.kind == "grunt" else float(profile.standoff)
	if actor.kind == "grunt":
		# 等候小兵使用不同纵深/前后排位置；获攻击名额后仍沿用直接近身，保留扫群手感。
		var index := actor.get_index() - 1
		var side := 1.0 if actor.position.x >= hero.position.x else -1.0
		var offset := Vector2(side * (standoff + (int(index / 3) % 2) * 22), ((index % 3) - 1) * 30)
		var destination := (hero.position + offset).clamp(actor.arena_bounds.position, actor.arena_bounds.end)
		var to_slot := destination - actor.position
		return {"move": to_slot.normalized() * minf(1.0, to_slot.length() / 18)}
	if not is_remote(actor) and distance < standoff * 0.85:
		return {"move": -delta / distance}
	if distance > standoff * 1.25:
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
