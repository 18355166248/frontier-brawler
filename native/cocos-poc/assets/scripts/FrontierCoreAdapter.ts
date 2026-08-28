import * as core from '../generated/frontier-core';

export interface PocInputState {
  moveX: number;
  moveY: number;
  attack: boolean;
  attackHeld: boolean;
  dash: boolean;
  skill: boolean;
  execute: boolean;
  jump: boolean;
}

export interface PocEntity {
  id: number;
  team: 'player' | 'enemy';
  kind?: string;
  profession?: string;
  weapon?: string | null;
  pos: { x: number; y: number };
  facing: -1 | 1;
  action: string;
  actionFrame: number;
  dead: boolean;
}

export interface PocRun {
  world: {
    arena: { minX: number; maxX: number; minY: number; maxY: number };
    entities: PocEntity[];
  };
  setProfession(profession: string): void;
  enterRoom(roomId: string, entrance: unknown): void;
  step(input: PocInputState): void;
}

interface PocActionDefinition {
  frames: number;
  loop: boolean;
}

interface FixedStepClockInstance {
  consume(frameMs: number, paused: boolean, step: () => void): number;
  reset(): void;
}

interface FrontierCoreContract {
  EMPTY_INPUT: PocInputState;
  FixedStepClock: new (options: { tickRate: number }) => FixedStepClockInstance;
  Run: new (stage: unknown, profile: unknown) => PocRun;
  STAGES: readonly unknown[];
  TICK_RATE: number;
  createProfile(): unknown;
  resolveAction(action: string, profession?: string, weapon?: string | null): PocActionDefinition;
}

// 生成模块只承载运行时代码；这里是 Cocos 适配层唯一的静态契约，避免把 core 类型复制进引擎工程。
const typedCore = core as unknown as FrontierCoreContract;

export const {
  EMPTY_INPUT,
  FixedStepClock,
  Run,
  STAGES,
  TICK_RATE,
  createProfile,
  resolveAction,
} = typedCore;
