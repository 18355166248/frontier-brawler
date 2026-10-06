extends Control

@onready var room: FBMistwardRoom = $WorldContainer/World/Room
@onready var run: FBRun = $Run
@onready var controls: FBInput = $Controls
@onready var hud: Control = $HUD
@onready var effects: Node2D = $WorldContainer/World/Effects
@onready var audio: Node = $Audio
var frame_samples: Array[float] = []
var shake_time := 0.0
var foot_distance := 0.0

func _ready() -> void:
	run.room = room
	run.phase_changed.connect(_phase_changed)
	run.impact.connect(_impact)
	run.shield_absorbed.connect(func(_actor: FBActor, amount: float):
		hud.announce("护盾吸收 %d" % roundi(amount), 0.6))
	run.boss_changed.connect(func(_actor: FBActor):
		hud.announce("守卫破阵 · 留意连续攻击")
		audio.play("boss"))
	controls.pause_requested.connect(toggle_pause)
	hud.command.connect(_command)
	room.populated.connect(func():
		effects.reset()
		hud.notice = ""
		hud.notice_time = 0.0
		foot_distance = 0.0)
	audio.muted = run.progress.data.muted
	hud.get_node("Top/Mute").set_pressed_no_signal(audio.muted)
	hud.get_node("Top/Mute").text = "静音" if audio.muted else "声音"
	effects.reduced_motion = run.progress.data.reduced_motion
	show_home()
	var args := OS.get_cmdline_user_args()
	if "--stress" in args:
		_command("stress")
	elif "--play" in args:
		_command("start")
	apply_safe_area()
	get_viewport().size_changed.connect(apply_safe_area)

func show_home() -> void:
	if run.threats != null:
		run.threats.clear_all() # 返回首页同样是战斗生命周期边界，不能留下旧箭或落点。
	room.populate(FBData.all().stage.rooms[0], {})
	room.hero.position = Vector2(740, 472)
	room.hero.previous_position = room.hero.position
	room.camera.position = Vector2(650, 290)
	run.paused = false
	run.set_phase("home")
	_phase_changed("home")

func _physics_process(_delta: float) -> void:
	if not run.paused and run.phase != "home":
		effects.advance(1.0 / 60.0)
	var hero := room.hero
	var old_action := hero.state.id
	var old_frame := hero.state.frame
	var old_lift := hero.visual_height
	var old_position := hero.position
	# 定格不消费按下沿；缓冲会在战斗恢复后进入角色状态机。
	run.step({} if run.combat.freeze_frames > 0 else controls.sample())
	if run.phase == "home":
		hero.tick({})
	elif hero == room.hero and not run.paused and run.phase in ["fighting", "cleared"]:
		_play_motion_audio(hero, old_action, old_frame, old_lift, old_position)
	hud.refresh(run)
	if is_instance_valid(room.hero):
		controls.unavailable = {"skill": room.hero.energy < 50 * room.hero.skill_cost_multiplier, "dash": room.hero.dash_cooldown > 0, "jump": room.hero.jump_cooldown > 0, "execute": run.combat.execute_target(room.hero, room.actors) == null}
		for key in ["q", "w", "e", "r"]:
			controls.unavailable["yone_" + key] = not room.hero.skills.can_use(key)
		controls.queue_redraw()

func _play_motion_audio(hero: FBActor, old_action: String, old_frame: int, old_lift: float, old_position: Vector2) -> void:
	if hero.state.id == "dash" and old_action != "dash":
		audio.play("dash")
	var boxes: Array = hero.state.definition().get("hitboxes", [])
	if not boxes.is_empty() and hero.state.frame == int(boxes[0].activeFrom) and (old_action != hero.state.id or old_frame != hero.state.frame):
		audio.play("swing")
	if old_lift > 0 and hero.visual_height == 0:
		audio.play("land")
	if hero.state.id == "move":
		foot_distance += hero.position.distance_to(old_position)
		if foot_distance >= 40:
			foot_distance = fmod(foot_distance, 40)
			audio.play("step")

