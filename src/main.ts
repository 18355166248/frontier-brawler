/**
 * 入口：固定步长循环 + 输入 + 关卡推进。
 *
 * 逻辑用固定 60Hz 步长推进，渲染跟显示帧率。
 * 手感数值（前摇帧数、硬直、击退衰减）全部以逻辑帧为单位，
 * 这样在 144Hz 屏和 60Hz 屏上打起来是一样的。
 *
 * 关卡结构见 docs/LEVEL_DESIGN.md：这一层只负责驱动 Run，
 * 房间怎么切、玩家状态怎么跨房间保留，全在 core/run.ts 里。
 */
import { TICK_RATE } from './core/actions';
import { validateStage } from './core/level';
import { Run, createProfile, createStageProfile } from './core/run';
import { STAGES } from './core/stages';
import type { UpgradeTrackId } from './core/upgrades';
import { createEnemy } from './core/world';
import type { InputState } from './core/world';
import { Renderer } from './render/renderer';
import { SpriteSheet } from './render/sprites';
import { EquipmentIcons } from './render/equipment-icons';
import { BuildingArt } from './render/building-art';
import { PROFESSION_IDS } from './core/types';
import type { ActionState, Profession } from './core/types';
import { ProfessionValidationStore } from './dev/profession-validation';
import { ValidationPanel } from './dev/validation-panel';
import { ACCESSORY_IDS, ARMOR_IDS, WEAPON_IDS, equipmentLabel } from './core/equipment';
import type { EquipmentId, EquipmentSlot } from './core/equipment';
import { BUILDING_IDS, unlockedBuildings } from './core/economy';
import type { BuildingId } from './core/economy';
import {
  clearCampaignSave,
  loadCampaignSave,
  writeCampaignSave,
} from './core/save';
import type { SaveStorage } from './core/save';
import { GameAudio } from './audio/game-audio';
import { TouchControls } from './input/touch-controls';
import { isSyntheticValidationSandbox, LoopValidationStore } from './dev/loop-validation';
import { PerformanceProbe } from './dev/performance-probe';
import type { EnemyKind } from './core/types';

/** 三选一的按键，和 render/renderer.ts 里卡片上画的键位一一对应 */
const CHOICE_KEYS: Record<string, UpgradeTrackId> = {
  Digit1: 'offense',
  Digit2: 'arcane',
  Digit3: 'guardian',
};

/** M2 验证阶段三个职业全部开放，键位顺序与选择卡片一致。 */
const PROFESSION_KEYS: Record<string, Profession> = {
  Digit1: 'heavy',
  Digit2: 'swift',
  Digit3: 'arcane',
};

const EQUIPMENT_SLOT_KEYS: Record<string, EquipmentSlot> = {
  Digit1: 'weapon',
  Digit2: 'armor',
  Digit3: 'accessory',
};

const WIDTH = 960;
const HEIGHT = 540;

// 正式动作表按 ROADMAP 约定固定为六行；行序一旦和图片错位，冲刺时就会
// 播成受击，因此在入口集中声明，不在渲染器里散落魔法下标。
const SHEET_ROWS: ActionState[] = ['idle', 'move', 'slash', 'slash2', 'dash', 'hit'];

/**
 * 六类敌人的行序必须和各自 JSON 报告一致。不同兵种只注册状态机真正会
 * 进入的动作；SpriteSheet 对未覆盖状态仍会回退 idle，保证素材损坏时游戏可测。
 */
