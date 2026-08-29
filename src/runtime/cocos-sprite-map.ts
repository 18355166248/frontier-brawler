export const COCOS_HERO_ROWS = ['idle', 'move', 'slash', 'slash2', 'dash', 'hit'] as const;
export const COCOS_GRUNT_ROWS = ['idle', 'move', 'slash', 'hit'] as const;
export const COCOS_BOSS_ROWS = [
  'idle',
  'move',
  'hit',
  'bossSlam',
  'bossCharge',
  'bossRush',
  'bossNova',
  'bossSummon',
] as const;

export type CocosSpriteKind = 'hero' | 'grunt' | 'boss';

export interface CocosSpriteAction {
  row: string;
  /** true 表示素材没有对应动作，只能使用安全静态帧。 */
  fallback: boolean;
}

/**
 * Cocos 动作表的唯一映射表。它只决定表现行，不改变逻辑动作、帧数或判定。
 * 保持纯函数后，门禁可以穷举动作而无需启动 Creator。
 */
export function resolveCocosSpriteAction(
  kind: CocosSpriteKind,
  action: string,
): CocosSpriteAction {
  const rows = kind === 'hero'
    ? COCOS_HERO_ROWS
    : kind === 'boss'
      ? COCOS_BOSS_ROWS
      : COCOS_GRUNT_ROWS;
  if ((rows as readonly string[]).includes(action)) return { row: action, fallback: false };

  if (kind === 'hero' && action === 'heavyCharge') return { row: 'slash', fallback: false };
  if (
    kind === 'hero'
    && ['heavy', 'slash3', 'heavyCharged', 'arcanePulse', 'skill', 'execute', 'airSlash'].includes(action)
  ) return { row: 'slash2', fallback: false };
  if (kind === 'hero' && action === 'jump') return { row: 'move', fallback: false };

  if (kind === 'boss') return { row: 'bossSlam', fallback: true };
  return { row: 'idle', fallback: true };
}
