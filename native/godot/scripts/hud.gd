extends Control

signal command(id: String)
@onready var title: Label = $Top/Title
@onready var health: ProgressBar = $Top/Health
@onready var energy: ProgressBar = $Top/Energy
@onready var status: Label = $Top/Status
@onready var hint: Label = $Hint
@onready var overlay: ColorRect = $Overlay
@onready var content: VBoxContainer = $Overlay/Center/Panel/Margin/Content
var last_phase := ""

func _ready() -> void:
	$Top/Pause.pressed.connect(func(): command.emit("pause"))
	$Top/Mute.toggled.connect(func(value: bool): command.emit("mute" if value else "unmute"))

func refresh(run: FBRun) -> void:
	if not is_instance_valid(run.room.hero):
		return
	var h := run.room.hero
	health.max_value = h.max_hp
	health.value = h.hp
	energy.value = h.energy
	title.text = "荒村  /  %02d" % (run.room_index + 1)
	status.text = "生命 %d / %d     能量 %d     敌人 %d" % [h.hp, h.max_hp, h.energy, run.room.alive_enemies()]
	var hints := ["沿街前进，走向右侧发光出口", "连按攻击衔接三段连招", "上下走位绕开敌人的攻击", "选择一项成长，继续前进", "首领举锤时，离开红色预警区域"]
	hint.text = "房间已清空 · 走向右侧发光出口 →" if run.phase == "cleared" else hints[run.room_index]
	if run.stress:
		hint.text = "训练场 · 50 单位 · Esc 暂停返回"

func show_phase(run: FBRun) -> void:
	var phase := "paused" if run.paused else run.phase
	last_phase = phase
	for child in content.get_children():
		content.remove_child(child)
		child.queue_free()
	overlay.visible = phase in ["home", "reward", "loot", "dead", "complete", "paused"]
	if not overlay.visible:
		return
	var headings := {"home": "FRONTIER\nBRAWLER", "reward": "旅途中的馈赠", "loot": "首领战利品", "dead": "此行未竟", "complete": "荒村已肃清", "paused": "歇一歇"}
	add_label("荒 境 行 者", 14, Color("85b59c"))
	add_label(headings[phase], 34, Color("f1e5be"))
	match phase:
		"home":
			add_label("第一章 · 荒村\n疾锋出击，穿过长街，迎战荒村守卫。", 17)
			add_button("开始旅程", "start")
			add_button("训练场 · 50 单位", "stress")
			add_label("WASD 移动  /  J 攻击  /  K 闪避\nL 跳跃  /  U 技能  /  I 处决", 14)
		"reward":
			add_label("选择一条路线，本次旅程生效。", 16)
			for id in ["offense", "arcane", "guardian"]:
				var data: Dictionary = FBData.all().upgrades[id]
				add_button(data.label + "  ·  " + data.description.replace("\n", " / "), id)
		"loot":
			add_label("选择一件战利品作为本次通关纪念。\n当前首关试玩暂不提供跨局装备。", 15)
			add_button("疾风双刃", "wind-sabers")
			add_button("斥候轻甲", "scout-coat")
			add_button("处决护符", "execution-charm")
		"dead", "complete":
			add_label(run.summary(), 18)
			add_button("再次出发", "start")
			add_button("返回首页", "home")
		"paused":
			add_label("准备好后继续。", 18)
			add_button("继续旅程", "pause")
			add_button("重新开始", "start")
			add_button("返回首页", "home")

func add_label(text: String, font_size: int, color := Color("abbcb1")) -> void:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	content.add_child(label)

func add_button(text: String, id: String) -> void:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size.y = 55
	button.add_theme_font_size_override("font_size", 17)
	button.pressed.connect(func(): command.emit(id))
	content.add_child(button)
