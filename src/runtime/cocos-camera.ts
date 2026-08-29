export const COCOS_WORLD_SCALE = 1;
export const COCOS_WORLD_VIEW_WIDTH = 476;
export const COCOS_BATTLE_CENTER_Y = 100;

export interface CocosArenaBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 战斗判定仍使用 Web core 的世界坐标；原生渲染必须横纵同倍率投影，
 * 否则角色尺寸、攻击距离与碰撞盒会在画面上产生互相矛盾的反馈。
 */
export function worldToCocosScreen(
  x: number,
  y: number,
  cameraX: number,
  arena: CocosArenaBounds,
): { x: number; y: number } {
  return {
    x: (x - cameraX) * COCOS_WORLD_SCALE,
    // 世界 y 越大越靠近镜头，屏幕位置越低；实体随后仍按世界 y 升序绘制。
    y: COCOS_BATTLE_CENTER_Y
      - (y - (arena.minY + arena.maxY) / 2) * COCOS_WORLD_SCALE,
  };
}

export function clampCocosCameraX(x: number, arena: CocosArenaBounds): number {
  const halfView = COCOS_WORLD_VIEW_WIDTH / COCOS_WORLD_SCALE / 2;
  const min = arena.minX + halfView;
  const max = arena.maxX - halfView;
  return min > max ? (arena.minX + arena.maxX) / 2 : Math.max(min, Math.min(max, x));
}
