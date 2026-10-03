# 雾渡：横屏首关验证

日期：2026-10-03。当前主入口 `scenes/main.tscn`；环境：macOS / Apple M2 / Godot 4.7.2 / GL Compatibility。

## 目标与实际结果

| 用户目标 | 当前实现 | 直接证据 |
|---|---|---|
| 一关完整可玩 | 山门→两处战斗→成长→铜面守卫→遗物→结算→重开，另有失败/暂停 | 正式伤害/AI 机器人击败 6 名敌人到达战利品，约 1 分钟；137 项行为检查 |
| 好看的横版游戏 | 1280×720 全屏雾林古道、月色远山、斗笠剑客/山匪/铜面守卫、极简 HUD 和原生奖励卡 | 已检查真实引擎的首页、战斗、跳劈、Boss、奖励、暂停及结算截图；背景没有代替人物或可交互 UI |
| 走路丝滑 | 起步/刹停、模拟摇杆力度、连续关节步态、支撑脚世界坐标锁定、位置插值 | 三种角色正反向在 120/240 Hz 下采样；验证脚不滑、逻辑帧边界不反跳、停顿时不偷跑 |
| 打斗/切换连贯 | 三段出刀、短时姿态融合、最短角度接招、关节转身、闪避、跳劈继承高度、受击和死亡 | 6336 个姿态样本 + 951 项插值/落脚/转身检查；实际主场景原速录像 |
| 反馈与底层可维护 | 唯一 60 Hz 战斗时钟；表现子节点插值；有界火花、声部、短屏震；相机不改碰撞 | 72 项反馈/音频检查；状态、场景、输入、UI、表现和声音分离 |
| 能直接操作 | 鼠标点开始/暂停/继续/静音/奖励，D 移动、J 出刀均进入实际 Viewport/InputMap | 17 项 GUI 与输入检查；关闭菜单释放焦点，后台恢复需要主动继续 |

这里的视觉检查是对渲染结果的技术与画面自检，不能代替玩家对风格、操作手感和难度的主观评价。

## 命令与结果

`npm run validate:godot` 完整通过，退出码 0，无 Godot 脚本错误或退出泄漏警告：

- `GODOT_VALIDATION_PASS checks=137`
- `ILLUSTRATED_POSE_PASS: 6336 quarter-frame samples`
- `ILLUSTRATED_INTERPOLATION_PASS checks=951`
- `FEEDBACK_CHECKS_PASS checks=72`
- `LANDSCAPE_UI_PASS checks=17`

`git diff --check` 通过。旧图集采样检查作为历史兼容单测保留；主场景另有明确断言，确认实际绑定的是 `FBMistwardRoom` 和 `FBIllustratedActor`，旧 Sprite 已隐藏。

## 实际渲染与录像

`tests/landscape_review.gd` 直接实例化正式主场景。行走、反向、闪避、出刀、跳劈、受击经过正式游戏输入与战斗流程。

产物均在不入 Git 的 `native/godot/output/`：

- `mistward-home.png`、`mistward-action-40.png`、`mistward-action-185.png`、`mistward-action-303.png`。
- `mistward-boss-53.png`、`mistward-reward.png`、`mistward-paused.png`、`mistward-loot.png`、`mistward-complete.png`。
- `mistward-motion.avi`：60 FPS 原速引擎帧与混音；`mistward-motion.mp4`：同一录像的 H.264/AAC 预览。

审阅脚本直接切换奖励/Boss/战利品/结算以定位界面，相关截图不充当完整通关证明；通关证明来自上述不改血量、不清怪的正式流程机器人。
录像使用离线固定帧输出，编码墙钟耗时不等于游戏运行帧率。当前图板 `illustrated_rig_sheet.png` 只作为角色设计参考，不用静态图板替代动作证据。

## 首关实时性能

`tests/landscape_performance.gd` 保留正式主场景的自动物理循环；四单位是本关最大同屏规模。仅在性能样本中提高生命，延长实际 AI/连招/受击的持续时间，不用于难度判断。

| 项目 | 结果 |
|---|---|
| 时钟 | 真实时间，物理 60 Hz，渲染限制 60 FPS |
| 规模/时间 | 1 玩家 + 3 敌人，12 秒 |
| 样本 | 718 个渲染帧，721 个物理帧 |
| 平均/P95 | 16.73 ms / 16.67 ms |
| 最大帧间隔 | 29.65 ms |
| 引擎静态内存 | 190.28 MiB，非进程 RSS |
| 文件 | `output/mistward-live-performance.json` |

额外的 50 单位开发负载模式当前不满足 60 FPS（本次初测约 82 ms/帧）；它不在玩家首页，也不作为本次四单位首关达标的替代证据。若后续扩大同屏人数，需要先优化关节绘制批次/可见性，再重新测试。

## 范围与限制

- 已完成的是本机可玩的这一关，后续关卡、装备生效、持久化存档及完整旧游戏迁移不在本轮交付。
- Android/iOS/HarmonyOS/Web 导出、真机输入/后台/安全区/字体/音频、长局发热尚未验收；桌面数据不外推。
- 鼠标键盘测试通过真实 Godot Viewport 事件分发，未宣称 macOS 系统级硬件输入自动化通过（CUA 无法识别命令行 Godot 窗口）。
- 程序音色和混音已接入并通过数据/生命周期测试；没有真人听觉或平衡样本。
