/**
 * 动作表加载与取帧。
 *
 * 表的排布来自 ai-asset-pipeline：一行一个动作，每行 N 帧，严格等分、透明背景。
 * 逻辑帧和美术帧不是一一对应的——逻辑上 slash 有 24 帧，美术只出 12 帧，
 * 所以取帧时按进度比例映射，而不是直接拿帧号当列号。
 */
import type { ActionState } from '../core/types';

export interface SheetLayout {
  url: string;
  columns: number;
  /** 行序：数组下标 = 行号 */
  rows: ActionState[];
}

export class SpriteSheet {
  image: HTMLImageElement;
  columns: number;
  rows: ActionState[];
  cellWidth = 0;
  cellHeight = 0;
  ready = false;

  constructor(layout: SheetLayout) {
    this.columns = layout.columns;
    this.rows = layout.rows;
    this.image = new Image();
    this.image.src = layout.url;
  }

  async load(): Promise<void> {
    await this.image.decode().catch(() => {
      /* 图缺失时保持 ready=false，渲染层退回色块，不让整个游戏起不来 */
    });
    if (this.image.naturalWidth > 0) {
      this.cellWidth = this.image.naturalWidth / this.columns;
      this.cellHeight = this.image.naturalHeight / this.rows.length;
      this.ready = true;
    }
  }

  /**
   * 按动作进度取帧。
   * progress 是 0..1 的动作完成度，映射到该行的列。
   */
  frameRect(action: ActionState, progress: number): {
    sx: number; sy: number; sw: number; sh: number;
  } | null {
    if (!this.ready) return null;
    let row = this.rows.indexOf(action);
    // 职业动作的逻辑先落地，专属美术补齐前让释放段复用 slash2，至少保持出手姿态；
    // 重击蓄力和其他没有专属行的动作继续退回 idle，总比整个人消失好。
    if (
      row < 0 &&
      (action === 'slash3' ||
        action === 'heavy' ||
        action === 'heavyCharged' ||
        action === 'arcanePulse')
    ) {
      row = this.rows.indexOf('slash2');
    }
    if (row < 0) row = 0;
    const clamped = Math.min(0.999999, Math.max(0, progress));
    const col = Math.floor(clamped * this.columns);
    return {
      sx: col * this.cellWidth,
      sy: row * this.cellHeight,
      sw: this.cellWidth,
      sh: this.cellHeight,
    };
  }
}
