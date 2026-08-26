import type { RoomKind } from './level';

/** M5 局外资源：基础材料可离线产出，图纸和稀有材料只能通过战斗获得。 */
export const RESOURCE_IDS = ['materials', 'blueprints', 'rareMaterials'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export type ResourceBalances = Record<ResourceId, number>;

export const BUILDING_IDS = [
  'trainingGround',
  'forge',
  'alchemyLab',
  'resourceField',
  'archive',
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

export interface BuildingUnlockDef {
  id: BuildingId;
  label: string;
  unlockAfterClears: number;
  combatBenefit: string;
}

export interface BuildingPlanDef {
  id: BuildingId;
  durationMs: number;
  cost: Partial<ResourceBalances>;
}

/** 首日按通关次数逐栋开放，避免第一次回基地同时面对五套系统。 */
export const BUILDING_UNLOCKS: readonly BuildingUnlockDef[] = [
  { id: 'trainingGround', label: '演武场', unlockAfterClears: 1, combatBenefit: '解锁职业与职业天赋' },
  { id: 'forge', label: '锻造台', unlockAfterClears: 2, combatBenefit: '解锁装备与强化' },
  { id: 'alchemyLab', label: '丹房', unlockAfterClears: 3, combatBenefit: '提供局内消耗品' },
  { id: 'resourceField', label: '资源田', unlockAfterClears: 4, combatBenefit: '提供基础材料以加快建设' },
  { id: 'archive', label: '藏经阁', unlockAfterClears: 5, combatBenefit: '解锁永久战斗天赋' },
];

/**
 * 首轮可玩成本以“当次解锁后有机会立刻开工”为基线，等待时间控制在一分钟内。
 * 后续量化只调整此表，不让输入层、渲染层各自维护一份价格。
 */
export const BUILDING_PLANS: Readonly<Record<BuildingId, BuildingPlanDef>> = {
  trainingGround: {
    id: 'trainingGround',
    durationMs: 5_000,
    cost: { materials: 15, blueprints: 1 },
  },
  forge: {
    id: 'forge',
    durationMs: 15_000,
    cost: { materials: 35, blueprints: 2 },
  },
  alchemyLab: {
    id: 'alchemyLab',
    durationMs: 30_000,
    cost: { materials: 55, blueprints: 3, rareMaterials: 1 },
  },
  resourceField: {
    id: 'resourceField',
    durationMs: 45_000,
    cost: { materials: 80, blueprints: 4, rareMaterials: 1 },
  },
  archive: {
    id: 'archive',
    durationMs: 60_000,
    cost: { materials: 120, blueprints: 6, rareMaterials: 2 },
  },
};

export interface ResourceLedgerEntry {
  sequence: number;
  resource: ResourceId;
  /** 正数为收入，负数为消耗。 */
  amount: number;
  reason: string;
}

export interface ConstructionJob {
  building: BuildingId;
  startsAtMs: number;
  completesAtMs: number;
}

export interface BaseProgress {
  completedStageRuns: number;
  completedBuildings: BuildingId[];
  constructionQueue: ConstructionJob[];
  lastActiveAtMs: number | null;
  /** 毫秒 × 每小时产量的余数，避免频繁上线吞掉不足一个材料的零碎时间。 */
  offlineProductionUnits: number;
  resources: ResourceBalances;
  resourceLedger: ResourceLedgerEntry[];
  nextLedgerSequence: number;
}

const MAX_LEDGER_ENTRIES = 200;

export function createBaseProgress(): BaseProgress {
  return {
    completedStageRuns: 0,
    completedBuildings: [],
    constructionQueue: [],
    lastActiveAtMs: null,
    offlineProductionUnits: 0,
    resources: { materials: 0, blueprints: 0, rareMaterials: 0 },
    resourceLedger: [],
    nextLedgerSequence: 1,
  };
}

/** 跨关与后续存档加载都必须深拷贝，避免旧档案和新 Run 共用流水数组。 */
export function cloneBaseProgress(progress: BaseProgress): BaseProgress {
  const sourceResources = progress.resources ?? createBaseProgress().resources;
  const resourceLedger = (progress.resourceLedger ?? []).map((entry) => ({ ...entry }));
  const maxSequence = resourceLedger.reduce((max, entry) => Math.max(max, entry.sequence), 0);
  return {
    completedStageRuns: progress.completedStageRuns ?? 0,
    completedBuildings: [...(progress.completedBuildings ?? [])],
    constructionQueue: (progress.constructionQueue ?? []).map((job) => ({ ...job })),
    lastActiveAtMs: progress.lastActiveAtMs ?? null,
    offlineProductionUnits: progress.offlineProductionUnits ?? 0,
    resources: {
      materials: validBalance(sourceResources.materials) ? sourceResources.materials : 0,
      blueprints: validBalance(sourceResources.blueprints) ? sourceResources.blueprints : 0,
      rareMaterials: validBalance(sourceResources.rareMaterials) ? sourceResources.rareMaterials : 0,
    },
    resourceLedger,
    nextLedgerSequence:
      Number.isSafeInteger(progress.nextLedgerSequence) && progress.nextLedgerSequence > maxSequence
        ? progress.nextLedgerSequence
        : maxSequence + 1,
  };
}

function validBalance(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function recordStageCompletion(progress: BaseProgress): void {
  progress.completedStageRuns += 1;
}

/**
 * 房间首次清空的基础产出。数值先保持小而可读，后续真机量化只调整这一张表；
 * 奖励房和起始房不产资源，避免无战斗路径刷账本。
 */
export function roomResourceReward(
  stageIndex: number,
  kind: RoomKind,
): Partial<ResourceBalances> {
  if (!Number.isSafeInteger(stageIndex) || stageIndex < 1) return {};
  let reward: Partial<ResourceBalances>;
  switch (kind) {
    case 'normal':
      reward = { materials: 3 + stageIndex };
      break;
    case 'elite':
      reward = {
        materials: 8 + stageIndex * 2,
        blueprints: 1,
        ...(stageIndex >= 5 ? { rareMaterials: 1 } : {}),
      };
      break;
    case 'boss':
      reward = {
        materials: 15 + stageIndex * 3,
        blueprints: 2,
        ...(stageIndex >= 3 ? { rareMaterials: 1 } : {}),
      };
      break;
    default:
      return {};
  }
  return Object.values(reward).every(Number.isSafeInteger) ? reward : {};
}

export function unlockedBuildings(progress: BaseProgress): BuildingId[] {
  return BUILDING_UNLOCKS.filter(
    (building) => progress.completedStageRuns >= building.unlockAfterClears,
  ).map((building) => building.id);
}

export function canAffordResources(
  progress: BaseProgress,
  cost: Partial<ResourceBalances>,
): boolean {
  return RESOURCE_IDS.every((resource) => {
    const amount = cost[resource] ?? 0;
    return Number.isSafeInteger(amount) && amount >= 0 && progress.resources[resource] >= amount;
  });
}

export interface QueueConstructionOptions {
  nowMs: number;
  durationMs: number;
  cost: Partial<ResourceBalances>;
}

/**
 * 建造队列串行执行：后一栋从前一栋完成时开始，而不是所有建筑同时倒计时。
 * 时长由调用方提供，机制骨架不提前固化尚未真机验证的等待数值。
 */
export function queueBuildingConstruction(
  progress: BaseProgress,
  building: BuildingId,
  options: QueueConstructionOptions,
): boolean {
  if (!BUILDING_IDS.includes(building)) return false;
  if (!unlockedBuildings(progress).includes(building)) return false;
  if (progress.completedBuildings.includes(building)) return false;
  if (progress.constructionQueue.some((job) => job.building === building)) return false;
  if (!Number.isSafeInteger(options.nowMs) || options.nowMs < 0) return false;
  if (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0) return false;

  const costs = RESOURCE_IDS.map((resource) => options.cost[resource] ?? 0);
  if (costs.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) return false;

  // 完成时间也属于交易前置条件，必须先校验再扣款；否则极大时间戳溢出时会
  // 留下“资源已扣、队列却不可结算”的半笔建造。
  const previous = progress.constructionQueue.at(-1);
  const startsAtMs = Math.max(options.nowMs, previous?.completesAtMs ?? options.nowMs);
  const completesAtMs = startsAtMs + options.durationMs;
  if (!Number.isSafeInteger(startsAtMs) || !Number.isSafeInteger(completesAtMs)) return false;

  const costChanges = Object.fromEntries(
    RESOURCE_IDS.map((resource) => [resource, -(options.cost[resource] ?? 0)]),
  ) as Partial<ResourceBalances>;
  if (costs.some((amount) => amount > 0)) {
    if (!applyResourceChanges(progress, costChanges, `construction:${building}`)) return false;
  }

  progress.constructionQueue.push({
    building,
    startsAtMs,
    completesAtMs,
  });
  return true;
}

/** 返回这次新完成的建筑，供 UI 做逐栋完成反馈。 */
export function settleConstruction(progress: BaseProgress, nowMs: number): BuildingId[] {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return [];
  const completed: BuildingId[] = [];
  while (progress.constructionQueue[0]?.completesAtMs <= nowMs) {
    const job = progress.constructionQueue.shift();
    if (!job || progress.completedBuildings.includes(job.building)) continue;
    progress.completedBuildings.push(job.building);
    completed.push(job.building);
  }
  return completed;
}

export interface OfflineIncomeResult {
  elapsedMs: number;
  creditedMaterials: number;
}

/**
 * 离线收益唯一入口，只能写入基础材料。图纸与稀有材料没有参数位，结构上杜绝
 * “顺手也离线产一点”的规则漂移；时钟回拨时保留原时间戳，避免反复改时间刷取。
 */
export function settleOfflineIncome(
  progress: BaseProgress,
  nowMs: number,
  materialsPerHour: number,
  maxOfflineMs: number,
): OfflineIncomeResult {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(materialsPerHour) ||
    materialsPerHour < 0 ||
    !Number.isSafeInteger(maxOfflineMs) ||
    maxOfflineMs <= 0
  ) {
    return { elapsedMs: 0, creditedMaterials: 0 };
  }
  if (progress.lastActiveAtMs === null) {
    progress.lastActiveAtMs = nowMs;
    return { elapsedMs: 0, creditedMaterials: 0 };
  }
  if (nowMs < progress.lastActiveAtMs) {
    // 本地设备从错误的未来时间校正回来时重新锚定；丢弃不足一个材料的余数，
    // 避免把两个不连续时钟区间拼成收入，同时保证收益不会永久冻结。
    progress.lastActiveAtMs = nowMs;
    progress.offlineProductionUnits = 0;
    return { elapsedMs: 0, creditedMaterials: 0 };
  }
  if (nowMs === progress.lastActiveAtMs) return { elapsedMs: 0, creditedMaterials: 0 };

  const elapsedMs = Math.min(nowMs - progress.lastActiveAtMs, maxOfflineMs);
  if (!Number.isSafeInteger(elapsedMs * materialsPerHour)) {
    return { elapsedMs: 0, creditedMaterials: 0 };
  }
  progress.lastActiveAtMs = nowMs;
  const productionUnits = progress.offlineProductionUnits + elapsedMs * materialsPerHour;
  const creditedMaterials = Math.floor(productionUnits / 3_600_000);
  progress.offlineProductionUnits = productionUnits % 3_600_000;
  if (creditedMaterials > 0) {
    applyResourceChanges(progress, { materials: creditedMaterials }, 'offline-income');
  }
  return { elapsedMs, creditedMaterials };
}

/**
 * 一次收支可以同时修改多种资源，并保证“要么全部成功，要么一项都不变”。
 * 建造/制造通常同时消耗材料和图纸，若逐项扣除，第二项不足时会留下半笔账。
 */
export function applyResourceChanges(
  progress: BaseProgress,
  changes: Partial<ResourceBalances>,
  reason: string,
): boolean {
  if (!reason.trim()) return false;
  const entries = RESOURCE_IDS.flatMap((resource) => {
    const amount = changes[resource] ?? 0;
    return amount === 0 ? [] : [{ resource, amount }];
  });
  if (!entries.length) return false;
  if (entries.some(({ amount }) => !Number.isSafeInteger(amount))) return false;
  if (
    entries.some(({ resource, amount }) => {
      const balance = progress.resources[resource];
      const next = balance + amount;
      return !validBalance(balance) || !Number.isSafeInteger(next) || next < 0;
    })
  ) return false;

  for (const { resource, amount } of entries) {
    progress.resources[resource] += amount;
    progress.resourceLedger.push({
      sequence: progress.nextLedgerSequence,
      resource,
      amount,
      reason,
    });
    progress.nextLedgerSequence += 1;
  }
  if (progress.resourceLedger.length > MAX_LEDGER_ENTRIES) {
    progress.resourceLedger.splice(0, progress.resourceLedger.length - MAX_LEDGER_ENTRIES);
  }
  return true;
}
