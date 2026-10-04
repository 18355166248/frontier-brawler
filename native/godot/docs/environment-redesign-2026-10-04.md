# 环境与关卡门视觉接入（2026-10-04）

基线HEAD：648767969a0bc4e1b6bbe08c6983e7956158e27f。保留原月夜山谷背景、五房地图、英雄/敌人、战斗控制/碰撞/伤害/连招、清场40tick与原x/depth过门谓词。当前默认关卡门为checkpoint-v3；两版旧门作为回退保留。

## 当前门

重新制作石木关隘，源素材直接画出柱/檐/门洞侧面与侧墙厚度；未继续shear正面门。空门洞的人门比例先在实际场景预览。3张真实透明PNG与来源见[素材说明](../assets/environment/checkpoint/README.md)。2D贴图，未新增3D网格。

FBCheckpointGate仅负责表现：关闭时有铁木栅门与“肃清解封”，原清场后0.38秒有界升起，显示“解封中·可前行”，完全开启后栅门隐藏。换房/重开马上重置；暂停不推进。原门谓词随清场立即允许通行，不等待视觉动画。Boss前有红旗与房名文字；Boss房无虚构东出口。无新碰撞、交互键、粒子或音效。独立栅门shader不会影响房间和角色。缺任何必要贴图或尺寸不符时不创建部分新门，沿用旧门。

## 环境和界面

此前地边明度/稀疏苔石/脚底阴影、五房轻微雾色/明度与房名区别、上方HUD及触控按钮显示位置保持前一冻结版，不继续扩地形/UI。旧地图/地面/HUD/触控布局可整体回退。Boss远侧地面仍有平直色带感，未在本轮扩大修改。

## 启动与回退

重启原“开始游戏.command”，或Godot打开project.godot按F5。

```bash
/opt/homebrew/bin/godot --path native/godot -- --play
/opt/homebrew/bin/godot --path native/godot -- --previous-gate --play
/opt/homebrew/bin/godot --path native/godot -- --classic-environment --play
GODOT_BIN=/opt/homebrew/bin/godot npm run validate:godot
```

## 验证边界

Godot4.7.2导入/脚本/shader解析通过。完整套件：137基础、6336姿态、951插值、72反馈、17视口UI、98英雄、55四技能、76环境检查均通过。环境新增项覆盖锁门表现、解封时可通行、暂停冻结、完成隐藏、关闭中断、换房/Boss/restart重置、回退与缺包原子失败。复核修正shader资源非null但编译失败的路径：创建节点前验证canvas_item模式及引擎反射的opening float uniform；12项故障回归覆盖编译无效、uniform缺失、uniform类型不符时零节点失败、旧门回退与原门规则保持。测试仅在已知无效shader创建期间临时关闭其预期错误输出，检查前立即恢复；独立引擎探针另记录原始SHADER ERROR和回退结果。

实际GL Compatibility引擎窗口通过原正式控制驱动自然清场过门至Boss：2958tick；原HP、AI、出怪与伤害不变。关门/Boss东侧构图为站位夹具，不当人工通关。独立门状态夹具7张截图覆盖锁门、解封、暂停恢复、半开、全开、Boss前与无东出口，重复中断/重开3次。Boss未在渲染驱动中被击败，既有基础验证另覆盖完整通关。

960×540、1280×720、1600×900与1024×768留边（实际纹理1024×576）及模拟触控安全区(40,24,48,28)共40项通过，五动作中心命中保持正确。净空使用真实门框alpha和整个门洞四边形，避免外凸包跨过柱脚间空地的误判。这是Mac引擎模拟，不是真机验收。

本轮主形预览先在当前用户会话展示，未把技术通过称为用户满意。没有新增人工GUI通关或移动端验收声明。原图/Prompt/实际渲染/完整日志与夹具保存在output/gate-redesign-20261004/，新freeze与此前V2区分。未提交或push。