const ENEMY_SHEET_ROWS: Record<string, ActionState[]> = {
  grunt: ['idle', 'move', 'slash', 'hit'],
  shield: ['idle', 'move', 'slash', 'hit'],
  ranged: ['idle', 'move', 'aim', 'shoot', 'hit'],
  charger: ['idle', 'move', 'charge', 'rush', 'hit'],
  elite: ['idle', 'move', 'heavy', 'hit'],
  boss: ['bossSlam', 'bossCharge', 'bossRush', 'bossNova', 'bossSummon'],
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const sheets = new Map<string, SpriteSheet>();
sheets.set('player', new SpriteSheet({ url: 'art/hero-v2.png', columns: 4, rows: SHEET_ROWS }));
// 每个兵种独立一张表，身份、体型和动作不会因为共用图集而互相串行。
for (const [kind, rows] of Object.entries(ENEMY_SHEET_ROWS)) {
  sheets.set(kind, new SpriteSheet({ url: `art/enemy-${kind}-v2.png`, columns: 4, rows }));
}

const renderer = new Renderer(canvas, sheets, new EquipmentIcons(), new BuildingArt());
renderer.setTouchMode(window.matchMedia('(hover: none), (pointer: coarse)').matches);
const audio = new GameAudio();

/**
 * 手写的房间图最容易出两种错：门只连了单向，和网格坐标与门方向对不上。
 * 两种在游戏里都表现为「玩着玩着卡住」，很难倒推，所以开发期一启动就全量校验。
 */
if (import.meta.env.DEV) {
  const problems = STAGES.flatMap((s) => validateStage(s));
  if (problems.length) console.error('关卡数据有问题:\n' + problems.join('\n'));
}

/** Safari 隐私模式等环境可能在访问 localStorage 属性时就抛错，启动不能因此白屏。 */
function resolveCampaignStorage(): SaveStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const campaignStorage = resolveCampaignStorage();
const loadedCampaign = campaignStorage ? loadCampaignSave(campaignStorage, STAGES.length) : null;
let stageIndex = loadedCampaign?.stageIndex ?? 0;
let run = new Run(
  STAGES[stageIndex],
  loadedCampaign ? createStageProfile(loadedCampaign.profile) : createProfile(),
);
let lastCampaignSaveAtMs = 0;
let campaignPersistenceEnabled = true;
/** 跳关、压力注入等沙盒局只用于机械验证，不能写入真人验收样本。 */
let validationSamplingEnabled = true;
const CAMPAIGN_AUTOSAVE_INTERVAL_MS = 1_000;

/** 通关画面刷新后直接从下一关起点继续，最终关则保留在最终关。 */
function campaignResumeStageIndex(): number {
  return run.phase === 'stageComplete' && stageIndex + 1 < STAGES.length
    ? stageIndex + 1
    : stageIndex;
}

/**
 * 离线收益每个逻辑帧都会更新时钟，因此按秒节流；离开页面和关键状态切换强制落盘。
 * 存储不可用时只放弃持久化，不影响当前战斗。
 */
function saveCampaign(nowMs = Date.now(), force = false): boolean {
  if (!campaignStorage || !campaignPersistenceEnabled) return false;
  if (!force && nowMs - lastCampaignSaveAtMs < CAMPAIGN_AUTOSAVE_INTERVAL_MS) return false;
  const saved = writeCampaignSave(
    campaignStorage,
    campaignResumeStageIndex(),
    run.profile,
    nowMs,
  );
  if (saved) lastCampaignSaveAtMs = nowMs;
  return saved;
}
const professionValidation = import.meta.env.DEV ? new ProfessionValidationStore() : null;
const loopValidation = import.meta.env.DEV ? new LoopValidationStore() : null;
const performanceProbe = import.meta.env.DEV ? new PerformanceProbe() : null;
const recordedValidationRuns = new WeakSet<Run>();
const defeatSampleByRun = new WeakMap<Run, string>();
/**
 * M2/M4/M6 验收面板。和上面的样本记录器一样只在 DEV 下构造，
 * 生产构建里 `import.meta.env.DEV` 会被替换成 false 后整段摇掉。
 */
const validationPanel =
  import.meta.env.DEV && professionValidation
    ? new ValidationPanel(
        professionValidation,
        (id) => equipmentLabel(id as EquipmentId),
        STAGES.map((stage) => stage.id),
        loopValidation && performanceProbe
          ? {
              loop: loopValidation,
              performance: () => performanceProbe.report(run.world.entities.length),
              environment: () => ({
                userAgent: navigator.userAgent,
                viewport: `${window.innerWidth}×${window.innerHeight}`,
                devicePixelRatio: window.devicePixelRatio,
                hardwareConcurrency: navigator.hardwareConcurrency || null,
                // deviceMemory 并非所有浏览器都暴露；缺失时导出 null，而非伪造设备档位。
                deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
              }),
              touchMode: () => window.matchMedia('(hover: none), (pointer: coarse)').matches,
            }
          : null,
      )
    : null;
if (validationPanel) document.body.classList.add('validation-enabled');

function startStage(index: number, carryFrom?: Run['profile']): void {
  stageIndex = Math.max(0, Math.min(STAGES.length - 1, index));
  // 职业、装备与基地跨关保留，生命、能量和普通局内成长按关卡重置。
  run = new Run(STAGES[stageIndex], createStageProfile(carryFrom));
  saveCampaign(Date.now(), true);
}

/** 只用于开发压力场景：固定网格生成混合兵种，不修改任何正式关卡编成。 */
function spawnStressEnemies(requestedCount: number): number {
  if (!import.meta.env.DEV || !Number.isFinite(requestedCount)) return 0;
  validationSamplingEnabled = false;
  const count = Math.max(1, Math.min(100, Math.floor(requestedCount)));
  const world = run.world;
  const player = world.player;
  if (!player) return 0;
  world.entities = [player];
  world.projectiles = [];
  world.attackTokens.clear();
  run.cleared.delete(run.room.id);
  const kinds: EnemyKind[] = ['grunt', 'shield', 'ranged', 'charger', 'elite'];
  const columns = 10;
  const rows = Math.ceil(count / columns);
  const minX = world.arena.minX + 300;
  const maxX = world.arena.maxX - 35;
  const minY = world.arena.minY + 20;
  const maxY = world.arena.maxY - 20;
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = minX + (column / Math.max(1, columns - 1)) * (maxX - minX);
    const y = minY + (row / Math.max(1, rows - 1)) * (maxY - minY);
    world.spawn(createEnemy(kinds[index % kinds.length], { x, y }));
  }
  performanceProbe?.clear();
  return count;
}

