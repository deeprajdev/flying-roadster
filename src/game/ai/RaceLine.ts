import { clamp } from '../core/math';
import type { TrackData } from '../track/TrackData';

/**
 * Precomputed racing line + safe speed profile, shared by all AI drivers on a track.
 * Line: iterative curvature-minimising relaxation of the lateral offset (cuts apexes,
 * uses the full width). Speed: v = sqrt(aLat / k) along the line, then a backwards braking pass.
 */
export class RaceLine {
  readonly n: number;
  readonly step: number;
  readonly line: Float32Array;   // lateral offset per sample
  readonly vmax: Float32Array;   // safe speed per sample (aLat = 1 units, scale with sqrt)
  readonly curv: Float32Array;   // signed curvature of the line
  private tr: TrackData;

  constructor(tr: TrackData, aLat = 23.5, brake = 25, vCap = 96) {
    this.tr = tr;
    const STEP = 3;
    const n = Math.floor(tr.n / STEP);
    this.n = n;
    this.step = (tr.n * tr.ds) / n;
    const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n);
    const rx = new Float64Array(n), ry = new Float64Array(n), rz = new Float64Array(n);
    const lock = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.min(tr.n - 1, Math.round((i * this.step) / tr.ds));
      cx[i] = tr.px[j]; cy[i] = tr.py[j]; cz[i] = tr.pz[j];
      rx[i] = tr.rx[j]; ry[i] = tr.ry[j]; rz[i] = tr.rz[j];
      lock[i] = tr.inZone('skywall', i * this.step, 30) ? 1 : 0;
    }
    const lim = tr.halfWidth - 2.8;
    const d = new Float64Array(n);
    // relaxation
    for (let it = 0; it < 900; it++) {
      for (let i = 0; i < n; i++) {
        if (lock[i]) {
          d[i] *= 0.8;
          continue;
        }
        const a = (i - 1 + n) % n, b = (i + 1) % n;
        const px = (cx[a] + rx[a] * d[a] + cx[b] + rx[b] * d[b]) / 2 - (cx[i] + rx[i] * d[i]);
        const py = (cy[a] + ry[a] * d[a] + cy[b] + ry[b] * d[b]) / 2 - (cy[i] + ry[i] * d[i]);
        const pz = (cz[a] + rz[a] * d[a] + cz[b] + rz[b] * d[b]) / 2 - (cz[i] + rz[i] * d[i]);
        const lat = px * rx[i] + py * ry[i] + pz * rz[i];
        d[i] = clamp(d[i] + lat * 0.9, -lim, lim);
      }
    }
    // light smoothing
    const sm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += d[(i + k + n) % n];
      sm[i] = acc / 7;
    }
    this.line = Float32Array.from(sm);
    // curvature of the line (in road plane)
    const curv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      const P = (k: number) => [cx[k] + rx[k] * sm[k], cy[k] + ry[k] * sm[k], cz[k] + rz[k] * sm[k]];
      const pa = P(a), pi = P(i), pb = P(b);
      const l1 = Math.hypot(pi[0] - pa[0], pi[1] - pa[1], pi[2] - pa[2]);
      const l2 = Math.hypot(pb[0] - pi[0], pb[1] - pi[1], pb[2] - pi[2]);
      const h = (l1 + l2) / 2;
      const lx = (pa[0] + pb[0] - 2 * pi[0]) / (h * h);
      const ly = (pa[1] + pb[1] - 2 * pi[1]) / (h * h);
      const lz = (pa[2] + pb[2] - 2 * pi[2]) / (h * h);
      curv[i] = lx * rx[i] + ly * ry[i] + lz * rz[i];
    }
    this.curv = curv;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // peak curvature in a small window (protects against noise)
      let k = 0;
      for (let o = -2; o <= 2; o++) k = Math.max(k, Math.abs(curv[(i + o + n) % n]));
      v[i] = Math.min(vCap, Math.sqrt(aLat / Math.max(k, 1e-5)));
      if (lock[i]) v[i] = vCap;
    }
    for (let pass = 0; pass < 2; pass++)
      for (let i = n - 1; i >= 0; i--) {
        const nx = v[(i + 1) % n];
        v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * brake * this.step));
      }
    this.vmax = v;
  }

  private idx(s: number) {
    const L = this.n * this.step;
    return Math.floor((((s % L) + L) % L) / this.step) % this.n;
  }

  lineAt(s: number) {
    const L = this.n * this.step;
    const f = ((((s % L) + L) % L) / this.step);
    const i = Math.floor(f) % this.n;
    const t = f - Math.floor(f);
    return this.line[i] + (this.line[(i + 1) % this.n] - this.line[i]) * t;
  }

  speedAt(s: number) {
    return this.vmax[this.idx(s)];
  }

  /** min safe speed between s and s+range */
  minSpeed(s: number, range: number) {
    let m = Infinity;
    for (let o = 0; o <= range; o += this.step) m = Math.min(m, this.vmax[this.idx(s + o)]);
    return m;
  }

  /** heading change of the centre line over [s, s+len] */
  turnOver(s: number, len: number) {
    const tr = this.tr;
    let a = 0;
    const st = 2;
    for (let o = 0; o < len; o += st) a += tr.kLat[tr.index(s + o)] * st;
    return a;
  }
}
