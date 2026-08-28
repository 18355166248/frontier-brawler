# Cocos 原生竖屏迁移

## 决策

- 引擎：Cocos Creator 3.8.8（本机已安装）
- 首发目标：Android / HarmonyOS 原生竖屏
- 设计分辨率：540×960
- 迁移方式：保留 `src/core/`，逐步替换渲染、输入、音频、存档和平台生命周期
- 回退原则：原 Web 版在原生垂直切片通过前保持可构建、可验证，不覆盖式重写

选择 Cocos 的主要原因不是“画面更好”，而是现有纯 TypeScript 核心可以继续使用，
同时由成熟引擎接管场景、资源、触摸、音频和原生发布。Phaser/Pixi 仍以 Web 为宿主，
不能解决不想在浏览器里玩的核心诉求。

## POC 范围

第一阶段只迁移首关第一间战斗房，验证最高风险，不扩玩法：

1. Cocos 通过 `npm run build:cocos-core` 从 `src/core/` 确定性生成单文件模块，不维护第二套战斗逻辑。
2. `update(dt)` 通过共享 `FixedStepClock` 保持固定 60Hz。
3. 540×960 战场与底部触控区分离，安全区内没有遮挡。
4. 切后台后暂停并释放输入，恢复时不集中补帧。
5. 现有动作表可按脚底基准线和朝向正确显示。
6. Android/HarmonyOS 调试包可安装，50 单位压力场景接近稳定 60fps。

POC 项目位于 `native/cocos-poc/`。当前已完成英雄与 grunt 正式动作表、纵深排序、
生命/能量 HUD 和五键触控提示接入；未迁移的敌人类型继续使用几何兜底，避免渲染
迁移阻塞战斗逻辑验证。持续按住攻击会以电平传入共享 core，重击蓄力不再被误当成
单帧脉冲；切后台会清空输入并重锚定固定步长时钟。

首次打开或核心逻辑变更后先执行：

```bash
npm ci
npm run build:cocos-core
npm run sync:cocos-art
```

`assets/generated/` 与 `assets/resources/generated-art/` 都是可重建产物，不提交源码库；
Creator 项目不能跳过上面的同步步骤。`npm run build:cocos-android` 会自动执行二者。

## 竖屏布局

```text
┌──────────────────────┐
│ 状态栏 / 安全区       │
├──────────────────────┤
│                      │
│       战斗视口        │  约 710 px
│                      │
├──────────┬───────────┤
│ 虚拟摇杆  │ 五个动作键 │  约 250 px
└──────────┴───────────┘
```

首个 POC 仍使用原横版世界坐标，只改变摄像机映射与 UI，不立即改变敌人 AI、攻击方向
或动作素材。若真机证明横向战场在竖屏里过窄，再单独立项评估“纵向推进”，不能把两种
高风险改造绑在同一次迁移里。

## 门禁

本机安装 Cocos Creator 3.8.8、Android Studio SDK/NDK 后，可直接生成竖屏 Android 调试包：

```bash
npm run build:cocos-android
```

脚本优先读取 `ANDROID_SDK_ROOT` / `ANDROID_HOME`、`ANDROID_NDK_HOME`、`JAVA_HOME`，
未设置时使用 macOS 与 Android Studio 的标准安装位置。本机工具链路径只写入临时配置，
不会进入仓库。APK 输出到
`native/cocos-poc/build/android/proj/build/frontier-brawler/outputs/apk/debug/frontier-brawler-debug.apk`。

- `npm run validate` 必须保持全绿。
- `npm run check:cocos` 对 Cocos 适配层做独立 TypeScript 门禁，生成模块的静态契约集中
  在 `FrontierCoreAdapter.ts`，不得在适配层复制玩法实现。
- Web 与 Cocos 使用同一个固定步长实现。
- POC 不修改伤害、帧数、判定窗口、敌人 AI 和关卡编成。
- Creator 预览只算开发检查；原生调试包真机通过才算 POC 完成。

## 分工

当前由 Codex 实施：它需要持续操作本机仓库、Creator、构建工具和真机验收闭环。
Claude 在 POC 场景跑通后做一次只读评审更合适，重点检查：核心是否被错误复制、引擎
生命周期是否泄漏、竖屏信息层级是否拥挤、后续全量迁移是否遗漏存档/音频/后台恢复。
