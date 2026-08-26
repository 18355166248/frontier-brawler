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
import type { InputState } from './core/world';
import { Renderer } from './render/renderer';
import { SpriteSheet } from './render/sprites';
import { PROFESSION_IDS } from './core/types';
import type { ActionState, Profession } from './core/types';
import { ProfessionValidationStore } from './dev/profession-validation';
import type { EquipmentId, EquipmentSlot } from './core/equipment';

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

const renderer = new Renderer(canvas, sheets);

/**
 * 手写的房间图最容易出两种错：门只连了单向，和网格坐标与门方向对不上。
 * 两种在游戏里都表现为「玩着玩着卡住」，很难倒推，所以开发期一启动就全量校验。
 */
if (import.meta.env.DEV) {
  const problems = STAGES.flatMap((s) => validateStage(s));
  if (problems.length) console.error('关卡数据有问题:\n' + problems.join('\n'));
}

let stageIndex = 0;
let run = new Run(STAGES[stageIndex], createProfile());
const professionValidation = import.meta.env.DEV ? new ProfessionValidationStore() : null;
const recordedValidationRuns = new WeakSet<Run>();

function startStage(index: number, carryFrom?: Run['profile']): void {
  stageIndex = Math.max(0, Math.min(STAGES.length - 1, index));
  // M4 装备跨关保留，战斗资源和局内成长仍重置；完整经营存档留给 M5。
  run = new Run(STAGES[stageIndex], createStageProfile(carryFrom));
}

if (import.meta.env.DEV) {
  // Canvas 场景没有可点的 DOM 节点，视觉回归若每次都从出生点走过去既慢又
  // 不稳定。开发地址允许 `?stage=3&room=c1` 直达指定房间，生产构建会整段移除。
  const params = new URLSearchParams(window.location.search);
  const requestedStage = Number(params.get('stage'));
  const requestedRoom = params.get('room');
  const requestedProfession = params.get('profession') as Profession | null;
  if (Number.isInteger(requestedStage) && requestedStage >= 1 && requestedStage <= STAGES.length) {
    startStage(requestedStage - 1);
  }
  if (requestedRoom && run.stage.rooms.some((room) => room.id === requestedRoom)) {
    run.enterRoom(requestedRoom, null);
  }
  if (requestedProfession && PROFESSION_IDS.includes(requestedProfession)) {
    run.setProfession(requestedProfession);
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

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (!e.repeat) queueActionEdge(e.code);
  if (e.code === 'KeyR') startStage(stageIndex, run.profile);
  if (e.code === 'KeyB' && !e.repeat) run.toggleEquipmentMenu();
  // 最后一关通关后没有下一关可进——不加这条边界的话，Math.min 会把
  // stageIndex+1 钳回原地，按 N 变成"用全新档案重开第 6 关"，
  // 玩家会以为按键没反应，而不是"这已经是终点"。
  if (e.code === 'KeyN' && run.phase === 'stageComplete' && stageIndex + 1 < STAGES.length) {
    startStage(stageIndex + 1, run.profile);
  }
  const track = CHOICE_KEYS[e.code];
  const profession = PROFESSION_KEYS[e.code];
  if (profession && run.phase === 'professionSelect') {
    run.setProfession(profession);
  } else if (run.phase === 'equipmentMenu') {
    const slot = EQUIPMENT_SLOT_KEYS[e.code];
    if (slot) run.cycleEquipment(slot);
  } else if (run.phase === 'equipmentChoice' && run.pendingEquipment) {
    const index = Number(e.code.replace('Digit', '')) - 1;
    const equipment = run.pendingEquipment[index];
    if (equipment) run.chooseEquipment(equipment);
  } else if (track && run.phase === 'choosing') {
    run.chooseUpgrade(track);
  }
  // 方向键和空格会滚动页面，游戏里要吃掉
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

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

/** 推进一个逻辑帧并把事件转给表现层。自动化验证也复用它，保证跑的是同一条路径。 */
function stepOnce(): void {
  const events = run.step(readInput());
  if (events.damage.length) renderer.onEvents(events.damage);
  if (events.executes.length) renderer.onExecutes(events.executes);
  if (events.skillCasts.length) renderer.onSkillCasts(events.skillCasts);
  if (events.bossPhaseShifts.length) renderer.onBossPhaseShift(events.bossPhaseShifts);
  if (
    professionValidation &&
    !recordedValidationRuns.has(run) &&
    (run.phase === 'stageComplete' || run.phase === 'dead')
  ) {
    professionValidation.record(run.stage.id, run.phase === 'stageComplete', run.overallSummary());
    recordedValidationRuns.add(run);
  }
}

function frame(now: number): void {
  if (stopped) return;
  accumulator += Math.min(250, now - last);
  last = now;

  while (accumulator >= STEP_MS) {
    if (!paused) stepOnce();
    accumulator -= STEP_MS;
  }

  renderer.draw(run);
  rafId = requestAnimationFrame(frame);
}

// HMR 会重新执行本模块，但不会停掉上一份的 rAF 循环。
// 不清理的话每次热更新都多一个循环，全都往同一张 canvas 上画：
// 画面会在新旧两个世界之间闪，而且改了代码看起来"没生效"。
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopped = true;
    cancelAnimationFrame(rafId);
  });
}

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
    professionSamples(): unknown {
      return professionValidation?.samples() ?? [];
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
