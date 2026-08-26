/**
 * M2 / M4 验收面板，只在开发构建里出现。
 *
 * 存在的理由和 `core/stats.ts` 一样：验收标准要求的是可判定的数字
 * （三职业打法是否真的不同、头部配装占比是否 < 40%），不是"感觉还行"。
 * 这些数字本来只能在控制台敲 `__game.professionReport()` 才看得到，
 * 真人连打六关时不会停下来开控制台——面板把它们摆到画面上，
 * 让"这一局记进去了没有、离验收还差多少"随时可读。
 *
 * 刻意拆成两层：
 *   buildValidationPanelModel()  纯函数，把两份报告翻译成可直接画的行
 *   ValidationPanel              只负责画和按键，不含任何判定逻辑
 * 拆开是为了让 tools/validate_professions.mjs 能在 Node 里直接断言
 * "无样本 / 单一配装 / 多配装"三种数据的呈现是否正确——画布截图断不了这个。
 *
 * 这一层**只读**统计数据，不碰任何玩法状态：不暂停战斗、不改 Run.phase、
 * 不动帧数伤害判定。面板是个纯覆盖层，开着的时候游戏照常跑。
 */
import type { Profession } from '../core/types';
import type {
  EquipmentReport,
  ProfessionReportRow,
  ProfessionValidationStore,
} from './profession-validation';

/** 和 render/renderer.ts 的 PROFESSION_CARDS 保持同名同色，面板不另立一套视觉语言。 */
const PROFESSION_VIEW: Record<Profession, { label: string; color: string }> = {
  heavy: { label: '重击', color: '#ff9a5c' },
  swift: { label: '疾锋', color: '#7fe8ff' },
  arcane: { label: '术法', color: '#b79cff' },
};

/** M4 验收标准第 2 条：头部配装占比必须低于这个门槛。 */
export const TOP_LOADOUT_SHARE_TARGET = 0.4;

/** 配装最多列这么多套，超出的折叠成一行计数，避免样本一多就画到画布外。 */
const MAX_LOADOUT_ROWS = 6;

/** 每张职业卡最多列这么多个动作，按次数降序取前几个。 */
const MAX_ACTION_ROWS = 6;

export interface PanelStatRow {
  label: string;
  value: string;
}

export interface PanelProfessionCard {
  profession: Profession;
  label: string;
  color: string;
  samples: number;
  /** 无样本时为 true；此时 stats/actions 里是占位符而不是会被误读成"0%"的真数字 */
  empty: boolean;
  stats: PanelStatRow[];
  actions: PanelStatRow[];
}

export interface PanelLoadoutRow {
  loadout: string;
  samples: number;
  share: number;
  shareText: string;
  successText: string;
  isTop: boolean;
}

export interface PanelEquipmentSection {
  totalSamples: number;
  topLoadoutShare: number;
  topShareText: string;
  passesDiversityTarget: boolean;
  /** 门槛结论一句话；无样本时明确说"无法判定"，不说"未达标" */
  verdictText: string;
  rows: PanelLoadoutRow[];
  /** 超出 MAX_LOADOUT_ROWS 被折叠的套数 */
  overflow: number;
  empty: boolean;
}

