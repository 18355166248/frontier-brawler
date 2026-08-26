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

/** 首日按通关次数逐栋开放，避免第一次回基地同时面对五套系统。 */
export const BUILDING_UNLOCKS: readonly BuildingUnlockDef[] = [
  { id: 'trainingGround', label: '演武场', unlockAfterClears: 1, combatBenefit: '解锁职业与职业天赋' },
  { id: 'forge', label: '锻造台', unlockAfterClears: 2, combatBenefit: '解锁装备与强化' },
  { id: 'alchemyLab', label: '丹房', unlockAfterClears: 3, combatBenefit: '提供局内消耗品' },
  { id: 'resourceField', label: '资源田', unlockAfterClears: 4, combatBenefit: '提供基础材料以加快建设' },
  { id: 'archive', label: '藏经阁', unlockAfterClears: 5, combatBenefit: '解锁永久战斗天赋' },
];

export interface ResourceLedgerEntry {
  sequence: number;
  resource: ResourceId;
  /** 正数为收入，负数为消耗。 */
  amount: number;
  reason: string;
}

export interface BaseProgress {
  completedStageRuns: number;
  resources: ResourceBalances;
  resourceLedger: ResourceLedgerEntry[];
  nextLedgerSequence: number;
}

const MAX_LEDGER_ENTRIES = 200;

export function createBaseProgress(): BaseProgress {
  return {
    completedStageRuns: 0,
    resources: { materials: 0, blueprints: 0, rareMaterials: 0 },
    resourceLedger: [],
    nextLedgerSequence: 1,
  };
}

/** 跨关与后续存档加载都必须深拷贝，避免旧档案和新 Run 共用流水数组。 */
export function cloneBaseProgress(progress: BaseProgress): BaseProgress {
  return {
    completedStageRuns: progress.completedStageRuns ?? 0,
    resources: { ...progress.resources },
    resourceLedger: progress.resourceLedger.map((entry) => ({ ...entry })),
    nextLedgerSequence: progress.nextLedgerSequence,
  };
}

export function recordStageCompletion(progress: BaseProgress): void {
  progress.completedStageRuns += 1;
}

export function unlockedBuildings(progress: BaseProgress): BuildingId[] {
  return BUILDING_UNLOCKS.filter(
    (building) => progress.completedStageRuns >= building.unlockAfterClears,
  ).map((building) => building.id);
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
  if (entries.some(({ resource, amount }) => progress.resources[resource] + amount < 0)) return false;

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
