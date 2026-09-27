class_name FBAnimationPose
extends RefCounted

# 素材帧与战斗帧分离：这里只选择姿态，不能移动 activeFrom / 取消窗口来迁就美术。
static func sample(id: String, frame: int, definition: Dictionary, legacy: bool = false, kind: String = "hero") -> Dictionary:
	var aliases := {"slash3": "slash2", "skill": "slash2", "execute": "slash2", "airSlash": "slash2", "jump": "move"}
	var action: String = aliases.get(id, id)
	var total := int(definition.frames)
	var progress := clampf(float(frame) / maxf(1, total), 0, 0.999)
	var column := mini(3, int(progress * 4))
	var boxes: Array = definition.hitboxes
	if not boxes.is_empty():
		var first: Dictionary = boxes[0]
		if frame < first.activeFrom:
			column = mini(1, int(2.0 * frame / maxf(1, first.activeFrom)))
		elif frame < first.activeTo:
			column = 2
		else:
			column = 3
			# 四帧源图没有专门的还原帧；保留前半段随挥，后半段回到待机准备姿态。
			# 连段提前取消仍走原判定，不能为了看完整收招延长攻击锁定。
			if not legacy:
				var recovery := float(frame - first.activeTo) / maxf(1, total - first.activeTo)
				if recovery >= 0.55:
					action = "idle"
					column = 0
	if not legacy and kind == "grunt" and id == "slash":
		# 杂兵图集第 2 格才是向前挥刀，第 3/4 格是随挥，不能照搬主角的列号。
		var box: Dictionary = boxes[0]
		if frame < box.activeFrom:
			column = 0
		elif frame < box.activeTo:
			column = 1
		elif action != "idle":
			column = 2 if frame < box.activeTo + 3 else 3
	if not legacy and id == "dash":
		# 12 帧后已停止高速位移，站起必须发生在停止后，不能均分四张图。
		column = 0 if frame < 2 else (1 if frame < 6 else (2 if frame < 12 else 3))
		if frame >= int(definition.frames) - 4:
			action = "idle"
			column = 0
	if not legacy and id == "hit":
		# 命中立即进入受力姿态，随后回弹；原第 1 格是站立，不应先等五帧才受击。
		column = 1 if frame < 3 else (2 if frame < 8 else 3)
		if frame >= 14:
			action = "idle"
			column = 0
	if not legacy and id in ["bossCharge", "bossSummon"]:
		column = 0 if progress < 0.16 else (1 if progress < 0.38 else (2 if progress < 0.84 else 3))
	if not legacy and id == "jump":
		# 缺少专属跳跃图时固定一个屈膝姿态，避免人在空中播放完整走路循环。
		column = 2 if frame < int(definition.get("airborne", {}).get("to", total)) else 0
	return {"action": action, "column": column}

# 少量形变补足四张原画之间的重心变化，脚底为轴；不对图片交叉淡入制造双影。
# 所有曲线直接采样逻辑帧，渲染频率、暂停和命中停顿不会改变动作进度。
static func weight(id: String, frame: int, definition: Dictionary) -> Vector3:
	var total := maxf(1, float(definition.frames) - 1)
	var t := clampf(frame / total, 0, 1)
	var lean := 0.0
	var squash := 0.0
	var shift := 0.0
	var boxes: Array = definition.hitboxes
	if id == "idle":
		squash = sin(t * TAU) * 0.009
	elif id == "move":
		lean = 0.025 * sin(t * TAU)
		squash = sin(t * TAU * 2) * 0.012
	elif id == "hit":
		var recoil := pow(1.0 - t, 2)
		lean = -0.12 * recoil
		shift = -4.0 * recoil
		squash = -0.035 * recoil
	elif id == "dash":
		var burst := sin(clampf(frame / 14.0, 0, 1) * PI)
		lean = 0.075 * burst
		squash = 0.06 * burst
	elif id == "jump":
		squash = 0.055 * sin(t * TAU)
	elif id in ["bossCharge", "bossSummon"]:
		var charge := sin(t * PI)
		squash = 0.035 * charge
		lean = -0.04 * charge if id == "bossCharge" else 0.0
	elif not boxes.is_empty():
		var box: Dictionary = boxes[0]
		if frame < box.activeFrom:
			var windup := smoothstep(0, maxf(1, box.activeFrom), frame)
			lean = -0.045 * windup
			shift = -2.0 * windup
			squash = 0.025 * windup
		else:
			var release := smoothstep(box.activeFrom, maxf(box.activeFrom + 1, box.activeTo), frame)
			var settle := 1.0 - smoothstep(box.activeTo, total, frame)
			lean = lerpf(-0.045, 0.065, release) * settle
			shift = lerpf(-2.0, 3.0, release) * settle
			squash = -0.025 * sin(release * PI) * settle
	return Vector3(lean, squash, shift)

static func jump_height(frame: int, definition: Dictionary) -> float:
	var window: Dictionary = definition.get("airborne", {})
	var start := int(window.get("from", 0))
	var finish := int(window.get("to", definition.frames))
	var progress := clampf(float(frame - start) / maxf(1, finish - start), 0, 1)
	return sin(progress * PI) * 48.0

static func landing_height(frame: int, definition: Dictionary, start_height: float) -> float:
	var finish := int(definition.get("airborne", {}).get("to", definition.frames))
	# 跳劈继承取消瞬间的真实高度，并在可接地面连招的落地帧归零。
	var progress := clampf(float(frame) / maxf(1, finish), 0, 1)
	return start_height * (1.0 - progress)

static func walk_bob(frame: int, total: int) -> float:
	# 一圈步态左右各落地一次；abs(sin(2πt)) 已经有两次起伏，不能再乘 2。
	return absf(sin(float(frame) / maxf(1, total) * TAU)) * 2.0
