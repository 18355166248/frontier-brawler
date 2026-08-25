# Claude 独立复审 Prompt

下面整段可直接复制给 Claude：

```text
你现在是 frontier-brawler 的独立最终复审者。请在本地仓库
/Users/xmly/Swell/code/game-workspace/frontier-brawler 中审计刚完成的角色/敌人动作表
与运行时接入。不要把实现者结论当成事实，必须自己读代码、逐帧看图并复跑验证。

本轮变更：
- hero slash2 第 4 帧已重出：应移除断剑尖，且第 3→4 帧读作连贯向右横扫收招。
- ranged aim 第 2 帧已移除暗色尘点；aim 搭箭/拉弦/满弓和 shoot 满弓帧应有清楚箭杆。
- elite 的 idle/move/heavy/hit 四行已重出为明确朝右的正交 3/4 侧视。
- 新增 bossSlam/bossCharge/bossRush/bossNova/bossSummon 五行 boss 正式美术；boss
  应明显大于 elite，阶段一深红 #8f2f3a，阶段二由运行时推向亮橙红 #e2543a。
- grunt/shield/ranged 仍保留源图朝左、打包时逐帧 --mirror 的已验证方案；这是明确选择，
  不是遗漏。生产图必须朝右，JSON 的 mirrored 字段必须与打包命令一致。

硬约束：透明 PNG、每格 96×96、一行一个动作、每行 4 帧；同一角色整套共用一个
缩放倍率，脚底统一注册到单格 y=90，任何可见内容不得触格。生产动作表一律面向
屏幕右侧，视角是约 62° 方位角的正交 3/4 侧视，不得接近正面或纯侧面。

资产总量应为 132 帧：hero 24 帧；grunt 16；shield 16；ranged 20；charger 20；
elite 16；boss 20。boss 行序必须是 bossSlam/bossCharge/bossRush/bossNova/bossSummon。

工作区有意保留未提交改动。禁止 reset、checkout、删除、提交或 push；不要自行重生图。
主观偏好只记录建议。仅在发现确定的代码/文档问题时做最小修复并复验；不得修改手感
数值、判定窗口、伤害、M2 职业系统。

先读：
- docs/experiments/enemy-actions-2026-08-25/README.md
- docs/experiments/enemy-actions-2026-08-25/REGEN-PROMPTS.md
- docs/ROADMAP.md 的“美术需求与产出规范”
- tools/build_ai_action_sheet.py、tools/validate_action_sheets.py
- src/main.ts、src/render/sprites.ts、src/render/renderer.ts
- src/core/enemies.ts、src/core/actions.ts、src/core/types.ts

必须独立执行：
1. git status --short && git diff --check
2. python3 tools/validate_action_sheets.py public/art/hero-v2.json public/art/enemy-*-v2.json
3. npm run build
4. 对照全部 JSON，确认图片尺寸、行序、帧数、baseline、统一 scale、frame bbox、mirrored
   与 src/main.ts 注册完全一致，总计 132 帧。
5. 逐张查看 hero-v2 和六张 enemy-*-v2，再查看相关 action-grids 源网格。重点逐帧检查：
   hero slash2 第 4 帧无悬空断剑尖且时序连续；ranged aim 第 2 帧无尘点且箭杆可见；
   ranged aim→shoot 连贯；elite 四行始终右向 3/4；boss 五行身份、武器、朝向一致。
6. 对全部生产动作表做 alpha 连通域扫描；报告主体外 >=4px 的独立分量。弓弦、箭杆或
   武器若形成独立分量必须人工判定，不可只凭阈值下结论。
7. 审计运行时：按 kind 取独立表；未知动作回退 idle；loop/non-loop 帧进度正确；
   ctx.scale(facing,1) 朝向正确；drawImage 以 y=90 贴地；每兵种倍率整套恒定；血条不压身；
   boss 比 elite 大，二阶段仍用同一动作相位且橙红变化清楚；PNG 加载失败仍走几何兜底。
8. 启动 npx vite --host 127.0.0.1 --port 4317，逐个打开并实际观察：
   grunt   http://127.0.0.1:4317/?stage=1&room=v1
   shield  http://127.0.0.1:4317/?stage=2&room=b1
   ranged  http://127.0.0.1:4317/?stage=3&room=c1
   charger http://127.0.0.1:4317/?stage=4&room=p1
   elite   http://127.0.0.1:4317/?stage=5&room=k1
   boss    http://127.0.0.1:4317/?stage=1&room=v3
   检查资源 404、控制台错误、角色是否面向玩家、裁切、动作切换跳动、血条遮挡。
   至少观察 ranged 射箭、charger 冲锋、elite 重击，以及 boss 五招和阶段二切色。

最终先给 APPROVE / APPROVE WITH NOTES / REQUEST CHANGES，再按 P0/P1/P2/P3 列 findings。
每条给资产+动作+帧号或文件行号、可重复证据、影响、最小修复建议。没有阻塞问题就明确
写“无阻塞 finding”，不要虚构问题。最后列实际执行命令、实际打开房间、主观美术建议、
以及你做过的最小修复和复验结果。
```
