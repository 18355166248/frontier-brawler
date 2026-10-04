# 十二动作英雄接入 · 2026-10-04

素材已放到 `wudu_hero_v2_runtime/` 并用于 Godot 主场景英雄；敌人视觉、移动、碰撞、伤害、连招、缓冲和提前取消窗口保持原代码。
本次只接入 Godot 原生首关，未替换旧 Web/Cocos 版。未 commit/push。

## 启动与回退

- macOS 双击 `native/godot/开始游戏.command`；启动器先导入资源。
- 仓库根目录：`npm run dev:godot`，或 `godot --path native/godot`。
- 临时回退：`godot --path native/godot -- --illustrated-hero`。
- 编辑器回退：Actor 场景 Visual 的 `use_wudu_hero=false`；原 `illustrated_actor.gd` 保留完整。
- 缺失 PNG、坏 JSON 或不合法资源规格会给出一条 Warning 并使用原英雄，不生成半初始化新图层。
- `npm run validate:godot` 检查导入及回归；不要用 `sync:godot` 更新战斗数据来安装美术。

## 运行时契约

| 项目 | 实现 |
|---|---|
| 来源 | Library `libfile_545b540c7b108191bbda191e95a394df`，`Wudu_12_Actions_v2_Runtime.zip` |
| 校验 | 9,166,440 bytes / ZIP CRC通过 / SHA256 `849c26d08d7e7ae5d66e9e67d7c9b239995202f401ad739c535c76c6a8b8a970` |
| 包内容 | 26源文件，12横条/66身体帧，6刀光/4尘土及尘土条，两个JSON与原中文说明 |
| 规格 | RGBA，每格640×640，朝右，世界脚底锚(288,560)，显示缩放0.30 |
| 导入 | PNG无损、Nearest、关闭mipmap；保留原图像与JSON，不做新的美术加工 |
| 时钟 | 读取同一60Hz `visual_tick/state.frame/dead_frames`；暂停/定格只完成当前一帧插值，不自由播放 |
| 循环 | 仅idle/move；move名义600ms周期按实测位移/原speed调速，其余独立计时不继承移动变速 |
| 出刀 | 仅视觉蓄势/挥刀/收招分段映射到原hitbox activeFrom/activeTo；建议窗口不写回规则 |
| 时长 | 源JSON的800/600/400/430/400/370/570/430/670/500/330/700ms保持；非循环动作的实际退出由原逻辑帧/取消点决定 |
| 跳跃 | 抵消帧内`art_lift_px`，再叠加原`visual_height`；原跳跃27帧落地、跳劈16帧落地 |
| 换向 | 图像和offset共同绕脚底父节点镜像；镜像会交换双刀的视觉手性 |
| 特效 | 独立刀光同身体锚，尘土留在地面；同名重起或提前切动作清除旧层 |
| 死亡 | 读取hp/dead_frames进入death，500–700ms淡出，停在最后一帧，永不误回idle |
| 回退 | 所有清单/schema/纹理存在、类型、尺寸成功后才启用新表现；坏包保留原关节英雄 |
| 规则 | actor/action_state/combat/illustrated_actor/first_stage.json未修改 |

PNG源包约9MB；本版保留640图集，身体+六刀光+尘土条的RGBA基级纹理约119MiB（估算，非设备实测）。未做移动端纹理/性能优化。
父子Canvas变换与偏移语义参照 [Godot CanvasItem](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html) 和 [Sprite2D](https://docs.godotengine.org/en/stable/classes/class_sprite2d.html)。

## 本机验证

Mac Apple M2 / Godot4.7.2 / GL Compatibility /1280×720。

- 全部门禁通过：137规则/完整首关通关、6336原骨架姿态、951原骨架插值、72反馈/音频、17视口输入，新增98项英雄检查。
- 新检查包括12动作/66帧/原时长、左右pivot、慢移动转攻击、原命中帧切姿态和刀光、定格、同名重起、10轮提前取消、跳跃/落地、死亡淡出、敌人旧层、回退和新实例。
- 隔离坏animation/effects JSON、坏帧schema、缺idle.png均回退成功，无SCRIPT ERROR/ERROR；四条Warning为故障夹具预期输出。正式包共23张PNG（12动作条+6刀光+4尘土+1尘土条），均校验存在与尺寸。
- 正式主场景真实OpenGL渲染18张截图，覆盖idle/move左右、三连段、dash、jump/airSlash/落地、skill、execute、hit、death及重开。
- 截图使用正常controls/run/碰撞伤害推进；处决、受击、死亡布置测试前置目标/生命值。只采完整逻辑帧，不据此声称实时FPS。
- CUA实际窗口核验启动、可见英雄、P暂停、点击继续/重开、J触发后的原动作位移；短按移动没有可靠覆盖持续键盘走位。未声称全部动作都由系统键盘手动完成。
- `output/wudu-import/validation.log`、`render-review.log/json`、18张PNG、`in-engine-actions.jpg`、`gui-live.png`保存证据。原ZIP在`output/wudu-import/source/`（Git忽略）。

## 已知限制

- 美术是像素风栅格原型：慢步、手/双刀/衣物漂移、slash3收刀拔刀缺过渡、收招回idle姿态跳变仍存在，没有声称手工精修。
- 死亡时原结算遮罩立即出现，会遮住倒地与淡出画面；未为查看死亡美术改变流程。
- 攻击时身体关键姿态和刀光按原窗口调整，但原型刀光的刀刃贴合仍需美术联调；长刀视觉范围不扩大伤害范围。
- 手机真机、长局性能、严格左右武器手性未验证。资源缺失降级经过自动化验证；无法覆盖任意损坏二进制PNG的引擎导入错误。
- 原包保留生成来源与官方永恩造型参考说明，没有新增商业授权声明。