if (import.meta.env.DEV) {
  // Canvas 场景没有可点的 DOM 节点，视觉回归若每次都从出生点走过去既慢又
  // 不稳定。开发地址允许 `?stage=3&room=c1` 直达指定房间，生产构建会整段移除。
  const params = new URLSearchParams(window.location.search);
  const requestedStage = Number(params.get('stage'));
  const requestedRoom = params.get('room');
  const requestedProfession = params.get('profession') as Profession | null;
  const requestedEquipment = params.getAll('equipment');
  const requestedStressCount = Number(params.get('stress'));
  const requestedBaseState = params.get('base');
  if (params.get('touch') === '1') {
    document.body.classList.add('force-touch');
    renderer.setTouchMode(true);
  }
  // 带直达参数的是一次性验收沙盒，不得把跳关或注入装备覆盖玩家的正式存档。
  const syntheticValidationSandbox = isSyntheticValidationSandbox(params);
  campaignPersistenceEnabled = !syntheticValidationSandbox;
  validationSamplingEnabled = !syntheticValidationSandbox;
  if (Number.isInteger(requestedStage) && requestedStage >= 1 && requestedStage <= STAGES.length) {
    startStage(requestedStage - 1);
  }
  if (requestedRoom && run.stage.rooms.some((room) => room.id === requestedRoom)) {
    run.enterRoom(requestedRoom, null);
  }
  if (requestedProfession && PROFESSION_IDS.includes(requestedProfession)) {
    run.setProfession(requestedProfession);
  }
  const equipmentIds = new Set<string>([...WEAPON_IDS, ...ARMOR_IDS, ...ACCESSORY_IDS]);
  for (const rawId of requestedEquipment) {
    if (!equipmentIds.has(rawId)) continue;
    const id = rawId as EquipmentId;
    run.grantEquipment(id);
    run.equip(id);
  }
  if (Number.isInteger(requestedStressCount) && requestedStressCount > 0) {
    document.body.classList.add('stress-test');
    run.setProfession('swift');
    spawnStressEnemies(requestedStressCount);
  }
  if (['unbuilt', 'building', 'completed'].includes(requestedBaseState ?? '')) {
    // 建筑三态是 Canvas 像素，DOM 自动化看不到；开发沙盒固定资源和进度，
    // 让每次换图都能直达同一画面人工复核，且上面的持久化门禁保证不污染存档。
    run.profile.base.completedStageRuns = BUILDING_IDS.length;
    run.profile.base.resources = { materials: 999, blueprints: 999, rareMaterials: 999 };
    run.setProfession('swift');
    if (requestedBaseState === 'building') {
      const nowMs = Date.now();
      run.profile.base.constructionQueue = BUILDING_IDS.map((building) => ({
        building,
        startsAtMs: nowMs,
        completesAtMs: nowMs + 60_000,
      }));
    } else if (requestedBaseState === 'completed') {
      run.profile.base.completedBuildings = [...BUILDING_IDS];
    }
    run.world.stats.died = true;
    run.toggleBaseMenu(Date.now());
  }
  if (params.get('report') === '1' && validationPanel) {
    // 真机没有键盘：验收专用地址直接打开 M6 页，避免玩家猜 V / Tab 怎么按。
    validationPanel.handleKey('KeyV');
    validationPanel.handleKey('Tab');
  }
}

