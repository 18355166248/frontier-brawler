import type { EquipmentId } from '../core/equipment';

/**
 * 首批正式装备图标。未列出的装备继续走渲染器占位符，避免素材生产进度
 * 反过来阻塞玩法验证；图片加载失败也保持同一条回退路径。
 */
export const EQUIPMENT_ICON_PATHS: Partial<Record<EquipmentId, string>> = {
  'iron-maul': 'art/equipment/iron-maul.png',
  'breaker-maul': 'art/equipment/breaker-maul.png',
  'wind-sabers': 'art/equipment/wind-sabers.png',
  'hook-blades': 'art/equipment/hook-blades.png',
  'spirit-focus': 'art/equipment/spirit-focus.png',
  'ember-focus': 'art/equipment/ember-focus.png',
  'field-armor': 'art/equipment/field-armor.png',
  'scout-coat': 'art/equipment/scout-coat.png',
  'ritual-robe': 'art/equipment/ritual-robe.png',
  'execution-charm': 'art/equipment/execution-charm.png',
  'war-sigil': 'art/equipment/war-sigil.png',
  'focus-bead': 'art/equipment/focus-bead.png',
};

export class EquipmentIcons {
  private readonly images = new Map<EquipmentId, HTMLImageElement>();

  constructor() {
    for (const [id, path] of Object.entries(EQUIPMENT_ICON_PATHS)) {
      const image = new Image();
      image.src = path;
      this.images.set(id as EquipmentId, image);
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    id: EquipmentId,
    x: number,
    y: number,
    size: number,
  ): boolean {
    const image = this.images.get(id);
    if (!image?.complete || image.naturalWidth === 0) return false;
    ctx.drawImage(image, x, y, size, size);
    return true;
  }
}
