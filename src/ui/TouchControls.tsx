import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useUI } from '../App';
import type { Game } from '../game/Game';
import type { Action } from '../game/input';
import { store } from '../game/store';

const stop = (e: { preventDefault(): void }) => e.preventDefault();

/** A button that stays pressed while any finger holds it (multi-touch safe). */
function Hold({ game, action, className, label, children, style }: {
  game: Game; action: Action; className: string; label: string; children: ReactNode; style?: CSSProperties;
}) {
  const [on, setOn] = useState(false);
  const ids = useRef(new Set<number>());
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is optional */
    }
    ids.current.add(e.pointerId);
    if (ids.current.size === 1) {
      setOn(true);
      game.touch(action, true);
    }
  };
  const up = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!ids.current.delete(e.pointerId)) return;
    if (ids.current.size === 0) {
      setOn(false);
      game.touch(action, false);
    }
  };
  useEffect(() => () => game.touch(action, false), [game, action]);
  return (
    <button
      type="button"
      className={`tbtn ${className} ${on ? 'is-down' : ''}`}
      aria-label={label}
      style={style}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={stop}
    >
      {children}
    </button>
  );
}

/** Steering pad: the side under the most recent finger steers; slide across to switch. */
function SteerPad({ game }: { game: Game }) {
  const ref = useRef<HTMLDivElement>(null);
  const fingers = useRef(new Map<number, number>()); // pointerId -> -1 | 0 | 1
  const order = useRef<number[]>([]);
  const [dir, setDir] = useState(0);
  const cur = useRef(0);
  const apply = () => {
    const last = order.current[order.current.length - 1];
    const d = last === undefined ? 0 : fingers.current.get(last) ?? 0;
    // engage the game input first, then repaint the pad
    game.touch('left', d < 0);
    game.touch('right', d > 0);
    if (d !== 0 && d !== cur.current && store.get().settings.vibration) {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* haptics optional */
      }
    }
    cur.current = d;
    setDir(d);
  };
  // no dead zone: every touch steers; a small hysteresis stops flicker when sliding across the middle
  const sideOf = (e: RPointerEvent<HTMLDivElement>, prev = 0) => {
    const r = ref.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (prev < 0) return x > 0.54 ? 1 : -1;
    if (prev > 0) return x < 0.46 ? -1 : 1;
    return x < 0.5 ? -1 : 1;
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* optional */
    }
    fingers.current.set(e.pointerId, sideOf(e));
    order.current = [...order.current.filter((i) => i !== e.pointerId), e.pointerId];
    apply();
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!fingers.current.has(e.pointerId)) return;
    const s = sideOf(e, fingers.current.get(e.pointerId));
    if (s !== fingers.current.get(e.pointerId)) {
      fingers.current.set(e.pointerId, s);
      apply();
    }
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (!fingers.current.delete(e.pointerId)) return;
    order.current = order.current.filter((i) => i !== e.pointerId);
    apply();
  };
  useEffect(() => () => {
    game.touch('left', false);
    game.touch('right', false);
  }, [game]);
  return (
    <div
      ref={ref}
      className="steer"
      role="group"
      aria-label="Steer"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={stop}
    >
      <span className={`steer-half ${dir < 0 ? 'is-down' : ''}`} aria-label="Steer left">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M15 4 L7 12 L15 20" /></svg>
      </span>
      <span className={`steer-half ${dir > 0 ? 'is-down' : ''}`} aria-label="Steer right">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M9 4 L17 12 L9 20" /></svg>
      </span>
    </div>
  );
}

export function TouchControls({ game }: { game: Game }) {
  const ui = useUI();
  const boost = ui.hud.boost;
  const tap = (code: string) => (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    game.press(code);
  };
  return (
    <div className="touch" onContextMenu={stop}>
      <div className="touch-top">
        <button type="button" className="tsmall" aria-label="Pause" onPointerDown={tap('Escape')}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5v14M16 5v14" /></svg>
        </button>
        <button type="button" className="tsmall" aria-label="Change camera" onPointerDown={tap('KeyC')}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></svg>
        </button>
        <button type="button" className="tsmall" aria-label="Reset car" onPointerDown={tap('KeyR')}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12a7 7 0 1 0 2.2-5.1" /><path d="M5 4v4h4" /></svg>
        </button>
      </div>
      <SteerPad game={game} />
      <div className="tright">
        <Hold game={game} action="fly" className={`t-fly ${ui.hud.flying ? 'is-on' : ''}`} label="Fly">Fly</Hold>
        <Hold game={game} action="down" className="t-brake" label="Brake">Brake</Hold>
        <Hold game={game} action="drift" className={`t-drift ${ui.hud.inAir ? 'is-air' : ''}`} label={ui.hud.inAir ? 'Flip' : 'Drift'}>
          {ui.hud.inAir ? 'Flip' : 'Drift'}
        </Hold>
        <Hold
          game={game}
          action="boost"
          className={`t-boost ${boost < 20 ? 'is-low' : ''}`}
          label={`Boost, ${Math.round(boost)} percent`}
          style={{ ['--boost' as string]: `${boost * 3.6}deg` }}
        >
          <span>Boost</span>
          <small>{Math.round(boost)}%</small>
        </Hold>
      </div>
    </div>
  );
}
