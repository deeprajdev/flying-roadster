import * as THREE from 'three';
import { newFrame, type Frame, type TrackData } from './TrackData';
import type { Theme } from './themes';
import { barrierTexture, checkerTexture, concreteBarrierTexture, concreteTexture, dashTexture, kerbTexture, roadTexture, signTexture, radialSprite } from './textures';
import { CHECKPOINTS } from '../race/Race';

type Strip = [number, number][];

const F: Frame = newFrame();

/** Sweep 2D profile strips (lat, up) along the track between s0 and s1. Normal = stripDir × tangent. */
export function sweep(tr: TrackData, s0: number, s1: number, strips: Strip[], step = 1, vTile = 16, uMeters = 0): THREE.BufferGeometry {
  const nSt = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const strip of strips) {
    const np = strip.length;
    const cum = [0];
    for (let k = 1; k < np; k++) cum.push(cum[k - 1] + Math.hypot(strip[k][0] - strip[k - 1][0], strip[k][1] - strip[k - 1][1]));
    const total = cum[np - 1] || 1;
    const base = pos.length / 3;
    for (let i = 0; i < nSt; i++) {
      const s = s0 + ((s1 - s0) * i) / (nSt - 1);
      tr.frame(s, F);
      for (let k = 0; k < np; k++) {
        const [lat, up] = strip[k];
        pos.push(F.px + F.rx * lat + F.ux * up, F.py + F.ry * lat + F.uy * up, F.pz + F.rz * lat + F.uz * up);
        uv.push(uMeters ? cum[k] / uMeters : cum[k] / total, s / vTile);
      }
    }
    for (let i = 0; i < nSt - 1; i++)
      for (let k = 0; k < np - 1; k++) {
        const a = base + i * np + k, b = a + 1, c = a + np, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const M = new THREE.Matrix4();
const vR = new THREE.Vector3(), vU = new THREE.Vector3(), vT = new THREE.Vector3();
/** Matrix placing an object in the road frame at (s, lat, up). Local X=left, Y=up, Z=forward (right-handed). */
export function frameMatrix(tr: TrackData, s: number, lat: number, up: number, sx = 1, sy = 1, sz = 1, flat = false, out = M) {
  tr.frame(s, F);
  vT.set(F.tx, F.ty, F.tz);
  vU.set(F.ux, F.uy, F.uz);
  if (flat) {
    vT.y = 0;
    vT.normalize();
    vU.set(0, 1, 0);
  }
  vR.crossVectors(vU, vT).normalize(); // local +X = road left (right-handed basis)
  out.makeBasis(vR.clone().multiplyScalar(sx), vU.clone().multiplyScalar(sy), vT.clone().multiplyScalar(sz));
  out.setPosition(F.px + F.rx * lat + F.ux * up, F.py + F.ry * lat + F.uy * up, F.pz + F.rz * lat + F.uz * up);
  return out;
}

export const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

export interface Gate {
  s: number;
  mat: THREE.MeshBasicMaterial;
  base: THREE.Color;
}

export interface TrackVisuals {
  group: THREE.Group;
  gates: Gate[];
  update(t: number, nextGate: number): void;
}

function ranges(tr: TrackData, tag: 'skywall' | 'tunnel') {
  const zs = tr.zones.filter((z) => z.tag === tag).map((z) => [z.s0, z.s1]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of zs) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] < 6) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export function buildTrackMesh(tr: TrackData, theme: Theme, envMap: THREE.Texture | null, groundAt: (x: number, z: number) => number): TrackVisuals {
  const group = new THREE.Group();
  const hw = tr.halfWidth;
  const L = tr.length;
  const sky = ranges(tr, 'skywall')[0];
  const normalRanges: [number, number][] = sky ? [[sky[1] + 1, sky[0] - 1 + L]] : [[0, L]];

  // ---------- materials ----------
  const rt = roadTexture(theme.road, theme.wet);
  const roadMat = new THREE.MeshStandardMaterial({
    map: rt.map, normalMap: rt.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: rt.roughnessMap,
    roughness: theme.wet > 0 ? 1 - theme.wet * 0.55 : theme.roadRoughness, metalness: 0.05, envMap,
    envMapIntensity: theme.wet > 0 ? 1.3 : theme.road === 'city' ? 0.7 : 0.3,
  });
  const coastal = theme.road === 'coastal';
  const bTex = coastal ? barrierTexture(theme.road) : concreteBarrierTexture(theme.road);
  const barrierMat = new THREE.MeshStandardMaterial({ map: bTex, roughness: 0.82, metalness: 0.02, envMap, envMapIntensity: 0.3 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.38, metalness: 0.85, envMap, envMapIntensity: 0.9, side: THREE.DoubleSide });
  const deckMat = new THREE.MeshStandardMaterial({ color: theme.road === 'city' ? 0x1c1d26 : 0x8a7f74, roughness: 0.9 });
  const neonAMat = new THREE.MeshBasicMaterial({ color: hdr(theme.neonA, theme.neonPower) });
  const neonBMat = new THREE.MeshBasicMaterial({ color: hdr(theme.neonB, theme.neonPower) });

  // ---------- road + barriers ----------
  const skirt = theme.road === 'city' ? -1.1 : -2.8;
  const tag = (m: THREE.Mesh, t: string) => {
    m.userData.shadow = t;
    return m;
  };
  // right-hand profile (lat, up); the left one is mirrored
  const mirror = (st: Strip): Strip => st.map(([x, y]) => [-x, y] as [number, number]).reverse();
  const W = coastal ? 0.45 : 0.64;
  const jersey: Strip = [
    [hw, 0], [hw + 0.05, 0.08], [hw + 0.2, 0.34], [hw + 0.29, 0.81], [hw + 0.35, 0.81],
    [hw + 0.44, 0.34], [hw + 0.59, 0.08], [hw + W, 0], [hw + W, skirt],
  ];
  const kerbWall: Strip = [[hw, 0], [hw, 0.16], [hw + 0.08, 0.2], [hw + W, 0.2], [hw + W, skirt]];
  const profile = coastal ? kerbWall : jersey;
  for (const [a, b] of normalRanges) {
    group.add(tag(new THREE.Mesh(sweep(tr, a, b, [[[-hw, 0], [hw, 0]]], 1, 16), roadMat), 'receive'));
    group.add(tag(new THREE.Mesh(sweep(tr, a, b, [profile, mirror(profile)], 2, 8, 1.6), barrierMat), 'both'));
    group.add(new THREE.Mesh(sweep(tr, a, b, [[[hw + W, skirt], [-hw - W, skirt]]], 2, 8), deckMat));
    if (coastal) {
      // galvanised W-beam guardrail on posts
      const wbeam: Strip = [[hw + 0.16, 0.48], [hw + 0.09, 0.58], [hw + 0.16, 0.68], [hw + 0.09, 0.78], [hw + 0.16, 0.86]];
      group.add(tag(new THREE.Mesh(sweep(tr, a, b, [wbeam, mirror(wbeam)], 2, 8), railMat), 'both'));
      group.add(new THREE.Mesh(sweep(tr, a, b, [[[hw + 0.165, 0.6], [hw + 0.165, 0.66]], [[-hw - 0.165, 0.66], [-hw - 0.165, 0.6]]], 2), neonBMat));
    } else {
      // LED strip along the top of the barrier
      group.add(new THREE.Mesh(sweep(tr, a, b, [[[hw + 0.29, 0.815], [hw + 0.35, 0.815]]], 2), neonBMat));
      group.add(new THREE.Mesh(sweep(tr, a, b, [[[-hw - 0.35, 0.815], [-hw - 0.29, 0.815]]], 2), neonAMat));
    }
  }
  if (coastal) {
    const postGeo = new THREE.BoxGeometry(0.14, 0.92, 0.14);
    postGeo.translate(0, 0.38, 0);
    const posts: THREE.Matrix4[] = [];
    for (const [a, b] of normalRanges)
      for (let s0 = a; s0 < b; s0 += 4) for (const sd of [-1, 1]) posts.push(frameMatrix(tr, s0, sd * (hw + 0.3), 0, 1, 1, 1, false, new THREE.Matrix4()));
    const pm = new THREE.InstancedMesh(postGeo, railMat, posts.length);
    posts.forEach((m4, i) => pm.setMatrixAt(i, m4));
    pm.userData.shadow = 'cast';
    group.add(pm);
  }

  // ---------- racing kerbs on the inside of corners ----------
  {
    const kMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.55, metalness: 0, envMap, envMapIntensity: 0.3 });
    const kerbs: Strip[][] = [];
    let s0 = -1, side = 0;
    const flush = (s1: number) => {
      if (s0 >= 0 && s1 - s0 > 8) {
        const st: Strip = side > 0 ? [[hw - 1.1, 0.012], [hw - 0.05, 0.05]] : [[-hw + 0.05, 0.05], [-hw + 1.1, 0.012]];
        group.add(tag(new THREE.Mesh(sweep(tr, s0 - 4, s1 + 4, [st], 1, 4), kMat), 'receive'));
        kerbs.push([st]);
      }
      s0 = -1;
    };
    for (let s = 0; s < L; s += 1) {
      const k = tr.kLat[tr.index(s)];
      const blocked = tr.inZone('skywall', s, 20) || tr.inZone('tunnel', s, 2);
      const on = Math.abs(k) > 1 / 75 && !blocked;
      if (on && s0 < 0) {
        s0 = s;
        side = Math.sign(k);
      } else if ((!on || Math.sign(k) !== side) && s0 >= 0) flush(s);
    }
    flush(L);
  }

  // ---------- road studs (cat's eyes) that catch the headlights at night ----------
  if (theme.night && theme.road !== 'city') {
    const studGeo = new THREE.BoxGeometry(0.14, 0.04, 0.1);
    const white: THREE.Matrix4[] = [], amber: THREE.Matrix4[] = [];
    for (const [a, b] of normalRanges)
      for (let s0 = a; s0 < b; s0 += 12) {
        white.push(frameMatrix(tr, s0, theme.road === 'desert' ? 0 : -hw / 3, 0.02, 1, 1, 1, false, new THREE.Matrix4()));
        if (theme.road !== 'desert') white.push(frameMatrix(tr, s0, hw / 3, 0.02, 1, 1, 1, false, new THREE.Matrix4()));
        for (const sd of [-1, 1]) amber.push(frameMatrix(tr, s0 + 6, sd * (hw - 0.45), 0.02, 1, 1, 1, false, new THREE.Matrix4()));
      }
    for (const [list, col] of [[white, hdr(0xdfe8ff, 2.2)], [amber, hdr(0xff9a2a, 2.4)]] as [THREE.Matrix4[], THREE.Color][]) {
      const im = new THREE.InstancedMesh(studGeo, new THREE.MeshBasicMaterial({ color: col }), list.length);
      list.forEach((m4, i) => im.setMatrixAt(i, m4));
      group.add(im);
    }
  }

  // ---------- street lamps (non-city tracks; the city has its own) ----------
  if (theme.road !== 'city' && theme.lamps) {
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 7.5, 6);
    poleGeo.translate(0, 3.75, 0);
    const armGeo = new THREE.BoxGeometry(2.2, 0.1, 0.16);
    armGeo.translate(-1.0, 7.5, 0);
    const headGeo = new THREE.BoxGeometry(0.8, 0.12, 0.3);
    headGeo.translate(-1.9, 7.42, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x40444c, metalness: 0.7, roughness: 0.4 });
    const headMat = new THREE.MeshBasicMaterial({ color: hdr(0xffc27a, 4) });
    const mats: THREE.Matrix4[] = [];
    const glow: THREE.Vector3[] = [];
    for (let s0 = 30; s0 < L; s0 += 52) {
      if (tr.inZone('tunnel', s0, 6)) continue;
      const sd = (Math.floor(s0 / 52) % 2) * 2 - 1;
      const mm = frameMatrix(tr, s0, sd * (hw + 0.9), 0.2, 1, 1, 1, true, new THREE.Matrix4());
      if (sd > 0) mm.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      mats.push(mm);
      const p = new THREE.Vector3(-1.9, 7.3, 0).applyMatrix4(mm);
      glow.push(p);
    }
    for (const [gg, mt] of [[poleGeo, poleMat], [armGeo, poleMat], [headGeo, headMat]] as [THREE.BufferGeometry, THREE.Material][]) {
      const im = new THREE.InstancedMesh(gg, mt, mats.length);
      mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      group.add(im);
    }
    // warm pools of light on the road under each lamp
    const poolTex = radialSprite('rgba(255,200,140,0.9)', 'rgba(255,200,140,0)');
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.42, 0.32, 0.22) });
    const poolGeo = new THREE.PlaneGeometry(16, 16);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, glow.length);
    const m4 = new THREE.Matrix4();
    glow.forEach((p, i) => {
      const y = p.y - 7.1;
      pools.setMatrixAt(i, m4.makeTranslation(p.x, y + 0.04, p.z));
    });
    pools.renderOrder = 2;
    group.add(pools);
  }

  // ---------- the Skywall (vertical loop, styled after the ramp photos) ----------
  if (sky) {
    const [a, b] = [sky[0] - 1, sky[1] + 1];
    // floodlit concrete: self-illuminated so the loop reads even when the road faces down
    const cTex = concreteTexture();
    const concMat = new THREE.MeshStandardMaterial({ map: cTex, emissiveMap: cTex, emissive: new THREE.Color(0.42, 0.42, 0.44), roughness: 0.85, metalness: 0.0 });
    const under = new THREE.MeshStandardMaterial({ color: 0x8c8c8a, emissive: new THREE.Color(0.16, 0.16, 0.17), roughness: 0.9 });
    const red = new THREE.MeshBasicMaterial({ color: hdr(0xff2a1a, 4.5) });
    group.add(new THREE.Mesh(sweep(tr, a, b, [[[-hw, 0], [hw, 0]]], 0.5, 16), concMat));
    group.add(
      new THREE.Mesh(
        sweep(tr, a, b, [
          [[hw, 0], [hw, 0.22]], [[hw, 0.22], [hw + 0.3, 0.22]], [[hw + 0.3, 0.22], [hw + 0.3, -1.0]],
          [[-hw, 0.22], [-hw, 0]], [[-hw - 0.3, 0.22], [-hw, 0.22]], [[-hw - 0.3, -1.0], [-hw - 0.3, 0.22]],
          [[hw + 0.3, -1.0], [-hw - 0.3, -1.0]],
        ], 0.5, 8),
        under,
      ),
    );
    group.add(
      new THREE.Mesh(
        sweep(tr, a, b, [
          [[hw - 0.32, 0.02], [hw - 0.04, 0.02]], [[-hw + 0.04, 0.02], [-hw + 0.32, 0.02]],
          [[hw + 0.31, 0.2], [hw + 0.31, -0.15]], [[-hw - 0.31, -0.15], [-hw - 0.31, 0.2]],
        ], 0.5),
        red,
      ),
    );
    buildSkywallTruss(tr, sky[0], sky[1], group, groundAt);
  }

  // ---------- elevated supports ----------
  {
    const pillarGeo = new THREE.CylinderGeometry(1, 1.15, 1, 14);
    pillarGeo.translate(0, 0.5, 0);
    const capGeo = new THREE.BoxGeometry(1, 1, 1);
    const pillarMat = new THREE.MeshStandardMaterial({ color: theme.road === 'city' ? 0x2a2c38 : 0xa89c8c, roughness: 0.8, metalness: 0.1 });
    const pts: { x: number; y: number; z: number; h: number; s: number }[] = [];
    for (let s = 0; s < L; s += 22) {
      if (sky && s > sky[0] - 30 && s < sky[1] + 30) continue;
      tr.frame(s, F);
      const by = F.py - 1.15;
      const gy = groundAt(F.px, F.pz);
      if (by - gy > 2.2) pts.push({ x: F.px, y: by, z: F.pz, h: by - gy, s });
    }
    const pill = new THREE.InstancedMesh(pillarGeo, pillarMat, pts.length);
    const caps = new THREE.InstancedMesh(capGeo, pillarMat, pts.length);
    pts.forEach((p, i) => {
      M.makeScale(1.2, p.h + 0.5, 1.2).setPosition(p.x, p.y - p.h, p.z);
      pill.setMatrixAt(i, M);
      frameMatrix(tr, p.s, 0, -1.55, hw * 2 + 0.6, 0.8, 3, false, M);
      caps.setMatrixAt(i, M);
    });
    pill.userData.shadow = 'cast';
    caps.userData.shadow = 'both';
    group.add(pill, caps);
  }

  // ---------- tunnels ----------
  const tunnels = ranges(tr, 'tunnel');
  if (tunnels.length) {
    const tunMat = new THREE.MeshStandardMaterial({ map: barrierTexture('city'), color: 0x8890a0, roughness: 0.8, side: THREE.FrontSide });
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x15161e, roughness: 0.9 });
    const dash = dashTexture();
    const lightMat = new THREE.MeshBasicMaterial({ map: dash, color: hdr(0xe8f4ff, 1.0) });
    const w = hw + 1.6;
    const arch: [number, number][] = [[w, -0.2], [w, 5.2]];
    for (let k = 1; k < 8; k++) {
      const ang = (k / 8) * Math.PI;
      arch.push([Math.cos(ang) * w, 5.2 + Math.sin(ang) * 2.0]);
    }
    arch.push([-w, 5.2], [-w, -0.2]);
    const shell: Strip = [[-w - 1, -0.6], [-w - 1, 6.6], [-w + 2, 7.8], [w - 2, 7.8], [w + 1, 6.6], [w + 1, -0.6]];
    for (const [a0, b0] of tunnels) {
      const a = a0, b = b0;
      group.add(new THREE.Mesh(sweep(tr, a, b, [arch], 2, 8, 1.4), tunMat));
      group.add(tag(new THREE.Mesh(sweep(tr, a, b, [shell], 2, 8), shellMat), 'cast'));
      group.add(new THREE.Mesh(sweep(tr, a, b, [[[-2.6, 7.12], [-4.4, 6.85]], [[4.4, 6.85], [2.6, 7.12]]], 1, 6), lightMat));
      group.add(new THREE.Mesh(sweep(tr, a, b, [[[w - 0.02, 2.1], [w - 0.02, 2.3]]], 2), neonBMat));
      group.add(new THREE.Mesh(sweep(tr, a, b, [[[-w + 0.02, 2.3], [-w + 0.02, 2.1]]], 2), neonAMat));
      // portals
      for (const [s, dir] of [[a, 1], [b, -1]] as [number, number][]) {
        const pg = new THREE.Group();
        const frame = new THREE.MeshStandardMaterial({ color: 0x22232c, roughness: 0.6, metalness: 0.4 });
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * w + 4, 2.2, 1.6), frame);
        beam.position.set(0, 8.4, 0);
        const colL = new THREE.Mesh(new THREE.BoxGeometry(2, 9.5, 1.6), frame);
        colL.position.set(-w - 1.5, 4.5, 0);
        const colR = colL.clone();
        colR.position.x = w + 1.5;
        const glow = new THREE.Mesh(new THREE.BoxGeometry(2 * w + 4.2, 0.18, 1.7), neonAMat);
        glow.position.set(0, 7.25, 0);
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(12, 1.8),
          new THREE.MeshBasicMaterial({ map: signTexture(theme.road === 'city' ? 'BOOST TUNNEL' : 'HEADLAND TUNNEL', theme.road === 'city' ? '#19e0ff' : '#ffd27a', undefined, 1024, 160), color: hdr(0xffffff, 1.6) }),
        );
        // sign faces oncoming traffic (−Z in the road frame)
        sign.position.set(0, 8.4, -0.81);
        sign.rotation.y = Math.PI;
        sign.visible = dir === 1;
        pg.add(beam, colL, colR, glow, sign);
        pg.applyMatrix4(frameMatrix(tr, s, 0, 0, 1, 1, 1, true, new THREE.Matrix4()));
        group.add(pg);
      }
    }
  }

  // ---------- start / finish ----------
  {
    const chk = new THREE.MeshBasicMaterial({ map: checkerTexture(), color: 0xdddddd });
    const line = new THREE.Mesh(sweep(tr, -1.2, 1.2, [[[-hw, 0.02], [hw, 0.02]]], 0.6, 2.4), chk);
    group.add(line);
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x30323c, metalness: 0.7, roughness: 0.35, envMap });
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, 10, 1.1), steel);
      col.position.set(sx * (hw + 1.6), 5, 0);
      g.add(col);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 4.4, 2.6, 1.2), steel);
    beam.position.set(0, 9.2, 0);
    g.add(beam);
    for (const dz of [0.61, -0.61]) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(hw * 2 + 3.6, 2.2),
        new THREE.MeshBasicMaterial({ map: signTexture('SPACE X10', '#ff3048', 'START · FINISH', 1024, 160), color: hdr(0xffffff, 1.8) }),
      );
      sign.position.set(0, 9.2, dz);
      if (dz < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 4.6, 0.16, 1.3), neonBMat);
    bar.position.set(0, 7.85, 0);
    g.add(bar);
    g.applyMatrix4(frameMatrix(tr, 0, 0, 0, 1, 1, 1, true, new THREE.Matrix4()));
    group.add(g);
  }

  // ---------- checkpoint gates ----------
  const gates: Gate[] = [];
  for (let k = 1; k < CHECKPOINTS; k++) {
    const s = (k * L) / CHECKPOINTS;
    const blocked = tr.inZone('skywall', s, 40) || tr.inZone('tunnel', s, 10);
    const g = new THREE.Group();
    const base = new THREE.Color(theme.road === 'city' ? 0x19e0ff : theme.road === 'desert' ? 0xffa21a : 0xffe08a);
    const mat = new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(1.5), transparent: true, opacity: 0.9 });
    const h = 6.5;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 0.3), mat);
      post.position.set(sx * (hw + 0.7), h / 2, 0);
      g.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.7, 0.3, 0.3), mat);
    top.position.set(0, h, 0);
    g.add(top);
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 1),
      new THREE.MeshBasicMaterial({ map: signTexture(`CP ${k}`, '#ffffff', undefined, 512, 128, 'rgba(0,0,0,0)'), transparent: true, side: THREE.DoubleSide }),
    );
    tag.position.set(0, h + 0.9, 0);
    tag.rotation.y = Math.PI;
    g.add(tag);
    g.applyMatrix4(frameMatrix(tr, s, 0, 0, 1, 1, 1, false, new THREE.Matrix4()));
    if (!blocked) group.add(g);
    gates.push({ s, mat, base });
  }

  return {
    group,
    gates,
    update(t: number, nextGate: number) {
      gates.forEach((g, i) => {
        const active = i + 1 === nextGate;
        const k = theme.night ? (active ? 2.4 + Math.sin(t * 8) * 0.8 : 0.9) : active ? 1.2 + Math.sin(t * 8) * 0.25 : 0.7;
        g.mat.color.copy(g.base).multiplyScalar(k);
        g.mat.opacity = theme.night ? 0.9 : active ? 0.85 : 0.22;
      });
    },
  };
}

