import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Game } from './game/Game';
import { store } from './game/store';
import { audio } from './game/audio/AudioEngine';
import { Menu } from './ui/Menu';
import { Hud } from './ui/Hud';
import { PauseMenu } from './ui/PauseMenu';
import { Results } from './ui/Results';
import { TouchControls } from './ui/TouchControls';
import { FpsMeter, SettingsPanel } from './ui/Settings';

export function useUI() {
  return useSyncExternalStore(store.subscribe, store.get);
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const ui = useUI();

  useEffect(() => {
    if (!host.current) return;
    let g: Game;
    try {
      g = new Game(host.current);
    } catch (e) {
      console.error(e);
      store.set({ loadingText: 'WebGL is not available in this browser.' });
      return;
    }
    setGame(g);
    (window as unknown as { __game: Game; __store: typeof store }).__game = g;
    (window as unknown as { __store: typeof store }).__store = store;
    (window as unknown as { __audio: typeof audio }).__audio = audio;
    void g.showTrack(store.get().track);
    g.setTouchMode(store.get().touch);
    g.setSteering(store.get().steering);
    // a real touch anywhere switches on the on-screen controls (e.g. tablets reporting a fine pointer)
    const onTouch = () => {
      if (!store.get().touch) store.set({ touch: true });
      g.setTouchMode(true);
    };
    window.addEventListener('touchstart', onTouch, { passive: true, once: true });
    return () => {
      window.removeEventListener('touchstart', onTouch);
      g.dispose();
    };
  }, []);

  return (
    <div className={`app ${ui.touch ? 'is-touch' : ''}`} onContextMenu={(e) => e.preventDefault()}>
      <div className="viewport" ref={host} />
      {ui.screen === 'menu' && game && <Menu game={game} />}
      {ui.screen === 'loading' && (
        <div className="loading">
          <div className="loading-bar" />
          <p>{ui.loadingText}</p>
        </div>
      )}
      {ui.screen === 'race' && game && (
        <>
          <Hud game={game} />
          {ui.touch && !ui.paused && !ui.finished && <TouchControls game={game} />}
          {ui.paused && !ui.finished && <PauseMenu game={game} />}
          {ui.finished && ui.results && <Results game={game} />}
        </>
      )}
      {ui.settingsOpen && game && <SettingsPanel game={game} />}
      {ui.settings.showFps && <FpsMeter />}
      {!game && ui.loadingText && <div className="loading"><p>{ui.loadingText}</p></div>}
    </div>
  );
}
