import { IS_TOUCH } from './device';
import type { TrackId } from './track/types';
import type { TimeOfDay } from './track/themes';
import { loadSettings, saveSettings, type Settings } from './settings';

export type Screen = 'menu' | 'loading' | 'race';

function savedSteering(): 1 | 2 | 3 {
  try {
    const v = Number(localStorage.getItem('x10.steering'));
    if (v === 1 || v === 2 || v === 3) return v;
  } catch {
    /* storage unavailable */
  }
  return 3;
}

function savedTod(): TimeOfDay {
  try {
    const v = localStorage.getItem('x10.tod');
    if (v === 'day' || v === 'night') return v;
  } catch {
    /* storage unavailable */
  }
  return 'night';
}

export function saveSteering(v: 1 | 2 | 3) {
  try {
    localStorage.setItem('x10.steering', String(v));
  } catch {
    /* storage unavailable */
  }
}

export interface ResultRow {
  name: string;
  color: string;
  isPlayer: boolean;
  time: number;
  finished: boolean;
  best: number;
}

export interface HudState {
  speed: number;        // km/h
  position: number;
  racers: number;
  lap: number;
  laps: number;
  progress: number;     // 0..1 race progress
  lapProgress: number;
  boost: number;        // 0..100
  boosting: boolean;
  autoThrust: boolean;
  drifting: boolean;
  time: number;
  lapTime: number;
  bestLap: number;
  countdown: number;    // >0 during countdown
  go: number;           // seconds since GO (for the GO! flash)
  wrongWay: boolean;
  airborne: boolean;
  flying: boolean;
  inAir: boolean;
  camera: string;
  standings: { name: string; color: string; isPlayer: boolean; gap: string }[];
}

export interface Toast {
  id: number;
  text: string;
  sub?: string;
  kind: 'info' | 'lap' | 'warn' | 'big';
}

export interface UIState {
  screen: Screen;
  track: TrackId;
  laps: number;
  paused: boolean;
  finished: boolean;
  results: ResultRow[] | null;
  playerPos: number;
  muted: boolean;
  touch: boolean;
  steering: 1 | 2 | 3;
  tod: TimeOfDay;
  settings: Settings;
  settingsOpen: boolean;
  loadingText: string;
  hud: HudState;
  toasts: Toast[];
}

const initialHud: HudState = {
  speed: 0, position: 5, racers: 6, lap: 1, laps: 3, progress: 0, lapProgress: 0, boost: 100, boosting: false, autoThrust: false,
  drifting: false, time: 0, lapTime: 0, bestLap: Infinity, countdown: 0, go: 99, wrongWay: false, airborne: false, flying: false, inAir: false, camera: 'CHASE', standings: [],
};

let state: UIState = {
  screen: 'menu',
  track: 'neon',
  laps: 3,
  paused: false,
  finished: false,
  results: null,
  playerPos: 0,
  muted: false,
  touch: IS_TOUCH,
  steering: savedSteering(),
  tod: savedTod(),
  settings: loadSettings(),
  settingsOpen: false,
  loadingText: '',
  hud: initialHud,
  toasts: [],
};

const subs = new Set<() => void>();

export const store = {
  get: () => state,
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  set(patch: Partial<UIState>) {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  },
  /** Change settings, save them, and notify listeners (the game applies them). */
  setSettings(patch: Partial<Settings>) {
    const settings = { ...state.settings, ...patch };
    saveSettings(settings);
    state = { ...state, settings };
    subs.forEach((f) => f());
  },
  setHud(patch: Partial<HudState>) {
    state = { ...state, hud: { ...state.hud, ...patch } };
    subs.forEach((f) => f());
  },
};

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', sub?: string, ms = 1800) {
  const t: Toast = { id: toastId++, text, kind, sub };
  store.set({ toasts: [...store.get().toasts.slice(-2), t] });
  setTimeout(() => store.set({ toasts: store.get().toasts.filter((x) => x.id !== t.id) }), ms);
}
