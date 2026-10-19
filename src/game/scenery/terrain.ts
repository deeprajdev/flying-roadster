import * as THREE from 'three';
import { smoothstep } from '../core/math';
import type { TrackData } from '../track/TrackData';

// ---------- deterministic value noise ----------
function hash2(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
export function ridged(x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const r = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    s += a * r * r;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

export interface TerrainOpts {
  margin: number;   // metres beyond the track bounds
  step: number;     // grid spacing
  falloff: number;  // distance over which terrain blends from road level to natural height
  natural: (x: number, z: number) => number;
  color: (h: number, slope: number, x: number, z: number, out: THREE.Color) => void;
  detail: THREE.Texture;
  roughness?: number;
}

/**
 * Heightfield that hugs the road: near the track it sits just under the road surface
 * (or above tunnels), and blends to the natural height over `falloff` metres.
 */
export function buildTerrain(tr: TrackData, o: TerrainOpts) {
  const b = tr.bounds;
  const x0 = b.minX - o.margin, z0 = b.minZ - o.margin;
  const nx = Math.ceil((b.maxX - b.minX + o.margin * 2) / o.step) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ + o.margin * 2) / o.step) + 1;
  const N = nx * nz;
  const dist = new Float32Array(N).fill(1e9);
  const roadY = new Float32Array(N);
  const hw = tr.halfWidth;
  const R = hw + o.falloff + 4;
  const rc = Math.ceil(R / o.step);
  for (let i = 0; i < tr.n; i += 2) {
    const px = tr.px[i], pz = tr.pz[i];
    const s = i * tr.ds;
    if (tr.inZone('skywall', s)) continue;
    const target = tr.inZone('tunnel', s, -8) ? tr.py[i] + 11 : tr.py[i] - 1.7 - hw * Math.abs(tr.ry[i]);
    const cx = Math.round((px - x0) / o.step), cz = Math.round((pz - z0) / o.step);
    for (let a = -rc; a <= rc; a++) {
      const gx = cx + a;
      if (gx < 0 || gx >= nx) continue;
      for (let c = -rc; c <= rc; c++) {
        const gz = cz + c;
        if (gz < 0 || gz >= nz) continue;
        const k = gz * nx + gx;
        const dx = x0 + gx * o.step - px, dz = z0 + gz * o.step - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < dist[k]) {
          dist[k] = d2;
          roadY[k] = target;
        }
      }
    }
  }
  const h = new Float32Array(N);
  for (let gz = 0; gz < nz; gz++)
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      const x = x0 + gx * o.step, z = z0 + gz * o.step;
      const nat = o.natural(x, z);
      const d = Math.sqrt(dist[k]);
      if (d > R) h[k] = nat;
      else {
        const w = smoothstep(hw + 2.5, hw + 2.5 + o.falloff, d);
        h[k] = roadY[k] + (nat - roadY[k]) * w;
      }
    }

  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2);
  const c = new THREE.Color();
  for (let gz = 0; gz < nz; gz++)
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      const x = x0 + gx * o.step, z = z0 + gz * o.step;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h[k];
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 24;
      uv[k * 2 + 1] = z / 24;
      const hx = h[Math.min(nx - 1, gx + 1) + gz * nx] - h[Math.max(0, gx - 1) + gz * nx];
      const hz = h[gx + Math.min(nz - 1, gz + 1) * nx] - h[gx + Math.max(0, gz - 1) * nx];
      const slope = Math.hypot(hx, hz) / (2 * o.step);
      o.color(h[k], slope, x, z, c);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  const idx: number[] = [];
  for (let gz = 0; gz < nz - 1; gz++)
    for (let gx = 0; gx < nx - 1; gx++) {
      const a = gz * nx + gx, b2 = a + 1, c2 = a + nx, d = c2 + 1;
      idx.push(a, c2, b2, b2, c2, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  o.detail.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: o.detail, roughness: o.roughness ?? 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(g, mat);

  const groundAt = (x: number, z: number) => {
    const fx = (x - x0) / o.step, fz = (z - z0) / o.step;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return o.natural(x, z);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const k = iz * nx + ix;
    const a = h[k], b1 = h[k + 1], c1 = h[k + nx], d1 = h[k + nx + 1];
    return a + (b1 - a) * tx + (c1 - a) * tz + (a - b1 - c1 + d1) * tx * tz;
  };
  /** distance (m) from the nearest track sample, coarse */
  const roadDist = (x: number, z: number) => {
    const gx = Math.round((x - x0) / o.step), gz = Math.round((z - z0) / o.step);
    if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) return 1e9;
    return Math.sqrt(dist[gz * nx + gx]);
  };
  return { mesh, groundAt, roadDist, bounds: { x0, z0, x1: x0 + (nx - 1) * o.step, z1: z0 + (nz - 1) * o.step } };
}

/** Grey detail texture multiplied over vertex colours. */
export function detailTexture(seed: number, contrast = 40) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(220,220,220)';
  g.fillRect(0, 0, 256, 256);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = 220 + (rnd() - 0.5) * contrast * 2;
    g.fillStyle = `rgb(${v},${v},${v})`;
    const r = 1 + rnd() * 2.5;
    g.fillRect(rnd() * 256, rnd() * 256, r, r);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
