import { emptyInput, type CarInput } from './vehicle/CarPhysics';

export type Action = 'up' | 'down' | 'left' | 'right' | 'boost' | 'drift' | 'fly';

const MAP: Record<string, Action> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  Space: 'drift',
  KeyF: 'fly',
  KeyE: 'fly',
};

/** Keyboard state → CarInput. One-shot keys (C, R, Esc, M) are delivered through `onPress`. */
export class Input {
  private held = new Set<Action>();
  private virt = new Set<Action>();
  /** touch mode: the car accelerates on its own unless braking */
  autoGas = false;
  /** touch steering response: 1 smooth, 2 quick, 3 sharp (keyboard stays at the default 0) */
  steerLevel = 3;
  onPress: (code: string) => void = () => {};
  private down = (e: KeyboardEvent) => {
    const a = MAP[e.code];
    if (a) {
      this.held.add(a);
      e.preventDefault();
    }
    if (!e.repeat && (e.code === 'KeyC' || e.code === 'KeyR' || e.code === 'Escape' || e.code === 'KeyM' || e.code === 'KeyP')) {
      this.onPress(e.code);
    }
  };
  private up = (e: KeyboardEvent) => {
    const a = MAP[e.code];
    if (a) {
      this.held.delete(a);
      e.preventDefault();
    }
  };
  private blur = () => this.held.clear();

  attach() {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur);
  }

  detach() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.blur);
  }

  clear() {
    this.held.clear();
    this.virt.clear();
  }

  /** On-screen (touch) buttons feed in here. */
  setVirtual(a: Action, down: boolean) {
    if (down) this.virt.add(a);
    else this.virt.delete(a);
  }

  read(out: CarInput = emptyInput()): CarInput {
    const k = this.held, v = this.virt;
    const has = (a: Action) => k.has(a) || v.has(a);
    const braking = has('down');
    out.throttle = has('up') || (this.autoGas && !braking) ? 1 : 0;
    out.brake = braking ? 1 : 0;
    out.steer = (has('right') ? 1 : 0) - (has('left') ? 1 : 0);
    out.handbrake = has('drift');
    out.boost = has('boost');
    out.fly = has('fly');
    out.assist = this.autoGas ? this.steerLevel : 0;
    return out;
  }
}
