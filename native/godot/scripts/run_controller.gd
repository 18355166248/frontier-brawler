class_name FBRun
extends Node

signal phase_changed(phase: String)
signal impact(target: FBActor, damage: float, killed: bool, perfect: bool)
signal boss_changed(actor: FBActor)
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
	combat.phase_shift.connect(func(a: FBActor): boss_changed.emit(a))
	enter_room({})

func set_phase(next: String) -> void:
	if phase == next:
		return
	phase = next
	phase_changed.emit(phase)

func enter_room(profile: Dictionary) -> void:
	director = FBEnemyDirector.new()
	combat.freeze_frames = 0
	clear_delay = 40
	var definition: Dictionary = FBData.all().stage.rooms[room_index]
	room.populate(definition, profile, 50 if stress else 0)
	apply_upgrade()
	if stress:
		# 压力模式只测负载；角色持续存活，不写正式进度。
		for actor in room.actors:
			actor.hp = 1000000
			actor.max_hp = 1000000
	if definition.kind == "reward":
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
	director.update(room.actors, hero)
	for actor in room.actors:
		var intent := input if actor == hero else director.intent(actor, hero)
		actor.tick(intent, combat.execute_target(hero, room.actors) if actor == hero else null)
	combat.resolve(room.actors)
	director.separate(room.actors, room.arena)
	if hero.is_dead():
		set_phase("dead")
		return
	if phase == "fighting" and room.alive_enemies() == 0:
		clear_delay -= 1
		if clear_delay <= 0:
			if room_index == 4:
				set_phase("loot")
			else:
				room.door_open = true
				set_phase("cleared")
	if phase == "cleared" and hero.position.x >= room.arena.end.x - 45 and absf(hero.position.y - room.arena.get_center().y) < 48:
		advance_room()

func advance_room() -> void:
	if phase != "cleared" or room_index >= 4:
		return
	var h := room.hero
	var profile := {"hp": h.hp, "max_hp": h.max_hp, "energy": h.energy, "yone_cooldowns": h.skills.cooldowns.duplicate()}
	total_perfect += h.perfect_count
	room_index += 1
	enter_room(profile)

func choose_upgrade(id: String) -> void:
	if phase != "reward" or not FBData.all().upgrades.has(id):
		return
	upgrade = id
	var previous_max := room.hero.max_hp
	apply_upgrade()
	room.hero.hp += room.hero.max_hp - previous_max
	room.door_open = true
	set_phase("cleared")

func apply_upgrade() -> void:
	if upgrade.is_empty():
		return
	var stats: Dictionary = FBData.all().upgrades[upgrade].stats
	var hero := room.hero
	hero.max_hp = 160 * stats.maxHpMultiplier
	hero.damage_multiplier = stats.damageMultiplier
	hero.skill_multiplier = stats.skillDamageMultiplier
	hero.skill_cost_multiplier = stats.skillCostMultiplier
	hero.heal_bonus = stats.executeHealBonus

func claim_loot(id: String) -> void:
	if phase != "loot" or id not in ["wind-sabers", "scout-coat", "execution-charm"]:
		return
	# 首关演示只领取战利品并结算；装备生效与跨局存档留给全量迁移。
	loot = id
	completions += 1
	set_phase("complete")

func summary() -> String:
	return "用时 %02d:%02d   击败 %d\n完美取消 %d   处决 %d" % [elapsed_frames / 3600, (elapsed_frames / 60) % 60, combat.kills, total_perfect + room.hero.perfect_count, combat.executes]