const keys = new Set<string>();
const pendingEdges = {
  attack: false,
  dash: false,
  skill: false,
  execute: false,
  jump: false,
};

/**
 * 出手键的 keydown 先进入边沿队列，下一逻辑帧再消费。
 * 否则极短点按可能完整落在两个 60Hz tick 之间，采样 keys 时已经 keyup，输入会凭空丢失。
 */
function queueActionEdge(code: string): void {
  if (code === 'KeyJ' || code === 'Space') pendingEdges.attack = true;
  if (code === 'KeyK' || code === 'ShiftLeft') pendingEdges.dash = true;
  if (code === 'KeyU' || code === 'KeyE') pendingEdges.skill = true;
  if (code === 'KeyI' || code === 'KeyF') pendingEdges.execute = true;
  if (code === 'KeyL' || code === 'KeyQ') pendingEdges.jump = true;
}

function handleKeyDown(e: KeyboardEvent): void {
  void audio.unlock();
  // 验收面板先看一眼：它只吃自己的键（V/Tab/O/C/Y/Esc），吃掉就不再交给游戏，
  // 免得"按 C 确认清空"顺手也触发了别的操作。其余键照常透传，
  // 面板是覆盖层不是暂停态。
  if (!e.repeat && validationPanel?.handleKey(e.code)) {
    e.preventDefault();
    return;
  }
  keys.add(e.code);
  if (!e.repeat) queueActionEdge(e.code);
  if (e.code === 'KeyM' && !e.repeat && !audio.toggleMuted()) audio.play('confirm');
  if (e.code === 'KeyR') startStage(stageIndex, run.profile);
  if (e.code === 'KeyB' && !e.repeat && run.toggleEquipmentMenu()) audio.play('confirm');
  if (e.code === 'KeyG' && !e.repeat) {
    const openingAfterDefeat = run.phase === 'dead';
    if (run.toggleBaseMenu(Date.now())) {
      if (openingAfterDefeat) {
        const sampleId = defeatSampleByRun.get(run);
        if (sampleId) loopValidation?.recordBaseChoice(sampleId);
      }
      audio.play('confirm');
    }
  }
  // 最后一关通关后没有下一关可进——不加这条边界的话，Math.min 会把
  // stageIndex+1 钳回原地，按 N 变成"用全新档案重开第 6 关"，
  // 玩家会以为按键没反应，而不是"这已经是终点"。
  if (e.code === 'KeyN' && run.phase === 'stageComplete' && stageIndex + 1 < STAGES.length) {
    startStage(stageIndex + 1, run.profile);
  }
  const track = CHOICE_KEYS[e.code];
  const profession = PROFESSION_KEYS[e.code];
  if (run.phase === 'baseMenu') {
    const index = Number(e.code.replace('Digit', '')) - 1;
    const building = BUILDING_IDS[index];
    if (building === 'alchemyLab' && run.profile.base.completedBuildings.includes('alchemyLab')) {
      if (run.craftTonic()) {
        recordDefeatBaseUse();
        audio.play('confirm');
      }
    } else if (building === 'archive' && run.profile.base.completedBuildings.includes('archive')) {
      if (run.cycleArchiveTrack()) {
        recordDefeatBaseUse();
        audio.play('confirm');
      }
    } else if (building) {
      if (run.queueBaseBuilding(building, Date.now())) {
        recordDefeatBaseUse();
        audio.play('confirm');
      }
    }
  } else if (
    profession &&
    run.phase === 'professionSelect' &&
    run.canSelectProfession(profession)
  ) {
    run.setProfession(profession);
    audio.play('confirm');
  } else if (run.phase === 'equipmentMenu') {
    const slot = EQUIPMENT_SLOT_KEYS[e.code];
    if (slot && run.cycleEquipment(slot)) audio.play('confirm');
  } else if (run.phase === 'equipmentChoice' && run.pendingEquipment) {
    const index = Number(e.code.replace('Digit', '')) - 1;
    const equipment = run.pendingEquipment[index];
    if (equipment && run.chooseEquipment(equipment)) audio.play('confirm');
  } else if (track && run.phase === 'choosing' && run.pendingChoice?.includes(track)) {
    run.chooseUpgrade(track);
    audio.play('confirm');
  }
  // 方向键和空格会滚动页面，游戏里要吃掉
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
}

