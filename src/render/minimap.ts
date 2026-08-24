/**
 * DNF 式小地图。**只读 Run 状态，不改**。
 *
 * 它要同时回答三个问题：我在哪、哪里没去过、首领在哪边。
 * 房间按手写的网格坐标摆放——不做运行时自动布局，
 * 手写房间图时坐标就定死了，画出来永远不会连成一团乱麻。
 */
import type { Direction, RoomDef } from '../core/level';
import { DIRECTIONS } from '../core/level';
import type { Run } from '../core/run';

/** 房间方块边长与格距。一关最多九间房，这个尺寸一屏放得下。 */
const CELL = 15;
const GAP = 9;
const PITCH = CELL + GAP;
const PADDING = 9;

const COLORS = {
  panel: 'rgba(12,16,20,0.72)',
  panelEdge: 'rgba(255,255,255,0.14)',
  current: '#ffd479',
  clearedFill: 'rgba(255,255,255,0.16)',
  knownEdge: 'rgba(255,255,255,0.5)',
  unknownEdge: 'rgba(255,255,255,0.2)',
  link: 'rgba(255,255,255,0.28)',
  linkLocked: 'rgba(255,255,255,0.1)',
  boss: '#e2705c',
  elite: '#d7b45a',
  reward: '#63d0a8',
  label: 'rgba(255,255,255,0.75)',
};

export class Minimap {
  /** 画在右上角。返回占用的高度，方便上层排 HUD。 */
  draw(ctx: CanvasRenderingContext2D, run: Run, canvasWidth: number): void {
    const rooms = run.stage.rooms;
    const minX = Math.min(...rooms.map((r) => r.gridX));
    const maxX = Math.max(...rooms.map((r) => r.gridX));
    const minY = Math.min(...rooms.map((r) => r.gridY));
    const maxY = Math.max(...rooms.map((r) => r.gridY));
    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;

    const w = cols * PITCH - GAP + PADDING * 2;
    const h = rows * PITCH - GAP + PADDING * 2 + 16;
    const originX = canvasWidth - w - 14;
    const originY = 14;

    ctx.save();

    // 底板。战场信息密度低，小地图常驻不构成干扰，所以不做开关。
    ctx.fillStyle = COLORS.panel;
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.lineWidth = 1;
    this.roundRect(ctx, originX, originY, w, h, 5);
    ctx.fill();
    ctx.stroke();

    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const clearedCount = run.stage.rooms.filter((r) => run.cleared.has(r.id)).length;
    ctx.fillText(
      `${run.stage.index} · ${run.stage.name}　${clearedCount}/${rooms.length}`,
      originX + PADDING,
      originY + 13,
    );

    const bodyY = originY + 18;
    const cellX = (r: RoomDef) => originX + PADDING + (r.gridX - minX) * PITCH;
    const cellY = (r: RoomDef) => bodyY + (r.gridY - minY) * PITCH;

    // 先画门连线，压在方块下面
    for (const room of rooms) {
      if (!this.isRoomShown(run, room)) continue;
      for (const dir of DIRECTIONS) {
        const targetId = room.doors[dir];
        if (!targetId) continue;
        const target = rooms.find((r) => r.id === targetId);
        if (!target) continue;
        // 每条门只画一次
        if (target.gridX < room.gridX || target.gridY < room.gridY) continue;
        if (!this.isRoomShown(run, target)) continue;
        const bothKnown = run.visited.has(room.id) && run.visited.has(target.id);
        ctx.strokeStyle = bothKnown ? COLORS.link : COLORS.linkLocked;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cellX(room) + CELL / 2, cellY(room) + CELL / 2);
        ctx.lineTo(cellX(target) + CELL / 2, cellY(target) + CELL / 2);
        ctx.stroke();
      }
    }

    for (const room of rooms) {
      if (!this.isRoomShown(run, room)) continue;
      const x = cellX(room);
      const y = cellY(room);
      const isCurrent = room.id === run.room.id;
      const isCleared = run.cleared.has(room.id);
      const isVisited = run.visited.has(room.id);

      if (isCurrent) {
        ctx.fillStyle = COLORS.current;
        ctx.fillRect(x, y, CELL, CELL);
      } else if (isCleared) {
        ctx.fillStyle = COLORS.clearedFill;
        ctx.fillRect(x, y, CELL, CELL);
      }

      // 没进过的房间用虚线：知道有路，但不知道里面是什么
      ctx.setLineDash(isVisited ? [] : [2, 2]);
      ctx.strokeStyle = isCurrent
        ? '#ffffff'
        : isVisited
          ? COLORS.knownEdge
          : COLORS.unknownEdge;
      ctx.lineWidth = isCurrent ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      ctx.setLineDash([]);

      // 类型标记。首领房一进关就可见——玩家需要知道自己在朝哪推进，
      // 探索的乐趣来自路线选择，不是方向迷失。
      const mark =
        room.kind === 'boss'
          ? COLORS.boss
          : room.kind === 'elite'
            ? COLORS.elite
            : room.kind === 'reward'
              ? COLORS.reward
              : null;
      if (mark) {
        ctx.fillStyle = isCurrent ? '#2a2118' : mark;
        if (room.kind === 'boss') {
          // 首领用叉，和圆点拉开区别，缩到 15px 也认得出
          ctx.strokeStyle = isCurrent ? '#2a2118' : mark;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 4);
          ctx.lineTo(x + CELL - 4, y + CELL - 4);
          ctx.moveTo(x + CELL - 4, y + 4);
          ctx.lineTo(x + 4, y + CELL - 4);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL / 2, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  /**
   * 该房间画不画。
   * 进过的画；首领房始终画；与进过的房间相邻的画成未探明。
   * 其余不画——一次全摊开就没有推进感了。
   */
  private isRoomShown(run: Run, room: RoomDef): boolean {
    if (run.visited.has(room.id)) return true;
    if (room.kind === 'boss') return true;
    for (const dir of DIRECTIONS) {
      const from = room.doors[dir as Direction];
      if (from && run.visited.has(from)) return true;
    }
    return false;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
