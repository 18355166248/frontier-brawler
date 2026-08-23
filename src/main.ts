/**
 * 入口：固定步长循环 + 输入 + 一波敌人。
 *
 * 逻辑用固定 60Hz 步长推进，渲染跟显示帧率。
 * 手感数值（前摇帧数、硬直、击退衰减）全部以逻辑帧为单位，
 * 这样在 144Hz 屏和 60Hz 屏上打起来是一样的。
 */
import { TICK_RATE } from './core/actions';
import type { InputState } from './core/world';
import { World, createEntity } from './core/world';
import { Renderer } from './render/renderer';
import { SpriteSheet } from './render/sprites';
import type { ActionState } from './core/types';

const WIDTH = 960;
const HEIGHT = 540;

const ARENA = { minX: 40, maxX: WIDTH - 40, minY: 300, maxY: HEIGHT - 40 };

const SHEET_ROWS: ActionState[] = ['idle', 'move', 'slash', 'hit'];

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const sheets = new Map<string, SpriteSheet>();
sheets.set('player', new SpriteSheet({ url: 'art/hero.png', columns: 4, rows: SHEET_ROWS }));
sheets.set('enemy', new SpriteSheet({ url: 'art/enemy.png', columns: 4, rows: SHEET_ROWS }));

const renderer = new Renderer(canvas, sheets);

let world = buildWorld();

function buildWorld(): World {
  const w = new World(ARENA);
  w.spawn(
    createEntity('player', { x: 180, y: 430 }, {
      hp: 160,
      maxHp: 160,
      speed: 2.9,
    }),
  );
  for (let i = 0; i < 5; i += 1) {
    w.spawn(
      createEntity('enemy', { x: 560 + (i % 3) * 90, y: 340 + (i % 4) * 44 }, {
        hp: 42,
        maxHp: 42,
        speed: 1.35,
        radius: 15,
      }),
    );
  }
  return w;
}

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') world = buildWorld();
  // 方向键和空格会滚动页面，游戏里要吃掉
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

/** 攻击和冲刺取「按下那一瞬间」，不是持续按住——否则按住不放会变成无限连招。 */
let attackLatch = false;
let dashLatch = false;

/** 调试注入的输入，和键盘取并集。开发期自动化验证用。 */
let injected: Partial<InputState> = {};

function readInput(): InputState {
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');

  const attackHeld = keys.has('KeyJ') || keys.has('Space') || !!injected.attack;
  const dashHeld = keys.has('KeyK') || keys.has('ShiftLeft') || !!injected.dash;

  const attack = attackHeld && !attackLatch;
  const dash = dashHeld && !dashLatch;
  attackLatch = attackHeld;
  dashLatch = dashHeld;

  return {
    moveX: (right ? 1 : 0) - (left ? 1 : 0) + (injected.moveX ?? 0),
    moveY: (down ? 1 : 0) - (up ? 1 : 0) + (injected.moveY ?? 0),
    attack,
    dash,
  };
}

const STEP_MS = 1000 / TICK_RATE;
let accumulator = 0;
let last = performance.now();
let rafId = 0;
let stopped = false;
let paused = false;

function frame(now: number): void {
  if (stopped) return;
  accumulator += Math.min(250, now - last);
  last = now;

  while (accumulator >= STEP_MS) {
    if (!paused) {
      const events = world.step(readInput());
      if (events.damage.length) renderer.onEvents(events.damage);
    }
    accumulator -= STEP_MS;
  }

  renderer.draw(world);
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
    get world() {
      return world;
    },
    restart(): void {
      world = buildWorld();
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
  };
}

async function boot(): Promise<void> {
  await Promise.all([...sheets.values()].map((s) => s.load()));
  requestAnimationFrame(frame);
}

void boot();
