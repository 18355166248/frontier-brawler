class_name FBActionState
extends RefCounted

var hero := true
var id := "idle"
var frame := 0
var hit_targets: Dictionary = {}
var buffers: Dictionary = {}
var perfect_pending := false
const BUFFER_FRAMES := 8

func definition() -> Dictionary:
	return FBData.action(id, hero)

func change(next: String) -> void:
	id = next
	frame = 0
	hit_targets.clear()

func can_interrupt() -> bool:
	var d := definition()
	if d.get("cancelable", false):
		return true
	if d.has("cancelFrom"):
		return frame >= d.cancelFrom
	var boxes: Array = d.hitboxes
	return frame >= (d.frames - 1 if boxes.is_empty() else boxes[-1].activeTo)

func in_window(key: String) -> bool:
	var w: Dictionary = definition().get(key, {})
	return not w.is_empty() and frame >= w.from and frame < w.to

func capture(input: Dictionary) -> void:
	for key in ["attack", "dash", "jump", "skill", "execute"] + FBYoneSkills.INPUTS:
		if input.get(key, false):
			buffers[key] = BUFFER_FRAMES

func has_buffer(key: String) -> bool:
	return buffers.get(key, 0) > 0

func consume(key: String) -> void:
	buffers.erase(key)

func decay() -> void:
	# 先消费再衰减，保留完整的八帧提前输入窗口。
	for key in buffers.keys():
		buffers[key] -= 1
		if buffers[key] <= 0:
			buffers.erase(key)

func advance() -> void:
	frame += 1
	var d := definition()
	if frame >= d.frames:
		if d.get("loop", false):
			frame = 0
		else:
			change("idle")
