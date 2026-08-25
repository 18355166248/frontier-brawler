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

/** M4 验证阶段直接给三把实验武器，先验证手感差异，不接 M5 解锁门槛。 */
export function createEquipmentInventory(): EquipmentInventory {
  return {
    weapons: [...WEAPON_IDS],
    armors: [...ARMOR_IDS],
    accessories: [...ACCESSORY_IDS],
  };
}

export function createEmptyLoadout(): EquipmentLoadout {
  return { weapon: null, armor: null, accessory: null };
}

export function canEquipWeapon(profession: Profession, weapon: WeaponId): boolean {
  return WEAPONS[weapon].profession === profession;
}

export function equipmentSlotOf(id: EquipmentId): EquipmentSlot {
  if ((WEAPON_IDS as readonly string[]).includes(id)) return 'weapon';
  if ((ARMOR_IDS as readonly string[]).includes(id)) return 'armor';
  return 'accessory';
}
