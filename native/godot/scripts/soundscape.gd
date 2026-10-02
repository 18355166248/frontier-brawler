extends Node
## 启动时生成短 PCM 素材，运行时只复用播放器；打击由木质瞬态、低频重量与金属余韵组成。

const SAMPLE_RATE := 32000
const VOICE_COUNT := 8
const BUS_NAME := "Frontier Foley"
const CUE_NAMES := ["hit", "kill", "confirm", "swing", "dash", "land", "boss", "step"]

var voices: Array[AudioStreamPlayer] = []
var cues: Dictionary = {}
var muted := false:
	set(value):
		muted = value
		if value:
			_silence()
		elif _combat_active and is_instance_valid(_ambience):
			_ambience.play()
var _ambience: AudioStreamPlayer
var _combat_active := false
var _duck := 0.0
var _random := RandomNumberGenerator.new()
var _last_played: Dictionary = {}
var _serial := 0
var _voice_order: Array[int] = []
var _voice_priority: Array[int] = []

func _ready() -> void:
	_random.seed = 35142
	# 独立分组预留混音入口；每声最大 -18 dB、PCM 峰值不超过 0.72，8 声叠加仍有余量。
	if AudioServer.get_bus_index(BUS_NAME) < 0:
		AudioServer.add_bus()
		AudioServer.set_bus_name(AudioServer.bus_count - 1, BUS_NAME)
	for i in VOICE_COUNT:
		var voice := AudioStreamPlayer.new()
		voice.bus = BUS_NAME
		voice.volume_db = -18.0
		add_child(voice)
		voices.append(voice)
		_voice_order.append(-1)
		_voice_priority.append(0)
	for cue in CUE_NAMES:
		var variations: Array[AudioStreamWAV] = []
		for take in 3:
			variations.append(_make_cue(cue, take))
		cues[cue] = variations
	_ambience = AudioStreamPlayer.new()
	_ambience.bus = BUS_NAME
	_ambience.volume_db = -27.0
	_ambience.stream = _make_ambience()
	add_child(_ambience)

func _process(delta: float) -> void:
	_duck = move_toward(_duck, 0.0, delta * 2.5)
	if is_instance_valid(_ambience):
		_ambience.volume_db = lerpf(-27.0, -33.0, _duck)

func set_combat_active(active: bool) -> void:
	_combat_active = active
	if not is_instance_valid(_ambience):
		return
	if active and not muted:
		if not _ambience.playing:
			_ambience.play()
	else:
		_ambience.stop()

func play(cue: String) -> void:
	if muted or not cues.has(cue):
		return
	var now := Time.get_ticks_msec()
	var gap := 45 if cue in ["hit", "step", "swing"] else 20
	# 同一次横扫可命中多名敌人；合并极短间隔的同类声音，保留击杀与首领提示的优先级。
	if now - int(_last_played.get(cue, -1000)) < gap:
		return
	_last_played[cue] = now
	var priority := 2 if cue in ["kill", "boss", "confirm"] else (0 if cue == "step" else 1)
	var selected := -1
	var oldest := 2147483647
	for i in voices.size():
		if not voices[i].playing:
			selected = i
			break
		if _voice_priority[i] <= priority and _voice_order[i] < oldest:
			selected = i
			oldest = _voice_order[i]
	if selected < 0:
		return
	var voice := voices[selected]
	voice.stop()
	voice.stream = cues[cue][_random.randi_range(0, 2)]
	voice.pitch_scale = _random.randf_range(0.97, 1.035)
	voice.volume_db = -25.0 if cue == "step" else (-21.0 if cue in ["swing", "dash"] else -18.0)
	_voice_order[selected] = _serial
	_voice_priority[selected] = priority
	_serial += 1
	voice.play()
	if cue in ["hit", "kill", "boss"]:
		_duck = 1.0

func stop() -> void:
	# 暂停/切场必须明确停掉环境音，后续仅由场景调用 set_combat_active 恢复。
	_combat_active = false
	_duck = 0.0
	_last_played.clear()
	_silence()

func _silence() -> void:
	for voice in voices:
		voice.stop()
	if is_instance_valid(_ambience):
		_ambience.stop()