function recordDefeatBaseUse(): void {
  const sampleId = defeatSampleByRun.get(run);
  if (sampleId) loopValidation?.recordBaseUse(sampleId);
}

function handleKeyUp(e: KeyboardEvent): void {
  keys.delete(e.code);
}

function unlockAudioFromPointer(): void {
  void audio.unlock();
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
canvas.addEventListener('pointerdown', unlockAudioFromPointer);

const touchRoot = document.getElementById('touch-controls');
const touchEquipmentButton = touchRoot?.querySelector<HTMLElement>('[data-touch-key="KeyB"]');
const touchControls = touchRoot
  ? new TouchControls({
      root: touchRoot,
      onMove: (vector) => {
        injected.moveX = vector.x;
        injected.moveY = vector.y;
      },
      onKey: (code, pressed) => {
        const event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code });
        if (pressed) handleKeyDown(event);
        else handleKeyUp(event);
      },
      onInteraction: () => void audio.unlock(),
    })
  : null;

/** 攻击和冲刺取「按下那一瞬间」，不是持续按住——否则按住不放会变成无限连招。 */
let attackLatch = false;
let dashLatch = false;
let skillLatch = false;
let executeLatch = false;
let jumpLatch = false;

/** 调试注入的输入，和键盘取并集。开发期自动化验证用。 */
let injected: Partial<InputState> = {};

function readInput(): InputState {
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');

  const attackHeld = keys.has('KeyJ') || keys.has('Space') || !!injected.attack;
  const dashHeld = keys.has('KeyK') || keys.has('ShiftLeft') || !!injected.dash;
  const skillHeld = keys.has('KeyU') || keys.has('KeyE') || !!injected.skill;
  const executeHeld = keys.has('KeyI') || keys.has('KeyF') || !!injected.execute;
  const jumpHeld = keys.has('KeyL') || keys.has('KeyQ') || !!injected.jump;

  const attack = pendingEdges.attack || (attackHeld && !attackLatch);
  const dash = pendingEdges.dash || (dashHeld && !dashLatch);
  const skill = pendingEdges.skill || (skillHeld && !skillLatch);
  const execute = pendingEdges.execute || (executeHeld && !executeLatch);
  const jump = pendingEdges.jump || (jumpHeld && !jumpLatch);
  pendingEdges.attack = false;
  pendingEdges.dash = false;
  pendingEdges.skill = false;
  pendingEdges.execute = false;
  pendingEdges.jump = false;
  attackLatch = attackHeld;
  dashLatch = dashHeld;
  skillLatch = skillHeld;
  executeLatch = executeHeld;
  jumpLatch = jumpHeld;

  return {
    moveX: (right ? 1 : 0) - (left ? 1 : 0) + (injected.moveX ?? 0),
    moveY: (down ? 1 : 0) - (up ? 1 : 0) + (injected.moveY ?? 0),
    attack,
    attackHeld,
    dash,
    skill,
    execute,
    jump,
  };
}

