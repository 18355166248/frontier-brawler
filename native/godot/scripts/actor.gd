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
# 只供表现层读取，由同一逻辑 tick 推进；暂停/命中定格时不会继续下落。
var visual_height := 0.0
var air_slash_start_height := 0.0
var visual_weight := Vector3.ZERO
# 速度单位与旧动作表一致：每个 60 Hz 逻辑帧的世界位移。表现层可按真实速度驱动步幅。
const INPUT_DEADZONE := 0.08
const DEPTH_SCALE := 0.62
var locomotion_velocity := Vector2.ZERO
var visual_tick := 0
var previous_position := Vector2.ZERO
var previous_visual_height := 0.0
var previous_visual_weight := Vector3.ZERO

func _ready() -> void:
	previous_position = position
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
	# 渲染只在相邻已完成逻辑帧之间插值；暂停、命中定格不调用 tick，也就不会偷偷走动画。
	previous_position = position
	previous_visual_height = visual_height
	previous_visual_weight = visual_weight
	visual_tick += 1
	if is_dead():
		dead_frames += 1
		locomotion_velocity = Vector2.ZERO
		visual_height = move_toward(visual_height, 0, 5)
		return
	var previous_action := state.id
	if kind == "hero":
		# 受击末段也允许提前输入；仍按同一逻辑时钟衰减，不能在硬直里无限保存旧按键。
		state.capture(input)
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
		locomotion_velocity = locomotion_velocity.move_toward(Vector2.ZERO, speed * 0.4)
		state.decay()
		state.advance()
		update_visual_height(previous_action)
		update_visual_weight()
		return
	var movement := shape_movement(input.get("move", Vector2.ZERO))
	if kind == "hero":
		if state.can_interrupt():
			apply_player_intent(movement, execute_target)
		state.decay()
	elif input.get("attack", false) and state.id in ["idle", "move"]:
		state.change("bossSlam" if kind == "boss" else "slash")
	var motion: Array = state.definition().get("motion", [])
	if state.frame < motion.size() and motion[state.frame] != 0:
		var direction := locked_direction if state.id in ["dash", "jump"] else Vector2(facing, 0)
		position += Vector2(direction.x, direction.y * DEPTH_SCALE) * float(motion[state.frame])
		locomotion_velocity = locomotion_velocity.move_toward(Vector2.ZERO, speed * 0.3)
	elif state.can_interrupt():
		update_locomotion(movement)
		if absf(movement.x) > INPUT_DEADZONE and state.id in ["idle", "move", "hit"]:
			facing = 1 if movement.x > 0 else -1
		if locomotion_velocity.length() > 0.02 and state.id == "idle":
			state.change("move")
		elif locomotion_velocity.length() <= 0.02 and state.id == "move":
			state.change("idle")
	else:
		# 攻击前摇允许极短的惯性收脚，主动位移始终由动作表独占，避免冲刺叠加跑速。
		locomotion_velocity = locomotion_velocity.move_toward(Vector2.ZERO, speed * 0.4)
		if state.id in ["slash", "slash2", "slash3", "skill", "execute"] and state.frame < 3:
			position += locomotion_velocity
	# 与原版相同：推进动作后再统一判定命中；所有角色只有一个逻辑时间源。
	state.advance()
	update_visual_height(previous_action)
	update_visual_weight()

static func shape_movement(raw: Vector2) -> Vector2:
	# 摇杆小幅度对应慢走，不能把任何非零值 normalized 成满速；圆形限幅防止斜走更快。
	if not raw.is_finite() or raw.length() < INPUT_DEADZONE:
		return Vector2.ZERO
	return raw.limit_length(1.0)

func update_locomotion(movement: Vector2) -> void:
	var target := Vector2(movement.x, movement.y * DEPTH_SCALE) * speed
	var rate := speed * 0.24
	if target.is_zero_approx():
		rate = speed * 0.30
	elif locomotion_velocity.dot(target) < 0:
		# 转向比从静止起步更快，但仍经过零速，避免按反方向时整个人瞬间弹回。
		rate = speed * 0.43
	locomotion_velocity = locomotion_velocity.move_toward(target, rate)
	position += locomotion_velocity

func update_visual_weight() -> void:
	# 仅平滑表现重心，姿态列号和碰撞不做延迟。换动作后约 3 帧收敛，避免重心瞬跳。
	var target := FBAnimationPose.weight(state.id, state.frame, state.definition())
	visual_weight = visual_weight.lerp(target, 0.65)

func update_visual_height(previous_action: String) -> void:
	if state.id == "jump":
		visual_height = FBAnimationPose.jump_height(state.frame, state.definition())
	elif state.id == "airSlash":
		if previous_action != "airSlash":
			air_slash_start_height = visual_height
		visual_height = FBAnimationPose.landing_height(state.frame, state.definition(), air_slash_start_height)
	elif state.id == "hit":
		# 可命中空中的招式打断跳跃后，只让表现落回地面，不把人物一帧拉到脚底。
		visual_height = move_toward(visual_height, 0, 5)
	else:
		visual_height = 0.0

func apply_player_intent(movement: Vector2, target: FBActor) -> void:
	var airborne := state.in_window("airborne")
	if state.has_buffer("execute") and not airborne and is_instance_valid(target):
		if absf(target.position.x - position.x) > 1:
			facing = 1 if target.position.x > position.x else -1
		state.change("execute")
		state.consume("execute")
	elif state.has_buffer("dash") and not airborne and state.id != "dash" and dash_cooldown == 0:
		# 防御动作优先于同一窗口里的旧普攻缓冲，玩家在收招点按闪避能及时脱离。
		lock_direction(movement)
		state.change("dash")
		locomotion_velocity = Vector2.ZERO
		dash_cooldown = 30
		state.consume("dash")
	elif state.has_buffer("jump") and state.id not in ["jump", "airSlash"] and jump_cooldown == 0:
		lock_direction(movement)
		state.change("jump")
		locomotion_velocity = Vector2.ZERO
		jump_cooldown = 40
		state.consume("jump")
	elif state.has_buffer("skill") and not airborne and energy >= 50 * skill_cost_multiplier:
		face_movement(movement)
		energy -= 50 * skill_cost_multiplier
		state.change("skill")
		state.consume("skill")
	elif state.has_buffer("attack"):
		# 连段起手可重新瞄准，生效帧内保持面向锁定，视觉转身不改变正在结算的命中盒。
		face_movement(movement)
		var chain: Array = state.definition().get("cancelInto", [])
		if not chain.is_empty() and state.in_window("perfectCancelWindow"):
			state.perfect_pending = true
			perfect_count += 1
		state.change(str(chain[0]) if not chain.is_empty() else "slash")
		state.consume("attack")

func face_movement(movement: Vector2) -> void:
	if absf(movement.x) >= INPUT_DEADZONE:
		facing = 1 if movement.x > 0 else -1

func lock_direction(movement: Vector2) -> void:
	locked_direction = movement.normalized() if movement.length() > 0.01 else Vector2(facing, 0)
	if absf(locked_direction.x) > 0.2:
		facing = 1 if locked_direction.x > 0 else -1
