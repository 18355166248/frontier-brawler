extends Control
## UI 只发命令，不修改战斗状态；所有弹层从唯一 phase 重建，防止重开遗留旧按钮。
signal command(id: String)
const PAPER := Color("efdfb9")
const MUTED := Color("a6b9b7")
const GOLD := Color("c8aa72")
var title: Label
var health: ProgressBar
var energy: ProgressBar
var status: Label
var hint: Label
var overlay: ColorRect
var content: VBoxContainer
var top: Control
var footer: Label
var boss_bar: ProgressBar
var boss_name: Label
var last_phase := ""
var notice := ""
var notice_time := 0.0
var _run: FBRun
var _transition: Tween
var skill_buttons: Dictionary = {}
var skill_status: Label
var remaining: Label

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var modern := "--classic-environment" not in OS.get_cmdline_user_args()
	top = Control.new()
	top.name = "Top"
	add_child(top)
	top.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	title = label_at(top, "Title", "行 者", Vector2(40, 26), Vector2(250, 28), 18, PAPER)
	health = bar_at(top, "Health", Rect2(40, 63, 232, 8), Color("cda17e"))
	energy = bar_at(top, "Energy", Rect2(40, 78, 164, 4), Color("79b9b6"))
	remaining = label_at(top, "Remaining", "", Vector2(40, 118), Vector2(290, 25), 13, MUTED)
	status = label_at(top, "Status", "", Vector2(40, 91), Vector2(300, 25), 13, MUTED)
	var pause_button := button_at(top, "Pause", "暂停", Rect2(1172, 30, 70, 36), "pause")
	pause_button.focus_mode = Control.FOCUS_NONE
	var mute_button := button_at(top, "Mute", "声音", Rect2(1090, 30, 70, 36), "")
	mute_button.toggle_mode = true
	mute_button.focus_mode = Control.FOCUS_NONE
	mute_button.toggled.connect(func(value: bool):
		mute_button.text = "静音" if value else "声音"
		command.emit("mute" if value else "unmute"))
	boss_name = label_at(top, "BossName", "铜面守卫", Vector2(438, 28), Vector2(404, 25), 16, PAPER)
	boss_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	boss_bar = bar_at(top, "BossHealth", Rect2(438, 63, 404, 5), Color("b87e60"))
	hint = label_at(self, "Hint", "", Vector2(330, 194 if modern else 646), Vector2(620, 24), 15, PAPER)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	footer = label_at(self, "Keys", "WASD 移动     J 出刀     K 闪避     L 跳跃     U 剑气     I 处决", Vector2(40, 697 if modern else 678), Vector2(1200, 20 if modern else 24), 12 if modern else 14, MUTED)
	footer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	for i in 4:
		var key: String = ["q", "w", "e", "r"][i]
		var button := button_at(top, "Ability" + key, "", Rect2(400 + i * 124, 116 if modern else 571, 116, 44), "yone_" + key)
		button.focus_mode = Control.FOCUS_NONE
		button.add_theme_font_size_override("font_size", 13)
		for mode in ["normal", "hover", "pressed", "focus", "disabled"]:
			var style := button.get_theme_stylebox(mode).duplicate() as StyleBox
			style.content_margin_top = 3
			style.content_margin_bottom = 3
			style.content_margin_left = 4
			style.content_margin_right = 4
			button.add_theme_stylebox_override(mode, style)
		skill_buttons[key] = button
	skill_status = label_at(top, "AbilityStatus", "", Vector2(370, 164 if modern else 620), Vector2(540, 22), 13, MUTED)
	skill_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	overlay = ColorRect.new()
	overlay.name = "Overlay"
	add_child(overlay)
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.color = Color(0.025, 0.065, 0.08, 0.78)

func _process(delta: float) -> void:
	notice_time = maxf(0, notice_time - delta)
	queue_redraw()

func announce(text: String, seconds := 3.0) -> void:
	notice = text
	notice_time = seconds

