import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Hard-surface Roadster body.
 *
 * The body is lofted from cross-sections along Z (nose +Z, up +Y). Each cross-section is split
 * into panels at the character lines (sill, rocker lip, shoulder crease, deck edge). Every panel
 * is its own surface with its own normals, so creases stay crisp while panels stay smooth.
 * The lower profile follows real wheel-arch cut-outs around both axles.
 */

type Key = [number, number];

/** Smooth (cubic Hermite / Catmull-Rom) curve through keys. */
function curve(keys: Key[]) {
  return (z: number) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [z0, v0] = keys[i], [z1, v1] = keys[i + 1];
      if (z > z1) continue;
      const [zm, vm] = i > 0 ? keys[i - 1] : [z0 - (z1 - z0), v0];
      const [zp, vp] = i + 2 < keys.length ? keys[i + 2] : [z1 + (z1 - z0), v1];
      const h = z1 - z0;
      const t = (z - z0) / h;
      const m0 = ((v1 - vm) / (z1 - zm)) * h;
      const m1 = ((vp - v0) / (zp - z0)) * h;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1;
    }
    return keys[keys.length - 1][1];
  };
}

export const Z_REAR = -2.32;
export const Z_FRONT = 2.36;
export const WHEEL_Z = [1.45, -1.45];
export const AXLE_Y = 0.36;
const ARCH_R = 0.445;

const halfW = curve([[-2.32, 0.86], [-2.2, 0.95], [-1.95, 1.0], [-1.45, 1.03], [-0.95, 1.0], [-0.3, 0.955], [0.5, 0.96], [1.0, 0.99], [1.45, 1.01], [1.85, 0.97], [2.15, 0.87], [2.3, 0.7], [2.36, 0.6]]);
const floorY = curve([[-2.32, 0.3], [-2.0, 0.17], [-1.6, 0.14], [1.9, 0.14], [2.2, 0.17], [2.36, 0.2]]);
const sillY = curve([[-2.32, 0.36], [-2.1, 0.3], [2.1, 0.3], [2.36, 0.26]]);
const shoulderY = curve([[-2.32, 0.76], [-2.0, 0.86], [-1.45, 0.9], [-0.95, 0.83], [-0.4, 0.745], [0.4, 0.73], [0.95, 0.8], [1.45, 0.865], [1.85, 0.77], [2.15, 0.6], [2.36, 0.44]]);
const deckY = curve([[-2.32, 0.86], [-2.0, 0.935], [-1.45, 0.955], [-0.95, 0.885], [-0.5, 0.8], [0.5, 0.79], [0.98, 0.855], [1.45, 0.905], [1.85, 0.8], [2.15, 0.635], [2.36, 0.465]]);
const topY = curve([[-2.32, 0.885], [-2.0, 0.915], [-1.55, 0.905], [-1.1, 0.845], [-0.6, 0.775], [0.6, 0.755], [1.1, 0.8], [1.5, 0.825], [1.85, 0.765], [2.15, 0.625], [2.36, 0.475]]);