func _process(delta: float) -> void:
	room.presentation_paused = run.paused
	if not run.paused:
		shake_time += delta * 39
	room.camera_shake = Vector2(sin(shake_time * 1.37), cos(shake_time * 1.93) * 0.55) * effects.shake_amount
	if run.stress and not run.paused:
		frame_samples.append(delta * 1000)
		if frame_samples.size() > 3600:
			frame_samples.pop_front()

func _phase_changed(_phase: String) -> void:
	controls.clear()
	controls.enabled = not run.paused and run.phase in ["fighting", "cleared"]
	hud.show_phase(run)
	audio.set_combat_active(controls.enabled)
	if not controls.enabled:
		audio.stop()
	room.presentation_paused = run.paused

func _command(id: String) -> void:
	if id in FBYoneSkills.INPUTS:
		if controls.enabled:
			controls.pending[id] = true
		return
	if id.begins_with("equip:") and run.phase == "home":
		var relic := id.trim_prefix("equip:")
		if run.progress.data.unlocked.has(relic):
			run.progress.data.equipped = relic
			run.progress.save_progress()
			hud.show_phase(run)
		return
	match id:
		"start", "stress":
			effects.reset()
			audio.stop()
			controls.clear()
			frame_samples.clear()
			run.start(id == "stress")
		"resume":
			effects.reset()
			run.resume()
		"reduce_motion":
			effects.reduced_motion = not effects.reduced_motion
			run.progress.data.reduced_motion = effects.reduced_motion
			run.progress.save_progress()
			hud.show_phase(run)
		"pause":
			toggle_pause()
		"home":
			audio.stop()
			effects.reset()
			show_home()
		"mute", "unmute":
			audio.muted = id == "mute"
			run.progress.data.muted = audio.muted
			run.progress.save_progress()
		"offense", "arcane", "guardian":
			run.choose_upgrade(id)
		_:
			run.claim_loot(id)
	if id not in ["mute", "home", "pause"]:
		audio.play("confirm")

func toggle_pause() -> void:
	if run.phase in ["home", "dead", "complete"]:
		return
	run.paused = not run.paused
	controls.clear()
	audio.stop()
	_phase_changed(run.phase)

func _notification(what: int) -> void:
	if not is_node_ready():
		return
	if what in [NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED]:
		# 回到前台仍由玩家明确继续，后台不积累移动或自动出招。
		controls.clear()
		if run.phase not in ["home", "dead", "complete"] and not run.paused:
			toggle_pause()

func _impact(actor: FBActor, damage: float, killed: bool, perfect: bool) -> void:
	effects.hit(actor.position - Vector2(0, actor.visual_height), damage, killed, perfect)
	audio.play("kill" if killed else "hit")
	if perfect and not killed:
		hud.announce("连势 · 完美衔接", 0.8)

func apply_safe_area() -> void:
	if not OS.has_feature("mobile"):
		return
	var safe := DisplayServer.get_display_safe_area()
	var screen := DisplayServer.screen_get_size()
	if safe.size == Vector2i.ZERO or screen.x == 0 or screen.y == 0:
		return
	# keep 模式先去除两侧或上下留白，再把物理安全区换算到 1280×720 逻辑画布。
	var scale_factor := minf(screen.x / 1280.0, screen.y / 720.0)
	var letterbox := (Vector2(screen) - Vector2(1280, 720) * scale_factor) * 0.5
	var insets := Vector4(maxf(0, safe.position.x - letterbox.x), maxf(0, safe.position.y - letterbox.y), maxf(0, screen.x - safe.end.x - letterbox.x), maxf(0, screen.y - safe.end.y - letterbox.y)) / scale_factor
	hud.apply_safe_insets(insets)
	controls.safe_insets = insets
	controls.layout_controls()
