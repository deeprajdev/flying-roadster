import { useEffect, useRef } from 'react';
import type { Game } from '../game/Game';

/** Canvas minimap redrawn every animation frame straight from game state (no React updates). */
export function Minimap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext('2d')!;
    let raf = 0;
    let bg: HTMLCanvasElement | null = null;
    let bgFor: unknown = null;
    let map = { sc: 1, ox: 0, oz: 0, minX: 0, minZ: 0 };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const data = game.minimapData();
      if (!data) return;
      const { track, racers } = data;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth * dpr, H = cv.clientHeight * dpr;
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
        bg = null;
      }
      if (!bg || bgFor !== track) {
        bgFor = track;
        bg = document.createElement('canvas');
        bg.width = W;
        bg.height = H;
        const b = track.bounds;
        const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
        const pad = 12 * dpr;
        const sc = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
        map = { sc, ox: (W - w * sc) / 2, oz: (H - h * sc) / 2, minX: b.minX, minZ: b.minZ };
        const bgc = bg.getContext('2d')!;
        bgc.lineJoin = 'round';
        const path = () => {
          bgc.beginPath();
          for (let i = 0; i < track.n; i += 3) {
            const x = (track.px[i] - map.minX) * sc + map.ox;
            const y = (track.pz[i] - map.minZ) * sc + map.oz;
            if (i === 0) bgc.moveTo(x, y);
            else bgc.lineTo(x, y);
          }
          bgc.closePath();
        };
        bgc.strokeStyle = 'rgba(185,184,179,0.22)';
        bgc.lineWidth = 7 * dpr;
        path();
        bgc.stroke();
        bgc.strokeStyle = 'rgba(244,246,248,0.85)';
        bgc.lineWidth = 1.6 * dpr;
        path();
        bgc.stroke();
        // skywall marker
        const sky = track.zoneOf('skywall');
        if (sky) {
          const i = track.index(sky.s0);
          bgc.fillStyle = '#ff3b2a';
          bgc.fillRect((track.px[i] - map.minX) * sc + map.ox - 3 * dpr, (track.pz[i] - map.minZ) * sc + map.oz - 3 * dpr, 6 * dpr, 6 * dpr);
        }
        // start line
        bgc.fillStyle = '#f4f6f8';
        bgc.fillRect((track.px[0] - map.minX) * sc + map.ox - 1.5 * dpr, (track.pz[0] - map.minZ) * sc + map.oz - 5 * dpr, 3 * dpr, 10 * dpr);
      }
      g.clearRect(0, 0, W, H);
      g.drawImage(bg, 0, 0);
      const order = [...racers].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
      for (const r of order) {
        const i = track.index(r.car.s);
        const x = (track.px[i] + track.rx[i] * r.car.d - map.minX) * map.sc + map.ox;
        const y = (track.pz[i] + track.rz[i] * r.car.d - map.minZ) * map.sc + map.oz;
        g.beginPath();
        g.arc(x, y, (r.isPlayer ? 5 : 3.6) * dpr, 0, Math.PI * 2);
        g.fillStyle = r.isPlayer ? '#ff3b2a' : '#' + r.color.toString(16).padStart(6, '0');
        g.fill();
        if (r.isPlayer) {
          g.lineWidth = 2 * dpr;
          g.strokeStyle = '#000';
          g.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  return <canvas ref={ref} className="minimap" aria-label="Circuit map" />;
}
