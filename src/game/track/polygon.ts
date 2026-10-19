import type { TrackCmd, Waypoint } from './types';

/**
 * Converts a closed waypoint polygon (corners filleted with radius r) into turtle commands.
 * The command list starts in the middle of the first straight (start/finish line) so the
 * starting grid sits on a straight. Two straights flagged `adj` absorb loop shifts.
 */
export function polygonToCmds(pts: Waypoint[], startFrac = 0.5): TrackCmd[] {
  const n = pts.length;
  const turn: number[] = [];
  const tlen: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const ax = c.x - p.x, az = c.z - p.z, bx = q.x - c.x, bz = q.z - c.z;
    const ang = Math.atan2(ax * bz - az * bx, ax * bx + az * bz); // + = right turn
    turn.push(ang);
    tlen.push(c.r * Math.tan(Math.abs(ang) / 2));
  }
  const straights: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = pts[i], q = pts[(i + 1) % n];
    const L = Math.hypot(q.x - c.x, q.z - c.z) - tlen[i] - tlen[(i + 1) % n];
    if (L < 0) throw new Error(`Waypoint ${i}->${(i + 1) % n}: corners overlap (${L.toFixed(1)} m)`);
    straights.push(L);
  }
  const seg = (i: number, from: number, to: number): TrackCmd[] => {
    const w = pts[i];
    const L = straights[i];
    const out: TrackCmd[] = [];
    // split points on this straight: height knots and the loop
    const splits: { at: number; h?: number; loop?: boolean; tag?: TrackCmd['tag']; hasTag?: boolean }[] = [];
    for (const k of w.knots ?? [])
      if (k.at > from && k.at < to) splits.push({ at: k.at, h: k.h, tag: k.tag, hasTag: 'tag' in k });
    if (w.loop && w.loop.at >= from && w.loop.at < to) splits.push({ at: w.loop.at, loop: true });
    splits.sort((a, b) => a.at - b.at);
    let cur = from;
    let curTag = w.tag;
    for (const sp of splits) {
      const len = (sp.at - cur) * L;
      if (len > 0.01 || sp.h !== undefined) out.push({ t: 'S', len: Math.max(len, 0.01), tag: curTag, h: sp.h });
      if (sp.loop) out.push({ t: 'LOOP', r: w.loop!.r, shift: w.loop!.shift, h: w.h });
      if (sp.hasTag) curTag = sp.tag;
      cur = sp.at;
    }
    const len = (to - cur) * L;
    // the adjustable piece is always the part after the loop
    if (len > 0.01 || w.adj) out.push({ t: 'S', len, tag: curTag, adj: to === 1 ? w.adj : undefined });
    return out;
  };
  const cmds: TrackCmd[] = [];
  cmds.push(...seg(0, startFrac, 1));
  for (let i = 1; i <= n; i++) {
    const k = i % n;
    const w = pts[k];
    if (Math.abs(turn[k]) > 1e-4)
      cmds.push({ t: 'T', ang: (turn[k] * 180) / Math.PI, r: w.r, h: w.h, tag: w.cornerTag });
    else if (w.h !== undefined) cmds.push({ t: 'S', len: 0.01, h: w.h });
    if (k !== 0) cmds.push(...seg(k, 0, 1));
  }
  cmds.push(...seg(0, 0, startFrac));
  // ensure exactly two adjustable straights exist; adj on a straight means "solve its length"
  // – keep the designed length as a fallback if not flagged.
  return cmds.map((c) => (c.adj ? { ...c, len: undefined } : c));
}
