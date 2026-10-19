import { useEffect, useRef, type ReactNode } from 'react';
import { useUI } from '../App';
import type { Game } from '../game/Game';
import { audio } from '../game/audio/AudioEngine';
import { saveSteering, store } from '../game/store';
import { DEFAULT_SETTINGS, type Settings as S } from '../game/settings';

function Seg<T extends string | number | boolean>({ label, value, options, onPick, hint }: {
  label: string;
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
  hint?: string;
}) {
  return (
    <div className="set-row">
      <span className="set-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <div className="seg seg-wide" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            role="radio"
            aria-checked={value === v}
            className={value === v ? 'is-on' : ''}
            onClick={() => {
              audio.init();
              audio.click();
              onPick(v);
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const LEVELS: [1 | 2 | 3, string][] = [
  [1, 'Low'],
  [2, 'Med'],
  [3, 'High'],
];
const ONOFF: [boolean, string][] = [
  [true, 'On'],
  [false, 'Off'],
];

/** Settings dialog: sound, graphics, controls and display. Opened from the main menu and the pause menu. */
export function SettingsPanel({ game }: { game: Game }) {
  const ui = useUI();
  const st = ui.settings;
  const done = useRef<HTMLButtonElement>(null);
  const set = (p: Partial<S>) => store.setSettings(p);
  const close = () => store.set({ settingsOpen: false });

  useEffect(() => {
    done.current?.focus();
    // the menu has no game key handler, so close on Escape here too
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && store.get().screen !== 'race') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="overlay settings-overlay" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="panel settings">
        <header className="set-head">
          <h2>Settings</h2>
          <button ref={done} className="btn btn-primary set-done" onClick={close}>
            Done
          </button>
        </header>

        <div className="set-body">
          <Group title="Sound">
            <Seg label="Music" value={st.music} options={ONOFF} onPick={(v) => set({ music: v })} />
            <Seg label="Music volume" value={st.musicVol} options={LEVELS} onPick={(v) => set({ musicVol: v, music: true })} />
            <Seg label="Effects" value={st.sfx} options={ONOFF} onPick={(v) => set({ sfx: v })} hint="Motor, thrusters, tyres" />
            <Seg label="Effects volume" value={st.sfxVol} options={LEVELS} onPick={(v) => set({ sfxVol: v, sfx: true })} />
          </Group>

          <Group title="Graphics">
            <Seg
              label="Quality"
              value={st.graphics}
              options={[
                ['high', 'High'],
                ['low', 'Low'],
              ]}
              onPick={(v) => set({ graphics: v })}
              hint={st.graphics === 'high' ? 'Sharpest image, real shadows' : 'Smoother on older phones'}
            />
            <Seg label="FPS counter" value={st.showFps} options={ONOFF} onPick={(v) => set({ showFps: v })} />
          </Group>

          <Group title="Driving">
            <Seg
              label="Camera"
              value={st.camera}
              options={[
                [0, 'Chase'],
                [1, 'Far'],
                [2, 'Bumper'],
              ]}
              onPick={(v) => set({ camera: v })}
              hint={ui.touch ? undefined : 'C switches in a race'}
            />
            <Seg
              label="Speed units"
              value={st.units}
              options={[
                ['kmh', 'km/h'],
                ['mph', 'mph'],
              ]}
              onPick={(v) => set({ units: v })}
            />
            {ui.touch && (
              <>
                <Seg
                  label="Steering"
                  value={ui.steering}
                  options={[
                    [1, 'Smooth'],
                    [2, 'Quick'],
                    [3, 'Sharp'],
                  ]}
                  onPick={(v) => {
                    store.set({ steering: v });
                    saveSteering(v);
                    game.setSteering(v);
                  }}
                />
                <Seg label="Vibration" value={st.vibration} options={ONOFF} onPick={(v) => set({ vibration: v })} />
              </>
            )}
          </Group>
        </div>

        <button
          className="set-reset"
          onClick={() => {
            store.setSettings({ ...DEFAULT_SETTINGS });
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

/** Gear icon for the settings buttons. */
export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** Small frame-rate readout (when switched on in Settings). */
export function FpsMeter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0, frames = 0, t0 = performance.now();
    const loop = (t: number) => {
      frames++;
      if (t - t0 >= 500) {
        if (ref.current) ref.current.textContent = `${Math.round((frames * 1000) / (t - t0))} FPS`;
        frames = 0;
        t0 = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="fps" ref={ref} aria-hidden />;
}
