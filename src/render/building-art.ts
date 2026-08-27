import type { BuildingId } from '../core/economy';

export type BuildingArtState = 'unbuilt' | 'building' | 'completed';

const BUILDING_ART_PATHS: Partial<Record<BuildingId, string>> = {
  trainingGround: 'art/buildings/training-ground-v1.png',
  forge: 'art/buildings/forge-v1.png',
  alchemyLab: 'art/buildings/alchemy-lab-v1.png',
  resourceField: 'art/buildings/resource-field-v1.png',
  archive: 'art/buildings/archive-v1.png',
};

const STATE_COLUMN: Record<BuildingArtState, number> = {
  unbuilt: 0,
  building: 1,
  completed: 2,
};

/**
 * 运行时图集只打包三个实际绘制状态，并在第一次打开基地时才开始加载；素材尚未
 * 加载或加载失败时返回 false，渲染器继续画稳定占位，避免拖慢战斗首屏或阻塞功能。
 */
export class BuildingArt {
  private readonly images = new Map<BuildingId, HTMLImageElement>();

  private resolveImage(id: BuildingId): HTMLImageElement | undefined {
    const existing = this.images.get(id);
    if (existing) return existing;
    const path = BUILDING_ART_PATHS[id];
    if (!path) return undefined;
    const image = new Image();
    image.src = path;
    this.images.set(id, image);
    return image;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    id: BuildingId,
    state: BuildingArtState,
    x: number,
    y: number,
    size: number,
  ): boolean {
    const image = this.resolveImage(id);
    if (!image?.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return false;
    const cellWidth = image.naturalWidth / 3;
    const cellHeight = image.naturalHeight;
    const column = STATE_COLUMN[state];
    ctx.drawImage(
      image,
      column * cellWidth,
      0,
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
