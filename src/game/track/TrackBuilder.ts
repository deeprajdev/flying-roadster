import { clamp } from '../core/math';
import { TrackData } from './TrackData';
import type { TrackDef, Zone } from './types';

const RAW_STEP = 0.5;
const DS = 1.0;

interface Raw {
  x: number; y: number; z: number;
  loop: boolean;
  ux: number; uy: number; uz: number;
  kH: number;
}

interface TurtleOut {
  raws: Raw[];
  cmdStart: number[]; // raw index where each command starts
  endX: number; endZ: number; endHeading: number;
  adjDir: Record<1 | 2, [number, number]>;
  knots: { idx: number; h: number; flat: boolean }[];
}

const deg = Math.PI / 180;

function runTurtle(def: TrackDef, adjLen: Record<1 | 2, number>): TurtleOut {
  const raws: Raw[] = [];
  const cmdStart: number[] = [];
  const knots: { idx: number; h: number; flat: boolean }[] = [{ idx: 0, h: def.startHeight, flat: false }];
  const adjDir: Record<1 | 2, [number, number]> = { 1: [1, 0], 2: [0, 1] };
  let x = 0, z = 0, th = 0;
  const push = (px: number, pz: number, kH: number) =>
    raws.push({ x: px, y: NaN, z: pz, loop: false, ux: 0, uy: 1, uz: 0, kH });

  for (const c of def.cmds) {
    cmdStart.push(raws.length);
    const dx = Math.cos(th), dz = Math.sin(th);
    const rx = -Math.sin(th), rz = Math.cos(th); // right of heading (Y-up, right-handed)
    if (c.t === 'S') {
      const len = c.adj ? adjLen[c.adj] : c.len!;
      if (c.adj) adjDir[c.adj] = [dx, dz];
      const n = Math.max(1, Math.ceil(len / RAW_STEP));
      for (let k = 0; k < n; k++) push(x + dx * (len * k) / n, z + dz * (len * k) / n, 0);
      x += dx * len;
      z += dz * len;
    } else if (c.t === 'T') {
      const a = c.ang! * deg;
      const r = c.r!;
      const sg = Math.sign(a);
      const cx = x + rx * r * sg, cz = z + rz * r * sg;
      const n = Math.max(2, Math.ceil((Math.abs(a) * r) / RAW_STEP));
      for (let k = 0; k < n; k++) {
        const thk = th + (a * k) / n;
        push(cx - sg * -Math.sin(thk) * r, cz - sg * Math.cos(thk) * r, sg / r);
      }
      th += a;
      x = cx - sg * -Math.sin(th) * r;
      z = cz - sg * Math.cos(th) * r;
    } else if (c.t === 'LOOP') {
      const R = c.r!;
      const shift = c.shift ?? 20;
      const base = c.h ?? 0;
      knots.push({ idx: raws.length, h: base, flat: true });
      const n = Math.ceil((Math.PI * 2 * R) / (RAW_STEP * 0.8));
      for (let k = 0; k < n; k++) {
        const ph = (Math.PI * 2 * k) / n;
        const fwd = R * Math.sin(ph);
        const up = R * (1 - Math.cos(ph));
        const lat = (shift * (ph - Math.sin(ph))) / (Math.PI * 2);
        raws.push({
          x: x + dx * fwd + rx * lat,
          y: base + up,
          z: z + dz * fwd + rz * lat,
          loop: true,
          // points at the loop centre
          ux: -dx * Math.sin(ph), uy: Math.cos(ph), uz: -dz * Math.sin(ph),
          kH: 0,
        });
      }
      x += rx * shift;
      z += rz * shift;
      knots.push({ idx: raws.length, h: base, flat: true });
      continue;
    }
    if (c.h !== undefined) knots.push({ idx: raws.length, h: c.h, flat: false });
  }
  return { raws, cmdStart, endX: x, endZ: z, endHeading: th, adjDir, knots };
}

/** Monotone cubic (Fritsch–Carlson) height profile through the knots, on a closed loop. */
function applyHeights(out: TurtleOut, def: TrackDef) {
  const { raws } = out;
  const N = raws.length;
  // cumulative horizontal/3D length at raw samples (loop sections use their real 3D length)
  const cum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const a = raws[i - 1], b = raws[i % N];
    const dy = a.loop && b.loop ? b.y - a.y : 0;
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, dy, b.z - a.z);
  }
  const total = cum[N];
  const ks = out.knots.map((k) => ({ s: cum[k.idx], h: k.h, flat: k.flat }));
  ks.sort((a, b) => a.s - b.s);
  // closed: add wrap knot
  const K = [...ks, { s: total, h: def.startHeight, flat: false }];
  const m = K.length;
  const sec: number[] = [];
  for (let i = 0; i < m - 1; i++) sec.push((K[i + 1].h - K[i].h) / Math.max(1e-6, K[i + 1].s - K[i].s));
  const slope: number[] = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    if (K[i].flat) continue;
    const dPrev = i === 0 ? sec[m - 2] : sec[i - 1];
    const dNext = i === m - 1 ? sec[0] : sec[i];
    if (dPrev * dNext <= 0) slope[i] = 0;
    else {
      const avg = (dPrev + dNext) / 2;
      const lim = 3 * Math.min(Math.abs(dPrev), Math.abs(dNext));
      slope[i] = Math.sign(avg) * Math.min(Math.abs(avg), lim);
    }
  }
  slope[m - 1] = slope[0];
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const r = raws[i];
    const s = cum[i];
    while (seg < m - 2 && s > K[seg + 1].s) seg++;
    if (r.loop) continue;
    const a = K[seg], b = K[seg + 1];
    const hseg = Math.max(1e-6, b.s - a.s);
    const t = clamp((s - a.s) / hseg, 0, 1);
    const t2 = t * t, t3 = t2 * t;
    r.y =
      (2 * t3 - 3 * t2 + 1) * a.h +
      (t3 - 2 * t2 + t) * hseg * slope[seg] +
      (-2 * t3 + 3 * t2) * b.h +
      (t3 - t2) * hseg * slope[seg + 1];
  }
}

