/** M2 真人对比样本，只在开发构建中使用。 */
import type { Run } from '../core/run';
import type { Profession } from '../core/types';

type Summary = ReturnType<Run['overallSummary']>;

export interface ProfessionSample {
  id: string;
  stageId: string;
  cleared: boolean;
  recordedAt: string;
  summary: Summary;
}

export interface ProfessionReportRow {
  profession: Profession;
  samples: number;
  successRate: number;
  averageSeconds: number;
  averageMoveDistance: number;
  averageEngagementDistance: number;
  averageActions: Record<string, number>;
}

export interface EquipmentReportRow {
  loadout: string;
  samples: number;
  share: number;
  successRate: number;
}

export interface EquipmentReport {
  totalSamples: number;
  topLoadoutShare: number;
  passesDiversityTarget: boolean;
  loadouts: EquipmentReportRow[];
}

export interface ProfessionCoverageRow {
  profession: Profession;
  readyStages: number;
  requiredStages: number;
  minimumSamples: number;
  minimumSamplesPerStage: number;
  complete: boolean;
  stageSamples: Record<string, number>;
}

const STORAGE_KEY = 'frontier-brawler:m2-profession-samples:v1';

/**
 * 验收样本用 localStorage 跨刷新保留；读写失败时退化成内存列表，
 * 避免隐私模式或存储被禁用后影响游戏主循环。
 */
export class ProfessionValidationStore {
  private memory: ProfessionSample[] = [];

  constructor(private readonly storage: Storage | null = availableStorage()) {
    this.memory = this.read();
  }

  record(stageId: string, cleared: boolean, summary: Summary): ProfessionSample {
    const sample: ProfessionSample = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      stageId,
      cleared,
      recordedAt: new Date().toISOString(),
      summary,
    };
    this.memory.push(sample);
    this.write();
    return sample;
  }

  samples(): ProfessionSample[] {
    return this.memory.map((sample) => ({ ...sample, summary: { ...sample.summary } }));
  }

  report(): ProfessionReportRow[] {
    const professions: Profession[] = ['heavy', 'swift', 'arcane'];
    return professions.map((profession) => {
      const samples = this.memory.filter((sample) => sample.summary.profession === profession);
      const count = samples.length;
      const actionTotals: Record<string, number> = {};
      for (const sample of samples) {
        for (const [action, value] of Object.entries(sample.summary.actions)) {
          actionTotals[action] = (actionTotals[action] ?? 0) + value;
        }
      }
      const averageActions = Object.fromEntries(
        Object.entries(actionTotals).map(([action, total]) => [action, round(total / Math.max(1, count))]),
      );
      return {
        profession,
        samples: count,
        successRate: round(samples.filter((sample) => sample.cleared).length / Math.max(1, count)),
        averageSeconds: average(samples.map((sample) => sample.summary.seconds)),
        averageMoveDistance: average(samples.map((sample) => sample.summary.totalMoveDistance)),
        averageEngagementDistance: average(
          samples.map((sample) => sample.summary.averageEngagementDistance),
        ),
        averageActions,
      };
    });
  }

  /**
   * M2 要求每个职业在六关都有足量真人样本，不能用同一关反复刷出的总数冒充。
   * 这里按关卡分别计数，面板只在每一关都达到门槛时显示覆盖完成。
   */
  coverage(stageIds: readonly string[], minimumSamplesPerStage = 3): ProfessionCoverageRow[] {
    const professions: Profession[] = ['heavy', 'swift', 'arcane'];
    return professions.map((profession) => {
      const stageSamples = Object.fromEntries(
        stageIds.map((stageId) => [
          stageId,
          this.memory.filter(
            (sample) => sample.stageId === stageId && sample.summary.profession === profession,
          ).length,
        ]),
      );
      const counts = Object.values(stageSamples);
      const readyStages = counts.filter((count) => count >= minimumSamplesPerStage).length;
      const minimumSamples = counts.length ? Math.min(...counts) : 0;
      return {
        profession,
        readyStages,
        requiredStages: stageIds.length,
        minimumSamples,
        minimumSamplesPerStage,
        complete: stageIds.length > 0 && readyStages === stageIds.length,
        stageSamples,
      };
    });
  }

  /** M4 用同一批真人通关样本统计配装，不另开一套容易口径漂移的记录器。 */
  equipmentReport(): EquipmentReport {
    const groups = new Map<string, ProfessionSample[]>();
    for (const sample of this.memory) {
      const equipment = sample.summary.equipment;
      const key = [
        equipment.weapon ?? 'none',
        equipment.armor ?? 'none',
        equipment.accessory ?? 'none',
      ].join(' / ');
      groups.set(key, [...(groups.get(key) ?? []), sample]);
    }

    const totalSamples = this.memory.length;
    const loadouts = [...groups.entries()]
      .map(([loadout, samples]) => ({
        loadout,
        samples: samples.length,
        share: round(samples.length / Math.max(1, totalSamples)),
        successRate: round(
          samples.filter((sample) => sample.cleared).length / Math.max(1, samples.length),
        ),
      }))
      .sort((a, b) => b.samples - a.samples || a.loadout.localeCompare(b.loadout));
    const topLoadoutShare = loadouts[0]?.share ?? 0;
    return {
      totalSamples,
      topLoadoutShare,
      passesDiversityTarget: totalSamples > 0 && topLoadoutShare < 0.4,
      loadouts,
    };
  }

  clear(): void {
    this.memory = [];
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // 内存已经清空；存储不可写时无需让调试工具影响游戏。
    }
  }

  private read(): ProfessionSample[] {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ProfessionSample[]) : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.memory));
    } catch {
      // 保留内存样本，下一次调用 report() 仍然可用。
    }
  }
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function availableStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
