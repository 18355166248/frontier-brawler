extends SceneTree

var checks := 0

func _initialize() -> void:
	call_deferred("validate")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		push_error("CHECK FAILED: " + message)
		quit(1)
		assert(ok, message)

static func make_actor(host_root: Window) -> FBActor:
	var result := FBActor.new()
	host_root.add_child(result)
	return result

static func step(hero: FBActor, movement: Vector2, ticks: int) -> void:
	for i in ticks:
		hero.tick({"move": movement})

func validate() -> void:
	run(root, Callable(self, "check"))
	print("FLUID_MOTION_PASS checks=", checks)
	quit(0)

# 单独执行和完整回归共用相同断言，避免独立测试通过但日常门禁漏跑。
static func run(host_root: Window, report: Callable) -> void:
	var hero := make_actor(host_root)
	hero.tick({"move": Vector2.RIGHT})
	var first_step := hero.position.x
	report.call(first_step > 0.0 and first_step < hero.speed * 0.5, "first movement tick responds without snapping to full speed")
	step(hero, Vector2.RIGHT, 5)
	report.call(is_equal_approx(hero.locomotion_velocity.x, hero.speed), "running reaches full speed within 100 milliseconds")
	var before_stop := hero.position.x
	hero.tick({})
	report.call(hero.position.x > before_stop and hero.locomotion_velocity.x < hero.speed, "release brakes instead of instantly stopping")
	report.call(hero.state.id == "move", "braking keeps the locomotion pose until feet settle")
	step(hero, Vector2.ZERO, 4)
	report.call(hero.locomotion_velocity.is_zero_approx() and hero.state.id == "idle", "braking finishes within five ticks")
	report.call(hero.position.x - before_stop < hero.speed * 1.5, "release has a short stopping distance")
	hero.free()

	hero = make_actor(host_root)
	step(hero, Vector2(0.25, 0), 15)
	report.call(is_equal_approx(hero.locomotion_velocity.x, hero.speed * 0.25), "quarter-stick input walks at quarter speed")
	hero.free()
	hero = make_actor(host_root)
	step(hero, Vector2(0.01, 0), 60)
	report.call(hero.position.is_zero_approx() and hero.state.id == "idle", "tiny joystick jitter cannot trigger walking")
	hero.tick({"move": Vector2(NAN, INF)})
	report.call(hero.position.is_finite() and hero.position.is_zero_approx(), "invalid analog input cannot corrupt actor coordinates")
	hero.free()
	hero = make_actor(host_root)
	step(hero, Vector2.ONE, 15)
	var world_velocity := Vector2(hero.locomotion_velocity.x, hero.locomotion_velocity.y / FBActor.DEPTH_SCALE)
	report.call(is_equal_approx(world_velocity.length(), hero.speed), "diagonal input does not exceed straight run speed")
	report.call(is_equal_approx(hero.locomotion_velocity.y / hero.locomotion_velocity.x, FBActor.DEPTH_SCALE), "depth movement retains arena perspective")
	hero.free()

	hero = make_actor(host_root)
	step(hero, Vector2.RIGHT, 8)
	hero.tick({"move": Vector2.LEFT})
	report.call(hero.facing == -1 and hero.locomotion_velocity.x > 0, "turn intent updates facing while momentum brakes naturally")
	step(hero, Vector2.LEFT, 3)
	report.call(hero.locomotion_velocity.x < 0, "run direction reverses within four ticks")
	var at := hero.position
	var old_visual_tick := hero.visual_tick
	hero.tick({"move": Vector2.LEFT})
	report.call(hero.previous_position == at and hero.visual_tick == old_visual_tick + 1, "render snapshots describe adjacent simulation ticks")
	hero.free()

	hero = make_actor(host_root)
	hero.state.change("slash")
	hero.state.frame = 5
	hero.tick({"attack": true})
	for i in 7:
		hero.tick({})
	report.call(hero.state.id == "slash2" and hero.perfect_count == 1, "eight-frame attack buffer reaches the original perfect cancel window")
	hero.state.change("slash")
	hero.state.frame = 12
	hero.tick({"move": Vector2.LEFT, "attack": true})
	report.call(hero.state.id == "slash2" and hero.facing == -1, "combo follow-up aims toward current input")
	hero.tick({"move": Vector2.RIGHT})
	report.call(hero.facing == -1, "active attack facing cannot rotate its hitbox mid-strike")
	hero.state.change("slash")
	hero.state.frame = 11
	hero.tick({"attack": true, "dash": true})
	hero.tick({})
	report.call(hero.state.id == "dash", "buffered dodge wins over attack at the first legal cancel frame")
	hero.free()

	hero = make_actor(host_root)
	hero.state.change("hit")
	hero.state.frame = 9
	hero.stun = 3
	hero.tick({"dash": true})
	report.call(hero.state.id == "hit" and hero.stun == 2, "buffer capture does not bypass hit stun")
	for i in 3:
		hero.tick({})
	report.call(hero.state.id == "dash", "defensive input during final stun ticks executes when recovery opens")
	hero.free()
	hero = make_actor(host_root)
	hero.state.change("hit")
	hero.state.frame = 0
	hero.stun = 12
	hero.tick({"attack": true})
	for i in 13:
		hero.tick({})
	report.call(hero.state.id == "hit" and not hero.state.has_buffer("attack"), "early stun input expires instead of unexpectedly attacking later")
	hero.free()

	hero = make_actor(host_root)
	step(hero, Vector2.RIGHT, 8)
	var dash_start := hero.position
	hero.tick({"dash": true, "move": Vector2.RIGHT})
	hero.tick({"move": Vector2.RIGHT})
	report.call(is_equal_approx(hero.position.x - dash_start.x, 1.5), "dash uses authored root motion without stacking run velocity")
	hero.free()
	hero = make_actor(host_root)
	hero.tick({"jump": true})
	for i in 16:
		hero.tick({})
	var air_height := hero.visual_height
	hero.tick({"attack": true})
	report.call(hero.state.id == "airSlash" and hero.visual_height > air_height * 0.9, "air slash inherits airborne height across its transition")
	for i in 15:
		hero.tick({})
	report.call(is_zero_approx(hero.visual_height) and hero.state.can_interrupt(), "air slash lands at its original grounded cancel frame")
	hero.hp = 0
	var death_at := hero.position
	hero.tick({"move": Vector2.RIGHT, "attack": true})
	report.call(hero.position == death_at and hero.locomotion_velocity.is_zero_approx(), "death cannot retain locomotion or respond to buffered movement")
	hero.free()
