extends Node

var voices: Array[AudioStreamPlayer] = []
var cues: Dictionary = {}
var muted := false
var cue_this_frame := -1

func _ready() -> void:
	for i in 6:
		var voice := AudioStreamPlayer.new()
		voice.volume_db = -16
		add_child(voice)
		voices.append(voice)
	for cue in ["hit", "kill", "confirm"]:
		cues[cue] = make_tone(cue)

func make_tone(cue: String) -> AudioStreamWAV:
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = 22050
	var duration := 0.18 if cue == "kill" else 0.09
	var frequency := 480.0 if cue == "confirm" else 135.0
	var data := PackedByteArray()
	data.resize(int(duration * 22050) * 2)
	var phase := 0.0
	for i in data.size() / 2:
		var t := float(i) / 22050.0
		phase += TAU * frequency * (1 - t / duration * 0.6) / 22050.0
		var sample := sin(phase) * pow(1 - t / duration, 2) * minf(1, t * 1000)
		data.encode_s16(i * 2, int(sample * 20000))
	stream.data = data
	return stream

func play(cue: String) -> void:
	if muted or cue_this_frame == Engine.get_process_frames():
		return
	cue_this_frame = Engine.get_process_frames()
	for voice in voices:
		if not voice.playing:
			voice.stream = cues[cue]
			voice.play()
			break

func stop() -> void:
	for voice in voices:
		voice.stop()
