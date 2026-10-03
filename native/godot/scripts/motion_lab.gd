extends Control

const MODES := {
	"hero": [["待机", "idle"], ["移动", "move"], ["普攻收招", "slash"], ["三连击", "combo"], ["跳跃", "jump"], ["跳跃接跳劈", "jump-chain"], ["闪避", "dash"], ["技能", "skill"], ["处决", "execute"], ["受击", "hit"], ["死亡", "death"]],
	"grunt": [["待机", "idle"], ["移动", "move"], ["挥刀", "slash"], ["受击", "hit"], ["死亡", "death"]],
	"boss": [["待机", "idle"], ["移动", "move"], ["重砸", "bossSlam"], ["蓄力接冲锋", "boss-chain"], ["范围爆发", "bossNova"], ["阶段转换", "bossSummon"], ["受击", "hit"], ["死亡", "death"]],
}
var actors: Array[FBActor] = []
var kind := "hero"
var mode := "jump-chain"
var clock := 0
var playing := true
var rate := 1.0
var accumulator := 0.0
var readout: Label
var modes: OptionButton

func _ready() -> void:
	get_window().content_scale_size = Vector2i(960, 640)
	get_window().size = Vector2i(960, 640)
	get_window().title = "Frontier Brawler · 全角色动作对照"
	var background := ColorRect.new()
	background.color = Color("14212b")
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background)
	label("全角色动作 · 节奏与衔接对照", Vector2(32, 22), 28)
	label("左：历史四帧图集    右：连续关节骨架    |    共用同一套战斗逻辑帧", Vector2(32, 67), 16)
	var kinds := OptionButton.new()
	kinds.position = Vector2(32, 104)
	kinds.size = Vector2(130, 42)
	for text in ["主角", "杂兵", "Boss"]:
		kinds.add_item(text)
	kinds.item_selected.connect(func(index: int): select_kind(["hero", "grunt", "boss"][index]))
	add_child(kinds)
	modes = OptionButton.new()
	modes.position = Vector2(175, 104)
	modes.size = Vector2(235, 42)
	modes.item_selected.connect(func(index: int): select_mode(MODES[kind][index][1]))
	add_child(modes)
	button("暂停 / 继续", Vector2(430, 104), func(): playing = not playing)
	button("前进一帧", Vector2(580, 104), func():
		playing = false
		step_once())
	var speed := OptionButton.new()
	speed.position = Vector2(750, 104)
	speed.size = Vector2(150, 42)
	for text in ["1× 正常速度", "0.5× 慢放", "0.25× 慢放"]:
		speed.add_item(text)
	speed.item_selected.connect(func(index: int): rate = [1.0, 0.5, 0.25][index])
	add_child(speed)
	label("重构初版播放", Vector2(160, 480), 23)
	label("优化后", Vector2(665, 480), 23)
	readout = label("", Vector2(32, 540), 17)
	label("正常速度看整体，逐帧看起手与收招。Boss 冲锋/范围技为素材演示，首关 AI 未启用。", Vector2(32, 605), 16)
	select_kind("hero")
	select_mode("jump-chain")

func button(text: String, at: Vector2, callback: Callable) -> void:
	var node := Button.new()
	node.text = text
	node.position = at
	node.size = Vector2(135, 42)
	node.pressed.connect(callback)
	add_child(node)

func label(text: String, at: Vector2, font_size: int) -> Label:
	var node := Label.new()
	node.text = text
	node.position = at
	node.add_theme_font_size_override("font_size", font_size)
	add_child(node)
	return node

func select_kind(next: String) -> void:
	kind = next
	for actor in actors:
		remove_child(actor)
		actor.queue_free()
	actors.clear()
	for i in 2:
		var actor: FBActor = load("res://scenes/legacy_actor.tscn" if i == 0 else "res://scenes/actor.tscn").instantiate()
		actor.kind = kind
		actor.scale = Vector2.ONE * (2.0 if kind == "boss" else 2.5)
		add_child(actor)
		actor.facing = 1
		actor.get_node("Visual").legacy_preview = i == 0
		actors.append(actor)
	modes.clear()
	for item in MODES[kind]:
		modes.add_item(item[0])
	select_mode("idle")

func reset_actor(actor: FBActor) -> void:
	actor.state.change("idle")
	actor.state.buffers.clear()
	actor.hp = actor.max_hp
	actor.dead_frames = 0
	actor.stun = 0
	actor.invulnerability = 0
	actor.knockback = Vector2.ZERO
	actor.jump_cooldown = 0
	actor.dash_cooldown = 0
	actor.visual_height = 0
	actor.visual_weight = Vector3.ZERO
	actor.air_slash_start_height = 0

func select_mode(next: String) -> void:
	mode = next
	clock = 0
	accumulator = 0
	for i in MODES[kind].size():
		if MODES[kind][i][1] == mode:
			modes.select(i)
	for i in actors.size():
		reset_actor(actors[i])
		# 大范围特效按整招缩小，预览不截掉范围圈，也不让特效盖住操作说明。
		actors[i].scale = Vector2.ONE * (1.25 if mode in ["skill", "bossNova"] else (0.65 if mode == "boss-chain" else (2.0 if kind == "boss" else 2.5)))
		actors[i].position = Vector2(235 + i * 480, ground_y())
		actors[i].get_node("Visual")._process(0)

func ground_y() -> float:
	return 330.0 if mode in ["skill", "bossNova"] else 440.0

func step_once() -> void:
	var input := {}
	match mode:
		"move": input.move = Vector2.RIGHT
		"combo": input.attack = clock % 90 in [0, 12, 23]
		"jump-chain":
			input.jump = clock % 80 == 0
			input.attack = clock % 80 == 17
	# 单招预览直接设置动作入口；组合演示走正式输入。不会修改正式 AI 的技能集合。
	for i in actors.size():
		var actor := actors[i]
		if mode == "death":
			if clock % 90 == 0:
				reset_actor(actor)
				actor.hp = 0
		elif mode == "boss-chain":
			if clock % 90 == 0:
				actor.state.change("bossCharge")
			elif clock % 90 == 24:
				actor.state.change("bossRush")
		elif mode not in ["move", "idle", "combo", "jump-chain"]:
			if clock % (int(FBData.action(mode, kind == "hero").frames) + 30) == 0:
				actor.state.change(mode)
				if mode == "hit":
					actor.stun = 12
		actor.tick(input)
		actor.position = Vector2(235 + i * 480, ground_y())
		actor.get_node("Visual")._process(0)
	clock += 1
	var actor := actors[1]
	readout.text = "%s · %s · 帧 %d · 离地 %.1f px\n原画没有新增；优化姿态节奏、脚底重心、收招与特效消退。" % [kind, actor.state.id, actor.state.frame, actor.visual_height]

func _physics_process(_delta: float) -> void:
	if not playing:
		return
	accumulator += rate
	while accumulator >= 1:
		accumulator -= 1
		step_once()