func refresh(run: FBRun) -> void:
	_run = run
	if not is_instance_valid(run.room.hero):
		return
	var h := run.room.hero
	health.max_value = h.max_hp
	health.value = h.hp
	energy.value = h.energy
	remaining.text = "剩余敌人 %d" % run.room.alive_enemies() if run.phase == "fighting" else ""
	title.text = "行 者   /   " + run.room.presentation_title()
	status.text = "生命 %d / %d     剑意 %d" % [h.hp, h.max_hp, h.energy]
	var names := {"q": "1 蓄风刺击", "w": "2 护盾横扫", "e": "3 灵体出击", "r": "4 封命斩"}
	for key in skill_buttons:
		var cd: int = h.skills.cooldowns[key]
		var button: Button = skill_buttons[key]
		button.text = names[key] + ("\n再按回归" if key == "e" and h.skills.e_active else ("\n%.1f 秒" % (cd / 60.0) if cd > 0 else "\n就绪"))
		button.disabled = not h.skills.can_use(key)
	skill_status.text = "蓄风 %d/2%s   护盾 %d%s" % [h.skills.q_stacks, " · %.1fs" % (h.skills.q_remaining / 60.0) if h.skills.q_stacks > 0 else "", h.skills.shield, "   灵体 %.1fs" % (h.skills.e_remaining / 60.0) if h.skills.e_active else ""]
	var boss: FBActor
	for actor in run.room.actors:
		if actor.kind == "boss" and not actor.is_dead():
			boss = actor
	boss_bar.visible = boss != null
	boss_name.visible = boss != null
	if boss:
		boss_bar.max_value = boss.max_hp
		boss_bar.value = boss.hp
		boss_name.text = "铜 面 守 卫" + ("  ·  破阵" if boss.boss_phase == 2 else "")
	# 教学提示绑定房间身份，新增法师房不会把奖励和 Boss 文案错位或越界。
	var hints := {"v0": "向前踏入雾中  →", "v1": "连按 J 衔接出刀，K 闪避", "v2": "避开箭线 · 上下走位或跳跃，突进打断弓手", "vm": "离开白灯落点 · 趁施法收势切入", "vr": "片刻休整，选择一份馈赠", "v3": "留意守卫举刃，离开地面预警"}
	# 清场提示优先于刚结束的连招通知，避免门已开却仍显示战斗指示。
	if run.progress.write_failed:
		notice = "进度保存失败 · 当前游戏可继续"
		notice_time = 1
	hint.text = run.room.exit_cue() if run.phase == "cleared" and run.room.redesigned() else (notice if notice_time > 0 else ("前路已开  ·  继续向右 →" if run.phase == "cleared" and run.room_index > 0 else str(hints.get(run.room.room_id, "继续向前"))))
	if notice_time <= 0 and (run.phase != "cleared" or not run.room.redesigned()):
		for actor in run.room.actors:
			if actor.kind != "hero" and actor.launch_remaining > 0:
				hint.text = "稍候接 2 横扫  ·  J / 跳劈等敌人落地"
				break
	if run.room.room_id == "v3" and boss == null and run.room.alive_enemies() > 0:
		hint.text = "守卫已倒下 · 清理剩余护卫 %d" % run.room.alive_enemies()
	if run.stress:
		hint.text = "演武场  ·  五十人同屏"
	var in_game := not run.paused and run.phase in ["fighting", "cleared"]
	top.visible = in_game
	hint.visible = in_game
	var controls := get_node_or_null("../Controls") as FBInput
	footer.visible = in_game and (not run.room.redesigned() or controls == null or not controls.touch_visible)

