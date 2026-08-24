/**
 * 局内三选一成长。对应 GAME_DESIGN.md 3.6：
 *
 *   锋芒：强化输出（伤害）
 *   玄术：强化技能（冷却、伤害）
 *   守元：强化生存（血量、处决回复）
 *
 * 三条路线固定覆盖，不做「随机词条」——避免搭配爆炸导致数值失控，
 * 这条约束继承自 GAME_DESIGN 第八节「明确不做的」。
 *
 * 数值全部是**相对基准的倍率**，不是滚雪球式基于当前值累加：
 * 连续三级伤害是 1.36 倍，不是 1.12³ = 1.40 倍。前者可预期、好平衡，
 * 后者会让越强越强的正反馈失控。
 */

export type UpgradeTrackId = 'offense' | 'arcane' | 'guardian';

export const UPGRADE_TRACK_IDS: UpgradeTrackId[] = ['offense', 'arcane', 'guardian'];

/** 某条路线升满后就不再提供，让其余路线补位——避免一路吃满一条路线的选项。 */
export const MAX_UPGRADE_LEVEL = 3;

export interface UpgradeTrack {
  id: UpgradeTrackId;
  label: string;
  /** 一句话说明这条路线整体在做什么，卡片副标题用 */
  theme: string;
  /** 选到第 level 级（1 起）具体带来什么，卡片正文用 */
  describe(level: number): string;
}

export const UPGRADE_TRACKS: Record<UpgradeTrackId, UpgradeTrack> = {
  offense: {
    id: 'offense',
    label: '锋芒',
    theme: '强化输出',
    // 卡片窄，用 \n 手动分段，比自动换行可控——自动换行贪心逐字符切，
    // 短语末尾偏偏落在窄卡片边界上时会把一个字符单独挤成一行。
    describe: (level) => `普攻与处决\n伤害 +${level * 12}%`,
  },
  arcane: {
    id: 'arcane',
    label: '玄术',
    theme: '强化技能',
    describe: (level) =>
      `技能伤害 +${level * 15}%\n消耗 -${Math.round((1 - 0.85 ** level) * 100)}%`,
  },
  guardian: {
    id: 'guardian',
    label: '守元',
    theme: '强化生存',
    describe: (level) => `最大生命 +${level * 15}%\n处决回复 +${level * 4}`,
  },
};

export interface UpgradeStats {
  damageMultiplier: number;
  skillDamageMultiplier: number;
  skillCostMultiplier: number;
  executeHealBonus: number;
  maxHpMultiplier: number;
}

export const BASE_UPGRADE_STATS: UpgradeStats = {
  damageMultiplier: 1,
  skillDamageMultiplier: 1,
  skillCostMultiplier: 1,
  executeHealBonus: 0,
  maxHpMultiplier: 1,
};

/** 把「每条路线选了几级」换算成实际生效的倍率，供建玩家实体时使用。 */
export function computeUpgradeStats(upgrades: Record<UpgradeTrackId, number>): UpgradeStats {
  return {
    damageMultiplier: 1 + upgrades.offense * 0.12,
    skillDamageMultiplier: 1 + upgrades.arcane * 0.15,
    skillCostMultiplier: 0.85 ** upgrades.arcane,
    executeHealBonus: upgrades.guardian * 4,
    maxHpMultiplier: 1 + upgrades.guardian * 0.15,
  };
}

/**
 * 本次进奖励房能选的路线：跳过已经满级的。
 * 三条都满了就返回空数组——房间直接按「无事发生」处理，不强行凑数。
 */
export function availableTracks(upgrades: Record<UpgradeTrackId, number>): UpgradeTrackId[] {
  return UPGRADE_TRACK_IDS.filter((id) => upgrades[id] < MAX_UPGRADE_LEVEL);
}
