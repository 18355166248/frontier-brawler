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
import { Run, createProfile } from './core/run';
import { STAGES } from './core/stages';
import type { InputState } from './core/world';
import { Renderer } from './render/renderer';
import { SpriteSheet } from './render/sprites';
import type { ActionState } from './core/types';

const WIDTH = 960;
const HEIGHT = 540;

const SHEET_ROWS: ActionState[] = ['idle', 'move', 'slash', 'hit'];

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = WIDTH;
canvas.height = HEIGHT;

// 只加载玩家的动作表。敌人当前是几何占位件（见 renderer 里 drawEnemy 的说明）：
// 五种敌人共用一张 enemy.png 根本分不出谁是谁，而「能不能一眼认出面前是什么」
// 正是 M1 要验证的东西。五套动作表按规格产出后，在这里逐个注册回来即可。
const sheets = new Map<string, SpriteSheet>();
sheets.set('player', new SpriteSheet({ url: 'art/hero.png', columns: 4, rows: SHEET_ROWS }));

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

function startStage(index: number): void {
  stageIndex = Math.max(0, Math.min(STAGES.length - 1, index));
  // 每关重新给一份满血档案。跨关卡的状态继承要等 M5 的经营层，现在不做。
  run = new Run(STAGES[stageIndex], createProfile());
}

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') startStage(stageIndex);
  if (e.code === 'KeyN' && run.phase === 'stageComplete') startStage(stageIndex + 1);
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

  const attack = attackHeld && !attackLatch;
  const dash = dashHeld && !dashLatch;
  const skill = skillHeld && !skillLatch;
  const execute = executeHeld && !executeLatch;
  attackLatch = attackHeld;
  dashLatch = dashHeld;
  skillLatch = skillHeld;
  executeLatch = executeHeld;

  return {
    moveX: (right ? 1 : 0) - (left ? 1 : 0) + (injected.moveX ?? 0),
    moveY: (down ? 1 : 0) - (up ? 1 : 0) + (injected.moveY ?? 0),
    attack,
    dash,
    skill,
    execute,
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
      return run.world.stats.summary();
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