func show_phase(run: FBRun) -> void:
	_run = run
	var phase := "paused" if run.paused else run.phase
	last_phase = phase
	# 关闭弹层时主动释放键盘焦点，避免战斗中的空格再次激活菜单按钮。
	var focused := get_viewport().gui_get_focus_owner()
	if focused:
		focused.release_focus()
	for child in overlay.get_children():
		overlay.remove_child(child)
		child.queue_free()
	overlay.visible = phase in ["home", "reward", "loot", "dead", "complete", "paused"]
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP if overlay.visible else Control.MOUSE_FILTER_IGNORE
	refresh(run)
	if not overlay.visible:
		return
	overlay.color = Color(0.016, 0.034, 0.041, 0.34 if phase == "home" else 0.81)
	content = VBoxContainer.new()
	content.add_theme_constant_override("separation", 18)
	if phase == "home":
		overlay.add_child(content)
		content.position = Vector2(88, 159)
		content.size = Vector2(430, 440)
		add_label("M I S T W A R D", 18, GOLD, false)
		add_label("雾 渡", 78, PAPER, false)
		add_label("第一章   /   雾隐古道", 23, PAPER, false)
		add_label("通关 %d 次" % run.completions + (" · 最快 %02d:%02d" % [int(run.progress.data.best_frames) / 3600, (int(run.progress.data.best_frames) / 60) % 60] if run.progress.data.best_frames > 0 else ""), 15, MUTED, false)
		add_button("踏入雾中    →", "start", true)
		if run.can_resume():
			add_button("从房间起点继续", "resume")
		# 遗物另列在右侧，不让继续按钮和三件遗物把首页操作挤出画布。
		var primary := content
		if not run.progress.data.unlocked.is_empty():
			content = VBoxContainer.new()
			content.position = Vector2(860, 210)
			content.size.x = 330
			content.add_theme_constant_override("separation", 14)
			overlay.add_child(content)
			add_label("携带一件遗物", 22, PAPER, false)
			for unlocked in run.progress.data.unlocked:
				add_button(("已携带 · " if unlocked == run.progress.data.equipped else "携带 · ") + FBProgressStore.RELICS[unlocked].label, "equip:" + unlocked)
			var relic: String = run.progress.data.equipped
			if FBProgressStore.RELICS.has(relic):
				add_label(FBProgressStore.RELICS[relic].description, 14, MUTED, false)
		content = primary
		if run.progress.write_failed or run.progress.future_version:
			add_label("存档无法更新 · 当前游戏可继续", 14, GOLD, false)
		add_label("WASD 移动 · J 出刀 · K 闪避\nL 跳跃 · U 剑气 · I 处决\n1 蓄风 · 2 护盾 · 3 灵体/回归 · 4 封命", 14, MUTED, false)
	else:
		var center := CenterContainer.new()
		overlay.add_child(center)
		center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		center.mouse_filter = Control.MOUSE_FILTER_IGNORE
		content.custom_minimum_size.x = 930 if phase in ["reward", "loot"] else 430
		center.add_child(content)
		var headings := {"reward": "山间馈赠", "loot": "守卫的遗物", "dead": "此行未竟", "complete": "雾散，路远", "paused": "歇剑听风"}
		add_label("雾 隐 古 道", 15, GOLD)
		add_label(headings[phase], 42, PAPER)
		match phase:
			"reward":
				add_label("择一而行，此行生效。", 17)
				var cards := HBoxContainer.new()
				cards.add_theme_constant_override("separation", 18)
				content.add_child(cards)
				for id in ["offense", "arcane", "guardian"]:
					var data: Dictionary = FBData.all().upgrades[id]
					add_card(cards, data.label, data.description.replace("\n", "\n\n"), id)
			"loot":
				add_label("带走一件遗物，下次出行生效。", 17)
				var cards := HBoxContainer.new()
				cards.add_theme_constant_override("separation", 18)
				content.add_child(cards)
				add_card(cards, "疾风双刃", FBProgressStore.RELICS["wind-sabers"].description, "wind-sabers")
				add_card(cards, "斥候轻甲", FBProgressStore.RELICS["scout-coat"].description, "scout-coat")
				add_card(cards, "处决护符", FBProgressStore.RELICS["execution-charm"].description, "execution-charm")
			"dead", "complete":
				add_label(run.summary(), 18)
				add_button("再赴古道", "start", true)
				add_button("返回山门", "home")
			"paused":
				add_label("山风未歇，等你归来。", 17)
				add_button("继续前行", "pause", true)
				add_button("减少震屏：" + ("开" if run.progress.data.reduced_motion else "关"), "reduce_motion")
				add_button("重新出发", "start")
				add_button("返回山门", "home")
	if _transition and _transition.is_running():
		_transition.kill()
	content.modulate.a = 0
	_transition = create_tween()
	_transition.tween_property(content, "modulate:a", 1.0, 0.22)
	var buttons := content.find_children("*", "Button", true, false)
	if not buttons.is_empty():
		buttons[0].grab_focus()

func label_at(parent: Node, node_name: String, text: String, at: Vector2, dimensions: Vector2, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.name = node_name
	label.text = text
	label.position = at
	label.size = dimensions
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_shadow_color", Color(0.01, 0.025, 0.03, 0.85))
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 2)
	parent.add_child(label)
	return label

func box_style(color: Color, border := Color(0.6, 0.68, 0.58, 0.3)) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(3)
	style.content_margin_left = 22
	style.content_margin_right = 22
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	return style

