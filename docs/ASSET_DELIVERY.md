# 素材交付规范

## 目的

本项目允许 Codex 图片生成作为素材上游，但正式游戏资源必须经过
`../ai-asset-pipeline` 或本仓库已有的确定性打包器处理与验证。

这条规则解决的不是“图片够不够好看”，而是运行时最容易出错的三件事：
跨帧尺寸/脚底漂移、精灵朝向与逻辑相反、构建通过但画面裁切或血条遮挡。

## 责任边界

```text
Codex 图片生成
  → 通用静态素材源图进入 ai-asset-pipeline/input/codex/<asset-id>/
  → 项目专属动作源图仍留在 docs/experiments/<experiment>/
  → ai-asset-pipeline：切格、色键、统一缩放、联络表与 3D 渲染
  → frontier-brawler：动作表打包、JSON 报告、运行时注册、教学房人工复核
```

不要直接把生成 PNG 放进 `public/art/`；`public/art/` 只接收可从实验源图
确定性重建的正式产物。

上游通用规范见
[`ai-asset-pipeline` 的 Codex 生图工作流](../../ai-asset-pipeline/docs/CODEX_ASSET_WORKFLOW.md)。

## 本项目动作表硬规格

适用于 hero 与所有敌人：

- 透明 PNG；96×96 单格；一行一个动作；每行 4 帧，严格等分。
- 整套共用同一缩放倍率；脚底注册到单格 `y=90`；可见内容不得触格。
- 正交 3/4 侧视，约 62° 方位角；源表默认面向屏幕右侧。
- 角色身份、服装/武器、相机和根节点固定；动作只改变姿态。
- 逐帧裁切或逐帧缩放一律禁止；它会重新引入切动作跳动。

主角的具体源网格和提示词见
[ai-sprite-consistency 实验](experiments/ai-sprite-consistency-2026-08-25/README.md)，
敌人见 [enemy-actions 实验](experiments/enemy-actions-2026-08-25/README.md)。

## 交付清单

每次新增或替换正式素材，提交中必须同时包含：

1. 原始图、提示词和参考图：项目动作源随本仓库提交；通用静态素材则记录
   `ai-asset-pipeline` 的台账条目与对应提交。
2. 可复制执行的打包命令，以及正式 PNG 和同名 JSON 报告。
3. `python3 tools/validate_action_sheets.py public/art/hero-v2.json public/art/enemy-*-v2.json`。
4. `npm run build`。
5. 对受影响兵种的教学房人工检查：朝向玩家、无裁切、血条不压角色。

推荐通过开发地址直达房间，例如：

```text
/?stage=1&room=v1  grunt
/?stage=2&room=b1  shield
/?stage=3&room=c1  ranged
/?stage=4&room=p1  charger
/?stage=5&room=k1  elite
/?stage=1&room=v3  boss
```

视觉复核结果应记录在对应实验 README 或提交说明中；机械脚本不替代人工判断朝向。

## 静态装备图标的首个试点

M4 装备面板应优先使用静态图标来验证这条链路，而不重做角色动作：

1. Codex 生成一张 2×2 或更规则的装备图标源图，使用纯 `#FF00FF` 背景。
2. 在 `ai-asset-pipeline/input/codex/<asset-id>/` 保留原图与 `prompt.md`，并更新素材台账。
3. 运行切格、色键、缩放和联络表；检查真实显示尺寸下的可读性。
4. 将通过的正式图标接到 `B` 装备面板，保留构建结果与面板截图/短录屏。

`frontier-equipment-icons-v1/v2/v3` 三批源网格已覆盖全部 12 件装备。游戏端从
`public/art/equipment/` 加载 64×64 透明 PNG；单张加载失败时继续显示按槽位
区分的占位符，避免素材损坏阻塞玩法验收。

该试点只补美术可读性，不改装备数值、职业动作参数或 M2 验收基线。
