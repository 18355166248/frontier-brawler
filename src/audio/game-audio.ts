import type { WorldEvents } from '../core/types';

export type AudioCue =
  | 'enemyHit'
  | 'criticalHit'
  | 'guard'
  | 'kill'
  | 'playerHit'
  | 'execute'
  | 'skillLight'
  | 'skillHeavy'
  | 'bossPhase'
  | 'roomClear'
  | 'stageClear'
  | 'defeat'
  | 'confirm';

/**
 * 同一逻辑帧可能打中多个目标；先去重再播放，避免范围技把音量按敌人数叠爆。
 * 分类只依赖核心事件，既方便回归，也不把 Web Audio 反向耦合进战斗层。
 */
export function audioCuesForWorldEvents(events: WorldEvents, playerId?: number): AudioCue[] {
  const cues = new Set<AudioCue>();
  for (const event of events.damage) {
    if (event.target === playerId) cues.add('playerHit');
    else if (event.killed) cues.add('kill');
    else if (event.guarded) cues.add('guard');
    else if (event.backstab || event.perfectCancel) cues.add('criticalHit');
    else cues.add('enemyHit');
  }
  if (events.executes.length) cues.add('execute');
  if (events.skillCasts.some((event) => event.power === 'light')) cues.add('skillLight');
  if (events.skillCasts.some((event) => event.power === 'heavy')) cues.add('skillHeavy');
  if (events.bossPhaseShifts.length) cues.add('bossPhase');
  return [...cues];
}

interface Tone {
  frequency: number;
  endFrequency?: number;
  duration: number;
  delay?: number;
  volume: number;
  wave: OscillatorType;
}

const CUE_TONES: Record<AudioCue, readonly Tone[]> = {
  enemyHit: [{ frequency: 125, endFrequency: 75, duration: 0.07, volume: 0.48, wave: 'square' }],
  criticalHit: [
    { frequency: 260, endFrequency: 120, duration: 0.09, volume: 0.5, wave: 'sawtooth' },
    { frequency: 680, duration: 0.05, volume: 0.18, wave: 'square' },
  ],
  guard: [
    { frequency: 920, endFrequency: 620, duration: 0.08, volume: 0.25, wave: 'square' },
    { frequency: 1_360, duration: 0.04, volume: 0.13, wave: 'sine' },
  ],
  kill: [
    { frequency: 150, endFrequency: 52, duration: 0.16, volume: 0.62, wave: 'sawtooth' },
    { frequency: 420, endFrequency: 180, duration: 0.11, volume: 0.22, wave: 'square' },
  ],
  playerHit: [{ frequency: 92, endFrequency: 45, duration: 0.18, volume: 0.7, wave: 'sawtooth' }],
  execute: [
    { frequency: 110, endFrequency: 45, duration: 0.22, volume: 0.72, wave: 'square' },
    { frequency: 520, endFrequency: 820, duration: 0.14, delay: 0.04, volume: 0.28, wave: 'sine' },
  ],
  skillLight: [{ frequency: 310, endFrequency: 610, duration: 0.12, volume: 0.24, wave: 'sine' }],
  skillHeavy: [
    { frequency: 130, endFrequency: 55, duration: 0.3, volume: 0.62, wave: 'sawtooth' },
    { frequency: 360, endFrequency: 720, duration: 0.2, volume: 0.3, wave: 'sine' },
  ],
  bossPhase: [
    { frequency: 70, endFrequency: 45, duration: 0.5, volume: 0.7, wave: 'sawtooth' },
    { frequency: 220, endFrequency: 440, duration: 0.42, delay: 0.08, volume: 0.3, wave: 'square' },
  ],
  roomClear: [
    { frequency: 392, duration: 0.09, volume: 0.2, wave: 'sine' },
    { frequency: 523, duration: 0.12, delay: 0.08, volume: 0.22, wave: 'sine' },
  ],
  stageClear: [
    { frequency: 330, duration: 0.13, volume: 0.24, wave: 'triangle' },
    { frequency: 440, duration: 0.13, delay: 0.11, volume: 0.25, wave: 'triangle' },
    { frequency: 659, duration: 0.25, delay: 0.22, volume: 0.28, wave: 'triangle' },
  ],
  defeat: [
    { frequency: 220, endFrequency: 110, duration: 0.28, volume: 0.28, wave: 'triangle' },
    { frequency: 130, endFrequency: 55, duration: 0.42, delay: 0.16, volume: 0.35, wave: 'sawtooth' },
  ],
  confirm: [{ frequency: 480, endFrequency: 640, duration: 0.06, volume: 0.16, wave: 'sine' }],
};

type WebkitAudioWindow = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/** 无外部素材依赖的短音效引擎；首次键盘/触控手势后才创建 AudioContext。 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private muted = false;

  async unlock(): Promise<boolean> {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext
        ?? (globalThis as WebkitAudioWindow).webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;
      // 多种大反馈可能同帧叠加；压缩器只做峰值安全网，避免主输出削波。
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -10;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.18;
      this.master.connect(this.limiter);
      this.limiter.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        return false;
      }
    }
    return this.context.state === 'running';
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  onWorldEvents(events: WorldEvents, playerId?: number): void {
    for (const cue of audioCuesForWorldEvents(events, playerId)) this.play(cue);
  }

  play(cue: AudioCue): void {
    if (this.muted || !this.context || !this.master || this.context.state !== 'running') return;
    for (const tone of CUE_TONES[cue]) this.playTone(tone);
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    this.limiter = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  private playTone(tone: Tone): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const start = context.currentTime + (tone.delay ?? 0);
    const end = start + tone.duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.frequency, start);
    if (tone.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(tone.volume, start + Math.min(0.012, tone.duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }
}
