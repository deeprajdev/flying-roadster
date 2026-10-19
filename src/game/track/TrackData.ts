import { mod } from '../core/math';
import type { TrackDef, Zone, ZoneTag } from './types';

/** Interpolated road frame at a given distance along the track. */
export interface Frame {
  px: number; py: number; pz: number;
  tx: number; ty: number; tz: number; // tangent (forward)
  ux: number; uy: number; uz: number; // road up (normal)
  rx: number; ry: number; rz: number; // right
  kLat: number; // turn curvature in road plane (+ = turning right)
  kUp: number;  // curvature toward road up (+ = concave, e.g. loop / dip)
}

export const newFrame = (): Frame => ({
  px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0, kLat: 0, kUp: 0,
});

/**
 * Sampled closed circuit. Everything (physics, AI, meshes) works in track space:
 * s = distance along centre line, d = lateral offset (+ right), h = height above road.
 */
export class TrackData {
  readonly n: number;
  readonly ds: number;
  readonly length: number;
  readonly halfWidth: number;
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  readonly tx: Float32Array; readonly ty: Float32Array; readonly tz: Float32Array;
  readonly ux: Float32Array; readonly uy: Float32Array; readonly uz: Float32Array;
  readonly rx: Float32Array; readonly ry: Float32Array; readonly rz: Float32Array;
  readonly kLat: Float32Array;
  readonly kUp: Float32Array;
  readonly zones: Zone[];
  readonly def: TrackDef;
  /** min / max world bounds of the centre line */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };

  constructor(def: TrackDef, n: number, ds: number, arrays: Record<string, Float32Array>, zones: Zone[]) {
    this.def = def;
    this.n = n;
    this.ds = ds;
    this.length = n * ds;
    this.halfWidth = def.halfWidth;
    this.px = arrays.px; this.py = arrays.py; this.pz = arrays.pz;
    this.tx = arrays.tx; this.ty = arrays.ty; this.tz = arrays.tz;
    this.ux = arrays.ux; this.uy = arrays.uy; this.uz = arrays.uz;
    this.rx = arrays.rx; this.ry = arrays.ry; this.rz = arrays.rz;
    this.kLat = arrays.kLat;
    this.kUp = arrays.kUp;
    this.zones = zones;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
      minY = Math.min(minY, this.py[i]); maxY = Math.max(maxY, this.py[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
  }

  wrap(s: number) {
    return mod(s, this.length);
  }

  /** Signed shortest distance from a to b along the loop. */
  delta(a: number, b: number) {
    let d = b - a;
    const L = this.length;
    d = mod(d + L / 2, L) - L / 2;
    return d;
  }

  index(s: number) {
    return mod(Math.floor(s / this.ds), this.n);
  }

  inZone(tag: ZoneTag, s: number, pad = 0): boolean {
    const w = this.wrap(s);
    for (const z of this.zones) {
      if (z.tag !== tag) continue;
      if (w >= z.s0 - pad && w <= z.s1 + pad) return true;
    }
    return false;
  }

  zoneOf(tag: ZoneTag): Zone | undefined {
    return this.zones.find((z) => z.tag === tag);
  }

  /** Linear interpolation of the frame at distance s (writes into `out`). */
  frame(s: number, out: Frame): Frame {
    const n = this.n;
    const f = mod(s, this.length) / this.ds;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);
    const L = (a: Float32Array) => a[i0] + (a[i1] - a[i0]) * t;
    out.px = L(this.px); out.py = L(this.py); out.pz = L(this.pz);
    let x = L(this.tx), y = L(this.ty), z = L(this.tz);
    let m = 1 / Math.hypot(x, y, z);
    out.tx = x * m; out.ty = y * m; out.tz = z * m;
    x = L(this.ux); y = L(this.uy); z = L(this.uz);
    m = 1 / Math.hypot(x, y, z);
    out.ux = x * m; out.uy = y * m; out.uz = z * m;
    // right = T x U (keeps the frame orthonormal after interpolation)
    out.rx = out.ty * out.uz - out.tz * out.uy;
    out.ry = out.tz * out.ux - out.tx * out.uz;
    out.rz = out.tx * out.uy - out.ty * out.ux;
    out.kLat = L(this.kLat);
    out.kUp = L(this.kUp);
    return out;
  }

  /** World position of a track-space point. */
  toWorld(s: number, d: number, h: number, f: Frame, out: { x: number; y: number; z: number }) {
    this.frame(s, f);
    out.x = f.px + f.rx * d + f.ux * h;
    out.y = f.py + f.ry * d + f.uy * h;
    out.z = f.pz + f.rz * d + f.uz * h;
    return out;
  }
}