const STEP_MS = 1000 / TICK_RATE;
let accumulator = 0;
let last = performance.now();
let rafId = 0;
let stopped = false;
let paused = false;
const performanceHud = document.getElementById('performance-hud');
let performanceHudCooldown = 0;

/** 推进一个逻辑帧并把事件转给表现层。自动化验证也复用它，保证跑的是同一条路径。 */
function stepOnce(): void {
  // 建造使用真实时间而非战斗帧：暂停、切关或页面后台时都应照常到期。
  const nowMs = Date.now();
  run.settleBaseConstruction(nowMs);
  run.settleBaseOfflineIncome(nowMs);
  const clearedBefore = run.cleared.size;
  const stageClearedBefore = run.stageCleared;
  const phaseBefore = run.phase;
  const events = run.step(readInput());
  audio.onWorldEvents(events, run.world.player?.id);
  if (events.damage.length) renderer.onEvents(events.damage);
  if (events.executes.length) renderer.onExecutes(events.executes);
  if (events.skillCasts.length) renderer.onSkillCasts(events.skillCasts);
  if (events.bossPhaseShifts.length) renderer.onBossPhaseShift(events.bossPhaseShifts);
  if (!stageClearedBefore && run.stageCleared) audio.play('stageClear');
  else if (run.cleared.size > clearedBefore) audio.play('roomClear');
  if (phaseBefore !== 'dead' && run.phase === 'dead') audio.play('defeat');
  if (validationSamplingEnabled && phaseBefore !== 'dead' && run.phase === 'dead' && loopValidation) {
    defeatSampleByRun.set(run, loopValidation.recordDefeat(run.stage.id));
  }
  if (
    validationSamplingEnabled &&
    professionValidation &&
    !recordedValidationRuns.has(run) &&
    (run.phase === 'stageComplete' || run.phase === 'dead')
  ) {
    professionValidation.record(run.stage.id, run.phase === 'stageComplete', run.overallSummary());
    recordedValidationRuns.add(run);
  }
  saveCampaign(nowMs);
}

function frame(now: number): void {
  if (stopped) return;
  const frameMs = Math.min(250, now - last);
  accumulator += frameMs;
  last = now;

  let logicMs = 0;
  while (accumulator >= STEP_MS) {
    if (!paused) {
      const logicStartedAt = performance.now();
      stepOnce();
      logicMs += performance.now() - logicStartedAt;
    }
    accumulator -= STEP_MS;
  }

  const renderStartedAt = performance.now();
  if (touchRoot) {
    touchRoot.dataset.phase = run.phase;
    touchRoot.dataset.finalStage = String(stageIndex + 1 >= STAGES.length);
    const forgeUnlocked = run.profile.base.completedBuildings.includes('forge');
    touchRoot.dataset.forgeUnlocked = String(forgeUnlocked);
    touchRoot.dataset.validationOpen = String(validationPanel?.open ?? false);
    touchRoot.dataset.validationClearPending = String(validationPanel?.clearPending ?? false);
    touchEquipmentButton?.setAttribute('aria-disabled', String(!forgeUnlocked));
  }
  renderer.draw(run);
  // 画在所有游戏 UI 之上：它是开发期的检查工具，不是玩法界面
  validationPanel?.draw(canvas.getContext('2d')!, canvas.width, canvas.height);
  performanceHud?.classList.toggle('validation-hidden', validationPanel?.open ?? false);
  const renderMs = performance.now() - renderStartedAt;
  performanceProbe?.record(frameMs, logicMs, renderMs);
  if (performanceHud && performanceHudCooldown-- <= 0) {
    const report = performanceProbe?.report(run.world.entities.length);
    if (report) {
      performanceHud.textContent = [
        `${report.entities} units · ${report.averageFps} fps`,
        `p95 frame ${report.p95FrameMs}ms`,
        `logic ${report.p95LogicMs}ms · render ${report.p95RenderMs}ms`,
        report.passes50UnitTarget ? 'PASS' : `sampling ${report.samples}/120`,
      ].join('\n');
    }
    performanceHudCooldown = 30;
  }
  rafId = requestAnimationFrame(frame);
}

