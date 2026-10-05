# 铜面守卫 v2：Boss 视觉接入候选

按用户“Boss需要再酷炫一点，然后可以植入到游戏中”的授权，在铜面/暗青旧铠甲/长刃方向上强化冠脊、重肩甲、冷玉眼缝与宽刃轮廓。已接入 Godot 的正式 Actor 场景；不自动提交或发布。当前为可玩集成候选，具体动作美术仍待用户看效果，不把工程通过记作美术验收。

## 真实来源与加工

本轮 14 次内置 imagegen 调用：身份母版 1、四姿态网格 12（含走路后半周期的首次失败和重做）、单张号令修正 1。原始 PNG 在 generated_images，实际提示词/参考顺序/耗时在 art-source/copper-guard-v2/recipe.json 和 runtime provenance.json。上轮浅灰背景参考不算本轮调用。没有视频生成调用，没有 43 秒 AI 视频产物，也没有将视频抽帧用于游戏。

首次后半步态重复了支撑方式，不使用；首次召唤网格的两个号令姿态没有可靠持柄，不使用。新的号令单图清楚显示一手握柄、一手发令。召唤前摇复用实际左侧收刃姿态，避免直立武器在身体左右两侧突然跳换；另一个竖立起手也未使用。均保留原始失败材料与原因。

打包器依据实际 alpha 连通轮廓提取整个人物，保留跨名义网格边界的完整武器，不直接猜等分格裁切。所有四姿态源使用同一 0.72 倍缩放，单图为两倍像素基准使用 0.36；不按各帧 bbox 独立缩放，不关节拼接，不补间/重复图片伪造新姿态。清理 alpha≤8 的杂点，保留主体附近软轮廓；只依据已检查的脚底区域与显式横向锚点平移注册。共享 640×640 画布、pivot=(308,560)，游戏整体倍率 0.38。

复现：

```sh
/Users/xmly/Swell/code/game-workspace/ai-asset-pipeline/.venv-cutout/bin/python tools/build_copper_guard.py art-source/copper-guard-v2/recipe.json --out native/godot/assets/copper-guard-v2 --preview native/godot/output/copper-guard-v2
npm run validate:godot
godot --path native/godot --audio-driver Dummy --script tests/export_copper_guard_review.gd
```

Python 依赖使用现有资产工具环境的 Pillow/NumPy/SciPy。输出为10个表现动作、55个播放位置、42张不同源帧；共同待机开头/结尾是明确的原图复用与保持，不计为新增绘画。正常速度 GIF 与逐帧联络表在 native/godot/output/copper-guard-v2。GIF 是已有真实精灵的预览，不是 AI 视频。

## 状态与规则

| 原状态 | 新表现 | 接入方式 |
| --- | --- | --- |
| idle / move | 待机 / 8姿态重步 | 待机跟随逻辑 tick，走路按真实位移推进60世界单位的步态周期 |
| bossSlam | 重刃下砸 | 原44..51帧命中段映射到素材500..610ms接触姿态 |
| bossCharge | 后撤与低位蓄势 | 保留原24帧与后撤 motion，末帧保持发射前姿态 |
| bossRush | 持刃冲锋与制动 | 原0..17帧命中段映射到素材0..280ms；原32帧位移不变 |
| bossNova | 震地 | 原30..34帧范围命中映射到素材500..600ms；半径/空中命中规则不变 |
| bossSummon | 持刃号令 | 只映射原50帧表现，不添加召唤机制，教学首领仍沿用原隔离规则 |
| hit | 厚重后仰与恢复 | 使用原受击状态与高度，表现不能推进逻辑 |
| hp≤0 | 屈膝、跪倒、侧倒、尸体 | 600ms关键帧序列，400ms时进入最后倒地图；在原40 tick清场窗口内完成，之后不淡出 |
| 无对应战斗状态 | 横扫参考 | 只在素材包与预览中保留，不给现有Boss新增招式、伤害或AI行为 |

仅更换 actor.tscn 的 Visual 脚本，继承原英雄视觉类。英雄仍使用原12动作包，grunt仍使用原绘制。脚本不修改 Actor/ActionState/Combat/EnemyDirector/Run/first_stage.json/mistward_room。原137规则、6336姿态、951插值、72反馈、17界面、98英雄、55技能、76环境门禁通过；新Boss门禁478检查通过。首次 Boss 测试曾因精确浮点比例比较误报，已改容差比较，并修复失败后仍输出 PASS 的测试报告缺陷；以最终 validation.log 为准，不以初次日志或完成标志单独判定通过。

现代/回退100 tick的原生位移、状态、伤害、hitstop一致；真实 Boss 房39 tick仍战斗、40 tick原样进入掉落，尸体保留；重启恢复完整280HP Boss。资源清单、纹理尺寸与命中段完整校验后才启用新分支，缺图/坏JSON/无效清单回退原Boss；命令行 --illustrated-boss 可随时使用原表现，--illustrated-hero 仍作用于原英雄路径。

## 引擎证据与限制

真实 Godot 4.7.2 / OpenGL Apple M2 渲染11张截图，正常游戏HUD与Boss关卡背景，无PS拼贴：native/godot/output/copper-guard-v2/engine。截图脚本禁用物理推进后设置已有状态的指定逻辑帧，证明引擎采样与画面，不冒充自然完整打通；规则流程由上述实际测试验证。render.log 有 COPPER_GUARD_RENDER_PASS，validation.log 有全部完成标志且没有 SCRIPT ERROR / ERROR / CHECK FAILED。

本轮只做必要的可玩集成，未做移动设备体验与完整43秒展示视频。关键帧数量有限，收刃/动作切换仍偏硬，铠甲细节与局部姿态有生成漂移；正常速度与真实尺寸预览留给用户审美验收。没有把同一张图片平移/增帧宣称完成步态。旧地图与关卡提交保持原样，未改游戏掉落/胜利/暂停结算。后续独立审核由另一个任务执行，本说明与测试均是实现方自验。
