# AI 四帧走路一致性实验（2026-08-25）

## 结论

**六行动作表已完成并接入游戏。** 直接要求 4×1 透明动作表的前两次生成失败；改成
`2×2 方格 + #FF00FF 纯色背景` 后，再使用确定性脚本切格、绿幕抠图、统一缩放、
重排和 alpha 清理，最终为 `idle / move / slash / slash2 / dash / hit` 各生成四帧，
得到 384×576 RGBA PNG。24 格共用同一个缩放倍率、同一条 `y=90` 脚底线，且
没有任何格子触边。

最终件已经复制到 `public/art/hero-v2.png`，运行时也按六行读取。生产构建通过，
浏览器运行检查无资源错误、洋红边或透明黑块。角色身份、服装、武器和低多边形
风格在六次生成之间保持稳定；被淘汰的 `slash2-rejected-1.png` 保留作筛选证据。

## 原始输出

- `walk-4f-attempt-1.png`：首次生成
- `walk-4f-attempt-2.png`：要求只修正透明背景、注册线与 4:1 排布后的编辑结果
- `walk-4f-attempt-3-chroma-grid.png`：改用 2×2 方格和纯洋红背景的原始生成
- `action-grids/`：六个动作的 2×2 洋红源图和一个淘汰版本
- `hero-actions-v2-final.png`：最终 6×4 动作表
- `hero-actions-v2-final.json`：缩放、基准线和逐格包围盒报告
- `PROMPTS.md`：角色圣经、通用约束和六动作提示词

前两张图均为 1774×887 RGB PNG，棋盘格已经被画进图片，不是 alpha 预览。
第三次原图为 1254×1254 RGB PNG，背景是可确定抠除的纯洋红。

## 像素测量

前景分割规则：将每张图严格四等分；亮且中性的棋盘格视为背景，其余像素视为
角色。三个不同阈值（220/225/230）得到相同边界，以下记录阈值 225 的结果。

| 结果 | 帧 | 头顶 y | 脚底 y | 可见高度 |
| --- | ---: | ---: | ---: | ---: |
| 首次生成 | 1 | 156 | 720 | 565 |
| 首次生成 | 2 | 158 | 720 | 563 |
| 首次生成 | 3 | 163 | 721 | 559 |
| 首次生成 | 4 | 165 | 720 | 556 |
| 定向修正 | 1 | 152 | 727 | 576 |
| 定向修正 | 2 | 152 | 726 | 575 |
| 定向修正 | 3 | 152 | 727 | 576 |
| 定向修正 | 4 | 152 | 730 | 579 |

- 首次生成：头顶漂移 9 px、脚底漂移 1 px、高度漂移 9 px。
- 定向修正：头顶漂移 0 px、脚底漂移 4 px、高度漂移 4 px。
- 2×2 绿幕方案最终件：四帧均为头顶 y=10、脚底 y=85、可见高度 76 px；
  三项漂移均为 0 px。

## 通过方案

生成时不要直接要求模型输出透明 4×1 长条，而是：

1. 使用模型更稳定的方形 2×2 构图，一次生成同一动作的四帧。
2. 背景指定为单一 `#FF00FF`，不要请求透明棋盘格。
3. 严格等分切成四格，禁止逐帧 autocrop。
4. 用 chroma 色距抠图，所有格子保持原始同尺寸画布。
5. 使用同一个缩放倍率缩到 96×96，再按读取顺序重排为 4×1。
6. 清理低于 50% alpha 的边缘残留，以 alpha>0 的最终轮廓验收。

这条流程复用了 `ai-asset-pipeline/src/slice_grid.py`、`cutout.py` 和
`pack_sheet.py`。关键是全程不做逐帧裁切或逐帧缩放，避免后处理重新引入跳动。

## 前两次的定向修正提示词

使用内置 imagegen，对首次结果做单变量编辑：

```text
Edit the previously generated four-frame walking sprite strip only.

Primary change: convert the entire checkerboard background to genuine alpha
transparency and register the four existing characters to exactly the same
top-of-head line and exactly the same bottom-of-planted-boot baseline.

Preserve the same four low-poly frontier swordsman designs, colors, facial
identity, outfit, sword, 3/4 side orthographic view, and walking poses. Use
exactly one horizontal row of four equal square cells. Keep camera, zoom,
apparent body height, body proportions, and baseline identical. Do not add
gutters, borders, labels, shadows, floor, text, watermark, checkerboard, scale
drift, vertical drift, horizontal drift, or perspective drift. Output a real
alpha channel.
```

## 通过方案的生成提示词

使用内置 imagegen 生成：

```text
Generate exactly one square 2×2 grid containing exactly four frames of a
seamless walk cycle of the same low-poly frontier swordsman. Reading order is
top-left, top-right, bottom-left, bottom-right. Cover the entire background with
perfectly flat uniform #FF00FF chroma-key magenta; no checkerboard, gradient,
floor or shadow. Use four equal square cells, one full-body character per cell,
a fixed orthographic 3/4 side camera, identical local camera coordinates, zoom,
root position, body proportions, scale, foot baseline and head line. Keep face,
hair, outfit, sword, materials and lighting identical; only limb rotations may
change. No borders, labels, text, guides, gutters, extra limbs or watermark.
```

## 复测门槛

新工具或模型只有同时满足以下条件才算通过：

1. 384×96 RGBA PNG，四个 96×96 单格，无边框和间隙。
2. 四帧脚底基准线的最大差值为 0 px。
3. 四帧头顶线与角色可见高度的最大差值为 0 px。
4. 固定相机与缩放；不能靠逐帧缩放来“修齐”。
5. 角色几何、服装、武器、材质保持一致，四帧能形成闭环走路循环。

四帧走路最小用例已通过以上五项；跨六动作的最终结果见下一节。

## 六行动作表打包

在 `frontier-brawler` 根目录执行一条命令即可从六张源网格重建动作表：

环境只需要 Python 3 和 Pillow（`python3 -m pip install Pillow`）。

```bash
python3 tools/build_ai_action_sheet.py \
  docs/experiments/ai-sprite-consistency-2026-08-25/action-grids \
  -o public/art/hero-v2.png --actions idle move slash slash2 dash hit \
  --remove-components-under 12
```

打包器的默认生产参数为：单格 96×96、完整源格统一缩到 88×88、脚底线 y=90、
chroma tolerance=45、alpha cutoff=128。它只依赖 Pillow，会在内容触边、帧数
错误、源尺寸不一致、全透明或脚底注册失败时直接退出，不会静默产出坏表。
`--remove-components-under 12` 只清理生图洋红背景经色键缩小后形成的微小孤岛；
主体永远保留，动作、缩放和脚底注册不受影响，阈值也写进同名 JSON 供复核。

六行动作表当前验收结果：

- 尺寸 384×576，RGBA。
- 24/24 格脚底 y=90。
- 24/24 格不接触单格四边。
- 全套固定缩放倍率 88/627 = 0.1403508772。
- 行序固定为 idle / move / slash / slash2 / dash / hit。