// HMR 会重新执行本模块；循环和输入监听都要清掉，否则画面会闪、一次按键会
// 被多份旧世界重复消费，新增的 AudioContext 也会跟着泄漏。
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    saveCampaign(Date.now(), true);
    stopped = true;
    cancelAnimationFrame(rafId);
    audio.dispose();
    touchControls?.dispose();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    canvas.removeEventListener('pointerdown', unlockAudioFromPointer);
    window.removeEventListener('pagehide', persistCampaignOnPageHide);
  });
}

// pagehide 同时覆盖刷新、关闭标签页和移动端进入后台，比 beforeunload 更可靠。
function persistCampaignOnPageHide(): void {
  saveCampaign(Date.now(), true);
}
window.addEventListener('pagehide', persistCampaignOnPageHide);

/**
 * 调试挂钩。开发期用来在控制台直接驱动世界、跑自动化测试，
 * 不经过键盘事件，省得被焦点问题挡住。生产构建里会被 tree-shake 掉。
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    get run() {
      return run;
    },
    /** 当前房间的世界。跨房间的事看 __game.run */
    get world() {
      return run.world;
    },
    restart(): void {
      startStage(stageIndex);
    },
    /** 立即保存当前跨局进度；返回 false 表示浏览器存储不可用。 */
    save(): boolean {
      return saveCampaign(Date.now(), true);
    },
    /** 只清除磁盘存档，不中断当前这局。 */
    clearSave(): boolean {
      return campaignStorage ? clearCampaignSave(campaignStorage) : false;
    },
    /** 音效静音开关；返回 true 表示当前已静音。 */
    mute(): boolean {
      return audio.toggleMuted();
    },
    /** 跳到第 n 关（1 起） */
    stage(n: number): void {
      startStage(n - 1);
    },
    /** 直接传送到本关某个房间，跳过前面的战斗 */
    goto(roomId: string): void {
      run.enterRoom(roomId, null);
    },
    /** 切职业用于 M2 对照测试；正式选择界面也会复用 Run.setProfession。 */
    profession(profession: Profession): void {
      if (!PROFESSION_IDS.includes(profession)) return;
      run.setProfession(profession);
    },
    /** M4 实验武器/装备验证；传 null 时必须同时指定要卸下的槽位。 */
    equip(id: EquipmentId | null, slot?: EquipmentSlot): boolean {
      return run.equip(id, slot);
    },
    /** M4 掉落调试：直接收入库存，不自动装备。 */
    grantEquipment(id: EquipmentId): void {
      run.grantEquipment(id);
    },
    toggleBase(): boolean {
      return run.toggleBaseMenu(Date.now());
    },
    queueBuilding(id: BuildingId): boolean {
      if (!BUILDING_IDS.includes(id)) return false;
      return run.queueBaseBuilding(id, Date.now());
    },
    /** 清空当前房间的敌人，用来快速验证开门与切换 */
    clearRoom(): void {
      for (const e of run.world.entities) {
        if (e.team === 'enemy' && !e.dead) {
          e.hp = 0;
          e.dead = true;
        }
      }
    },
    /** 持续注入输入，交给正常循环消费；传 {} 清空。 */
    hold(input: Partial<InputState>): void {
      injected = input;
    },
    /** 暂停/继续逻辑推进，渲染照常。用来定格检查某一帧的画面。 */
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
    },
    /** 注入一帧后自动清掉，用来模拟"按一下"。 */
    tap(input: Partial<InputState>, frames = 2): void {
      injected = input;
      setTimeout(() => {
        injected = {};
      }, (frames * 1000) / TICK_RATE);
    },
    /** 本房间统计摘要，M1 四条验收标准直接读这个。 */
    stats(): unknown {
      return { profession: run.profile.profession, ...run.world.stats.summary() };
    },
    /** 整关（跨房间）统计摘要，结算界面画的就是这份数据。 */
    overallStats(): unknown {
      return run.overallSummary();
    },
    /** M2 真人样本按职业聚合；每次通关或死亡会自动落一条。 */
    professionReport(): unknown {
      return professionValidation?.report() ?? [];
    },
    /** M4 配装分布与头部占比，和职业验收共用同一批自动记录样本。 */
    equipmentReport(): unknown {
      return professionValidation?.equipmentReport() ?? {
        totalSamples: 0,
        topLoadoutShare: 0,
        passesDiversityTarget: false,
        loadouts: [],
      };
    },
    /** 每职业逐关统计是否达到至少 3 份终局样本，防止总数掩盖关卡缺口。 */
    professionCoverage(): unknown {
      return professionValidation?.coverage(STAGES.map((stage) => stage.id)) ?? [];
    },
    professionSamples(): unknown {
      return professionValidation?.samples() ?? [];
    },
    /** M6 战败后进入/使用基地的真人比例。 */
    loopReport(): unknown {
      return loopValidation?.report() ?? {
        defeats: 0,
        baseChoices: 0,
        baseUses: 0,
        baseChoiceRate: 0,
        baseUseRate: 0,
        passesChoiceTarget: false,
      };
    },
    loopSamples(): unknown {
      return loopValidation?.samples() ?? [];
    },
    clearLoopSamples(): void {
      loopValidation?.clear();
    },
    /** M6 50+ 单位压力报告；先用 stress(50) 注入或打开 ?stress=50。 */
    performanceReport(): unknown {
      return performanceProbe?.report(run.world.entities.length) ?? null;
    },
    stress(count = 50): number {
      return spawnStressEnemies(count);
    },
    /** 开关 M2/M4 验收面板；键盘 V 走的是同一条路径。 */
    toggleValidationPanel(): boolean {
      validationPanel?.handleKey('KeyV');
      return validationPanel?.open ?? false;
    },
    /** 面板当前呈现的行，自动化验证直接断言这个而不是截图。 */
    validationPanelModel(): unknown {
      return validationPanel?.model() ?? null;
    },
    clearProfessionSamples(): void {
      professionValidation?.clear();
    },
    /** 无预警伤害明细，验收第 4 条要逐条 review。 */
    unwarned(): unknown {
      return run.world.stats.unwarned;
    },
    /** 本关进度 */
    progress(): unknown {
      return {
        stage: `${run.stage.index} ${run.stage.name}`,
        room: run.room.id,
        kind: run.room.kind,
        phase: run.phase,
        cleared: [...run.cleared],
        total: run.stage.rooms.length,
        openDoors: run.openDoors,
        hp: Math.round(run.profile.hp),
        profession: run.profile.profession,
        equipment: { ...run.profile.equipment },
        inventory: {
          weapons: [...run.profile.inventory.weapons],
          armors: [...run.profile.inventory.armors],
          accessories: [...run.profile.inventory.accessories],
        },
        resources: { ...run.profile.base.resources },
        completedStageRuns: run.profile.base.completedStageRuns,
        completedBuildings: [...run.profile.base.completedBuildings],
        unlockedBuildings: unlockedBuildings(run.profile.base),
        constructionQueue: run.profile.base.constructionQueue.map((job) => ({ ...job })),
        lastActiveAtMs: run.profile.base.lastActiveAtMs,
        tonics: run.profile.base.tonics,
        archiveTrack: run.profile.base.archiveTrack,
        resourceLedgerEntries: run.profile.base.resourceLedger.length,
        pendingEquipment: run.pendingEquipment ? [...run.pendingEquipment] : null,
        seconds: Number((run.stats.frames / 60).toFixed(1)),
      };
    },
    /**
     * 脱离渲染循环快速推进 n 帧，给自动化验证用。
     * 跑的是和真机同一个 stepOnce，所以统计结果可信。
     */
    fastForward(frames: number): void {
      for (let i = 0; i < frames && run.phase !== 'dead'; i += 1) stepOnce();
    },
  };
}

async function boot(): Promise<void> {
  await Promise.all([...sheets.values()].map((s) => s.load()));
  requestAnimationFrame(frame);
}

void boot();
