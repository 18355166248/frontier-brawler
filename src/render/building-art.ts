import type { BuildingId } from '../core/economy';

export type BuildingArtState = 'unbuilt' | 'building' | 'completed' | 'icon';

const BUILDING_ART_PATHS: Partial<Record<BuildingId, string>> = {
  trainingGround: 'art/buildings/training-ground-v1.png',
};

const STATE_CELL: Record<BuildingArtState, readonly [number, number]> = {
  unbuilt: [0, 0],
  building: [1, 0],
  completed: [0, 1],
  icon: [1, 1],
};

/**
 * 建筑图集按 2×2 固定排布加载；素材未到齐或加载失败时返回 false，渲染器继续
 * 画稳定占位，避免美术生产进度阻塞基地功能。
 */
export class BuildingArt {
  private readonly images = new Map<BuildingId, HTMLImageElement>();

  constructor() {
    for (const [id, path] of Object.entries(BUILDING_ART_PATHS)) {
      const image = new Image();
      image.src = path;
      this.images.set(id as BuildingId, image);
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    id: BuildingId,
    state: BuildingArtState,
    x: number,
    y: number,
    size: number,
  ): boolean {
    const image = this.images.get(id);
    if (!image?.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return false;
    const cellWidth = image.naturalWidth / 2;
    const cellHeight = image.naturalHeight / 2;
    const [column, row] = STATE_CELL[state];
    ctx.drawImage(
      image,
      column * cellWidth,
      row * cellHeight,
      cellWidth,
      cellHeight,
      x,
      y,
      size,
      size,
    );
    return true;
  }
}
