# 雾渡 · MISTWARD

Godot 4.7.2 / GDScript / Compatibility，1280×720 横屏动作首关「雾隐古道」。
目前主入口使用新环境、导入的十二动作英雄、连续关节敌人、横屏 HUD、命中反馈和程序音效。

## 启动

macOS 双击 **开始游戏.command**；或用 Godot 打开 `project.godot`，按 F5。
启动器先导入资源再进入游戏，全新检出不需要手动复制 `.godot` 缓存。

```bash
# 仓库根目录
npm run dev:godot
npm run validate:godot
```

命令行需将 Godot 加入 PATH，也可通过 `GODOT_BIN` 指定验证器使用的引擎。

- WASD / 方向键：行走；J / 空格：出刀，连续按下衔接三段连招。
- K / Shift：闪避；L / Q：跳跃，腾空时出刀接跳劈。
- U / E：剑气，初始消耗 50 剑意；I / F：处决近身、低于 25% 生命的敌人。
- 1 蓄风刺击；2 护盾横扫；3 灵体出击/再次回归；4 封命斩。上方显示冷却、蓄层、护盾和离体期限，按钮可点击。
- Esc / P：暂停；失去焦点后暂停，回到窗口需要主动继续。
- 清场后走向右侧山门；途中选择一份成长，击败铜面守卫、领取遗物、结算或重开。

桌面使用键盘与原生菜单按钮；触屏自动显示独立多指控件。触屏代码已有引擎级测试，
Android/iOS/HarmonyOS 导出与真实设备输入、音频、字体、安全区尚未验证。

## 当前内容与结构

完整一关：山门起步 → 两处战斗 → 三选一成长 → 铜面守卫 → 遗物 → 结算 → 重开。
遗物是本次旅程的通关纪念，尚无跨局装备/存档。本轮只制作这一关。

- `scenes/main.tscn`：全屏世界视口、输入、HUD、流程、音频。
- `scripts/actor.gd` / `action_state.gd` / `combat.gd`：固定 60 Hz 的移动、缓冲、取消窗口和伤害权威。
- `scripts/illustrated_actor.gd`：连续关节、双腿交替支撑、实测位移步幅、转身、动作衔接和衣摆。
  子节点插值不修改碰撞/Y 排序；暂停和命中定格不会继续推进动作。
- `scripts/wudu_hero_visual.gd`：只读原动作状态，播放 `assets/wudu-hero/` 的十二动作英雄。
  敌人继续使用原关节绘制；坏包自动回退。接入规格与验证见 [英雄接入说明](assets/wudu-hero/INTEGRATION.md)。
- `scripts/mistward_room.gd`：雾林背景、地面、灯火、落叶、山门、跟随镜头；继承基础房间。
- `scripts/hud.gd` / `input_router.gd`：原生可点击 UI、InputMap、键盘和多指摇杆；等比画布与安全区。
- `scripts/impact_feedback.gd` / `soundscape.gd`：刀光、火花、小号伤害字、有限屏震、脚步/挥刀/命中/环境声音。
- `data/first_stage.json`：独立规则快照，Godot 运行不需要 TS/Node。需要同步原 TS 规则时运行 `npm run sync:godot` 后重新验证。
- `assets/environment/README.md`：环境素材来源、Prompt、尺寸和预算；中文使用系统字体回退，不分发系统字体。

旧 Web/Cocos 项目仍保留；原四帧角色仅用于历史对照：`npm run dev:motion-lab`。
`--stress` 是开发负载测试入口（50 单位），没有放进普通玩家菜单。

## 验证与演示

`npm run validate:godot` 检查工程导入、完整通关、动作、951 项插值/落脚/转身、
6336 个原骨架姿态样本、反馈/音频边界、视口级鼠标键盘交互和98项新英雄资源/定格/中断/死亡/损坏包回退检查。
验证器同时检查退出码、错误日志和完成标志。旧骨架检查不能代替新美术视觉验收。
还包含四技能专门的命中、去重、回响、期限、缓冲和重启边界检查。
四技能操作、合法连招时序、改动范围与验证方法见 [四技能接入说明](docs/yone-mvp-integration-2026-10-04.md)。
击飞期间可稍候接 2；原 J/跳劈需等敌人落地后命中。

```bash
# 真正的主场景画面与动作；截图输出到被 Git 忽略的 output/
godot --path native/godot --script tests/landscape_review.gd
# 实时 60 Hz 主循环，四单位同屏 12 秒性能记录
godot --path native/godot --script tests/landscape_performance.gd
# 正常速度动作录像，包含引擎混音
mkdir -p native/godot/output
godot --path native/godot --script tests/landscape_review.gd \
  --write-movie "$PWD/native/godot/output/mistward-motion.avi" --fixed-fps 60 --disable-vsync -- --capture-movie
```

录像是离线帧输出，只用于检查动作；其编码耗时不能当成游戏帧率。
最新画面、验证数据和完整边界见 [首关验证](docs/redesign-2026-10-02/VALIDATION.md)。

本轮保留原远景、五房战斗与过门规则，加入分层山门、低密度苔石边缘、分房雾色/灯火和无遮挡HUD。
门锁定/开启与Boss前红帘各有可见状态，Boss房无东出口不画出口门。
素材来源、回退开关和验证范围见 [环境视觉接入说明](docs/environment-redesign-2026-10-04.md)。
`npm run validate:godot` 还运行针对出口真实性、资源回退、原触发边界、暂停与HUD安全区的环境检查。

英雄素材已经接入，无需再复制压缩包。macOS 仍双击 `开始游戏.command`。
临时回到旧英雄表现：`godot --path native/godot -- --illustrated-hero`。
新英雄主场景截图：`godot --path native/godot --script tests/wudu_hero_review.gd`，
输出在 `native/godot/output/wudu-import/`；包含测试前置目标，不能当成手动通关录像。

关卡门当前为checkpoint-v3石木关隘，清场时栅门在0.38秒内升起；原过门规则不等待动画。重启游戏生效。`--previous-gate`可回退前一门表现，详见[环境与门说明](docs/environment-redesign-2026-10-04.md)。
