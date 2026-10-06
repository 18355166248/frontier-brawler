class_name FBRun
extends Node

signal phase_changed(phase: String)
signal impact(target: FBActor, damage: float, killed: bool, perfect: bool)
signal boss_changed(actor: FBActor)
signal shield_absorbed(actor: FBActor, amount: float)
var phase := "home"
var room: FBRoom
var combat := FBCombat.new()
var director := FBEnemyDirector.new()
var room_index := 0
var elapsed_frames := 0
var clear_delay := 0
var upgrade := ""
var loot := ""
var stress := false
var paused := false
var completions := 0
var total_perfect := 0
var restoring_checkpoint := false
var progress := FBProgressStore.new()
var threats: FBEnemyThreats

func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--progress-path="):
			progress.path = arg.trim_prefix("--progress-path=")
			progress.persistent = true
	progress.load_progress()
	completions = int(progress.data.completions)

func start(stress_mode := false) -> void:
	stress = stress_mode
	paused = false
	room_index = 1 if stress else 0
	elapsed_frames = 0
	total_perfect = 0
	upgrade = ""
	loot = ""
	combat = FBCombat.new()
	combat.hit.connect(func(a: FBActor, d: float, k: bool, p: bool): impact.emit(a, d, k, p))
	combat.shielded.connect(func(a: FBActor, d: float): shield_absorbed.emit(a, d))
	combat.phase_shift.connect(func(a: FBActor): boss_changed.emit(a))
	enter_room({})

func set_phase(next: String) -> void:
	if phase == next:
		return
	phase = next
	phase_changed.emit(phase)

func enter_room(profile: Dictionary) -> void:
	# room 由主场景 ready 注入；延迟到首次进房初始化，避免子节点 ready 先于父节点。
	if threats == null:
		threats = FBEnemyThreats.new()
		room.add_child(threats)
	threats.clear_all()
	director = FBEnemyDirector.new()
	combat.freeze_frames = 0
	clear_delay = 40
	var definition: Dictionary = FBData.all().stage.rooms[room_index]
	room.populate(definition, profile, 50 if stress else 0)
	apply_upgrade()
	# 继续前可能在首页换下轻甲，恢复生命不能超过本次携带装备的上限。
	room.hero.hp = minf(room.hero.hp, room.hero.max_hp)
	if profile.is_empty():
		room.hero.hp = room.hero.max_hp
	if not stress and not restoring_checkpoint:
		save_checkpoint()
	if stress:
		# 压力模式只测负载；角色持续存活，不写正式进度。
		for actor in room.actors:
			actor.hp = 1000000
			actor.max_hp = 1000000
	if definition.kind == "reward" and upgrade.is_empty():
		set_phase("reward")
	elif room.alive_enemies() == 0:
		room.door_open = true
		set_phase("cleared")
	else:
		set_phase("fighting")
	phase_changed.emit(phase)

func step(input: Dictionary) -> void:
	if paused:
		return
	if phase == "dead":
		# 失败后只收尾死亡表现，不能继续伤害判定、AI 或移动玩家。
		if combat.freeze_frames > 0:
			combat.freeze_frames -= 1
		else:
			for actor in room.actors:
				if actor.is_dead():
					actor.tick({})
		return
	if phase not in ["fighting", "cleared"]:
		return
	elapsed_frames += 1
	if combat.freeze_frames > 0:
		combat.freeze_frames -= 1
		return
	var hero := room.hero
	var half_view := room.get_viewport_rect().size.x / room.camera.zoom.x * 0.5
	director.visible_x = Vector2(room.camera.position.x - half_view + 45, room.camera.position.x + half_view - 45)
	director.update(room.actors, hero, threats.remote_owner())
	for actor in room.actors:
		var intent := input if actor == hero else director.intent(actor, hero)
		actor.tick(intent, combat.execute_target(hero, room.actors) if actor == hero else null)
	combat.resolve(room.actors)
	# 近战命中先取消未释放法术，再推进弹丸；沿用同一暂停/定格时钟。
	threats.step(room.actors, hero, combat)
	director.separate(room.actors, room.arena)
	if hero.is_dead():
		threats.clear_all()
		set_phase("dead")
		return
	if phase == "fighting" and room.alive_enemies() == 0:
		threats.clear_all()
		clear_delay -= 1
		if clear_delay <= 0:
			if FBData.all().stage.rooms[room_index].kind == "boss":
				save_checkpoint("loot")
				set_phase("loot")
			elif room.room_id == "v1" and upgrade.is_empty():
				# 首战后即获得构筑，使后续两场群战也能体验成长；旧休整房不重复发奖。
				set_phase("reward")
			else:
				room.door_open = true
				set_phase("cleared")
	if phase == "cleared" and hero.position.x >= room.arena.end.x - 45 and absf(hero.position.y - room.arena.get_center().y) < 48:
		advance_room()

