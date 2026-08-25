# 六类敌人正式动作表（2026-08-25）

## 结论

六类敌人已完成独立身份参考、分动作 2×2 源网格、确定性抠图与注册、运行时
接入。共 27 行、108 帧；所有帧共用单格 96×96、`inner=88`、脚底 `y=90`，
没有透明空帧或内容触边。

| 类型 | 行序 | 帧数 | 正式资产 |
| --- | --- | ---: | --- |
| grunt | idle / move / slash / hit | 16 | `public/art/enemy-grunt-v2.png` |
| shield | idle / move / slash / hit | 16 | `public/art/enemy-shield-v2.png` |
| ranged | idle / move / aim / shoot / hit | 20 | `public/art/enemy-ranged-v2.png` |
| charger | idle / move / charge / rush / hit | 20 | `public/art/enemy-charger-v2.png` |
| elite | idle / move / heavy / hit | 16 | `public/art/enemy-elite-v2.png` |
| boss | bossSlam / bossCharge / bossRush / bossNova / bossSummon | 20 | `public/art/enemy-boss-v2.png` |

每个 PNG 旁边的同名 JSON 是逐帧验收报告，记录行序、统一缩放倍率、脚底线、
最终 bbox 和 y 偏移。源网格保存在 `<kind>/action-grids/`，可直接重跑打包器。

## 生成约束

每个兵种先从阵容概念图拆出单独身份参考，再按动作分别调用内置 imagegen。
完整提示词随兵种动作变化，但都固定以下模板约束：

> 使用参考图中的同一角色身份、装备和配色；生成无边框无间隔的正方形 2×2
> 四帧动作网格；每格一个完整角色；纯 `#FF00FF` 背景；固定正交 3/4 侧视并
> 面向屏幕右侧；锁定相机、缩放、头身比、装备尺寸、角色根节点和脚底线；
> 禁止文字、阴影、场景、特效、运动线、额外肢体/武器和跨格内容。

动作语义再分别补充，例如 ranged 的 `aim` 是举弓、搭箭、拉弦、稳定满弓，
`shoot` 是满弓、释放、随动、回收；charger 的 `charge` 只蓄力不位移，
`rush` 才完成启动、肩撞、伸展、刹停。这样运行时的状态切换可以直接读姿态。

## 确定性打包

```bash
# grunt / shield / ranged 三个兵种必须带 --mirror，理由见下一节
python3 tools/build_ai_action_sheet.py \
  docs/experiments/enemy-actions-2026-08-25/grunt/action-grids \
  -o public/art/enemy-grunt-v2.png --actions idle move slash hit --mirror
```

其余兵种只替换目录、输出名和上表行序；boss 原生朝右，不带 `--mirror`。
本轮重出的 elite 和 boss 分别带 `--remove-components-under 17` 与
`--remove-components-under 4`，用于移除色键后确认是背景残留的孤岛。ranged 的
箭杆属于有意义的独立细件，不使用该参数。该清理默认关闭，不会波及其他动作表。

### grunt / shield / ranged 需要 `--mirror`

这三套源网格生成时朝向反了：规格要求整套动作一律**面向屏幕右侧**
（见 `docs/ROADMAP.md` 角色动作表规格），但它们生成出来是面向左的。
渲染层用 `ctx.scale(e.facing, 1)` 做镜像、`facing = 1` 时不镜像，
所以源图朝左会让敌人在游戏里永远背对目标——攻击判定朝一边、人物挥向
另一边。盾兵最严重：正面减伤和背后弱点按 `facing` 判定，画面上的盾会
正好落在实际是弱点的那一侧，把「绕后」这个机制教反。

源网格保持原样不动，改由打包器在切完格之后逐帧翻转（必须切完再翻，
直接翻整张 2×2 网格会把第 1↔2、3↔4 帧的位置也调换，动作时序就倒了）。
翻转对这套素材没有副作用：渲染层本来就会给每个精灵做镜像，同一个角色
朝左朝右两种形态在游戏里一直都会出现。

哪些表翻过记录在各自 JSON 的 `mirrored` 字段里，不用去翻命令历史。
**将来这三套素材若按规格重出（生成时就面向右），要同步去掉 `--mirror`。**
机械验收脚本查不出朝向，改完必须人工逐张确认。打包器不按角色 bbox 逐帧缩放，而是把
所有完整源格统一缩到 `inner=88`，再只做平移将最低可见像素注册到 `y=90`；
这是切动作时身高和脚底不漂移的结构保证。

## 复核命令

```bash
python3 tools/validate_action_sheets.py public/art/hero-v2.json public/art/enemy-*-v2.json
npm run build
```

运行时在 `src/main.ts` 按兵种注册六张独立表，`src/render/renderer.ts` 只按兵种
设置一个固定整体倍率，并以源表 `y=90` 为贴地点。boss 阶段一使用素材中的
深红 `#8f2f3a`，阶段二由运行时把红色区域推向亮橙红并叠加 `#e2543a` 地面强调；
素材加载失败时仍回退原几何轮廓，不阻断玩法测试。
