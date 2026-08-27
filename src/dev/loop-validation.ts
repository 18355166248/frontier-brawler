export interface LoopValidationSample {
  id: string;
  stageId: string;
  defeatedAt: string;
  openedBase: boolean;
  usedBase: boolean;
}

export interface LoopValidationReport {
  defeats: number;
  baseChoices: number;
  baseUses: number;
  baseChoiceRate: number;
  baseUseRate: number;
  passesChoiceTarget: boolean;
}

const STORAGE_KEY = 'frontier-brawler:m6-loop-samples:v1';

/** M6 只记录“战败后做了什么”，不采集身份信息，也不进入正式战役存档。 */
export class LoopValidationStore {
  private memory: LoopValidationSample[];

  constructor(private readonly storage: Storage | null = availableStorage()) {
    this.memory = this.read();
  }

  recordDefeat(stageId: string, now = new Date()): string {
    const id = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    this.memory.push({ id, stageId, defeatedAt: now.toISOString(), openedBase: false, usedBase: false });
    this.write();
    return id;
  }

  recordBaseChoice(id: string): boolean {
    return this.update(id, (sample) => { sample.openedBase = true; });
  }

  recordBaseUse(id: string): boolean {
    return this.update(id, (sample) => {
      sample.openedBase = true;
      sample.usedBase = true;
    });
  }

  samples(): LoopValidationSample[] {
    return this.memory.map((sample) => ({ ...sample }));
  }

  report(): LoopValidationReport {
    const defeats = this.memory.length;
    const baseChoices = this.memory.filter((sample) => sample.openedBase).length;
    const baseUses = this.memory.filter((sample) => sample.usedBase).length;
    const baseChoiceRate = round(baseChoices / Math.max(1, defeats));
    return {
      defeats,
      baseChoices,
      baseUses,
      baseChoiceRate,
      baseUseRate: round(baseUses / Math.max(1, defeats)),
      passesChoiceTarget: defeats > 0 && baseChoiceRate > 0.4,
    };
  }

  clear(): void {
    this.memory = [];
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // 内存样本已清空；验收存储失败不能影响游戏。
    }
  }

  private update(id: string, mutate: (sample: LoopValidationSample) => void): boolean {
    const sample = this.memory.find((item) => item.id === id);
    if (!sample) return false;
    mutate(sample);
    this.write();
    return true;
  }

  private read(): LoopValidationSample[] {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((value): LoopValidationSample[] => {
        if (typeof value !== 'object' || value === null) return [];
        const sample = value as Record<string, unknown>;
        if (
          typeof sample.id !== 'string' ||
          typeof sample.stageId !== 'string' ||
          typeof sample.defeatedAt !== 'string' ||
          typeof sample.openedBase !== 'boolean' ||
          typeof sample.usedBase !== 'boolean'
        ) return [];
        return [{
          id: sample.id,
          stageId: sample.stageId,
          defeatedAt: sample.defeatedAt,
          openedBase: sample.openedBase,
          usedBase: sample.usedBase,
        }];
      }).slice(-200);
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.memory.slice(-200)));
    } catch {
      // 保留内存样本，当前页面仍能读取报告。
    }
  }
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
