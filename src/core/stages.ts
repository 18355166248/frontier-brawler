/**
 * 六关的具体编排。
 *
 * **关卡顺序就是敌人机制的教学顺序**——这是整套关卡设计的支点：
 * 每关引入一种新敌人，且新敌人第一次出场时**场上只有它**。
 * 第一间遇到盾兵时若混在五个杂兵里，玩家只会觉得这只怪血厚；
 * 单独出场，他才有机会发现「正面砍不动」这件事。
 *
 * 难度旋钮按 LEVEL_DESIGN 的优先级用：先动 maxAttackers 和敌人组合，
 * 最后才考虑数值缩放——改血量和伤害是最钝的手段。
 *
 * 每关终点房都是一个分阶段首领（EnemyKind 'boss'）。第一关是教学变体：
 * 只用长前摇重击且阶段二不召唤，避免在新玩家只学过杂兵时提前考突进、
 * 范围技和多目标压力；第二关起恢复完整招式组，逐步成为综合考试。
 */
import type { EnemyKind } from './types';
import type { Direction, RoomDef, RoomKind, RoomSize, StageDef } from './level';

function room(
  id: string,
  gridX: number,
  gridY: number,
  kind: RoomKind,
  size: RoomSize,
  encounter: EnemyKind[],
  doors: Partial<Record<Direction, string>>,
): RoomDef {
  return { id, gridX, gridY, kind, size, encounter, doors };
}