function archY(z: number) {
  let y = -1;
  for (const zw of WHEEL_Z) {
    const d = z - zw;
    if (Math.abs(d) < ARCH_R) y = Math.max(y, AXLE_Y + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return y;
}

/** Right half control points P0 (bottom centre) … P10 (top centre). */
function halfProfile(z: number): [number, number][] {
  const W = halfW(z), yb = floorY(z), p6y = shoulderY(z);
  const a = archY(z);
  const p4y = Math.min(Math.max(sillY(z), a + 0.035), p6y - 0.09);
  const yLow = Math.min(Math.max(yb + 0.03, a), p4y - 0.03);
  const p5y = (p4y + p6y) / 2 + 0.015;
  const p8y = Math.max(deckY(z), p6y + 0.035);
  const p7y = (p6y + p8y) / 2;
  const p10y = topY(z);
  const p9y = p10y + (p8y - p10y) * 0.42 + 0.006;
  return [
    [0, yb],                                   // 0 floor centre
    [W * 0.64, yb],                            // 1 floor edge
    [W * 0.64, Math.max(yLow, yb + 0.03)],     // 2 wheel-well inner wall top
    [W * 0.95, Math.max(yLow, yb + 0.06)],     // 3 sill underside / arch edge
    [W * 0.985, p4y],                          // 4 rocker crease / arch lip
    [W * 1.006, p5y],                          // 5 door
    [W * 1.0, p6y],                            // 6 shoulder crease
    [W * 0.955, p7y],                          // 7 tumblehome
    [W * 0.86, p8y],                           // 8 deck-edge crease
    [W * 0.44, p9y],                           // 9 hood / deck
    [0, p10y],                                 // 10 top centre
  ];
}

export type PanelMat = 'paint' | 'trim' | 'dark';
interface Seg { pts: number[]; side: 1 | -1 | 0; mat: PanelMat; sub: number }

// Panels around the section, counter-clockwise seen from the front.
// side 0 = spans the centre line (indices refer to the right half; mirrored points use negative index).
const SEGS: Seg[] = [
  { pts: [-1, 0, 1], side: 0, mat: 'dark', sub: 1 },
  { pts: [1, 2], side: 1, mat: 'dark', sub: 1 },
  { pts: [2, 3], side: 1, mat: 'dark', sub: 1 },
  { pts: [3, 4], side: 1, mat: 'trim', sub: 2 },
  { pts: [4, 5, 6], side: 1, mat: 'paint', sub: 4 },
  { pts: [6, 7, 8], side: 1, mat: 'paint', sub: 3 },
  { pts: [8, 9, 10, -9, -8], side: 0, mat: 'paint', sub: 5 },
  { pts: [8, 7, 6], side: -1, mat: 'paint', sub: 3 },
  { pts: [6, 5, 4], side: -1, mat: 'paint', sub: 4 },
  { pts: [4, 3], side: -1, mat: 'trim', sub: 2 },
  { pts: [3, 2], side: -1, mat: 'dark', sub: 1 },
  { pts: [2, 1], side: -1, mat: 'dark', sub: 1 },
];

function ctrl(prof: [number, number][], idx: number, side: number): [number, number] {
  if (side === -1) return [-prof[idx][0], prof[idx][1]];
  if (idx < 0) return [-prof[-idx][0], prof[-idx][1]];
  return prof[idx];
}

/** Dense polyline for one panel at station z (Catmull-Rom through its control points). */
function segPolyline(z: number, seg: Seg): [number, number][] {
  const prof = halfProfile(z);
  const c = seg.pts.map((i) => ctrl(prof, i, seg.side));
  const n = c.length;
  if (n === 2 && seg.sub <= 1) return c;
  const P = (i: number): [number, number] => {
    if (i < 0) return [2 * c[0][0] - c[1][0], 2 * c[0][1] - c[1][1]];
    if (i >= n) return [2 * c[n - 1][0] - c[n - 2][0], 2 * c[n - 1][1] - c[n - 2][1]];
    return c[i];
  };
  const out: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < seg.sub; k++) {
      const t = k / seg.sub, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(c[n - 1]);
  return out;
}

function stations() {
  const zs = new Set<number>();
  const N = 84;
  for (let i = 0; i <= N; i++) zs.add(Z_REAR + ((Z_FRONT - Z_REAR) * i) / N);
  for (const zw of WHEEL_Z) {
    for (let z = zw - ARCH_R; z <= zw + ARCH_R; z += 0.028) zs.add(z);
    for (const e of [-ARCH_R - 0.003, -ARCH_R + 0.003, ARCH_R - 0.003, ARCH_R + 0.003]) zs.add(zw + e);
  }
  const arr = [...zs].filter((z) => z >= Z_REAR && z <= Z_FRONT).sort((a, b) => a - b);
  const out: number[] = [];
  for (const z of arr) if (!out.length || z - out[out.length - 1] > 0.002) out.push(z);
  return out;
}

function gridFromPolylines(rows: [number, number][][], zs: number[]) {
  const m = rows[0].length;
  const pos = new Float32Array(rows.length * m * 3);
  rows.forEach((row, i) => row.forEach(([x, y], k) => pos.set([x, y, zs[i]], (i * m + k) * 3)));
  const idx: number[] = [];
  for (let i = 0; i < rows.length - 1; i++)
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Full section outline at z (for the end caps and the tail light). */
function fullRing(z: number) {
  const pts: [number, number][] = [];
  for (const seg of SEGS) {
    const pl = segPolyline(z, seg);
    for (let i = 0; i < pl.length - 1; i++) pts.push(pl[i]);
  }
  return pts;
}

function cap(z: number, facing: 1 | -1) {
  const ring = fullRing(z);
  const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = new Float32Array(contour.length * 3);
  contour.forEach((p, i) => pos.set([p.x, p.y, z], i * 3));
  const idx: number[] = [];
  for (const [a, b, c] of tris) facing > 0 ? idx.push(a, b, c) : idx.push(a, c, b);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ details on the surface
/** Point + outward normal on a panel at station z and normalised position t (0..1) along it. */
function onPanel(z: number, segIndex: number, t: number) {
  const pl = segPolyline(z, SEGS[segIndex]);
  const L: number[] = [0];
  for (let i = 1; i < pl.length; i++) L.push(L[i - 1] + Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]));
  const target = t * L[L.length - 1];
  let i = 1;
  while (i < pl.length - 1 && L[i] < target) i++;
  const f = (target - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
  const x = pl[i - 1][0] + (pl[i][0] - pl[i - 1][0]) * f, y = pl[i - 1][1] + (pl[i][1] - pl[i - 1][1]) * f;
  const tx = pl[i][0] - pl[i - 1][0], ty = pl[i][1] - pl[i - 1][1];
  const tl = Math.hypot(tx, ty) || 1;
  // outward normal = ring tangent × Z  →  (ty, -tx)
  return { p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(ty / tl, -tx / tl, 0), tan: new THREE.Vector3(tx / tl, ty / tl, 0) };
}

/** Thin strip across a panel at constant z (panel gaps). */
function gapAcross(z: number, segs: number[], halfW = 0.0045, lift = 0.0022) {
  const pos: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const si of segs) {
    const pl = segPolyline(z, SEGS[si]);
    for (let i = 0; i < pl.length; i++) {
      const prev = pl[Math.max(0, i - 1)], next = pl[Math.min(pl.length - 1, i + 1)];
      const tx = next[0] - prev[0], ty = next[1] - prev[1], tl = Math.hypot(tx, ty) || 1;
      const nx = ty / tl, ny = -tx / tl;
      const x = pl[i][0] + nx * lift, y = pl[i][1] + ny * lift;
      pos.push(x, y, z - halfW, x, y, z + halfW);
    }
    for (let i = 0; i < pl.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    base += pl.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Patch on a panel between t0(z)..t1(z) for z in [za, zb] (scoops, headlight housings). */
function patch(segIndex: number, za: number, zb: number, band: (u: number) => [number, number], lift = 0.003, nz = 18, nt = 6) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nz; i++) {
    const u = i / nz;
    const z = za + (zb - za) * u;
    const [t0, t1] = band(u);
    for (let k = 0; k <= nt; k++) {
      const s = onPanel(z, segIndex, t0 + ((t1 - t0) * k) / nt);
      pos.push(s.p.x + s.n.x * lift, s.p.y + s.n.y * lift, s.p.z);
    }
  }
  const m = nt + 1;
  // t runs along the panel's own direction, so the winding matches the body surface
  for (let i = 0; i < nz; i++)
    for (let k = 0; k < nt; k++) {
      const a = i * m + k, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Strip that runs along Z at a fixed position t on a panel (LED light lines). */
function lineAlong(segIndex: number, za: number, zb: number, t: (u: number) => number, width = 0.012, lift = 0.0045, nz = 24) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nz; i++) {
    const u = i / nz;
    const z = za + (zb - za) * u;
    const s = onPanel(z, segIndex, t(u));
    const p = s.p.clone().addScaledVector(s.n, lift);
    pos.push(...p.clone().addScaledVector(s.tan, -width / 2).toArray(), ...p.clone().addScaledVector(s.tan, width / 2).toArray());
  }
  for (let i = 0; i < nz; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** One merged geometry per material, so a whole car body is a handful of draw calls. */
export interface BodyGeos {
  paint: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;      // gloss black: sills, arch lips, scoops, headlight housings, nose, rear fascia, mirror glass
  dark: THREE.BufferGeometry;      // matte black: underside, wheel wells, nose intake
  carbon: THREE.BufferGeometry;    // splitter, diffuser, mirror caps and stalks
  gaps: THREE.BufferGeometry;      // panel shut lines
  head: THREE.BufferGeometry;      // LED headlight slashes
  tail: THREE.BufferGeometry;      // full-width tail light
  accent: THREE.BufferGeometry;    // thin glowing line along the rocker crease
}

/** Position + normal only, always indexed, so parts from different builders merge cleanly. */
export function prep(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
  if (m) g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
  g.clearGroups();
  return g;
}

let CACHE: BodyGeos | null = null;

export function bodyGeometries(): BodyGeos {
  if (CACHE) return CACHE;
  const zs = stations();
  const byMat: Record<PanelMat, THREE.BufferGeometry[]> = { paint: [], trim: [], dark: [] };
  for (const seg of SEGS) {
    const rows = zs.map((z) => segPolyline(z, seg));
    byMat[seg.mat].push(gridFromPolylines(rows, zs));
  }
  // side scoops ahead of the rear wheels (panel 4 = right side, 8 = left side; t runs bottom→top / top→bottom)
  const scoopR = patch(4, -0.98, -0.42, (u) => {
    const w = Math.pow(1 - u, 0.8);
    return [0.5 - 0.32 * w, 0.62 + 0.22 * w];
  });
  const scoopL = patch(8, -0.98, -0.42, (u) => {
    const w = Math.pow(1 - u, 0.8);
    return [1 - (0.62 + 0.22 * w), 1 - (0.5 - 0.32 * w)];
  });
  // headlight housings on the upper side panels near the nose (5 = right, 7 = left)
  const lampR = patch(5, 1.84, 2.27, (u) => [0.15 + 0.45 * u, 0.98]);
  const lampL = patch(7, 1.84, 2.27, (u) => [0.02, 0.85 - 0.45 * u]);
  byMat.paint.push(cap(Z_REAR, -1));
  // gloss-black rear fascia band (the rear jets fire through it)
  const rearBand = new THREE.PlaneGeometry(1.46, 0.17);
  rearBand.rotateY(Math.PI);
  rearBand.translate(0, 0.42, Z_REAR - 0.004);
  rearBand.deleteAttribute('uv');
  byMat.trim.push(scoopR, scoopL, lampR, lampL, rearBand);

  const gaps = mergeGeometries([
    gapAcross(0.985, [4, 5]), gapAcross(-0.74, [4, 5]), // right door
    gapAcross(0.985, [7, 8]), gapAcross(-0.74, [7, 8]), // left door
    gapAcross(1.1, [6]),                               // hood shut line
    gapAcross(-1.2, [6]),                              // rear deck lid
  ])!;
  const head = mergeGeometries([
    lineAlong(5, 1.86, 2.25, (u) => 0.9 - 0.05 * u, 0.016),
    lineAlong(5, 1.95, 2.18, (u) => 0.55 + 0.25 * u, 0.01),
    lineAlong(7, 1.86, 2.25, (u) => 0.1 + 0.05 * u, 0.016),
    lineAlong(7, 1.95, 2.18, (u) => 0.45 - 0.25 * u, 0.01),
  ])!;
  // tail light: a thin bar across the rear face following the top of the section
  const tailPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 40; i++) {
    const s = onPanel(Z_REAR, 6, i / 40);
    tailPts.push(new THREE.Vector2(s.p.x, s.p.y));
  }
  const tailPos: number[] = [];
  const tailIdx: number[] = [];
  tailPts.forEach((p, i) => {
    tailPos.push(p.x * 0.985, p.y - 0.035, Z_REAR - 0.003, p.x * 0.985, p.y - 0.068, Z_REAR - 0.003);
    if (i < tailPts.length - 1) tailIdx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  });
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute(tailPos, 3));
  tail.setIndex(tailIdx);
  tail.computeVertexNormals();

  // front splitter: a flat blade with a crisp edge, following the nose outline
  const sp = new THREE.Shape();
  const outline: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const z = 2.0 + (Z_FRONT + 0.035 - 2.0) * (i / 16);
    outline.push([halfW(Math.min(z, Z_FRONT)) * 0.97, z]);
  }
  sp.moveTo(-outline[0][0], outline[0][1]);
  for (const [x, z] of outline) sp.lineTo(-x, z);
  for (let i = outline.length - 1; i >= 0; i--) sp.lineTo(outline[i][0], outline[i][1]);
  const splitter = new THREE.ExtrudeGeometry(sp, { depth: 0.018, bevelEnabled: false });
  splitter.rotateX(Math.PI / 2);
  splitter.translate(0, 0.168, 0);

  const finParts = [-0.48, -0.24, 0, 0.24, 0.48].map((x) => {
    const b = new THREE.BoxGeometry(0.012, 0.09, 0.3);
    b.translate(x, 0.27, Z_REAR + 0.15);
    return b;
  });
  // diffuser plate under the tail
  const plate = new THREE.BoxGeometry(1.3, 0.012, 0.32);
  plate.translate(0, 0.226, Z_REAR + 0.16);
  const fins = mergeGeometries([...finParts, plate])!;
  // mirror: a crisp wedge with a small bevel
  const ms = new THREE.Shape();
  ms.moveTo(-0.085, -0.05);
  ms.lineTo(0.085, -0.05);
  ms.lineTo(0.06, 0.07);
  ms.lineTo(-0.04, 0.07);
  ms.closePath();
  const mirror = new THREE.ExtrudeGeometry(ms, { depth: 0.05, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 4 });
  mirror.rotateX(Math.PI / 2); // shape y → +z (forward), extrude → down
  mirror.translate(0, 0.03, 0);
  const mirrorFace = new THREE.BoxGeometry(0.15, 0.05, 0.008);
  const stalk = new THREE.BoxGeometry(0.13, 0.022, 0.045);
  const accent = mergeGeometries([
    lineAlong(4, -0.92, 0.94, () => 0.04, 0.012, 0.004, 40),
    lineAlong(8, -0.92, 0.94, () => 0.96, 0.012, 0.004, 40),
  ])!;
  const intake = new THREE.BoxGeometry(0.86, 0.06, 0.03);
  intake.translate(0, 0.27, Z_FRONT - 0.005);
  // side mirrors (baked into the body geometry)
  const mm = mirrorMount();
  const M = (x: number, y: number, z: number, ry = 0, rz = 0, sx = 1) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(sx, 1, 1));
  const carbonParts: THREE.BufferGeometry[] = [prep(splitter), prep(fins)];
  const mirrorGlass: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    carbonParts.push(prep(mirror.clone(), M(sx * mm.x, mm.y, mm.z, sx * 0.12)));
    carbonParts.push(prep(stalk.clone(), M(sx * (mm.x - 0.08), mm.y - 0.05, mm.z + 0.02, 0, sx * -0.5)));
    mirrorGlass.push(prep(mirrorFace.clone(), M(sx * mm.x, mm.y, mm.z - 0.06)));
  }
  CACHE = {
    paint: mergeGeometries(byMat.paint.map((g) => prep(g)))!,
    trim: mergeGeometries([...byMat.trim.map((g) => prep(g)), prep(cap(Z_FRONT, 1)), ...mirrorGlass])!,
    dark: mergeGeometries([...byMat.dark.map((g) => prep(g)), prep(intake)])!,
    carbon: mergeGeometries(carbonParts)!,
    gaps, head, tail, accent,
  };
  return CACHE;
}

/** Where to mount the side mirrors (right side; mirror x for the left). */
export function mirrorMount() {
  const z = 0.66;
  const s = onPanel(z, 5, 0.95);
  return new THREE.Vector3(s.p.x + 0.06, s.p.y + 0.11, z);
}
