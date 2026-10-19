import { useEffect, useState } from 'react';
import { useUI } from '../App';
import type { Game } from '../game/Game';
import { store } from '../game/store';
import { buildTrack } from '../game/track/TrackBuilder';
import { TRACKS } from '../game/track/tracks';
import type { TrackId } from '../game/track/types';
import type { TimeOfDay } from '../game/track/themes';
import { audio } from '../game/audio/AudioEngine';
import { Controls } from './Controls';
import { GearIcon } from './Settings';

interface TrackInfo {
  id: TrackId;
  name: string;
  subtitle: string;
  km: string;
  corners: number;
  path: string;
}

let infoCache: TrackInfo[] | null = null;

function computeInfo(): TrackInfo[] {
  if (infoCache) return infoCache;
  infoCache = (Object.keys(TRACKS) as TrackId[]).map((id) => {
    const def = TRACKS[id];
    const { track } = buildTrack(def);
    const b = track.bounds;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const sc = Math.min(94 / w, 54 / h);
    const ox = (100 - w * sc) / 2, oz = (60 - h * sc) / 2;
    let d = '';
    for (let i = 0; i < track.n; i += 6) {
      const x = (track.px[i] - b.minX) * sc + ox;
      const y = (track.pz[i] - b.minZ) * sc + oz;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    d += 'Z';
    const corners = def.cmds.filter((c) => c.t === 'T' && Math.abs(c.ang!) > 12).length;
    return { id, name: def.name, subtitle: def.subtitle, km: (track.length / 1000).toFixed(2), corners, path: d };
  });
  return infoCache;
}

export function Menu({ game }: { game: Game }) {
  const ui = useUI();
  const [info, setInfo] = useState<TrackInfo[] | null>(infoCache);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (info) return;
    const t = setTimeout(() => setInfo(computeInfo()), 30);
    return () => clearTimeout(t);
  }, [info]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !store.get().settingsOpen) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pickTime = async (tod: TimeOfDay) => {
    if (tod === ui.tod || busy) return;
    audio.init();
    audio.click();
    setBusy(true);
    await game.setTimeOfDay(tod);
    setBusy(false);
  };

  const pick = async (id: TrackId) => {
    audio.init();
    audio.click();
    store.set({ track: id });
    setBusy(true);
    await game.showTrack(id);
    setBusy(false);
  };

  const start = () => {
    if (busy) return;
    audio.init();
    void game.startRace(ui.track, ui.laps);
  };

  return (
    <div className="menu">
      <section className="menu-panel">
        <header className="brand">
          <p className="brand-kicker">Tesla Roadster</p>
          <h1 className="brand-title">Space X10</h1>
          <p className="brand-line">Ten cold-gas thrusters, five rivals, one vertical wall.</p>
        </header>

        <div className="tracks" role="radiogroup" aria-label="Circuit">
          {(info ?? []).map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={ui.track === t.id}
              className={`track ${ui.track === t.id ? 'is-on' : ''}`}
              onClick={() => void pick(t.id)}
            >
              <svg viewBox="0 0 100 60" className="track-map" aria-hidden>
                <path d={t.path} />
              </svg>
              <span className="track-text">
                <span className="track-name">{t.name}</span>
                <span className="track-sub">{t.subtitle}</span>
                <span className="track-meta">
                  {t.km} km · {t.corners} corners
                </span>
              </span>
            </button>
          ))}
          {!info && <p className="muted">Surveying circuits…</p>}
        </div>

        <div className="menu-opts">
          <div className="laps">
            <span>Laps</span>
            <div className="seg" role="radiogroup" aria-label="Laps">
              {[1, 3, 5].map((n) => (
                <button key={n} role="radio" aria-checked={ui.laps === n} className={ui.laps === n ? 'is-on' : ''} onClick={() => store.set({ laps: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="laps">
            <span>Time</span>
            <div className="seg seg-wide" role="radiogroup" aria-label="Time of day">
              {(['day', 'night'] as TimeOfDay[]).map((t) => (
                <button key={t} role="radio" aria-checked={ui.tod === t} className={ui.tod === t ? 'is-on' : ''} onClick={() => void pickTime(t)}>
                  {t === 'day' ? 'Day' : 'Night'}
                </button>
              ))}
            </div>
          </div>
        </div>
        {ui.touch && <p className="touch-note">Left pad steers. Boost, drift and brake are on the right. The car accelerates by itself.</p>}
        <div className="start-row">
          <button className="start" onClick={start} disabled={busy}>
            <span>{busy ? 'Loading circuit…' : 'Start race'}</span>
            <kbd>Enter</kbd>
          </button>
          <button
            className="settings-btn"
            aria-label="Settings"
            onClick={() => {
              audio.init();
              audio.click();
              store.set({ settingsOpen: true });
            }}
          >
            <GearIcon />
            <span>Settings</span>
          </button>
        </div>
      </section>

      <aside className="menu-controls">
        <Controls touch={ui.touch} />
        <p className="fan-note">Fan project. Not affiliated with Tesla or SpaceX.</p>
      </aside>
    </div>
  );
}
