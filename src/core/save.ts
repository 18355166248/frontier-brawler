import {
  ACCESSORY_IDS,
  ARMOR_IDS,
  WEAPON_IDS,
  canEquipWeapon,
  createEmptyLoadout,
  createEquipmentInventory,
} from './equipment';
import type { EquipmentLoadout } from './equipment';
import {
  BUILDING_IDS,
  RESOURCE_IDS,
  cloneBaseProgress,
  createBaseProgress,
} from './economy';
import type {
  BaseProgress,
  BuildingId,
  ConstructionJob,
  ResourceId,
  ResourceLedgerEntry,
} from './economy';
import { createProfile } from './run';
import type { PlayerProfile } from './run';
import { PROFESSION_IDS } from './types';
import type { Profession } from './types';
import { UPGRADE_TRACK_IDS } from './upgrades';

export const CAMPAIGN_SAVE_KEY = 'frontier-brawler:campaign';
export const CAMPAIGN_SAVE_VERSION = 1;

export interface CampaignSave {
  version: typeof CAMPAIGN_SAVE_VERSION;
  savedAtMs: number;
  stageIndex: number;
  profile: PlayerProfile;
}

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeNonNegative(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fallback;
}

function uniqueKnown<T extends string>(value: unknown, known: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is T => known.includes(item as T)))];
}

/**
 * BaseProgress 的迁移入口先把外部 JSON 收窄成可信结构，再交给 cloneBaseProgress。
 * 不能直接把反序列化对象展开进档案，否则畸形数组和非法时间会进入主循环。
 */
function sanitizeBaseProgress(value: unknown): BaseProgress {
  const source = record(value);
  if (!source) return createBaseProgress();
  const base = createBaseProgress();
  base.completedStageRuns = safeNonNegative(source.completedStageRuns);
  base.completedBuildings = uniqueKnown(source.completedBuildings, BUILDING_IDS);

  const queued = new Set<BuildingId>();
  let previousCompletesAtMs = 0;
  if (Array.isArray(source.constructionQueue)) {
    base.constructionQueue = source.constructionQueue.flatMap((raw): ConstructionJob[] => {
      const job = record(raw);
      const building = job?.building as BuildingId;
      const startsAtMs = job?.startsAtMs;
      const completesAtMs = job?.completesAtMs;
      if (
        !job ||
        !BUILDING_IDS.includes(building) ||
        queued.has(building) ||
        base.completedBuildings.includes(building) ||
        !Number.isSafeInteger(startsAtMs) ||
        !Number.isSafeInteger(completesAtMs) ||
        (startsAtMs as number) < 0 ||
        (completesAtMs as number) <= (startsAtMs as number) ||
        (startsAtMs as number) < previousCompletesAtMs
      ) return [];
      queued.add(building);
      previousCompletesAtMs = completesAtMs as number;
      return [{ building, startsAtMs: startsAtMs as number, completesAtMs: completesAtMs as number }];
    });
  }
  base.lastActiveAtMs = source.lastActiveAtMs === null || source.lastActiveAtMs === undefined
    ? null
    : Number.isSafeInteger(source.lastActiveAtMs) && (source.lastActiveAtMs as number) >= 0
      ? source.lastActiveAtMs as number
      : null;
  base.offlineProductionUnits = safeNonNegative(source.offlineProductionUnits);

  const resources = record(source.resources);
  for (const id of RESOURCE_IDS) base.resources[id] = safeNonNegative(resources?.[id]);

  if (Array.isArray(source.resourceLedger)) {
    base.resourceLedger = source.resourceLedger.flatMap((raw): ResourceLedgerEntry[] => {
      const entry = record(raw);
      const resource = entry?.resource as ResourceId;
      const sequence = entry?.sequence;
      const amount = entry?.amount;
      const reason = entry?.reason;
      if (
        !entry ||
        !RESOURCE_IDS.includes(resource) ||
        !Number.isSafeInteger(sequence) ||
        (sequence as number) <= 0 ||
        !Number.isSafeInteger(amount) ||
        amount === 0 ||
        typeof reason !== 'string' ||
        !reason.trim()
      ) return [];
      return [{ sequence: sequence as number, resource, amount: amount as number, reason }];
    }).slice(-200);
  }
  base.nextLedgerSequence = safeNonNegative(source.nextLedgerSequence, 1);
  base.archiveTrack = UPGRADE_TRACK_IDS.includes(source.archiveTrack as never)
    ? source.archiveTrack as BaseProgress['archiveTrack']
    : null;
  base.tonics = safeNonNegative(source.tonics);
  return cloneBaseProgress(base);
}

