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
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  ai: { bossPhase: 1 | 2 };
  dead: boolean;
}

export type PocUpgradeTrackId = 'offense' | 'arcane' | 'guardian';
export type PocEquipmentId = string;
export type PocProfession = 'heavy' | 'swift' | 'arcane';

export interface PocRun {
  world: {
    arena: { minX: number; maxX: number; minY: number; maxY: number };
    entities: PocEntity[];
  };
  room: { id: string; kind: string };
  readonly player: PocEntity | undefined;
  readonly phase: string;
  readonly openDoors: string[];
  readonly availableProfessions: PocProfession[];
  pendingChoice: PocUpgradeTrackId[] | null;
  pendingEquipment: PocEquipmentId[] | null;
  setProfession(profession: PocProfession): void;
  enterRoom(roomId: string, entrance: unknown): void;
  step(input: PocInputState): void;
  chooseUpgrade(trackId: PocUpgradeTrackId): void;
  chooseEquipment(id: PocEquipmentId): boolean;
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
  UPGRADE_TRACKS: Record<PocUpgradeTrackId, { label: string; theme: string }>;
  WEAPONS: Record<string, { label: string }>;
  ARMORS: Record<string, { label: string }>;
  ACCESSORIES: Record<string, { label: string }>;
  COCOS_HERO_ROWS: readonly string[];
  COCOS_GRUNT_ROWS: readonly string[];
  COCOS_BOSS_ROWS: readonly string[];
  COCOS_WORLD_SCALE: number;
  COCOS_WORLD_VIEW_WIDTH: number;
  clampCocosCameraX(x: number, arena: PocRun['world']['arena']): number;
  worldToCocosScreen(
    x: number,
    y: number,
    cameraX: number,
    arena: PocRun['world']['arena'],
  ): { x: number; y: number };
  resolveCocosSpriteAction(
    kind: 'hero' | 'grunt' | 'boss',
    action: string,
  ): { row: string; fallback: boolean };
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
  UPGRADE_TRACKS,
  WEAPONS,
  ARMORS,
  ACCESSORIES,
  COCOS_HERO_ROWS,
  COCOS_GRUNT_ROWS,
  COCOS_BOSS_ROWS,
  COCOS_WORLD_SCALE,
  COCOS_WORLD_VIEW_WIDTH,
  clampCocosCameraX,
  worldToCocosScreen,
  resolveCocosSpriteAction,
} = typedCore;