func _make_cue(cue: String, take: int) -> AudioStreamWAV:
	var duration := 0.27
	match cue:
		"kill": duration = 0.48
		"boss": duration = 0.82
		"confirm": duration = 0.5
		"swing", "dash": duration = 0.25
		"land": duration = 0.22
		"step": duration = 0.12
	var count := int(duration * SAMPLE_RATE)
	var bytes := PackedByteArray()
	bytes.resize(count * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 1741 + take * 349 + CUE_NAMES.find(cue) * 821
	var low := 0.0
	var mid := 0.0
	var phase := 0.0
	var variant := 1.0 + (take - 1) * 0.035
	for i in count:
		var t := float(i) / SAMPLE_RATE
		var noise := rng.randf_range(-1.0, 1.0)
		low += (noise - low) * 0.07
		mid += (noise - mid) * 0.37
		var grit := mid - low
		var sample := 0.0
		match cue:
			"hit", "kill":
				var heavy := cue == "kill"
				phase += TAU * (61.0 + 117.0 * exp(-t * 30.0)) * variant / SAMPLE_RATE
				var body := sin(phase) * exp(-t * (14.0 if heavy else 23.0)) * 0.6
				var snap := grit * exp(-t * 95.0) * 2.5 + low * exp(-t * 23.0) * 0.6
				var metal := (sin(t * 1531.0 * variant * TAU) + sin(t * 2287.0 * variant * TAU) * 0.38) * exp(-t * 30.0) * 0.13
				var tail := low * exp(-t * 9.0) * 0.4 if heavy else 0.0
				sample = body + snap + metal + tail
			"swing", "dash":
				var envelope := pow(sin(clampf(t / duration, 0, 1) * PI), 2.2)
				sample = (grit * 1.7 + low * 0.6) * envelope
				if cue == "dash":
					sample += low * envelope * 1.8
			"land", "step":
				phase += TAU * (80.0 + 90.0 * exp(-t * 40.0)) / SAMPLE_RATE
				sample = (low * 1.5 + sin(phase) * 0.4) * exp(-t * 29.0) + grit * exp(-t * 75.0) * 0.7
			"confirm":
				# 木质拨弦的两个上行音，只作简短操作确认，不复用战斗音色。
				sample = _pluck(t, 440.0 * variant) * 0.45 + _pluck(t - 0.095, 659.25 * variant) * 0.4
				sample += grit * exp(-t * 85.0) * 0.12
			"boss":
				phase += TAU * (45.0 + 68.0 * exp(-t * 5.0)) / SAMPLE_RATE
				sample = sin(phase) * exp(-t * 5.0) * 0.55 + low * exp(-t * 5.0) * 0.9
				sample += sin(t * 219.0 * TAU) * exp(-t * 9.0) * 0.12
		var fade := minf(1.0, t * 1200.0) * minf(1.0, (duration - t) * 80.0)
		# 柔和饱和仅约束单个素材的瞬态；总线仍靠固定声部数量和保守增益留下叠音余量。
		var bounded := tanh(sample * 1.25) * 0.72 * fade
		bytes.encode_s16(i * 2, int(bounded * 32767.0))
	return _pcm_stream(bytes)

func _pluck(t: float, frequency: float) -> float:
	if t < 0.0:
		return 0.0
	return (sin(t * frequency * TAU) + sin(t * frequency * 2.006 * TAU) * 0.2) * exp(-t * 13.0) * minf(1, t * 1200.0)

func _make_ambience() -> AudioStreamWAV:
	var duration := 6.0
	var count := int(duration * SAMPLE_RATE)
	var overlap := SAMPLE_RATE
	var source := PackedFloat32Array()
	source.resize(count + overlap)
	var rng := RandomNumberGenerator.new()
	rng.seed = 12891
	var low := 0.0
	for i in source.size():
		var t := float(i) / SAMPLE_RATE
		low += (rng.randf_range(-1, 1) - low) * 0.012
		var breeze := low * (0.34 + 0.1 * sin(t * 1.2))
		# 稀薄风底加低频共鸣，留出脚步与兵刃频段；不是持续占据注意力的循环旋律。
		var resonance := sin(t * TAU * 55.0) * 0.019 + sin(t * TAU * 82.5) * 0.012
		source[i] = breeze + resonance
	var bytes := PackedByteArray()
	bytes.resize(count * 2)
	for i in count:
		var sample := source[i]
		if i < overlap:
			var mix := smoothstep(0, overlap, i)
			sample = lerpf(source[count + i], sample, mix)
		bytes.encode_s16(i * 2, int(clampf(sample, -0.25, 0.25) * 32767.0))
	var stream := _pcm_stream(bytes)
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = count
	return stream

func _pcm_stream(bytes: PackedByteArray) -> AudioStreamWAV:
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.stereo = false
	stream.data = bytes
	return stream
