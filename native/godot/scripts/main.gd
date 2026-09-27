extends Control

@onready var room: FBRoom = $WorldContainer/World/Room
@onready var run: FBRun = $Run
@onready var controls: FBInput = $Controls
@onready var hud: Control = $HUD
@onready var effects: Node2D = $WorldContainer/World/Effects
@onready var audio: Node = $Audio
var frame_samples: Array[float] = []

func _ready() -> void:
	run.room = room
	run.phase_changed.connect(_phase_changed)
	run.impact.connect(_impact)
	run.boss_changed.connect(func(_actor: FBActor): hud.hint.text = "首领进入第二阶段 · 抓住输出机会")
	controls.pause_requested.connect(toggle_pause)
	hud.command.connect(_command)
	room.populate(FBData.all().stage.rooms[0], {})
	hud.show_phase(run)
	var args := OS.get_cmdline_user_args()
	if "--stress" in args:
		_command("stress")
	elif "--play" in args:
		_command("start")
	apply_safe_area()
	get_viewport().size_changed.connect(apply_safe_area)

func _physics_process(_delta: float) -> void:
	# 命中停顿不消费按下沿，玩家在打击定格中提前按的连招应在恢复后送入缓冲。
	run.step({} if run.combat.freeze_frames > 0 else controls.sample())
	hud.refresh(run)
	if is_instance_valid(room.hero):
		controls.unavailable = {"skill": room.hero.energy < 50 * room.hero.skill_cost_multiplier, "dash": room.hero.dash_cooldown > 0, "jump": room.hero.jump_cooldown > 0, "execute": run.combat.execute_target(room.hero, room.actors) == null}
		controls.queue_redraw()

func _process(delta: float) -> void:
	if run.stress and not run.paused:
		frame_samples.append(delta * 1000)
		if frame_samples.size() > 3600:
			frame_samples.pop_front()

func _phase_changed(_phase: String) -> void:
	controls.clear()
	controls.enabled = not run.paused and run.phase in ["fighting", "cleared"]
	hud.show_phase(run)

func _command(id: String) -> void:
	match id:
		"start", "stress":
			effects.reset()
			audio.stop()
			controls.clear()
			frame_samples.clear()
			run.start(id == "stress")
		"pause":
			toggle_pause()
		"home":
			run.paused = false
			audio.stop()
			effects.reset()
			run.set_phase("home")
		"mute", "unmute":
			audio.muted = id == "mute"
			if audio.muted:
				audio.stop()
		"offense", "arcane", "guardian":
			run.choose_upgrade(id)
		_:
			run.claim_loot(id)
	if id not in ["mute", "home", "pause"]:
		audio.play("confirm")

func toggle_pause() -> void:
	if run.phase == "home" or run.phase in ["dead", "complete"]:
		return
	run.paused = not run.paused
	controls.clear()
	audio.stop()
	_phase_changed(run.phase)

func _notification(what: int) -> void:
	if not is_node_ready():
		return
	if what in [NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED]:
		# 恢复焦点后仍停在暂停页，需要明确继续，避免后台累积输入或自动开战。
		controls.clear()
		if run.phase not in ["home", "dead", "complete"] and not run.paused:
			toggle_pause()

func _impact(actor: FBActor, damage: float, killed: bool, perfect: bool) -> void:
	effects.hit(actor.position, damage, killed, perfect)
	audio.play("kill" if killed else "hit")

func apply_safe_area() -> void:
	if not OS.has_feature("mobile"):
		return
	var safe := DisplayServer.get_display_safe_area()
	var screen := DisplayServer.screen_get_size()
	if safe.size == Vector2i.ZERO or screen.y == 0:
		return
	var scale_y := 960.0 / screen.y
	var top := safe.position.y * scale_y
	var bottom := (screen.y - safe.end.y) * scale_y
	$HUD/Top.offset_top = top
	$WorldContainer.offset_top = 100 + top
	$WorldContainer.offset_bottom = 730 - bottom
	$HUD/Hint.offset_top = 105 + top
	$HUD/Hint.offset_bottom = 140 + top
	controls.offset_top = 730 - bottom
	controls.offset_bottom = 960 - bottom