export interface ValidationPanelModel {
  totalSamples: number;
  professions: PanelProfessionCard[];
  equipment: PanelEquipmentSection;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * 把 store 里的原始 id 串翻译成中文。store 为了聚合稳定用的是
 * `weapon / armor / accessory` 的 id 拼接，直接画出来读不出是什么装备。
 */
function loadoutLabel(raw: string, labelOf: (id: string) => string): string {
  return raw
    .split(' / ')
    .map((id) => (id === 'none' ? '空' : labelOf(id)))
    .join(' · ');
}

/**
 * 报告 → 可画的行。
 *
 * 最关键的一条：`ProfessionValidationStore` 的聚合用 `Math.max(1, count)`
 * 兜底除零，所以无样本时成功率和各项均值全是 0。直接画出来会被读成
 * "打了但成功率 0%"，和"还没有样本"是完全相反的结论。面板必须靠
 * `samples === 0` 把这两种情况分开，用占位符而不是 0。
 */
export function buildValidationPanelModel(
  professionRows: ProfessionReportRow[],
  equipment: EquipmentReport,
  labelOf: (id: string) => string = (id) => id,
): ValidationPanelModel {
  const professions = professionRows.map((row) => {
    const empty = row.samples === 0;
    const dash = '—';
    const stats: PanelStatRow[] = [
      { label: '成功率', value: empty ? dash : percent(row.successRate) },
      { label: '平均用时', value: empty ? dash : `${row.averageSeconds.toFixed(1)}s` },
      { label: '移动距离', value: empty ? dash : `${Math.round(row.averageMoveDistance)}` },
      { label: '平均交战距离', value: empty ? dash : `${Math.round(row.averageEngagementDistance)}px` },
    ];
    const actions = empty
      ? []
      : Object.entries(row.averageActions)
          .filter(([, value]) => value > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, MAX_ACTION_ROWS)
          .map(([action, value]) => ({ label: action, value: value.toFixed(1) }));
    return {
      profession: row.profession,
      label: PROFESSION_VIEW[row.profession].label,
      color: PROFESSION_VIEW[row.profession].color,
      samples: row.samples,
      empty,
      stats,
      actions,
    };
  });

  const empty = equipment.totalSamples === 0;
  const rows = equipment.loadouts.slice(0, MAX_LOADOUT_ROWS).map((row, index) => ({
    loadout: loadoutLabel(row.loadout, labelOf),
    samples: row.samples,
    share: row.share,
    shareText: percent(row.share),
    successText: percent(row.successRate),
    isTop: index === 0,
  }));

  return {
    totalSamples: equipment.totalSamples,
    professions,
    equipment: {
      totalSamples: equipment.totalSamples,
      topLoadoutShare: equipment.topLoadoutShare,
      topShareText: empty ? '—' : percent(equipment.topLoadoutShare),
      passesDiversityTarget: equipment.passesDiversityTarget,
      // 无样本不是"没达标"，是"还判定不了"。这两句话在验收会上含义完全不同。
      verdictText: empty
        ? '暂无样本 · 无法判定'
        : equipment.passesDiversityTarget
          ? `头部 ${percent(equipment.topLoadoutShare)} < ${percent(TOP_LOADOUT_SHARE_TARGET)} · 达标`
          : `头部 ${percent(equipment.topLoadoutShare)} ≥ ${percent(TOP_LOADOUT_SHARE_TARGET)} · 未达标`,
      rows,
      overflow: Math.max(0, equipment.loadouts.length - MAX_LOADOUT_ROWS),
      empty,
    },
  };
}

const PASS_COLOR = '#63d0a8';
const FAIL_COLOR = '#e2705c';
const MUTED = 'rgba(255,255,255,0.5)';

/**
 * 面板本体。只画和收按键，不改玩法状态——开着的时候游戏照常推进，
 * 这样才能一边打一边看数字涨，也免得为了暂停去动 Run 的相位机。
 */
export class ValidationPanel {
  private visible = false;
  /** 清空是不可逆的，必须二次确认；这个标记表示正在等第二次按键 */
  private confirmingClear = false;

  constructor(
    private readonly store: Pick<
      ProfessionValidationStore,
      'report' | 'equipmentReport' | 'samples' | 'clear'
    >,
    private readonly labelOf: (id: string) => string = (id) => id,
  ) {}

  get open(): boolean {
    return this.visible;
  }

  model(): ValidationPanelModel {
    return buildValidationPanelModel(this.store.report(), this.store.equipmentReport(), this.labelOf);
  }

  /**
   * 返回 true 表示这个按键被面板吃掉了，调用方不应再交给游戏。
   * 只吃自己的键：面板是覆盖层不是暂停态，走位和出手键照常透传下去。
   */
  handleKey(code: string): boolean {
    if (code === 'KeyV') {
      this.visible = !this.visible;
      this.confirmingClear = false;
      return true;
    }
    if (!this.visible) return false;
    if (code === 'KeyO') {
      this.exportJson();
      return true;
    }
    if (code === 'KeyC') {
      this.confirmingClear = true;
      return true;
    }
    if (code === 'KeyY' && this.confirmingClear) {
      this.store.clear();
      this.confirmingClear = false;
      return true;
    }
    if (code === 'Escape') {
      // 有待确认就先撤销确认，没有才关面板——免得手滑一下把面板也关了
      if (this.confirmingClear) this.confirmingClear = false;
      else this.visible = false;
      return true;
    }
    return false;
  }

