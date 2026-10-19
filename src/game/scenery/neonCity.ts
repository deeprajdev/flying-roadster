import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { IS_TOUCH, VIEW } from '../device';
import { newFrame, type TrackData } from '../track/TrackData';
import type { Theme } from '../track/themes';
import { groundCityTexture, signTexture } from '../track/textures';
import { frameMatrix, hdr } from '../track/TrackMesh';
import { Clearance } from './common';
import {
  S, TowerKit, bayWater, buildLights, buildParts, searchlight, skylineMaterial, type LightPoint, type Part, type SkyLight,
} from './skyline';

const SIGNS: [string, string, string?][] = [
  ['SPACE X10', '#19e0ff', 'COLD-GAS THRUSTERS'],
  ['ROADSTER', '#ff2bd6', '0-100 IN 1.1 s'],
  ['MARS EXPRESS', '#ffb02e', 'NEXT DEPARTURE 21:40'],
  ['NEON CITY', '#8a5cff', 'GRAND PRIX'],
  ['BOOST', '#2bff9c', 'HOLD SHIFT'],
  ['SKYWALL', '#ff3b3b', 'DON’T LIFT'],
  ['ORBITAL', '#19e0ff', 'NIGHT MARKET'],
  ['HYPERLOOP', '#ff2bd6', 'GATE 7'],
];

/**
 * Neon City: a night-time megacity mixing Manhattan and San Francisco.
 * The start straight runs along the waterfront; across the bay are a lit suspension bridge
 * and a second skyline. Downtown clusters hold the supertalls.
 */
