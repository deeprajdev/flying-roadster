import { useEffect, useRef } from 'react';
import { useUI } from '../App';
import { formatTime } from '../game/core/math';
import type { Game } from '../game/Game';
import { TRACKS } from '../game/track/tracks';

const ord = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

export function Results({ game }: { game: Game }) {
  const ui = useUI();
  const rows = ui.results!;
  const winner = rows[0];
  const me = rows.find((r) => r.isPlayer)!;
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        game.restart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  return (
    <div className="overlay results" role="dialog" aria-modal="true" aria-label="Race results">
      <div className="panel panel-wide">
        <p className="res-track">{TRACKS[ui.track].name} · {ui.laps} {ui.laps === 1 ? 'lap' : 'laps'}</p>
        <h2 className="res-head">
          {ui.playerPos === 1 ? 'You won' : `You finished ${ord(ui.playerPos)}`}
        </h2>
        <p className="res-time">
          {formatTime(me.time)}
          {ui.playerPos > 1 && <span> · {(me.time - winner.time).toFixed(2)} s behind {winner.name.charAt(0) + winner.name.slice(1).toLowerCase()}</span>}
        </p>
        <table className="res-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Driver</th>
              <th>Race time</th>
              <th>Best lap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className={r.isPlayer ? 'me' : ''}>
                <td>{i + 1}</td>
                <td>
                  <i style={{ background: r.color }} />
                  {r.isPlayer ? 'You' : r.name.charAt(0) + r.name.slice(1).toLowerCase()}
                </td>
                <td>
                  {formatTime(r.time)}
                  {!r.finished && <em title="Still racing — projected time"> est.</em>}
                </td>
                <td>{isFinite(r.best) ? formatTime(r.best) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="panel-actions row">
          <button ref={first} className="btn btn-primary" onClick={() => game.restart()}>
            Race again <kbd>Enter</kbd>
          </button>
          <button className="btn" onClick={() => game.quitToMenu()}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}
