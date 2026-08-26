/** M4 装备数据：固定三槽位，不引入品质轴。 */
import type { Profession } from './types';

export const WEAPON_IDS = [
  'iron-maul',
  'breaker-maul',
  'wind-sabers',
  'hook-blades',
  'spirit-focus',
  'ember-focus',
] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const ARMOR_IDS = ['field-armor', 'scout-coat', 'ritual-robe'] as const;
export type ArmorId = (typeof ARMOR_IDS)[number];

export const ACCESSORY_IDS = ['execution-charm', 'war-sigil', 'focus-bead'] as const;
export type AccessoryId = (typeof ACCESSORY_IDS)[number];

export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';
export type EquipmentId = WeaponId | ArmorId | AccessoryId;

export interface WeaponDef {
  id: WeaponId;
  label: string;
  profession: Profession;
  description: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  'iron-maul': {
    id: 'iron-maul',
    label: '裂阵锤',
    profession: 'heavy',
    description: '满蓄力范围更宽，但释放更慢。',
  },
  'breaker-maul': {
    id: 'breaker-maul',
    label: '破城槌',
    profession: 'heavy',
    description: '满蓄力更快出手，但范围和单次伤害降低。',
  },
  'wind-sabers': {
    id: 'wind-sabers',
    label: '逐风双刃',
    profession: 'swift',
    description: '第三段更快，击退更轻，便于继续贴身。',
  },
  'hook-blades': {
    id: 'hook-blades',
    label: '回钩双刃',
    profession: 'swift',
    description: '二段横扫范围更宽、击退更强，但收招稍慢。',
  },
  'spirit-focus': {
    id: 'spirit-focus',
    label: '回响法器',
    profession: 'arcane',
    description: '脉冲落点更远、范围更大，但施法略慢。',
  },
  'ember-focus': {
    id: 'ember-focus',
    label: '烬火法器',
    profession: 'arcane',
    description: '脉冲更快命中，但落点更近、覆盖更小。',
  },
};

export const ARMORS: Record<ArmorId, { id: ArmorId; label: string; description: string }> = {
  'field-armor': {
    id: 'field-armor',
    label: '行阵甲',
    description: '承受伤害降低 12%，但移动速度降低 6%。',
  },
  'scout-coat': {
    id: 'scout-coat',
    label: '游击衣',
    description: '承受伤害降低 4%，移动速度提高 8%。',
  },
  'ritual-robe': {
    id: 'ritual-robe',
    label: '燃纹袍',
    description: '不提供减伤，技能伤害提高 8%。',
  },
};

export const ACCESSORIES: Record<
  AccessoryId,
  { id: AccessoryId; label: string; description: string }
> = {
  'execution-charm': {
    id: 'execution-charm',
    label: '收魂佩',
    description: '每次成功处决额外回复 8 点生命。',
  },
  'war-sigil': {
    id: 'war-sigil',
    label: '血战印',
    description: '普攻伤害提高 8%，但承受伤害提高 6%。',
  },
  'focus-bead': {
    id: 'focus-bead',
    label: '凝神珠',
    description: '技能伤害提高 12%，不强化普攻与生存。',
  },
};

export interface EquipmentLoadout {
  weapon: WeaponId | null;
  armor: ArmorId | null;
  accessory: AccessoryId | null;
}

export interface EquipmentInventory {
  weapons: WeaponId[];
  armors: ArmorId[];
  accessories: AccessoryId[];
}

export interface EquipmentEffects {
  damageTakenMultiplier: number;
  executeHealBonus: number;
  damageMultiplier: number;
  skillDamageMultiplier: number;
  speedMultiplier: number;
}

/** 新档案从空库存开始，装备通过精英/首领房掉落进入库存。 */
export function createEquipmentInventory(): EquipmentInventory {
  return { weapons: [], armors: [], accessories: [] };
}

export function createEmptyLoadout(): EquipmentLoadout {
  return { weapon: null, armor: null, accessory: null };
}

export function canEquipWeapon(profession: Profession, weapon: WeaponId): boolean {
  return WEAPONS[weapon].profession === profession;
}

/** 护甲和饰品效果集中换算，避免掉血与处决分支各自认识具体装备 id。 */
export function resolveEquipmentEffects(loadout: EquipmentLoadout): EquipmentEffects {
  let damageTakenMultiplier = 1;
  let damageMultiplier = 1;
  let skillDamageMultiplier = 1;
  let speedMultiplier = 1;

  if (loadout.armor === 'field-armor') {
    damageTakenMultiplier *= 0.88;
    speedMultiplier *= 0.94;
  } else if (loadout.armor === 'scout-coat') {
    damageTakenMultiplier *= 0.96;
    speedMultiplier *= 1.08;
  } else if (loadout.armor === 'ritual-robe') {
    skillDamageMultiplier *= 1.08;
  }

  if (loadout.accessory === 'war-sigil') {
    damageMultiplier *= 1.08;
    damageTakenMultiplier *= 1.06;
  } else if (loadout.accessory === 'focus-bead') {
    skillDamageMultiplier *= 1.12;
  }

  return {
    damageTakenMultiplier,
    executeHealBonus: loadout.accessory === 'execution-charm' ? 8 : 0,
    damageMultiplier,
    skillDamageMultiplier,
    speedMultiplier,
  };
}

export function equipmentSlotOf(id: EquipmentId): EquipmentSlot {
  if ((WEAPON_IDS as readonly string[]).includes(id)) return 'weapon';
  if ((ARMOR_IDS as readonly string[]).includes(id)) return 'armor';
  return 'accessory';
}

export function equipmentLabel(id: EquipmentId): string {
  const slot = equipmentSlotOf(id);
  if (slot === 'weapon') return WEAPONS[id as WeaponId].label;
  if (slot === 'armor') return ARMORS[id as ArmorId].label;
  return ACCESSORIES[id as AccessoryId].label;
}

export function equipmentDescription(id: EquipmentId): string {
  const slot = equipmentSlotOf(id);
  if (slot === 'weapon') return WEAPONS[id as WeaponId].description;
  if (slot === 'armor') return ARMORS[id as ArmorId].description;
  return ACCESSORIES[id as AccessoryId].description;
}
