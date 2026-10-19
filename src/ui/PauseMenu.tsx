import { useEffect, useRef } from 'react';
import { useUI } from '../App';
import type { Game } from '../game/Game';
import { Controls } from './Controls';
import { store } from '../game/store';
import { GearIcon } from './Settings';

export function PauseMenu({ game }: { game: Game }) {
  const ui = useUI();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
      <div className="panel">
        <h2>Paused</h2>
        <div className="panel-actions">
          <button ref={first} className="btn btn-primary" onClick={() => game.setPaused(false)}>
            Resume
          </button>
          <button className="btn" onClick={() => game.restart()}>
            Restart race
          </button>
          <button className="btn btn-icon" onClick={() => store.set({ settingsOpen: true })}>
            <GearIcon /> Settings
          </button>
          <button className="btn" onClick={() => game.quitToMenu()}>
            Quit to menu
          </button>
        </div>
        <Controls touch={ui.touch} />
      </div>
    </div>
  );
}
