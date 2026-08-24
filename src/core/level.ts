/**
 * 关卡与房间的数据定义。纯数据 + 纯函数，不引用任何渲染 API。
 *
 * 三层结构见 docs/LEVEL_DESIGN.md：
 *   战役 → 关卡（一张房间图 + 一个主题 + 一档难度）→ 房间（一场战斗）
 *
 * 房间图是**手写**的，不做随机生成：随机的话没法保证第 2 关一定先遇到盾兵，
 * 而「关卡顺序就是敌人机制的教学顺序」是这套关卡设计的支点。
 */
import type { EnemyKind } from './types';
import type { Arena } from './world';

export type RoomKind = 'start' | 'normal' | 'elite' | 'reward' | 'boss';

/** 门的方向。north/south 是纵深两端，east/west 是横向两端。 */
export type Direction = 'north' | 'south' | 'east' | 'west';

export const DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

/** 走出某个方向的门，会从下一间的哪个门进来 */
export const OPPOSITE: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/** 小地图上该方向对应的网格位移，用来校验手写坐标有没有写歪 */
export const DIR_DELTA: Record<Direction, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/**
 * 场地尺寸档位。**尺寸本身就是玩法变化**，不只是换个观感：
 * 窄房间里远程放不了风筝，深房间里绕后更容易，宽房间适合冲锋助跑。
 */
export type RoomSize = 'standard' | 'wide' | 'narrow' | 'deep';

export const ROOM_SIZES: Record<RoomSize, Arena> = {
  standard: { minX: 40, maxX: 920, minY: 300, maxY: 500 },
  /** 横向拉满、纵深压扁：冲锋有助跑空间，绕后要跑更远 */
  wide: { minX: 30, maxX: 930, minY: 330, maxY: 486 },
  /** 横向收窄：贴身缠斗，远程退无可退 */
  narrow: { minX: 250, maxX: 710, minY: 300, maxY: 500 },
  /** 纵深加大：绕后和躲直线都更从容，代价是敌人也更容易散开 */
  deep: { minX: 60, maxX: 900, minY: 246, maxY: 516 },
};

/** 一关一套配色。地面和天空换掉，观感就完全不同，成本却近乎为零。 */
export interface StageTheme {
  skyTop: string;
  skyBottom: string;
  groundFar: string;
  groundNear: string;
  lane: string;
}

export interface RoomDef {
  id: string;
  /** 小地图网格坐标，手写时定好 */
  gridX: number;
  gridY: number;
  kind: RoomKind;
  size: RoomSize;
  /** 本房间的敌人编成，一次性全部入场 */
  encounter: EnemyKind[];
  /** 方向 → 目标房间 id */
  doors: Partial<Record<Direction, string>>;
}

export interface StageDef {
  id: string;
  /** 第几关，从 1 开始 */
  index: number;
  name: string;
  /** 这一关新引入的敌人，用于开场提示；start 关为 undefined */
  introduces?: EnemyKind;
  theme: StageTheme;
  /** 难度主旋钮：同时能进攻的敌人数 */
  maxAttackers: number;
  rooms: RoomDef[];
  startRoom: string;
}

export function findRoom(stage: StageDef, id: string): RoomDef | undefined {
  return stage.rooms.find((r) => r.id === id);
}

export function arenaOf(room: RoomDef): Arena {
  return { ...ROOM_SIZES[room.size] };
}

/**
 * 校验房间图：门必须双向对应，网格坐标必须和门的方向一致。
 *
 * 手写房间图最容易犯两种错——门只连了单向（走过去回不来），
 * 和网格坐标与门方向对不上（小地图上连线交叉成一团）。
 * 这两种错在游戏里都表现为「玩着玩着卡住了」，很难倒推，所以开发期直接抛出来。
 */
export function validateStage(stage: StageDef): string[] {
  const problems: string[] = [];
  const byId = new Map(stage.rooms.map((r) => [r.id, r]));

  if (!byId.has(stage.startRoom)) {
    problems.push(`${stage.id}: startRoom "${stage.startRoom}" 不存在`);
  }

  const seen = new Set<string>();
  for (const room of stage.rooms) {
    const key = `${room.gridX},${room.gridY}`;
    if (seen.has(key)) problems.push(`${stage.id}: 网格坐标 ${key} 被多个房间占用`);
    seen.add(key);

    for (const dir of DIRECTIONS) {
      const targetId = room.doors[dir];
      if (!targetId) continue;
      const target = byId.get(targetId);
      if (!target) {
        problems.push(`${stage.id}: ${room.id} 的 ${dir} 门指向不存在的 ${targetId}`);
        continue;
      }
      if (target.doors[OPPOSITE[dir]] !== room.id) {
        problems.push(`${stage.id}: ${room.id} --${dir}--> ${targetId} 缺少反向门`);
      }
      const d = DIR_DELTA[dir];
      if (target.gridX !== room.gridX + d.x || target.gridY !== room.gridY + d.y) {
        problems.push(
          `${stage.id}: ${room.id} 的 ${dir} 门通向 ${targetId}，但两者网格坐标不相邻`,
        );
      }
    }
  }

  // 从起点走一遍，确认没有走不到的房间
  const reached = new Set<string>([stage.startRoom]);
  const queue = [stage.startRoom];
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    const room = byId.get(id);
    if (!room) continue;
    for (const dir of DIRECTIONS) {
      const next = room.doors[dir];
      if (next && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  for (const room of stage.rooms) {
    if (!reached.has(room.id)) problems.push(`${stage.id}: ${room.id} 从起点走不到`);
  }

  return problems;
}