  /**
   * 导出成文件下载。样本是真人连打六关攒出来的，只在控制台打印的话
   * 一刷新就没了；下载失败（无 DOM / 被拦）时退回控制台，至少不丢数据。
   */
  private exportJson(): void {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        professionReport: this.store.report(),
        equipmentReport: this.store.equipmentReport(),
        samples: this.store.samples(),
      },
      null,
      2,
    );
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `frontier-brawler-validation-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      console.log('[validation-panel] 导出失败，改为打印：\n' + payload);
    }
  }

  /** 复用 renderer 的「全屏遮罩 + 圆角卡片」形态，只是数据密度更高。 */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.visible) return;
    const model = this.model();

    ctx.save();
    // 比玩法面板（0.72~0.8）更厚一档：这一层可能叠在职业选择/结算面板之上，
    // 那些界面自己就有大号高亮文字，遮罩太薄会透上来和面板标题糊在一起。
    ctx.fillStyle = 'rgba(8,10,13,0.96)';
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('M2 / M4 验收面板', width / 2, 44);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(
      `共 ${model.totalSamples} 份样本 · O 导出 JSON · C 清空 · V 关闭`,
      width / 2,
      66,
    );

    this.drawProfessions(ctx, model, width);
    this.drawEquipment(ctx, model, width);

    if (this.confirmingClear) {
      ctx.textAlign = 'center';
      ctx.fillStyle = FAIL_COLOR;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(
        `确认清空全部 ${model.totalSamples} 份样本？按 Y 确认 · Esc 取消`,
        width / 2,
        height - 18,
      );
    }
    ctx.restore();
  }

  private drawProfessions(
    ctx: CanvasRenderingContext2D,
    model: ValidationPanelModel,
    width: number,
  ): void {
    const margin = 24;
    const gap = 14;
    const count = model.professions.length;
    const cardW = (width - margin * 2 - gap * (count - 1)) / count;
    const cardH = 210;
    const top = 84;

    model.professions.forEach((card, index) => {
      const x = margin + index * (cardW + gap);
      ctx.fillStyle = 'rgba(20,24,30,0.94)';
      ctx.strokeStyle = card.color;
      ctx.lineWidth = 2;
      roundRect(ctx, x, top, cardW, cardH, 11);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = card.color;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText(card.label, x + cardW / 2, top + 30);
      ctx.fillStyle = MUTED;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`样本 ${card.samples}`, x + cardW / 2, top + 50);

      card.stats.forEach((row, i) => {
        const y = top + 76 + i * 20;
        ctx.textAlign = 'left';
        ctx.fillStyle = MUTED;
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(row.label, x + 16, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = card.empty ? MUTED : '#ffffff';
        ctx.font = card.empty ? '12px system-ui, sans-serif' : 'bold 13px system-ui, sans-serif';
        ctx.fillText(row.value, x + cardW - 16, y);
      });

      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('动作分布', x + 16, top + 172);

      if (card.empty) {
        ctx.fillStyle = MUTED;
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('暂无样本', x + 16, top + 192);
        return;
      }

      // 两列排布，最多 MAX_ACTION_ROWS 个；动作名本身就是英文 id，
      // 和 __game.professionReport() 打印出来的键名一致，便于对照。
      const colW = (cardW - 32) / 2;
      card.actions.forEach((row, i) => {
        const col = i % 2;
        const line = Math.floor(i / 2);
        const cx = x + 16 + col * colW;
        const y = top + 192 + line * 16;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(row.label, cx, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(row.value, cx + colW - 10, y);
      });
    });
  }

  private drawEquipment(
    ctx: CanvasRenderingContext2D,
    model: ValidationPanelModel,
    width: number,
  ): void {
    const margin = 24;
    const top = 306;
    const panelW = width - margin * 2;
    const panelH = 190;
    const section = model.equipment;
    const verdictColor = section.empty ? MUTED : section.passesDiversityTarget ? PASS_COLOR : FAIL_COLOR;

    ctx.fillStyle = 'rgba(20,24,30,0.94)';
    ctx.strokeStyle = verdictColor;
    ctx.lineWidth = 2;
    roundRect(ctx, margin, top, panelW, panelH, 11);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText('M4 配装分布', margin + 18, top + 28);
    ctx.fillStyle = MUTED;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`总样本 ${section.totalSamples}`, margin + 132, top + 28);

    ctx.textAlign = 'right';
    ctx.fillStyle = verdictColor;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(section.verdictText, margin + panelW - 18, top + 28);

    if (section.empty) {
      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('暂无样本：通关或死亡各会自动记一条。', margin + 18, top + 60);
      return;
    }

    const rowH = 21;
    const barX = margin + 300;
    const barW = panelW - 300 - 150;
    section.rows.forEach((row, i) => {
      const y = top + 56 + i * rowH;
      ctx.textAlign = 'left';
      ctx.fillStyle = row.isTop ? '#ffffff' : 'rgba(255,255,255,0.72)';
      ctx.font = row.isTop ? 'bold 12px system-ui, sans-serif' : '12px system-ui, sans-serif';
      ctx.fillText(row.loadout, margin + 18, y);

      // 占比条：头部那一套按是否越过门槛着色，一眼能看出卡在哪
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(barX, y - 9, barW, 10);
      ctx.fillStyle = row.isTop ? verdictColor : 'rgba(255,255,255,0.34)';
      ctx.fillRect(barX, y - 9, Math.max(1, barW * row.share), 10);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`${row.shareText} · ${row.samples} 局`, barX + barW + 92, y);
      ctx.fillStyle = MUTED;
      ctx.fillText(row.successText, margin + panelW - 18, y);
    });

    if (section.overflow > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(
        `其余 ${section.overflow} 套已折叠，完整数据用 O 导出`,
        margin + 18,
        top + 56 + section.rows.length * rowH,
      );
    }
  }
}

function roundRect(
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