function gaussSmoothClosed(arr: Float64Array, sigma: number, mask?: Uint8Array) {
  const n = arr.length;
  const rad = Math.ceil(sigma * 3);
  const w: number[] = [];
  let ws = 0;
  for (let k = -rad; k <= rad; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    w.push(v);
    ws += v;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) {
      out[i] = arr[i];
      continue;
    }
    let acc = 0;
    for (let k = -rad; k <= rad; k++) acc += arr[(i + k + n) % n] * w[k + rad];
    out[i] = acc / ws;
  }
  arr.set(out);
}

export interface BuildReport {
  length: number;
  minRadius: number;
  maxGrade: number;
  crossings: string[];
  adj: [number, number];
  turnSum: number;
}

export function buildTrack(def: TrackDef): { track: TrackData; report: BuildReport } {
  // 1) heading closure check
  let turnSum = 0;
  for (const c of def.cmds) if (c.t === 'T') turnSum += c.ang!;
  // 2) solve adjustable straights so the end meets the start
  const probe = runTurtle(def, { 1: 0, 2: 0 });
  const [a1, b1] = probe.adjDir[1];
  const [a2, b2] = probe.adjDir[2];
  const ex = -probe.endX, ez = -probe.endZ;
  const det = a1 * b2 - a2 * b1;
  let L1 = 0, L2 = 0;
  if (Math.abs(det) > 1e-6) {
    L1 = (ex * b2 - a2 * ez) / det;
    L2 = (a1 * ez - ex * b1) / det;
  }
  const tur = runTurtle(def, { 1: L1, 2: L2 });
  applyHeights(tur, def);
  const raws = tur.raws;
  const N = raws.length;

  // 3) resample to uniform 3D arc length
  const cum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const a = raws[i - 1], b = raws[i % N];
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const total = cum[N];
  const n = Math.round(total / DS);
  const ds = total / n;
  const P = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
  const H = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
  const kH = new Float64Array(n);
  const isLoop = new Uint8Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    while (j < N - 1 && cum[j + 1] < s) j++;
    const a = raws[j], b = raws[(j + 1) % N];
    const t = clamp((s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]), 0, 1);
    P.x[i] = a.x + (b.x - a.x) * t;
    P.y[i] = a.y + (b.y - a.y) * t;
    P.z[i] = a.z + (b.z - a.z) * t;
    H.x[i] = a.ux + (b.ux - a.ux) * t;
    H.y[i] = a.uy + (b.uy - a.uy) * t;
    H.z[i] = a.uz + (b.uz - a.uz) * t;
    kH[i] = a.kH + (b.kH - a.kH) * t;
    isLoop[i] = a.loop || b.loop ? 1 : 0;
  }
  // zones in final s
  const zones: Zone[] = [];
  def.cmds.forEach((c, ci) => {
    const tag = c.tag ?? (c.t === 'LOOP' ? 'skywall' : undefined);
    if (!tag) return;
    const r0 = tur.cmdStart[ci];
    const r1 = ci + 1 < def.cmds.length ? tur.cmdStart[ci + 1] : N;
    zones.push({ tag, s0: cum[r0], s1: cum[r1] });
  });

  // 4) smooth (softens straight→arc and loop entry transitions)
  gaussSmoothClosed(P.x, 2.5);
  gaussSmoothClosed(P.y, 2.5);
  gaussSmoothClosed(P.z, 2.5);
  gaussSmoothClosed(H.x, 2.5);
  gaussSmoothClosed(H.y, 2.5);
  gaussSmoothClosed(H.z, 2.5);
  gaussSmoothClosed(kH, 9);

  // 5) frames
  const arr: Record<string, Float32Array> = {};
  for (const k of ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'ux', 'uy', 'uz', 'rx', 'ry', 'rz', 'kLat', 'kUp'])
    arr[k] = new Float32Array(n);
  computeFrames();
  // lift banked sections so the low (inside) edge never dips below the design height
  const lift = new Float64Array(n);
  for (let i = 0; i < n; i++) lift[i] = isLoop[i] ? 0 : def.halfWidth * Math.abs(arr.ry[i]) + 0.05;
  gaussSmoothClosed(lift, 6);
  for (let i = 0; i < n; i++) P.y[i] += lift[i];
  computeFrames();

  function computeFrames() {
  for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n, im = (i - 1 + n) % n;
    let tx = P.x[ip] - P.x[im], ty = P.y[ip] - P.y[im], tz = P.z[ip] - P.z[im];
    let m = Math.hypot(tx, ty, tz);
    tx /= m; ty /= m; tz /= m;
    let hx = H.x[i], hy = H.y[i], hz = H.z[i];
    if (!isLoop[i]) { hx = 0; hy = 1; hz = 0; }
    const dot = hx * tx + hy * ty + hz * tz;
    let ux = hx - tx * dot, uy = hy - ty * dot, uz = hz - tz * dot;
    m = Math.hypot(ux, uy, uz);
    ux /= m; uy /= m; uz /= m;
    let rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    // bank toward the inside of the turn
    const b = isLoop[i] ? 0 : clamp(kH[i] * def.bankFactor, -def.maxBank, def.maxBank);
    if (b !== 0) {
      const cb = Math.cos(b), sb = Math.sin(b);
      const nux = ux * cb + rx * sb, nuy = uy * cb + ry * sb, nuz = uz * cb + rz * sb;
      ux = nux; uy = nuy; uz = nuz;
      rx = ty * uz - tz * uy; ry = tz * ux - tx * uz; rz = tx * uy - ty * ux;
    }
    arr.px[i] = P.x[i]; arr.py[i] = P.y[i]; arr.pz[i] = P.z[i];
    arr.tx[i] = tx; arr.ty[i] = ty; arr.tz[i] = tz;
    arr.ux[i] = ux; arr.uy[i] = uy; arr.uz[i] = uz;
    arr.rx[i] = rx; arr.ry[i] = ry; arr.rz[i] = rz;
  }
  }
  const kl = new Float64Array(n), ku = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n, b = (i + 2) % n;
    const dx = (arr.tx[b] - arr.tx[a]) / (4 * ds);
    const dy = (arr.ty[b] - arr.ty[a]) / (4 * ds);
    const dz = (arr.tz[b] - arr.tz[a]) / (4 * ds);
    kl[i] = dx * arr.rx[i] + dy * arr.ry[i] + dz * arr.rz[i];
    ku[i] = dx * arr.ux[i] + dy * arr.uy[i] + dz * arr.uz[i];
  }
  gaussSmoothClosed(kl, 1.5);
  gaussSmoothClosed(ku, 1.5);
  arr.kLat.set(kl);
  arr.kUp.set(ku);

  const track = new TrackData(def, n, ds, arr, zones);

  // 6) report: min radius, max grade, unwanted self-crossings
  let maxK = 0, maxGrade = 0;
  for (let i = 0; i < n; i++) {
    if (!track.inZone('skywall', i * ds, 12)) {
      maxK = Math.max(maxK, Math.abs(kl[i]));
      const hor = Math.hypot(arr.tx[i], arr.tz[i]);
      maxGrade = Math.max(maxGrade, Math.abs(arr.ty[i]) / Math.max(1e-6, hor));
    }
  }
  const crossings: string[] = [];
  const cell = 24;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i += 2) {
    const key = `${Math.floor(arr.px[i] / cell)},${Math.floor(arr.pz[i] / cell)}`;
    let g = grid.get(key);
    if (!g) grid.set(key, (g = []));
    g.push(i);
  }
  const clear = def.halfWidth * 2 + 3;
  const seen = new Set<string>();
  for (let i = 0; i < n; i += 2) {
    if (isLoop[i]) continue;
    const cx = Math.floor(arr.px[i] / cell), cz = Math.floor(arr.pz[i] / cell);
    for (let ox = -1; ox <= 1; ox++)
      for (let oz = -1; oz <= 1; oz++) {
        const g = grid.get(`${cx + ox},${cz + oz}`);
        if (!g) continue;
        for (const k of g) {
          if (isLoop[k]) continue;
          const sep = Math.abs(track.delta(i * ds, k * ds));
          if (sep < 80) continue;
          const hd = Math.hypot(arr.px[i] - arr.px[k], arr.pz[i] - arr.pz[k]);
          const vd = Math.abs(arr.py[i] - arr.py[k]);
          if (hd < clear && vd < 10) {
            const tag = `${Math.round(Math.min(i, k) * ds / 50) * 50}/${Math.round(Math.max(i, k) * ds / 50) * 50}`;
            if (!seen.has(tag)) {
              seen.add(tag);
              crossings.push(`s=${(i * ds).toFixed(0)} vs s=${(k * ds).toFixed(0)} hd=${hd.toFixed(1)} vd=${vd.toFixed(1)}`);
            }
          }
        }
      }
  }
  return {
    track,
    report: { length: total, minRadius: 1 / Math.max(maxK, 1e-6), maxGrade, crossings, adj: [L1, L2], turnSum },
  };
}
