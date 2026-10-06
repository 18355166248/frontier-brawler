# 三基础怪物运行时候选

grunt / archer / mage 各一套原画；由 tools/build_enemy_roster.py 从已注册透明姿态构建。

身份与三攻击方向已获用户“合适 继续”认可。新增移动、受击、倒地仍为 integrated-candidate，不等于正式美术 release。idle 为单张守势，不是新增呼吸动画。move 四关键姿态尚待完整步态验收。

画布640×640，脚底(308,560)，比例0.30；动作、毫秒时序、来源帧SHA见各子目录 animation.json。脚底ROI与批次比例见 registration.json。原图/实际提示词/参考顺序/失败批次位于 docs/experiments/enemy-redesign-2026-10-05。

命中事件与暂停沿用Godot固定逻辑时钟；--illustrated-enemies 为完整素材回退。数据在 data/enemy_roster.json，旧Web导出器不会覆盖这一独立增量文件。
