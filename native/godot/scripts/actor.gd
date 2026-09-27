class_name FBActor
extends Node2D

@export_enum("hero", "grunt", "boss") var kind := "hero"
var state := FBActionState.new()
var hp := 160.0
var max_hp := 160.0
var energy := 0.0
var speed := 2.9
var radius := 16.0
var facing := 1
var stun := 0
var invulnerability := 0
var dash_cooldown := 0
var jump_cooldown := 0
var attack_cooldown := 0
var knockback := Vector2.ZERO
var locked_direction := Vector2.RIGHT
var boss_phase := 1
var dead_frames := 0
var damage_multiplier := 1.0
var skill_multiplier := 1.0
var skill_cost_multiplier := 1.0
var heal_bonus := 0.0
var perfect_count := 0

func _ready() -> void:
	state.hero = kind == "hero"
	if kind != "hero":
		var p: Dictionary = FBData.all().enemies[kind]
		max_hp = 280.0 if kind == "boss" else float(p.hp)
		hp = max_hp
		speed = p.speed
		radius = p.radius
		facing = -1

func is_dead() -> bool:
	return hp <= 0

func tick(input: Dictionary, execute_target: FBActor = null) -> void:
	if is_dead():
		dead_frames += 1
		return
	dash_cooldown = maxi(0, dash_cooldown - 1)
	jump_cooldown = maxi(0, jump_cooldown - 1)
	attack_cooldown = maxi(0, attack_cooldown - 1)
	invulnerability = maxi(0, invulnerability - 1)
	position += knockback
	knockback *= 0.82
	if knockback.length() < 0.05:
		knockback = Vector2.ZERO
	if stun > 0:
		stun -= 1
		state.advance()
		return
	var movement: Vector2 = input.get("move", Vector2.ZERO)
	if kind == "hero":
		state.capture(input)
		if state.can_interrupt():
			apply_player_intent(movement, execute_target)
		state.decay()
	elif input.get("attack", false) and state.can_interrupt():
		state.change("bossSlam" if kind == "boss" else "slash")
	var motion: Array = state.definition().get("motion", [])
	if state.frame < motion.size() and motion[state.frame] != 0:
		var direction := locked_direction if state.id in ["dash", "jump"] else Vector2(facing, 0)
		position += Vector2(direction.x, direction.y * 0.62) * float(motion[state.frame])
	elif state.can_interrupt():
		movement = movement.normalized()
		position += Vector2(movement.x, movement.y * 0.62) * speed
		if absf(movement.x) > 0.05 and state.id in ["idle", "move", "hit"]:
			facing = 1 if movement.x > 0 else -1
		if movement.length() > 0.01 and state.id == "idle":
			state.change("move")
		elif movement.length() < 0.01 and state.id == "move":
			state.change("idle")
	# 与原版相同：推进动作后再统一判定命中；所有角色只有一个逻辑时间源。
	state.advance()

func apply_player_intent(movement: Vector2, target: FBActor) -> void:
	var airborne := state.in_window("airborne")
	if state.has_buffer("execute") and not airborne and is_instance_valid(target):
		if absf(target.position.x - position.x) > 1:
			facing = 1 if target.position.x > position.x else -1
		state.change("execute")
		state.consume("execute")
	elif state.has_buffer("skill") and not airborne and energy >= 50 * skill_cost_multiplier:
		energy -= 50 * skill_cost_multiplier
		state.change("skill")
		state.consume("skill")
	elif state.has_buffer("attack"):
		if state.id not in ["slash", "slash2", "slash3"] and absf(movement.x) > 0.2:
			facing = 1 if movement.x > 0 else -1
		var chain: Array = state.definition().get("cancelInto", [])
		if not chain.is_empty() and state.in_window("perfectCancelWindow"):
			state.perfect_pending = true
			perfect_count += 1
		state.change(str(chain[0]) if not chain.is_empty() else "slash")
		state.consume("attack")
	elif state.has_buffer("jump") and state.id not in ["jump", "airSlash"] and jump_cooldown == 0:
		lock_direction(movement)
		state.change("jump")
		jump_cooldown = 40
		state.consume("jump")
	elif state.has_buffer("dash") and not airborne and state.id != "dash" and dash_cooldown == 0:
		lock_direction(movement)
		state.change("dash")
		dash_cooldown = 30
		state.consume("dash")

func lock_direction(movement: Vector2) -> void:
	locked_direction = movement.normalized() if movement.length() > 0.01 else Vector2(facing, 0)
	if absf(locked_direction.x) > 0.2:
		facing = 1 if locked_direction.x > 0 else -1
