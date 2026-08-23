# Frontier Brawler

横版割草闯关 + 基地经营。当前是**手感原型**：只验证战斗手感，还没有经营层。

技术栈 Vite + TypeScript + Canvas 2D，没有引擎。

## 文档

- [玩法设计](docs/GAME_DESIGN.md) —— 核心循环、战斗设计、职业与装备、经营层、数值框架
- [路线图](docs/ROADMAP.md) —— 里程碑与可判定的验收标准

两份文档里 `[已验证]` 与 `[待验证]` 是严格区分的：
前者来自原型实测，后者是设计假设，做出来玩过才能确认。

## 跑起来

```bash
npm install
npm run dev
```

打开 http://localhost:5180

| 键 | 作用 |
| --- | --- |
| `WASD` / 方向键 | 走位。**上下是纵深**，不是跳跃 |
| `J` / 空格 | 攻击，收招段再按接第二段 |
| `K` / `Shift` | 冲刺 |
| `R` | 重来 |

## 为什么不用 Cocos

逻辑层本来就该是引擎无关的 TS —— 这是从 `xianxia-roguelike` 学到的：
它的 32 个战斗系统文件**零 Cocos 依赖**，5300 行逻辑随时能搬，
而耦合全压在一个 9800 行的编排层里。

所以这里从第一行就把线画清楚：

```text
src/core/     纯逻辑，不引用任何渲染 API。换引擎时一行不动。
src/render/   Canvas 渲染层。换 Cocos 只重写这里。
```

原型阶段用 Canvas 是因为迭代和验证都快得多；
将来要发微信小游戏，再补一层 Cocos 渲染层即可，`core/` 直接复用。

## 手感设计

**固定 60Hz 逻辑步长**，渲染跟显示帧率。所有手感数值（前摇、硬直、击退衰减）
以逻辑帧为单位，144Hz 屏和 60Hz 屏打起来一致。

**帧数分配就是打击感**（见 `core/actions.ts`）：
第一段挥砍前摇 8 帧，第 9-11 帧判定生效，之后收招。
挥出只占 3 帧所以显得快，命中定格再冻结整个世界 5 帧让力道落地。

**攻击令牌**（见 `core/world.ts` 的 `enemyThink`）——这条是实测逼出来的。
最初五个敌人同时贴脸输出，玩家每次受击进 20 帧硬直，永远轮不到自己出手，
实测就是站着被打死。而且不是数值问题：把敌人伤害调到 1 也一样操作不了。

令牌把「同时能打你的人数」压到 2 个，其余的在待机圈上游走。
玩家因此始终有出手窗口，围殴的压迫感却还在。交还令牌时给 42 帧冷却，
否则同一个敌人会立刻抢回去，轮流进攻退化成一个人贴脸连打。

**纵深移速压到横向的 62%**：不压的话斜着走比横着走快，而且纵深过快会破坏横版的空间感。

## 美术

**美术设计不在本仓库的自动化范围内。**
`docs/ROADMAP.md` 末尾列了角色动作表、敌人、建筑的**规格要求**，
产出交给专业工具或人。管线只负责把合规的几何烘成合规的动作表，
不解决"好不好看"。

当前 `public/art/` 是占位盒子人，由 [`ai-asset-pipeline`](../ai-asset-pipeline) 的枢轴动画管线生成：
Blender 里按动作库搭骨架 → K 关键帧 → 正交相机渲成透明序列帧 → 打包成一行一动作的表。

```bash
cd ../ai-asset-pipeline
python src/render_clip_set.py --out output/frames/fb --prefix hero --view side --size 192 \
    --clips idle:4:loop move:4:loop slash:4 hit:4
python src/pack_action_sheet.py --rows \
    idle=output/frames/fb/hero_idle move=output/frames/fb/hero_move \
    slash=output/frames/fb/hero_slash hit=output/frames/fb/hero_hit \
    -o ../frontier-brawler/public/art/hero.png --cols 4 --cell 96
```

`enemy.png` 直接复制自 `hero.png`，敌我暂时分不开。
美术方向定的是低多边形卡通 3D，正式角色几何待产出。

## 开发期调试挂钩

开发模式下 `window.__game` 暴露了几个方法，用来绕过键盘焦点做自动化验证：

```js
__game.restart()                  // 重开
__game.hold({moveX: 1})           // 持续注入输入，{} 清空
__game.tap({attack: true})        // 按一下
__game.pause() / __game.resume()  // 定格检查某一帧
__game.world                      // 读世界状态
```

生产构建里这段会被 tree-shake 掉。

## 已知问题

- `R` 重来在浏览器里按键有时不生效，用 `__game.restart()` 可靠。焦点处理待修。
- 敌我用同一套贴图，视觉上分不开。
- 经营层、装备、职业、升级全都还没有。

## 下一步

见 [路线图](docs/ROADMAP.md)。当前在 **M1 · 战斗深度**——
这是最高风险的里程碑，验收不过就该改机制而不是继续堆功能。