func style_button(button: Button, primary := false) -> void:
	button.add_theme_stylebox_override("normal", box_style(Color("d5c39d") if primary else Color(0.06, 0.12, 0.14, 0.85)))
	button.add_theme_stylebox_override("hover", box_style(Color("eddcba") if primary else Color("29454a"), GOLD))
	button.add_theme_stylebox_override("pressed", box_style(Color("92a99a")))
	button.add_theme_stylebox_override("focus", box_style(Color(0, 0, 0, 0), GOLD))
	button.add_theme_color_override("font_color", Color("182e35") if primary else PAPER)
	button.add_theme_color_override("font_hover_color", Color("182e35") if primary else PAPER)
	button.add_theme_color_override("font_focus_color", Color("182e35") if primary else PAPER)
	button.add_theme_font_size_override("font_size", 18)

func button_at(parent: Node, node_name: String, text: String, rect: Rect2, id: String) -> Button:
	var button := Button.new()
	button.name = node_name
	button.text = text
	button.position = rect.position
	button.size = rect.size
	style_button(button)
	button.add_theme_font_size_override("font_size", 14)
	parent.add_child(button)
	if not id.is_empty():
		button.pressed.connect(func(): command.emit(id))
	return button

func bar_at(parent: Node, node_name: String, rect: Rect2, color: Color) -> ProgressBar:
	var bar := ProgressBar.new()
	bar.name = node_name
	bar.position = rect.position
	bar.size = rect.size
	bar.show_percentage = false
	bar.add_theme_font_size_override("font_size", 1)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var track := StyleBoxFlat.new()
	track.bg_color = Color(0.015, 0.04, 0.05, 0.8)
	bar.add_theme_stylebox_override("background", track)
	var fill := StyleBoxFlat.new()
	fill.bg_color = color
	bar.add_theme_stylebox_override("fill", fill)
	parent.add_child(bar)
	# 挂树与主题设置后重新应用高度，避免构造时默认字体把无文字血条撑成 26px。
	bar.size = rect.size
	return bar

func add_label(text: String, font_size: int, color := MUTED, centered := true) -> void:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER if centered else HORIZONTAL_ALIGNMENT_LEFT
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	content.add_child(label)

func add_button(text: String, id: String, primary := false) -> void:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size.y = 54
	style_button(button, primary)
	button.pressed.connect(func(): command.emit(id))
	content.add_child(button)

func add_card(parent: HBoxContainer, title_text: String, description: String, id: String) -> void:
	var button := Button.new()
	button.custom_minimum_size = Vector2(298, 205)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	style_button(button)
	button.pressed.connect(func(): command.emit(id))
	parent.add_child(button)
	var margin := MarginContainer.new()
	button.add_child(margin)
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 24)
	margin.add_theme_constant_override("margin_right", 24)
	margin.add_theme_constant_override("margin_top", 28)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", 20)
	margin.add_child(column)
	for text in [title_text, description]:
		var label := Label.new()
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.text = text
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		label.add_theme_font_size_override("font_size", 22 if text == title_text else 16)
		label.add_theme_color_override("font_color", PAPER if text == title_text else MUTED)
		column.add_child(label)

func apply_safe_insets(insets: Vector4) -> void:
	# 横屏逻辑画布采用 keep 等比缩放；只移动安全区边缘控件，世界视口保持完整。
	top.position = Vector2(insets.x, insets.y)
	$Top/Pause.position.x = 1172 - insets.z - insets.x
	$Top/Mute.position.x = 1090 - insets.z - insets.x
	var modern := "--classic-environment" not in OS.get_cmdline_user_args()
	footer.position.y = (697 if modern else 678) - insets.w
	hint.position.y = 194 + insets.y if modern else 646 - insets.w
	for button in skill_buttons.values():
		button.position.y = 116 if modern else 571 - insets.w - insets.y
	skill_status.position.y = 164 if modern else 620 - insets.w - insets.y

func _draw() -> void:
	if _run == null or _run.phase == "home" or overlay.visible:
		return
	for i in FBData.all().stage.rooms.size():
		var at := Vector2(974 + i * 17, 48)
		draw_circle(at, 2.5, GOLD if i <= _run.room_index else Color(0.6, 0.7, 0.7, 0.3))
