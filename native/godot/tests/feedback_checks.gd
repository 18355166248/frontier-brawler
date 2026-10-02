extends SceneTree
## 独立检查反馈的生命周期与音效叠加边界，不依赖关卡、美术或真实音频输出设备。
## 运行：godot --headless --path native/godot --script tests/feedback_checks.gd

var checks := 0
var failures := 0

func _initialize() -> void:
	call_deferred("validate")

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		failures += 1
		push_error("FEEDBACK CHECK FAILED: " + message)

func validate() -> void:
	var feedback = load("res://scripts/impact_feedback.gd").new()
	var sound = load("res://scripts/soundscape.gd").new()
	root.add_child(feedback)
	root.add_child(sound)
	await process_frame
	check(sound.voices.size() == 8, "audio pool has exactly eight reusable voices")
	check(sound.cues.size() == 8, "eight supported cue families are generated")
	for cue in sound.cues:
		for stream in sound.cues[cue]:
			check(stream.data.size() > 0, "%s has PCM sample data" % cue)
			var peak := 0
			for i in stream.data.size() / 2:
				peak = maxi(peak, absi(stream.data.decode_s16(i * 2)))
			check(peak <= 23600, "%s PCM peak stays below 0.72 with quantization tolerance" % cue)
		sound.play(cue)
	sound.play("unrecognised")
	sound.set_combat_active(true)
	check(sound._ambience.playing, "combat starts the ambience loop")
	sound.muted = true
	check(not sound._ambience.playing, "muting stops ambience immediately")
	for voice in sound.voices:
		check(not voice.playing, "muting stops every active voice")
	sound.muted = false
	check(sound._ambience.playing, "unmuting active combat restores ambience")
	sound.stop()
	check(not sound._ambience.playing, "pause or scene stop silences ambience")
	for i in 100:
		feedback.hit(Vector2(300 + i, 300), 23 + i, i % 5 == 0, i % 7 == 0)
	check(feedback.particles.size() <= feedback.MAX_SPARKS, "a hundred hits keep sparks bounded")
	check(feedback.accents.size() <= feedback.MAX_ACCENTS, "a hundred hits keep slash accents bounded")
	check(feedback.labels.size() <= feedback.MAX_LABELS, "a hundred hits keep damage labels bounded")
	check(feedback.shake_amount <= 5.5, "screen shake has a fixed maximum")
	for i in 60:
		feedback.advance(1.0 / 60)
	check(feedback.particles.is_empty(), "sparks expire within one second")
	check(feedback.accents.is_empty(), "slash accents expire within one second")
	check(feedback.labels.is_empty(), "damage labels expire within one second")
	check(feedback.shake_amount == 0, "screen shake settles fully")
	feedback.reduced_motion = true
	feedback.hit(Vector2(300, 300), 76, true, true)
	check(feedback.shake_amount == 0, "reduced motion suppresses screen shake even for strong hits")
	feedback.reset()
	check(feedback.particles.is_empty(), "room reset clears particles")
	feedback.queue_free()
	sound.queue_free()
	await process_frame
	# 音频线程异步释放已停止的 Playback；等待一轮混音回收，避免退出产生假泄漏报告。
	await create_timer(0.25).timeout
	if failures == 0:
		print("FEEDBACK_CHECKS_PASS checks=%d bounded_pools=3 voices=8 pcm_peak<=0.72" % checks)
	else:
		push_error("FEEDBACK_CHECKS_FAILED failures=%d checks=%d" % [failures, checks])
	quit(0 if failures == 0 else 1)