/** 只恢复跨局字段；血量、能量和局内成长始终从 createProfile 的基线开始。 */
function sanitizeProfile(value: unknown): PlayerProfile {
  const source = record(value);
  const profile = createProfile();
  if (!source) return profile;
  const profession = source.profession as Profession;
  if (PROFESSION_IDS.includes(profession)) profile.profession = profession;

  const inventory = record(source.inventory);
  profile.inventory = createEquipmentInventory();
  profile.inventory.weapons = uniqueKnown(inventory?.weapons, WEAPON_IDS);
  profile.inventory.armors = uniqueKnown(inventory?.armors, ARMOR_IDS);
  profile.inventory.accessories = uniqueKnown(inventory?.accessories, ACCESSORY_IDS);

  const loadout = record(source.equipment);
  const equipment: EquipmentLoadout = createEmptyLoadout();
  const weapon = loadout?.weapon;
  if (
    typeof weapon === 'string' &&
    WEAPON_IDS.includes(weapon as never) &&
    profile.inventory.weapons.includes(weapon as never) &&
    canEquipWeapon(profile.profession, weapon as never)
  ) equipment.weapon = weapon as EquipmentLoadout['weapon'];
  const armor = loadout?.armor;
  if (typeof armor === 'string' && profile.inventory.armors.includes(armor as never)) {
    equipment.armor = armor as EquipmentLoadout['armor'];
  }
  const accessory = loadout?.accessory;
  if (typeof accessory === 'string' && profile.inventory.accessories.includes(accessory as never)) {
    equipment.accessory = accessory as EquipmentLoadout['accessory'];
  }
  profile.equipment = equipment;
  profile.base = sanitizeBaseProgress(source.base);
  return profile;
}

export function encodeCampaignSave(
  stageIndex: number,
  profile: PlayerProfile,
  savedAtMs: number,
): string | null {
  if (!Number.isSafeInteger(stageIndex) || stageIndex < 0) return null;
  if (!Number.isSafeInteger(savedAtMs) || savedAtMs < 0) return null;
  return JSON.stringify({ version: CAMPAIGN_SAVE_VERSION, savedAtMs, stageIndex, profile });
}

export function decodeCampaignSave(raw: string, stageCount: number): CampaignSave | null {
  if (!Number.isSafeInteger(stageCount) || stageCount <= 0) return null;
  try {
    const envelope = record(JSON.parse(raw));
    if (!envelope || envelope.version !== CAMPAIGN_SAVE_VERSION) return null;
    const savedAtMs = safeNonNegative(envelope.savedAtMs, -1);
    if (savedAtMs < 0) return null;
    const requestedStage = safeNonNegative(envelope.stageIndex);
    return {
      version: CAMPAIGN_SAVE_VERSION,
      savedAtMs,
      stageIndex: Math.min(stageCount - 1, requestedStage),
      profile: sanitizeProfile(envelope.profile),
    };
  } catch {
    return null;
  }
}

export function loadCampaignSave(storage: SaveStorage, stageCount: number): CampaignSave | null {
  try {
    const raw = storage.getItem(CAMPAIGN_SAVE_KEY);
    return raw ? decodeCampaignSave(raw, stageCount) : null;
  } catch {
    return null;
  }
}

export function writeCampaignSave(
  storage: SaveStorage,
  stageIndex: number,
  profile: PlayerProfile,
  savedAtMs: number,
): boolean {
  const encoded = encodeCampaignSave(stageIndex, profile, savedAtMs);
  if (!encoded) return false;
  try {
    storage.setItem(CAMPAIGN_SAVE_KEY, encoded);
    return true;
  } catch {
    return false;
  }
}

export function clearCampaignSave(storage: SaveStorage): boolean {
  try {
    storage.removeItem(CAMPAIGN_SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
