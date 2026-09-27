# Frontier Brawler · Godot 首关

Godot 4.7.2 / GDScript / Compatibility 渲染，540×960 竖屏。
目前是独立可玩的荒村首关，旧 Web 与 Cocos 入口仍可使用。

## 启动

macOS 双击本目录的 **开始游戏.command**。启动器先导入资源，再打开游戏。
也可用 Godot 打开 `project.godot` 后按 F6/F5（主场景为 `scenes/main.tscn`）。

在仓库根目录：

```bash
npm run dev:godot
npm run validate:godot
npm run dev:motion-lab
```

全新检出先运行 `godot --headless --editor --path native/godot --import`，或使用双击启动器。
命令行需将 Godot 加入 PATH；测试可通过 `GODOT_BIN` 指定路径。

- WASD / 方向键：移动；J / 空格：攻击，连续按下可衔接三段连招。
- K / Shift：闪避；L / Q：跳跃，腾空时攻击接跳劈。
- U / E：技能，初始消耗 50 能量；I / F：处决近身、低于 25% 血量的敌人。
- Esc / P：暂停。鼠标可以拖动摇杆或点击动作键；原生触摸支持独立多指。
- 清房后走向右侧发光出口。顶部可静音，返回焦点后需手动继续。
- 首页「训练场」开启 50 单位持续负载。训练场血量提高，不结算正式战果。

## 已包含

首页 → 起点 → 两间战斗房 → 三选一成长 → 教学 Boss → 战利品选择 → 结算 → 重开。
疾锋三段连招、完美取消、八帧输入缓冲、命中停顿、闪避无敌、跳跃/跳劈、技能、
处决回血、Boss 半血阶段转换、暂停、静音和触控。

当前仅前进，不开放回走旧房间。战利品是本次结算记录，尚未接入装备效果和跨局库存。
后五关、重装/术法、其余敌人、基地、周目、小地图和持久化存档待全量迁移。
音效是独立生成的临时采样，不是旧 Web Audio 的逐音色还原。

## 结构

- `scenes/main.tscn`：视口、UI、输入区、流程与音频的组合入口。
- `scenes/room.tscn`：可编辑相机和 Y 排序角色容器。
- `scenes/actor.tscn`：可复用角色与 Sprite2D 表现。
- `scripts/action_state.gd`：动作时间、取消窗口、输入缓冲。
- `scripts/actor.gd`：角色状态与移动；`combat.gd`：统一命中/伤害；
  `enemy_director.gd`：敌人进攻名额、首关 AI 和单位分离。
- `scripts/run_controller.gd`：首关流程与局内成长。
- `scripts/input_router.gd`：InputMap 与多指输入归一化；`hud.gd`：界面命令与显示。
- `scripts/animation_pose.gd`：姿态采样、跳跃/跳劈高度和移动起伏；由战斗逻辑帧驱动。
- `scripts/actor_visual.gd`、`hit_effects.gd`、`room.gd`：角色、命中特效、场景装饰。

地面位置用 Node2D 管理并保留旧版的确定性推挤；没有使用刚体解算代替战斗判定。
角色高度只影响 Sprite2D 偏移，排序仍用脚底 Y。动画取帧由动作逻辑驱动，
没有第二套动画计时器。房间生成与重开通过显式流程清理节点。

## 数据与素材

`data/first_stage.json` 是迁移基准快照。修改旧 TS 规则后如需同步：

```bash
npm run sync:godot
npm run validate:godot
```

同步工具从旧版解析疾锋动作、敌人动作、首关、成长和素材元数据。Godot 启动不需要
Node 或 TypeScript。GDScript 控制逻辑由本工程维护，JSON 不是第二套 JS 运行时。

三张 PNG 来自 `public/art/`，共约 464 KiB，96×96 单格，四列，脚底 y=90。
缺失的 slash3/skill/execute/airSlash 复用 slash2，jump 复用 move；复用表集中于
`animation_pose.gd`。跳跃固定屈膝姿态，跳劈继承接招前高度并在腾空窗口结束时落地。
普攻末段回到起手姿态；预警和剑弧独立呈现，后续可替换专属帧。
中文使用系统字体，未复制或分发 macOS 字体；目标移动系统上的字体表现待真机检查。

## 验证

`npm run validate:godot` 会先导入工程，再运行 109 项行为检查；同时检查 Godot 错误日志，
防止脚本报错却以退出码 0 误报通过。机器人通过正式伤害和敌人 AI 打到结算，
不直接清怪，样本不能替代真人手感或平衡结论。

```bash
godot --path native/godot --script tests/visual_check.gd
```

上述命令打开真实渲染窗口，产出首页、战斗、奖励、Boss、压力截图和 12 秒性能数据到
`output/`（不入 Git）。验证记录见 `docs/validation.md`。

尚未构建 Android/iOS/HarmonyOS/Web 导出包；桌面结果不代表这些平台可发布。

## 动作对照与素材工具试点

`npm run dev:motion-lab` 打开独立对照场：左侧重构初版播放，右侧当前表现，可选择主角、杂兵、Boss 的 24 个场景，
并暂停、逐帧或慢放。正式主场景始终使用当前表现。
`npm run export:motion-review` 从实际姿态采样器导出 Aseprite 兼容 JSON，供
`ai-asset-pipeline` 打包；该预览只含姿态和时长，不含游戏位移、腾空和命中反馈。

问题分析、验证截图和下一版原画设计见
[动作试点记录](../../docs/experiments/hero-motion-2026-09-27/README.md)。

全角色第二轮优化与影响范围见 [全动作审计](../../docs/experiments/hero-motion-2026-09-27/ALL_ANIMATIONS.md)。
