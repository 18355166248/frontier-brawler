# 雾渡环境背景

- 用途：横屏首关环境背景；角色、碰撞、前景地面、灯火、UI 单独渲染。
- 生成日期：2026-10-02；来源：内置 imagegen，原创文本生成，无外部参考图片。
- 原始生成批次：`exec-53173aef-b983-49ff-9d10-3a900e49f91f.png`。
- 项目源文件与运行时文件：`mistward-backdrop.png`，1672×941，不透明 PNG，原图复制入库，未做裁切或改色。
- 显示：横屏主场景使用 1060×596 世界矩形，允许背景轻微拉伸；左上锚点，无碰撞。
- 加载：本地 Godot 纹理；资源缺失时回退为程序绘制的深蓝背景与场景物件。
- 预算：单张原图不超过 4 MiB；当前首关仅使用这一张背景。
- 状态：已接入主游戏并检查真实 Godot 场景截图；背景独立于角色、碰撞、UI 和前景特效。

## 原始 Prompt

Use case: stylized-concept. Production game background for an original cinematic horizontal 2D sword action game titled Mistward (no lettering). Paint a stunning wide 16:9 panoramic background, high-end hand painted animated-film environment art with restrained ink brush textures and crisp layered silhouettes. Ancient East Asian misty mountain monastery at blue twilight: enormous desaturated teal pine trees framing edges, distant pale blue mountains and a warm ivory full moon upper right, a small red vermilion shrine bridge in the middle distance, old stone shrine and golden hanging lanterns mostly at right. Moody, elegant, richly detailed yet gameplay-readable, no people or creatures. Composition specifically for side scrolling gameplay: horizon about 55% height; lower 35% is quiet dark desaturated blue-green stone garden ground fading into mist, completely empty space for actors. Dark navy framing, dusty jade foliage, silver blue volumetric fog, small restrained warm amber accents. Camera is side-on, very slightly looking down, broad lateral stage, not a path receding into the center. Strong depth layers; far layers soft, nearer architecture crisp. No UI, no HUD, no text, no letters, no watermark, no character artwork, no animated motion blur. Widescreen landscape, as large as possible. This is an atmospheric backdrop only; real interactive characters and ground will be rendered separately.
# 地面边缘补充（2026-10-04）

`stone-edge.png` 是低矮苔石装饰，仅疏放在可走地面的远近边缘，无碰撞。
来源为当前任务中 OpenAI 内置 image_gen 的真实透明PNG；Library运行包
`libfile_2f6ffde155ac8191ab92aee4e2fd6166` / `wudu-stone-accent-v1.zip`，717,303字节，
SHA256 `bcc3585936b33f34764de2a4786f246a09459c498fdccf9bb37e18b4702bb931`。
原图及预览留在来源包，不重复导入工程。运行PNG字节未编辑，SHA256
`38117bce5353f028dab00b402fe95fe71486df0bad6891e4581936c0998ad161`。
768×192 RGBA，pivot(384,160)，scale0.2；主要可见轮廓约134×18世界单位，
不得铺满战斗地面或作为碰撞障碍。精确契约见 [stone-edge-contract.json](stone-edge-contract.json)。

分层山门另见 [gates/README.md](gates/README.md)。旧远景图未改动。

当前默认关卡门已换为[checkpoint-v3](checkpoint/README.md)：真实斜侧面石木门与0.38秒栅门解封。旧gates目录保留供--previous-gate或资源降级使用。
