/** M4 装备数据：固定三槽位，不引入品质轴。 */
import type { Profession } from './types';

export const WEAPON_IDS = ['iron-maul', 'wind-sabers', 'spirit-focus'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const ARMOR_IDS = ['field-armor'] as const;
export type ArmorId = (typeof ARMOR_IDS)[number];

export const ACCESSORY_IDS = ['execution-charm'] as const;
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
  'wind-sabers': {
    id: 'wind-sabers',
    label: '逐风双刃',
    profession: 'swift',
    description: '第三段更快，击退更轻，便于继续贴身。',
  },
  'spirit-focus': {
    id: 'spirit-focus',
    label: '回响法器',
    profession: 'arcane',
    description: '脉冲落点更远、范围更大，但施法略慢。',
  },
};

export const ARMORS: Record<ArmorId, { id: ArmorId; label: string; description: string }> = {
  'field-armor': {
    id: 'field-armor',
    label: '行阵甲',
    description: '承受伤害降低 12%，换取更稳定的近身容错。',
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
  return {
    damageTakenMultiplier: loadout.armor === 'field-armor' ? 0.88 : 1,
    executeHealBonus: loadout.accessory === 'execution-charm' ? 8 : 0,
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
