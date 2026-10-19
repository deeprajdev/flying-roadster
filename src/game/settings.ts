/** Player settings, saved in this browser. */

export type Level = 1 | 2 | 3; // low / medium / high
export type Graphics = 'low' | 'high';
export type Units = 'kmh' | 'mph';

export interface Settings {
  music: boolean;
  musicVol: Level;
  sfx: boolean;
  sfxVol: Level;
  graphics: Graphics;
  units: Units;
  camera: 0 | 1 | 2;   // starting camera: chase / far chase / bumper
  vibration: boolean;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  music: true,
  musicVol: 2,
  sfx: true,
  sfxVol: 3,
  graphics: 'high',
  units: 'kmh',
  camera: 0,
  vibration: true,
  showFps: false,
};

const KEY = 'x10.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Settings>;
      const s = { ...DEFAULT_SETTINGS, ...v };
      // guard against stale or hand-edited values
      if (![1, 2, 3].includes(s.musicVol)) s.musicVol = DEFAULT_SETTINGS.musicVol;
      if (![1, 2, 3].includes(s.sfxVol)) s.sfxVol = DEFAULT_SETTINGS.sfxVol;
      if (s.graphics !== 'low' && s.graphics !== 'high') s.graphics = 'high';
      if (s.units !== 'kmh' && s.units !== 'mph') s.units = 'kmh';
      if (![0, 1, 2].includes(s.camera)) s.camera = 0;
      return s;
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Speed in the chosen unit (input km/h). */
export function speedIn(units: Units, kmh: number) {
  return units === 'mph' ? Math.round(kmh * 0.621371) : kmh;
}