export const STAGES: StageDef[] = [
  /**
   * 第一关：只有杂兵。房间少、场地标准，让玩家先把连段和收招节奏摸熟。
   * 这一关刻意不给任何新机制——第一关的作用是让人上手，不是考验人。
   */
  {
    id: 'village',
    index: 1,
    name: '荒村',
    introduces: 'grunt',
    maxAttackers: 2,
    theme: {
      skyTop: '#2a2118',
      skyBottom: '#3d3226',
      groundFar: '#3a3022',
      groundNear: '#4d4130',
      lane: 'rgba(255,240,210,0.05)',
    },
    startRoom: 'v0',
    rooms: [
      room('v0', 0, 0, 'start', 'standard', [], { east: 'v1' }),
      room('v1', 1, 0, 'normal', 'standard', ['grunt', 'grunt'], { west: 'v0', east: 'v2' }),
      room('v2', 2, 0, 'normal', 'wide', ['grunt', 'grunt', 'grunt'], { west: 'v1', east: 'vr' }),
      // 奖励房夹在最后一场战斗和首领之间：打完硬仗、进首领前，正是该停下来
      // 读三张卡的节点——GAME_DESIGN 3.6 要求这一步独立成房，不做弹窗。
      room('vr', 3, 0, 'reward', 'standard', [], { west: 'v2', east: 'v3' }),
      // 首领房用 deep：突进位移约 258px，窄场地转身都费劲，
      // 阶段二的范围技覆盖也大，玩家得有地方能真正拉开距离。
      room('v3', 4, 0, 'boss', 'deep', ['boss'], { west: 'vr' }),
    ],
  },

  /**
   * 第二关：盾兵。v1 单独放一个盾兵当教学间。
   * 终点用 deep 场地——纵深大，绕后有空间，正好考「学没学会绕后」。
   */
  {
    id: 'bridge',
    index: 2,
    name: '石桥',
    introduces: 'shield',
    maxAttackers: 2,
    theme: {
      skyTop: '#1b2733',
      skyBottom: '#2b3a45',
      groundFar: '#2a3630',
      groundNear: '#3d4a44',
      lane: 'rgba(255,255,255,0.05)',
    },
    startRoom: 'b0',
    rooms: [
      room('b0', 0, 0, 'start', 'standard', [], { east: 'b1' }),
      // 教学间：只有一个盾兵，砍正面砍不动，逼玩家自己找答案
      room('b1', 1, 0, 'normal', 'standard', ['shield'], { west: 'b0', east: 'b2', north: 'b1n' }),
      // 支线：纯杂兵，给一条「不想硬啃就先绕开」的路
      room('b1n', 1, -1, 'normal', 'narrow', ['grunt', 'grunt', 'grunt'], { south: 'b1' }),
      room('b2', 2, 0, 'normal', 'standard', ['shield', 'grunt', 'grunt'], { west: 'b1', east: 'br' }),
      room('br', 3, 0, 'reward', 'standard', [], { west: 'b2', east: 'b3' }),
      room('b3', 4, 0, 'boss', 'deep', ['boss'], { west: 'br' }),
    ],
  },

  /**
   * 第三关：远程。教学间用 deep，让玩家有纵深空间去体会「躲线」。
   * c3 反过来用 narrow：窄场地里远程退无可退，教的是另一半答案——冲进去。
   */
  {
    id: 'canyon',
    index: 3,
    name: '峡谷',
    introduces: 'ranged',
    maxAttackers: 2,
    theme: {
      skyTop: '#331f1a',
      skyBottom: '#4a2f24',
      groundFar: '#3f2a20',
      groundNear: '#54392b',
      lane: 'rgba(255,220,190,0.05)',
    },
    startRoom: 'c0',
    rooms: [
      room('c0', 0, 0, 'start', 'standard', [], { east: 'c1' }),
      room('c1', 1, 0, 'normal', 'deep', ['ranged'], { west: 'c0', east: 'c2' }),
      room('c2', 2, 0, 'normal', 'wide', ['ranged', 'ranged', 'grunt', 'grunt'], {
        west: 'c1',
        north: 'c2n',
        east: 'c3',
      }),
      room('c2n', 2, -1, 'elite', 'standard', ['shield', 'shield'], { south: 'c2' }),
      room('c3', 3, 0, 'normal', 'narrow', ['ranged', 'shield'], { west: 'c2', east: 'cr' }),
      room('cr', 4, 0, 'reward', 'standard', [], { west: 'c3', east: 'c4' }),
      room('c4', 5, 0, 'boss', 'deep', ['boss'], {
        west: 'cr',
      }),
    ],
  },

  /**
   * 第四关：冲锋，并把 maxAttackers 提到 3——从这一关开始是「紧张」而不是「舒适」。
   * 教学间必须用 wide：冲锋要有助跑距离才起手，窄场地里它根本不会冲。
   */
  {
    id: 'camp',
    index: 4,
    name: '废营',
    introduces: 'charger',
    maxAttackers: 3,
    theme: {
      skyTop: '#1a2318',
      skyBottom: '#26331f',
      groundFar: '#243020',
      groundNear: '#33422c',
      lane: 'rgba(220,255,210,0.05)',
    },
    startRoom: 'p0',
    rooms: [
      room('p0', 0, 0, 'start', 'standard', [], { east: 'p1' }),
      room('p1', 1, 0, 'normal', 'wide', ['charger'], { west: 'p0', east: 'p2' }),
      room('p2', 2, 0, 'normal', 'wide', ['charger', 'grunt', 'grunt'], {
        west: 'p1',
        south: 'p2s',
        east: 'p3',
      }),
      room('p2s', 2, 1, 'elite', 'narrow', ['shield', 'ranged', 'grunt'], { north: 'p2' }),
      room('p3', 3, 0, 'normal', 'standard', ['charger', 'ranged', 'shield'], {
        west: 'p2',
        east: 'pr',
      }),
      room('pr', 4, 0, 'reward', 'standard', [], { west: 'p3', east: 'p4' }),
      room('p4', 5, 0, 'boss', 'wide', ['boss'], {
        west: 'pr',
      }),
    ],
  },

  /**
   * 第五关：精英。精英打不断，贴脸莽会被重击换掉大半条血。
   * 教学间给 deep，让玩家有地方拉开——学会拉开才算学会打精英。
   */
  {
    id: 'pass',
    index: 5,
    name: '关隘',
    introduces: 'elite',
    maxAttackers: 3,
    theme: {
      skyTop: '#161d2e',
      skyBottom: '#222c42',
      groundFar: '#232b3a',
      groundNear: '#31394d',
      lane: 'rgba(210,225,255,0.06)',
    },
    startRoom: 'k0',
    rooms: [
      room('k0', 0, 0, 'start', 'standard', [], { east: 'k1' }),
      room('k1', 1, 0, 'normal', 'deep', ['elite'], { west: 'k0', east: 'k2' }),
      room('k2', 2, 0, 'normal', 'standard', ['elite', 'grunt', 'grunt'], {
        west: 'k1',
        north: 'k2n',
        east: 'k3',
      }),
      room('k2n', 2, -1, 'elite', 'wide', ['charger', 'charger', 'ranged'], { south: 'k2' }),
      room('k3', 3, 0, 'normal', 'narrow', ['elite', 'shield', 'ranged'], { west: 'k2', east: 'kr' }),
      room('kr', 4, 0, 'reward', 'standard', [], { west: 'k3', east: 'k4' }),
      room('k4', 5, 0, 'boss', 'deep', ['boss'], { west: 'kr' }),
    ],
  },

  /**
   * 第六关：综合考。不引入新类型，考的是前五关学的东西能不能一起用。
   */
  {
    id: 'citadel',
    index: 6,
    name: '主城',
    maxAttackers: 3,
    theme: {
      skyTop: '#1e1526',
      skyBottom: '#2d1f38',
      groundFar: '#2a2033',
      groundNear: '#3a2c45',
      lane: 'rgba(235,215,255,0.06)',
    },
    startRoom: 'm0',
    rooms: [
      room('m0', 0, 0, 'start', 'standard', [], { east: 'm1' }),
      room('m1', 1, 0, 'normal', 'wide', ['charger', 'ranged', 'grunt', 'grunt'], {
        west: 'm0',
        east: 'm2',
      }),
      room('m2', 2, 0, 'normal', 'narrow', ['shield', 'shield', 'ranged'], {
        west: 'm1',
        north: 'm2n',
        east: 'm3',
      }),
      room('m2n', 2, -1, 'elite', 'deep', ['elite', 'ranged', 'ranged'], { south: 'm2' }),
      room('m3', 3, 0, 'normal', 'deep', ['elite', 'charger', 'shield', 'grunt'], {
        west: 'm2',
        east: 'mr',
      }),
      room('mr', 4, 0, 'reward', 'standard', [], { west: 'm3', east: 'm4' }),
      room('m4', 5, 0, 'boss', 'wide', ['boss'], {
        west: 'mr',
      }),
    ],
  },
];

/** 最终关之后回到第一关开启新远征；装备和基地是否继承由 createStageProfile 决定。 */
export function nextCampaignStageIndex(currentIndex: number): number {
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= STAGES.length) return 0;
  return currentIndex + 1 < STAGES.length ? currentIndex + 1 : 0;
}

export function stageByIndex(index: number): StageDef | undefined {
  return STAGES.find((s) => s.index === index);
}
