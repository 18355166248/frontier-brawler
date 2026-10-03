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
