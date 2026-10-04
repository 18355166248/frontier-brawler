extends SceneTree
## 真实GUI/正常主循环的只读记录器；记录键位施放与手动回归，不改变技能规则。
var game: Control
var file: FileAccess
var last_hero := 0
var last_cast := -1
var last_returns := 0
var last_e_remaining := 0

func _initialize() -> void:
	call_deferred("start_probe")

func start_probe() -> void:
	root.size = Vector2i(1280, 720)
	file = FileAccess.open("res://output/yone-mvp/gui-events.jsonl", FileAccess.WRITE)
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game._command("start")

func _process(_delta: float) -> bool:
	if not is_instance_valid(game) or not is_instance_valid(game.room.hero):
		return false
	var hero: FBActor = game.room.hero
	var s := hero.skills
	if last_hero != hero.get_instance_id():
		last_hero = hero.get_instance_id()
		last_cast = -1
		last_returns = 0
		last_e_remaining = 0
		write({"event": "hero_created", "instance": last_hero, "cooldowns": s.cooldowns.duplicate()})
	if s.cast_serial != last_cast:
		last_cast = s.cast_serial
		write({"event": "cast", "serial": last_cast, "action": hero.state.id, "frame": hero.state.frame, "cooldowns": s.cooldowns.duplicate()})
	if s.return_count != last_returns:
		last_returns = s.return_count
		write({"event": "e_return", "count": last_returns, "previous_remaining": last_e_remaining, "cooldown": s.cooldowns.e, "position": [hero.position.x, hero.position.y]})
	last_e_remaining = s.e_remaining
	return false

func write(record: Dictionary) -> void:
	record.time_ms = Time.get_ticks_msec()
	file.store_line(JSON.stringify(record))
	file.flush()