export function buildNeonCity(tr: TrackData, theme: Theme, envMap: THREE.Texture | null) {
  const group = new THREE.Group();
  const rnd = mulberry32(1234);
  const b = tr.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const fogC = new THREE.Color(theme.fogColor);
  const skyTop = new THREE.Color(theme.skyTop);
  const skyHz = new THREE.Color(theme.skyHorizon);
  const D = theme.fogDensity;
  const SHORE = b.minZ - 60;          // waterfront line north of the start straight
  const FAR_SHORE = SHORE - 1420;
  const CITY_N = b.minZ - 22;         // no buildings north of this (keeps the bay view open)
  const BRIDGE_X = b.maxX + 370;
  const day = !theme.night;
  const L: SkyLight = {
    day,
    sunDir: new THREE.Vector3(...theme.sunDir).normalize(),
    sun: new THREE.Color(theme.sunColor).multiplyScalar(day ? theme.sunIntensity * 0.42 : 0),
    ambSky: new THREE.Color(theme.hemiSky).multiplyScalar(theme.hemiIntensity * 0.42),
    ambGround: new THREE.Color(theme.hemiGround).multiplyScalar(theme.hemiIntensity * 0.42),
  };

  // ---------- ground ----------
  const gt = groundCityTexture(false, day ? [74, 75, 78] : [12, 13, 20]);
  gt.repeat.set(60, 60);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 7000),
    new THREE.MeshStandardMaterial({ map: gt, roughness: 0.6, metalness: 0.15, envMap, envMapIntensity: 0.3 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.05, (b.minZ + b.maxZ) / 2 - 600);
  ground.userData.shadow = 'receive';
  group.add(ground);

  // ---------- city grid ----------
  const clear = new Clearance(6);
  clear.markTrack(tr, tr.halfWidth + 13);
  const kit = new TowerKit(rnd);
  const LOT = 36;
  const x0 = b.minX - 650, x1 = b.maxX + 650;
  const z0 = CITY_N, z1 = b.maxZ + 650;
  const clusters: [number, number, number][] = [
    [cx + 180, b.maxZ + 330, 420],   // midtown, south of the circuit
    [b.minX - 260, 250, 380],        // financial district, west
    [b.maxX + 300, 110, 300],        // waterfront towers ahead of the start straight
    [cx - 60, 230, 160],             // a few inside the infield
  ];
  const coreAt = (x: number, z: number) => {
    let c = 0;
    for (const [qx, qz, r] of clusters) c = Math.max(c, 1 - Math.hypot(x - qx, z - qz) / r);
    return Math.max(0, c);
  };
  // landmarks first so they get the best lots
  const landmark = (fn: (x: number, z: number) => void, x: number, z: number, half: number) => {
    for (let k = 0; k < 40; k++) {
      const px = x + (rnd() - 0.5) * 140, pz = z + (rnd() - 0.5) * 140;
      if (pz - half > CITY_N && clear.free(px, pz, half + 2)) {
        fn(px, pz);
        return [px, pz];
      }
    }
    return null;
  };
  const taken: [number, number, number][] = [];
  const lp = landmark((x, z) => kit.pyramid(x, z, 46, 262), b.minX - 230, 260, 30);
  if (lp) taken.push([lp[0], lp[1], 40]);
  const le = landmark((x, z) => kit.deco(x, z, 44, 400), cx + 180, b.maxZ + 300, 26);
  if (le) taken.push([le[0], le[1], 36]);
  const lw = landmark((x, z) => kit.glass(x, z, 30, 30, 430), b.maxX + 330, 120, 24);
  if (lw) taken.push([lw[0], lw[1], 36]);
  const lr = landmark((x, z) => kit.round(x, z, 40, 330), b.minX - 140, 420, 22);
  if (lr) taken.push([lr[0], lr[1], 32]);

  for (let x = x0; x <= x1; x += LOT)
    for (let z = z0 + LOT / 2; z <= z1; z += LOT) {
      if (rnd() < 0.08) continue; // the odd plaza / park
      if (Math.abs(x - BRIDGE_X) < 40 && z < 140) continue; // bridge approach
      if (taken.some(([tx, tz, r]) => Math.abs(x - tx) < r && Math.abs(z - tz) < r)) continue;
      const half = LOT * 0.44;
      if (!clear.free(x, z, half)) {
        // squeeze a smaller building in if the lot only touches the track buffer
        if (clear.free(x, z, half * 0.55) && rnd() < 0.6) kit.midrise(x, z, LOT * 0.45, LOT * 0.45, 10 + rnd() * 26);
        continue;
      }
      kit.random(x, z, LOT * 0.86, coreAt(x, z));
    }
  const near = kit.parts;
  const nearMat = skylineMaterial(fogC, D, skyTop, skyHz, L);
  const nearMeshes = buildParts(near, nearMat);
  nearMeshes.traverse((o) => {
    o.userData.shadow = 'cast';
    o.userData.heavy = true;
  });
  group.add(nearMeshes);

  // ---------- far skylines: across the bay + around the horizon ----------
  const far = new TowerKit(mulberry32(77));
  const farStep = IS_TOUCH ? 70 : 52;
  for (let x = cx - 1700; x <= cx + 1900; x += farStep)
    for (let z = FAR_SHORE - 60; z >= FAR_SHORE - 900; z -= farStep) {
      if (rnd() < 0.35) continue;
      const core = Math.max(0, 1 - Math.hypot(x - (cx + 250), z - (FAR_SHORE - 300)) / 900);
      far.random(x + (rnd() - 0.5) * 12, z + (rnd() - 0.5) * 12, farStep * 0.75, 0.25 + core * 0.9);
    }
  const ringN = IS_TOUCH ? 140 : 240;
  for (let i = 0; i < ringN; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1500 + rnd() * 900;
    const x = cx + Math.cos(a) * r, z = (b.minZ + b.maxZ) / 2 + Math.sin(a) * r;
    if (z < CITY_N - 100) continue; // the bay side has its own skyline
    far.random(x, z, 50, 0.4 + rnd() * 0.6);
  }
  const farMat = skylineMaterial(fogC, D * 0.42, skyTop, skyHz, L);
  group.add(buildParts(far.parts, farMat));

  // ---------- the bay ----------
  const waterMat = bayWater(fogC, D * 0.6, skyHz, skyTop, L);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, SHORE - FAR_SHORE), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, 0.15, (SHORE + FAR_SHORE) / 2);
  group.add(water);
  const shoreParts: Part[] = [];
  const P = (p: Omit<Part, 'seed'>) => shoreParts.push({ seed: rnd(), ...p });
  P({ geo: 'box', x: cx, y: -2, z: SHORE, sx: 9000, sy: 3.4, sz: 4, style: S.PLAIN, top: 1, lit: 0, color: 0x3a3a46 });
  P({ geo: 'box', x: cx, y: 1.25, z: SHORE + 1.6, sx: 9000, sy: 0.25, sz: 0.3, style: S.CROWN, top: 2, lit: 0, color: 0x2fd8ff });

  // ---------- suspension bridge across the bay ----------
  const lights: LightPoint[] = [];
  const beaconLights: LightPoint[] = [];
  {
    const bz0 = SHORE, bz1 = FAR_SHORE;
    const zt1 = bz0 - 300, zt2 = bz1 + 300;
    const deckY = 48, topY = 176;
    const ORANGE = 0xd0482c;
    // towers
    for (const zt of [zt1, zt2]) {
      for (const sx of [-1, 1]) P({ geo: 'box', x: BRIDGE_X + sx * 16, y: -6, z: zt, sx: 8, sy: topY + 6, sz: 10, style: S.STEEL, top: topY, lit: 0, color: ORANGE });
      for (const sy of [deckY - 6, 96, 136, topY - 8]) P({ geo: 'box', x: BRIDGE_X, y: sy, z: zt, sx: 32, sy: 5, sz: 7, style: S.STEEL, top: topY, lit: 0, color: ORANGE });
      for (const sx of [-1, 1]) beaconLights.push({ x: BRIDGE_X + sx * 16, y: topY + 1.5, z: zt, color: [1, 0.12, 0.05], size: 3, phase: rnd() });
    }
    // anchorages + deck + truss
    for (const zz of [bz0 - 20, bz1 + 20]) P({ geo: 'box', x: BRIDGE_X, y: -2, z: zz, sx: 46, sy: deckY + 6, sz: 40, style: S.STEEL, top: deckY, lit: 0, color: 0x6a3a2c });
    P({ geo: 'box', x: BRIDGE_X, y: deckY - 4, z: (bz0 + bz1) / 2, sx: 30, sy: 4, sz: bz0 - bz1, style: S.PLAIN, top: deckY, lit: 0, color: 0x2a2a32 });
    P({ geo: 'box', x: BRIDGE_X, y: deckY - 7, z: (bz0 + bz1) / 2, sx: 30.6, sy: 3, sz: bz0 - bz1, style: S.STEEL, top: deckY, lit: 0, color: ORANGE });
    // cable profile
    const half = (zt1 - zt2) / 2, zm = (zt1 + zt2) / 2;
    const cableY = (z: number) => {
      if (z > zt1) return deckY + 3 + (topY - 3 - deckY - 3) * (1 - (z - zt1) / (bz0 - zt1)) ** 1.15;
      if (z < zt2) return deckY + 3 + (topY - 3 - deckY - 3) * (1 - (zt2 - z) / (zt2 - bz1)) ** 1.15;
      const t = (z - zm) / half;
      return deckY + 4 + (topY - 3 - deckY - 4) * t * t;
    };
    for (const sx of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let z = bz0; z >= bz1; z -= 10) pts.push(new THREE.Vector3(BRIDGE_X + sx * 14, cableY(z), z));
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 260, 0.8, 6, false);
      const st = new Float32Array([S.STEEL, rnd(), topY, 0]);
      tube.setAttribute('aStyle', new THREE.InstancedBufferAttribute(st, 4));
      const cm = new THREE.InstancedMesh(tube, nearMat, 1);
      cm.setMatrixAt(0, new THREE.Matrix4());
      cm.setColorAt(0, new THREE.Color(ORANGE));
      cm.frustumCulled = false;
      group.add(cm);
      // suspenders + LED cable lights
      for (let z = bz0 - 15; z > bz1 + 15; z -= 15) {
        const cy = cableY(z);
        if (cy - deckY > 2) P({ geo: 'box', x: BRIDGE_X + sx * 14, y: deckY, z, sx: 0.35, sy: cy - deckY, sz: 0.35, style: S.STEEL, top: topY, lit: 0, color: ORANGE });
      }
      for (let z = bz0; z >= bz1; z -= 9) lights.push({ x: BRIDGE_X + sx * 14, y: cableY(z) + 1, z, color: [0.85, 0.92, 1.0], size: 1.4, phase: -1 });
      for (let z = bz0; z >= bz1; z -= 12) lights.push({ x: BRIDGE_X + sx * 14.8, y: deckY + 1.2, z, color: [1.0, 0.62, 0.28], size: 1.8, phase: -1 });
    }
    // traffic: headlights one way, tail lights the other
    const len = bz0 - bz1;
    const lanes: [number, number, [number, number, number]][] = [
      [-9, -1, [1, 0.95, 0.85]], [-5, -1, [1, 0.95, 0.85]], [5, 1, [1, 0.08, 0.04]], [9, 1, [1, 0.08, 0.04]],
    ];
    const perLane = IS_TOUCH ? 30 : 60;
    for (const [lx, dir, colr] of lanes)
      for (let i = 0; i < perLane; i++) {
        const sp = 16 + rnd() * 10;
        lights.push({
          x: BRIDGE_X + lx, y: deckY + 0.9, z: dir < 0 ? bz0 : bz1, color: colr, size: 1.1, phase: rnd(),
          move: [0, dir, sp, len],
        });
      }
  }
  group.add(buildParts(shoreParts, nearMat));

  // promenade lamps along the waterfront
  for (let x = cx - 2600; x <= cx + 2600; x += 14) lights.push({ x, y: 5, z: SHORE + 8, color: [1.0, 0.72, 0.4], size: 1.6, phase: -1 });

  // ---------- street-light grid ----------
  const stride = IS_TOUCH ? 24 : 16;
  for (let x = x0 - LOT / 2; x <= x1 + LOT / 2; x += LOT)
    for (let z = z0; z <= z1; z += stride)
      if (clear.free(x, z, 3)) lights.push({ x, y: 6, z, color: [1.0, 0.66, 0.32], size: 1.5, phase: -1 });
  for (let z = z0; z <= z1; z += LOT)
    for (let x = x0; x <= x1; x += stride)
      if (clear.free(x, z, 3)) lights.push({ x, y: 6, z, color: [1.0, 0.66, 0.32], size: 1.5, phase: -1 });

  // aircraft warning beacons on every tall roof and spire
  for (const bc of [...kit.beacons, ...far.beacons]) {
    beaconLights.push(bc.strobe
      ? { x: bc.x, y: bc.y, z: bc.z, color: [1, 1, 1], size: 6, phase: rnd() }
      : { x: bc.x, y: bc.y, z: bc.z, color: [1, 0.1, 0.04], size: 3, phase: rnd() });
  }
  const steady = buildLights(lights, D * 0.5);
  const blink = buildLights(beaconLights, D * 0.35);
  group.add(blink.pts);
  if (!day) group.add(steady.pts); // street grid, bridge and promenade lights only at night

  // ---------- sweeping searchlights from the tallest roofs ----------
  const roofs = day ? [] : [...kit.roofs].sort((a, c) => c.h - a.h).slice(0, IS_TOUCH ? 3 : 7);
  const beams: { g: THREE.Group; m: THREE.Mesh; ph: number; dir: number }[] = [];
  roofs.forEach((rf, i) => {
    const g = new THREE.Group();
    g.position.set(rf.x, rf.y, rf.z);
    const m = searchlight(new THREE.Color(i % 3 === 0 ? 0xbfd8ff : i % 3 === 1 ? 0xffe6c0 : 0xd8c8ff), 1100);
    g.add(m);
    group.add(g);
    beams.push({ g, m, ph: rnd() * 6.28, dir: i % 2 ? 1 : -1 });
  });

  // ---------- billboards beside the track ----------
  const F = newFrame();
  const signMeshes: THREE.Mesh[] = [];
  let placed = 0;
  for (let s = 120; s < tr.length - 60 && placed < 22; s += 150 + rnd() * 60) {
    if (tr.inZone('skywall', s, 60) || tr.inZone('tunnel', s, 10)) continue;
    const side = rnd() < 0.5 ? -1 : 1;
    const [txt, color, sub] = SIGNS[placed % SIGNS.length];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 4.4),
      new THREE.MeshBasicMaterial({ map: signTexture(txt, color, sub), color: hdr(0xffffff, day ? 1.0 : 1.5) }),
    );
    const g = new THREE.Group();
    sign.rotation.y = Math.PI - side * 0.35;
    g.add(sign);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1b22, metalness: 0.6, roughness: 0.4 });
    tr.frame(s, F);
    const height = 9 + rnd() * 6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, height + F.py + 2, 8), poleMat);
    pole.userData.shadow = 'cast';
    pole.position.set(0, -(height + F.py + 2) / 2, 0.4);
    g.add(pole);
    g.applyMatrix4(frameMatrix(tr, s, side * (tr.halfWidth + 9), height, 1, 1, 1, true, new THREE.Matrix4()));
    group.add(g);
    signMeshes.push(sign);
    placed++;
  }

  // ---------- street lights along the circuit ----------
  {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 8, 6);
    poleGeo.translate(0, 4, 0);
    const armGeo = new THREE.BoxGeometry(2.6, 0.12, 0.2);
    armGeo.translate(-1.2, 8, 0);
    const headGeo = new THREE.BoxGeometry(1.0, 0.12, 0.35);
    headGeo.translate(-2.2, 7.92, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c36, metalness: 0.7, roughness: 0.4 });
    const headMat = new THREE.MeshBasicMaterial({ color: day ? new THREE.Color(0x8a8c90) : hdr(0xffe2b0, 4) });
    const mats: THREE.Matrix4[] = [];
    for (let s = 20; s < tr.length; s += 38) {
      if (tr.inZone('skywall', s, 30) || tr.inZone('tunnel', s, 4)) continue;
      for (const side of [-1, 1]) {
        const mm = frameMatrix(tr, s + (side > 0 ? 19 : 0), side * (tr.halfWidth + 0.75), 1.0, 1, 1, 1, true, new THREE.Matrix4());
        if (side > 0) mm.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
        mats.push(mm);
      }
    }
    for (const [g, mt] of [[poleGeo, poleMat], [armGeo, poleMat], [headGeo, headMat]] as [THREE.BufferGeometry, THREE.Material][]) {
      const im = new THREE.InstancedMesh(g, mt, mats.length);
      im.userData.shadow = 'cast';
      mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      group.add(im);
    }
  }

  return {
    group,
    update(t: number) {
      nearMat.uniforms.uTime.value = t;
      farMat.uniforms.uTime.value = t;
      waterMat.uniforms.uTime.value = t;
      const vh = VIEW.h;
      for (const L of [steady.mat, blink.mat]) {
        L.uniforms.uTime.value = t;
        L.uniforms.uViewH.value = vh;
      }
      for (const bm of beams) {
        bm.g.rotation.y = bm.ph + t * 0.22 * bm.dir;
        bm.m.rotation.x = 0.32 + 0.16 * Math.sin(t * 0.37 + bm.ph);
      }
      signMeshes.forEach((s, i) => {
        const mm = s.material as THREE.MeshBasicMaterial;
        mm.color.setScalar((day ? 0.95 : 1.3) + (day ? 0.1 : 0.35) * Math.sin(t * 2 + i * 1.7) * (i % 3 === 0 ? 1 : 0.2));
      });
    },
    groundAt: () => 0,
  };
}