/** Steel lattice towers, top beam, cables and floodlights around the Skywall loop. */
function buildSkywallTruss(tr: TrackData, s0: number, s1: number, group: THREE.Group, groundAt: (x: number, z: number) => number) {
  tr.frame(s0, F);
  const T = new THREE.Vector3(F.tx, 0, F.tz).normalize();
  const R = new THREE.Vector3(-T.z, 0, T.x); // right, horizontal
  const base = new THREE.Vector3(F.px, F.py, F.pz);
  // loop top height & lateral centre
  let topY = -Infinity;
  let topS = s0;
  for (let s = s0; s < s1; s += 1) {
    tr.frame(s, F);
    if (F.py > topY) { topY = F.py; topS = s; }
  }
  tr.frame(topS, F);
  const topPos = new THREE.Vector3(F.px, F.py, F.pz);
  const latC = new THREE.Vector3().subVectors(topPos, base).dot(R);
  const fwdC = new THREE.Vector3().subVectors(topPos, base).dot(T);
  const center = base.clone().addScaledVector(R, latC).addScaledVector(T, fwdC);
  const H = topY - base.y + 7;
  const halfSpan = tr.halfWidth + 9;
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9da3, metalness: 0.85, roughness: 0.35 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mats: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const bar = (a: THREE.Vector3, b: THREE.Vector3, t = 0.16) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    q.setFromUnitVectors(up, d.clone().normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(t, len, t));
    mats.push(m);
  };
  const W = 2.2;
  for (const side of [-1, 1]) {
    const c = center.clone().addScaledVector(R, side * halfSpan);
    const gy = groundAt(c.x, c.z);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(R, a * W / 2).addScaledVector(T, b * W / 2));
    const levels = Math.ceil(H / 3);
    for (let l = 0; l < levels; l++) {
      const y0 = gy + l * 3, y1 = gy + Math.min(H, (l + 1) * 3);
      for (let k = 0; k < 4; k++) {
        const p = corners[k], q2 = corners[(k + 1) % 4];
        bar(new THREE.Vector3(p.x, y0, p.z), new THREE.Vector3(p.x, y1, p.z), 0.22);
        bar(new THREE.Vector3(p.x, y1, p.z), new THREE.Vector3(q2.x, y1, q2.z), 0.12);
        bar(new THREE.Vector3(p.x, y0, p.z), new THREE.Vector3(q2.x, y1, q2.z), 0.09);
      }
    }
  }
  // top truss beam across the loop
  const yTop = base.y + H;
  const left = center.clone().addScaledVector(R, -halfSpan);
  const right = center.clone().addScaledVector(R, halfSpan);
  for (const dz of [-1, 1]) {
    for (const dy of [0, 1.8]) {
      const a = left.clone().addScaledVector(T, dz * W / 2); a.y = yTop + dy;
      const b = right.clone().addScaledVector(T, dz * W / 2); b.y = yTop + dy;
      bar(a, b, 0.2);
    }
  }
  const seg = 12;
  for (let i = 0; i < seg; i++) {
    const a = left.clone().lerp(right, i / seg); a.y = yTop;
    const b = left.clone().lerp(right, (i + 1) / seg); b.y = yTop + 1.8;
    bar(a, b, 0.1);
  }
  // cables to the loop crown
  for (const lat of [-tr.halfWidth + 1, 0, tr.halfWidth - 1]) {
    tr.frame(topS, F);
    const p = new THREE.Vector3(F.px - F.ux * 1.0 + F.rx * lat, F.py - F.uy * 1.0 + F.ry * lat, F.pz - F.uz * 1.0 + F.rz * lat);
    bar(p, new THREE.Vector3(p.x, yTop, p.z), 0.06);
  }
  const inst = new THREE.InstancedMesh(box, steel, mats.length);
  mats.forEach((m, i) => inst.setMatrixAt(i, m));
  group.add(inst);
  // floodlights on the tower tops
  const glowTex = radialSprite('rgba(255,255,255,1)', 'rgba(160,200,255,0)');
  for (const side of [-1, 1]) {
    const c = center.clone().addScaledVector(R, side * halfSpan);
    for (const dz of [-1, 1]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(0xe6f0ff, 3), depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.copy(c).addScaledVector(T, dz * 1.4);
      sp.position.y = yTop + 3;
      sp.scale.setScalar(5);
      group.add(sp);
    }
  }
  // skywall sign on the top beam
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(halfSpan * 1.4, 4),
    new THREE.MeshBasicMaterial({ map: signTexture('SKYWALL', '#ff3a2a', 'KEEP SPEED · THRUSTERS ARMED', 1024, 220), color: hdr(0xffffff, 1.7), side: THREE.DoubleSide }),
  );
  sign.position.copy(center);
  sign.position.y = yTop + 4.6;
  sign.lookAt(sign.position.clone().addScaledVector(T, -10));
  group.add(sign);
}