func advance_room() -> void:
	if phase != "cleared" or room_index >= FBData.all().stage.rooms.size() - 1:
		return
	var h := room.hero
	var profile := {"hp": h.hp, "max_hp": h.max_hp, "energy": h.energy, "yone_cooldowns": h.skills.cooldowns.duplicate()}
	total_perfect += h.perfect_count
	room_index += 1
	enter_room(profile)

func choose_upgrade(id: String) -> void:
	if phase != "reward" or not upgrade.is_empty() or not FBData.all().upgrades.has(id):
		return
	upgrade = id
	var previous_max := room.hero.max_hp
	apply_upgrade()
	room.hero.hp += room.hero.max_hp - previous_max
	room.door_open = true
	set_phase("cleared")

func apply_upgrade() -> void:
	var stats: Dictionary = FBData.all().upgrades[upgrade if not upgrade.is_empty() else "offense"].stats.duplicate()
	if upgrade.is_empty():
		stats = {"maxHpMultiplier":1.0,"damageMultiplier":1.0,"skillDamageMultiplier":1.0,"skillCostMultiplier":1.0,"executeHealBonus":0.0}
	var hero := room.hero
	hero.max_hp = (176 if progress.data.equipped == "scout-coat" and not stress else 160) * stats.maxHpMultiplier
	hero.damage_multiplier = stats.damageMultiplier
	hero.skill_multiplier = stats.skillDamageMultiplier
	hero.skill_cost_multiplier = stats.skillCostMultiplier
	hero.heal_bonus = stats.executeHealBonus
	hero.cooldown_multiplier = float(stats.get("cooldownMultiplier", 1.0))
	if not stress:
		if progress.data.equipped == "wind-sabers":
			hero.damage_multiplier *= 1.08
		elif progress.data.equipped == "execution-charm":
			hero.heal_bonus += 6

func claim_loot(id: String) -> void:
	if phase != "loot" or id not in ["wind-sabers", "scout-coat", "execution-charm"]:
		return
	# 领取只在 loot 阶段执行一次；遗物下次出行生效，不在结算时改当前战斗数值。
	loot = id
	completions += 1
	progress.data.completions = completions
	if not progress.data.unlocked.has(id):
		progress.data.unlocked.append(id)
	progress.data.equipped = id
	var best: int = int(progress.data.best_frames)
	progress.data.best_frames = elapsed_frames if best == 0 else mini(best, elapsed_frames)
	progress.data.checkpoint = {}
	progress.save_progress()
	set_phase("complete")

func summary() -> String:
	return "用时 %02d:%02d   击败 %d\n完美取消 %d   处决 %d" % [elapsed_frames / 3600, (elapsed_frames / 60) % 60, combat.kills, total_perfect + room.hero.perfect_count, combat.executes]

func save_checkpoint(saved_phase := "entry") -> void:
	# 入口档重建敌人，胜利档保留待领奖与最终成绩；不序列化招式或临时引用。
	var h := room.hero
	progress.data.checkpoint = {"room_id": room.room_id, "phase": saved_phase, "hp": h.hp, "energy": h.energy, "upgrade": upgrade,
		"elapsed_frames": elapsed_frames, "kills": combat.kills, "executes": combat.executes, "perfect": total_perfect + (h.perfect_count if saved_phase == "loot" else 0),
		"cooldowns": h.skills.cooldowns.duplicate()}
	progress.save_progress()

func can_resume() -> bool:
	return not FBProgressStore.checkpoint(progress.data.checkpoint).is_empty()

func resume() -> void:
	if not can_resume():
		return
	var c := FBProgressStore.checkpoint(progress.data.checkpoint)
	restoring_checkpoint = true
	start() # 先重建所有生命周期状态，再还原房间起点的纯数据。
	for i in FBData.all().stage.rooms.size():
		if FBData.all().stage.rooms[i].id == c.room_id:
			room_index = i
	upgrade = c.upgrade
	elapsed_frames = int(c.elapsed_frames)
	combat.kills = int(c.kills)
	combat.executes = int(c.executes)
	total_perfect = int(c.perfect)
	enter_room({"hp":float(c.hp),"energy":float(c.energy),"yone_cooldowns":c.cooldowns})
	if c.phase == "loot":
		# 胜利待领取时恢复结算场景，不复活敌人；领取仍由原阶段门防止重复奖励。
		for enemy in room.actors:
			if enemy.kind != "hero":
				enemy.hp = 0
				enemy.dead_frames = 40
		threats.clear_all()
		set_phase("loot")
	restoring_checkpoint = false
	save_checkpoint(c.phase)
