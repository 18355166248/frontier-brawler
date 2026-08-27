export interface TouchVector {
  x: number;
  y: number;
}

/** 把触点位移压进单位圆；小于死区时归零，避免拇指静止时角色缓慢漂移。 */
export function normalizeJoystick(dx: number, dy: number, radius: number, deadzone = 0.16): TouchVector {
  if (![dx, dy, radius, deadzone].every(Number.isFinite) || radius <= 0) return { x: 0, y: 0 };
  const distance = Math.hypot(dx, dy);
  const normalizedDistance = Math.min(1, distance / radius);
  if (normalizedDistance <= deadzone || distance === 0) return { x: 0, y: 0 };
  // 过死区后重新映射到 0..1，手指刚离开中心不会突然跳到 16% 速度。
  const magnitude = (normalizedDistance - deadzone) / (1 - deadzone);
  return { x: (dx / distance) * magnitude, y: (dy / distance) * magnitude };
}

interface TouchControlsOptions {
  root: HTMLElement;
  onMove(vector: TouchVector): void;
  onKey(code: string, pressed: boolean): void;
  onInteraction(): void;
}

/** DOM 只负责采集多指触控，所有动作仍回到与键盘相同的输入路径。 */
export class TouchControls {
  private abort = new AbortController();
  private joystickPointer: number | null = null;
  private buttonPointers = new Map<number, string>();
  private joystick: HTMLElement;
  private knob: HTMLElement;

  constructor(private options: TouchControlsOptions) {
    const joystick = options.root.querySelector<HTMLElement>('[data-touch-joystick]');
    const knob = options.root.querySelector<HTMLElement>('[data-touch-knob]');
    if (!joystick || !knob) throw new Error('触控摇杆 DOM 不完整');
    this.joystick = joystick;
    this.knob = knob;

    const signal = this.abort.signal;
    joystick.addEventListener('pointerdown', this.onJoystickDown, { signal });
    joystick.addEventListener('pointermove', this.onJoystickMove, { signal });
    joystick.addEventListener('pointerup', this.onJoystickEnd, { signal });
    joystick.addEventListener('pointercancel', this.onJoystickEnd, { signal });
    options.root.addEventListener('pointerdown', this.onButtonDown, { signal });
    options.root.addEventListener('pointerup', this.onButtonEnd, { signal });
    options.root.addEventListener('pointercancel', this.onButtonEnd, { signal });
  }

  dispose(): void {
    this.releaseAll();
    this.abort.abort();
  }

  /** 暂停、切后台或 HMR 时统一释放，避免恢复后残留移动/按键状态。 */
  releaseAll(): void {
    for (const code of this.buttonPointers.values()) this.options.onKey(code, false);
    this.buttonPointers.clear();
    this.options.root.querySelectorAll('.is-pressed').forEach((element) => {
      element.classList.remove('is-pressed');
    });
    this.resetJoystick();
  }

  private onJoystickDown = (event: PointerEvent): void => {
    if (this.joystickPointer !== null) return;
    event.preventDefault();
    this.options.onInteraction();
    this.joystickPointer = event.pointerId;
    this.joystick.setPointerCapture(event.pointerId);
    this.updateJoystick(event);
  };

  private onJoystickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointer) return;
    event.preventDefault();
    this.updateJoystick(event);
  };

  private onJoystickEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointer) return;
    event.preventDefault();
    this.resetJoystick();
  };

  private updateJoystick(event: PointerEvent): void {
    const rect = this.joystick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const vector = normalizeJoystick(dx, dy, radius);
    this.options.onMove(vector);
    this.knob.style.transform = `translate(${vector.x * radius * 0.48}px, ${vector.y * radius * 0.48}px)`;
  }

  private resetJoystick(): void {
    this.joystickPointer = null;
    this.options.onMove({ x: 0, y: 0 });
    this.knob.style.transform = 'translate(0, 0)';
  }

  private onButtonDown = (event: PointerEvent): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-touch-key]');
    const code = target?.dataset.touchKey;
    if (!target || !code || this.buttonPointers.has(event.pointerId)) return;
    event.preventDefault();
    this.options.onInteraction();
    target.setPointerCapture(event.pointerId);
    target.classList.add('is-pressed');
    this.buttonPointers.set(event.pointerId, code);
    this.options.onKey(code, true);
  };

  private onButtonEnd = (event: PointerEvent): void => {
    const code = this.buttonPointers.get(event.pointerId);
    if (!code) return;
    event.preventDefault();
    this.buttonPointers.delete(event.pointerId);
    this.options.root
      .querySelector<HTMLElement>(`[data-touch-key="${code}"]`)
      ?.classList.remove('is-pressed');
    this.options.onKey(code, false);
  };
}
