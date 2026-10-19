import { useUI } from '../App';
import { formatTime } from '../game/core/math';
import type { Game } from '../game/Game';
import { speedIn } from '../game/settings';
import { Minimap } from './Minimap';

const ord = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

function Ring({ value, max, label, unit, tone, sub }: { value: number; max: number; label: string; unit: string; tone: 'speed' | 'boost' | 'low'; sub?: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const sweep = 0.75; // 270°
  const f = Math.max(0, Math.min(1, value / max));
  return (
    <div className={`ring ring-${tone}`}>
      <svg viewBox="0 0 128 128" aria-hidden>
        <circle className="ring-track" cx="64" cy="64" r={R} strokeDasharray={`${C * sweep} ${C}`} transform="rotate(135 64 64)" />
        <circle className="ring-fill" cx="64" cy="64" r={R} strokeDasharray={`${C * sweep * f} ${C}`} transform="rotate(135 64 64)" />
      </svg>
      <div className="ring-read">
        <span className="ring-value">{Math.round(value)}</span>
        <span className="ring-unit">{unit}</span>
      </div>
      <span className="ring-label">{label}</span>
      {sub && <span className="ring-sub">{sub}</span>}
    </div>
  );
}

export function Hud({ game }: { game: Game }) {
  const ui = useUI();
  const h = ui.hud;
  const unit = ui.settings.units === 'mph' ? 'mph' : 'km/h';
  const cd = h.countdown;
  const cdNum = cd > 0 ? Math.ceil(cd) : 0;
  const boostTone = h.boost < 20 ? 'low' : 'boost';
  const boostSub = h.autoThrust ? 'Wall thrust' : h.flying ? 'Flying' : h.boosting ? 'Boosting' : h.drifting ? 'Drift charge' : undefined;

  return (
    <div className={`hud ${h.boosting || h.autoThrust ? 'is-boost' : ''} ${ui.touch ? 'hud-touch' : ''}`}>
      <div className="vignette" />

      <div className="hud-progress" aria-hidden>
        <div className="hud-progress-fill" style={{ width: `${h.progress * 100}%` }} />
        {Array.from({ length: h.laps - 1 }, (_, i) => (
          <i key={i} style={{ left: `${((i + 1) / h.laps) * 100}%` }} />
        ))}
      </div>

      <div className="hud-pos">
        <div className="pos-big">
          {h.position}
          <sup>{ord(h.position)}</sup>
          <span className="pos-of">of {h.racers}</span>
        </div>
        <ol className="standings">
          {h.standings.map((r) => (
            <li key={r.name} className={r.isPlayer ? 'me' : ''}>
              <i style={{ background: r.color }} />
              <span className="st-name">{r.isPlayer ? 'You' : r.name.charAt(0) + r.name.slice(1).toLowerCase()}</span>
              <span className="st-gap">{r.gap === 'LEADER' ? 'Leader' : r.gap === 'FIN' ? 'Finished' : r.gap}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="hud-time">
        <div className="lap">
          Lap <b>{h.lap}</b>/{h.laps}
        </div>
        <div className="clock">{formatTime(h.time)}</div>
        <div className="splits">
          <span>This lap {formatTime(h.lapTime)}</span>
          <span>Best {isFinite(h.bestLap) ? formatTime(h.bestLap) : '—'}</span>
        </div>
      </div>

      {ui.touch ? (
        <div className="speedo">
          <b>{speedIn(ui.settings.units, h.speed)}</b>
          <span>{unit}</span>
          {boostSub && <em>{boostSub}</em>}
        </div>
      ) : (
        <div className="telemetry">
          <Ring value={speedIn(ui.settings.units, h.speed)} max={ui.settings.units === 'mph' ? 200 : 320} label="Speed" unit={unit} tone="speed" />
          <Ring value={h.boost} max={100} label="Boost" unit="%" tone={boostTone} sub={boostSub} />
        </div>
      )}

      <Minimap game={game} />

      {cdNum > 0 && (
        <div className="countdown" key={cdNum}>
          <span>{cdNum}</span>
        </div>
      )}
      {cd <= 0 && h.go < 1.1 && (
        <div className="countdown go">
          <span>Go</span>
        </div>
      )}
      {h.wrongWay && <div className="wrongway">Wrong way</div>}
      {h.airborne && <div className="airtime">{h.flying ? 'Flying' : 'Airborne'}</div>}

      <div className="toasts">
        {ui.toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.sub && <small>{t.sub}</small>}
          </div>
        ))}
      </div>

      {!ui.touch && <div className="hud-hint">
        <kbd>Esc</kbd> pause <kbd>C</kbd> {h.camera.toLowerCase()} <kbd>R</kbd> reset
      </div>}
    </div>
  );
}
