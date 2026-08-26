/** M5 局外资源：基础材料可离线产出，图纸和稀有材料只能通过战斗获得。 */
export const RESOURCE_IDS = ['materials', 'blueprints', 'rareMaterials'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export type ResourceBalances = Record<ResourceId, number>;

export interface ResourceLedgerEntry {
  sequence: number;
  resource: ResourceId;
  /** 正数为收入，负数为消耗。 */
  amount: number;
  reason: string;
}

export interface BaseProgress {
  resources: ResourceBalances;
  resourceLedger: ResourceLedgerEntry[];
  nextLedgerSequence: number;
}

const MAX_LEDGER_ENTRIES = 200;

export function createBaseProgress(): BaseProgress {
  return {
    resources: { materials: 0, blueprints: 0, rareMaterials: 0 },
    resourceLedger: [],
    nextLedgerSequence: 1,
  };
}

/** 跨关与后续存档加载都必须深拷贝，避免旧档案和新 Run 共用流水数组。 */
export function cloneBaseProgress(progress: BaseProgress): BaseProgress {
  return {
    resources: { ...progress.resources },
    resourceLedger: progress.resourceLedger.map((entry) => ({ ...entry })),
    nextLedgerSequence: progress.nextLedgerSequence,
  };
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
