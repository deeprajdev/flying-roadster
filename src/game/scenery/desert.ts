import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/math';
import type { TrackData } from '../track/TrackData';
import type { Theme } from '../track/themes';
import { buildTerrain, detailTexture, fbm, ridged } from './terrain';
import { buildLights, type LightPoint } from './skyline';
import { VIEW } from '../device';

/** Desert Run: red-rock massif with switchbacks, canyon walls, dunes, mesas and cacti. */
export function buildDesert(tr: TrackData, theme: Theme) {
  const group = new THREE.Group();
  const b = tr.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  // locate the switchback massif (highest part of the track) and the canyon (south band)
  let mx = 0, mz = 0, my = -1;
  for (let i = 0; i < tr.n; i += 4) if (tr.py[i] > my) { my = tr.py[i]; mx = tr.px[i]; mz = tr.pz[i]; }
  const canyonZ = b.maxZ - 60;

  const natural = (x: number, z: number) => {
    let h = 3 * fbm(x / 70, z / 70) + 2;
    // massif: road switchbacks climb its flank
    const dx = (x - mx) / 340, dz = (z - mz) / 300;
    const r2 = dx * dx + dz * dz;
    if (r2 < 1) h += 62 * (1 - r2) * (1 - r2) * (0.85 + 0.3 * fbm(x / 60, z / 60));
    // canyon walls along the southern descent
    const cw = smoothstep(canyonZ - 150, canyonZ - 70, z) * (1 - smoothstep(canyonZ + 220, canyonZ + 340, z));
    h += cw * (28 + 38 * ridged(x / 110, z / 110));
    // distant mountain ring
    const rr = Math.hypot(x - cx, z - cz);
    h += smoothstep(700, 1500, rr) * (70 + 110 * ridged(x / 380, z / 380));
    return h;
  };
  const color = (h: number, slope: number, _x: number, _z: number, out: THREE.Color) => {
    const sand = [0.82, 0.62, 0.42];
    const rock = [0.6, 0.33, 0.21];
    const dark = [0.42, 0.22, 0.15];
    const band = 0.5 + 0.5 * Math.sin(h * 0.55);
    const r = smoothstep(0.35, 0.8, slope) * 0.85 + smoothstep(25, 60, h) * 0.3;
    const k = Math.min(1, r);
    const rk = [rock[0] + (dark[0] - rock[0]) * band * 0.5, rock[1] + (dark[1] - rock[1]) * band * 0.5, rock[2] + (dark[2] - rock[2]) * band * 0.5];
    out.setRGB(sand[0] + (rk[0] - sand[0]) * k, sand[1] + (rk[1] - sand[1]) * k, sand[2] + (rk[2] - sand[2]) * k);
  };
  const terrain = buildTerrain(tr, { margin: 900, step: 8, falloff: 26, natural, color, detail: detailTexture(7, 46) });
  terrain.mesh.userData.shadow = 'receive';
  group.add(terrain.mesh);

  const rnd = mulberry32(42);
  const place = (count: number, minRoad: number, fn: (x: number, y: number, z: number, i: number) => void) => {
    let n = 0, tries = 0;
    while (n < count && tries < count * 20) {
      tries++;
      const x = terrain.bounds.x0 + rnd() * (terrain.bounds.x1 - terrain.bounds.x0);
      const z = terrain.bounds.z0 + rnd() * (terrain.bounds.z1 - terrain.bounds.z0);
      if (terrain.roadDist(x, z) < minRoad) continue;
      fn(x, terrain.groundAt(x, z), z, n++);
    }
  };

  // boulders
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a5038, roughness: 0.95, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 420);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  place(420, 16, (x, y, z, i) => {
    const s = 0.8 + rnd() * rnd() * 7;
    q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3));
    m.compose(new THREE.Vector3(x, y + s * 0.2, z), q, new THREE.Vector3(s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.4), s));
    rocks.setMatrixAt(i, m);
  });
  rocks.userData.shadow = 'cast';
  group.add(rocks);

  // saguaro cacti
  const trunk = new THREE.CylinderGeometry(0.32, 0.38, 1, 8);
  trunk.translate(0, 0.5, 0);
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.8 });
  const cactiT = new THREE.InstancedMesh(trunk, cactusMat, 520);
  let ci = 0;
  place(170, 14, (x, y, z) => {
    if (y > 30) return;
    const h = 3 + rnd() * 4;
    m.compose(new THREE.Vector3(x, y - 0.2, z), q.identity(), new THREE.Vector3(1, h, 1));
    cactiT.setMatrixAt(ci++, m);
    const arms = Math.floor(rnd() * 3);
    for (let a = 0; a < arms && ci < 518; a++) {
      const side = a === 0 ? 1 : -1;
      const ah = h * (0.35 + rnd() * 0.3);
      // horizontal stub + vertical arm
      q.setFromEuler(e.set(0, rnd() * 6, side * Math.PI / 2));
      m.compose(new THREE.Vector3(x, y + ah, z), q, new THREE.Vector3(0.7, 0.9, 0.7));
      cactiT.setMatrixAt(ci++, m);
      const ang = e.y;
      const ox = Math.cos(ang) * 0.85 * -side, oz = Math.sin(ang) * 0.85 * side;
      m.compose(new THREE.Vector3(x + ox, y + ah, z + oz), q.identity(), new THREE.Vector3(0.75, h * 0.35, 0.75));
      cactiT.setMatrixAt(ci++, m);
    }
  });
  cactiT.count = ci;
  cactiT.userData.shadow = 'cast';
  group.add(cactiT);

  // mesas on the horizon
  const mesaMat = new THREE.MeshStandardMaterial({ color: 0xa9603e, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
    const r = 1700 + rnd() * 700;
    const rad = 120 + rnd() * 160;
    const hgt = 90 + rnd() * 120;
    const geo = new THREE.CylinderGeometry(rad * 0.82, rad, hgt, 9, 3);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const n = 0.85 + 0.3 * fbm(p.getX(k) / 40 + i, p.getZ(k) / 40 + p.getY(k) / 60);
      p.setX(k, p.getX(k) * n);
      p.setZ(k, p.getZ(k) * n);
    }
    geo.computeVertexNormals();
    const mesa = new THREE.Mesh(geo, mesaMat);
    mesa.position.set(cx + Math.cos(a) * r, hgt / 2 + 20, cz + Math.sin(a) * r);
    group.add(mesa);
  }

  // drifting dust haze sprites near the ground
  // ---------- night: a distant town on the plain and radio masts with beacons ----------
  let lights: ReturnType<typeof buildLights> | null = null;
  if (theme.night) {
    const pts: LightPoint[] = [];
    const tx = cx - 1500, tz = cz + 1200;
    for (let i = 0; i < 420; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 380;
      const x = tx + Math.cos(a) * r * 1.6, z = tz + Math.sin(a) * r;
      pts.push({ x, y: terrain.groundAt(x, z) + 2 + rnd() * 6, z, color: rnd() < 0.75 ? [1, 0.68, 0.36] : [0.9, 0.92, 1], size: 1.8 + rnd() * 1.6, phase: -1 });
    }
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const a = 0.6 + i * 1.4, r = 1200 + rnd() * 400;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = terrain.groundAt(x, z);
      const hgt = 80 + rnd() * 60;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, hgt, 4), mastMat);
      mast.position.set(x, y + hgt / 2, z);
      group.add(mast);
      for (const f of [0.5, 1]) pts.push({ x, y: y + hgt * f + 1, z, color: [1, 0.1, 0.05], size: 4, phase: rnd() });
    }
    lights = buildLights(pts, theme.fogDensity * 0.45);
    group.add(lights.pts);
  }

  return {
    group,
    update(t: number) {
      if (lights) {
        lights.mat.uniforms.uTime.value = t;
        lights.mat.uniforms.uViewH.value = VIEW.h;
      }
    },
    groundAt: terrain.groundAt,
  };
}
