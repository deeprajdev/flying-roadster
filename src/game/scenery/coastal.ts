import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/math';
import type { TrackData } from '../track/TrackData';
import type { Theme } from '../track/themes';
import { hdr } from '../track/TrackMesh';
import { buildTerrain, detailTexture, fbm, ridged } from './terrain';
import { buildLights, searchlight, type LightPoint } from './skyline';
import { VIEW } from '../device';

/** Coastal Drive: grassy cliffs, a beach, animated ocean, palms and a lighthouse (lit at night). */
export function buildCoastal(tr: TrackData, theme: Theme) {
  const group = new THREE.Group();
  const b = tr.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const coastZ = b.maxZ + 28; // shoreline just beyond the beach road

  const shore = (x: number) => coastZ + 26 * (fbm(x / 160, 3.1) - 0.5) * 2;
  const natural = (x: number, z: number) => {
    // inland hills rising away from the sea
    let h = 30 + 26 * fbm(x / 210, z / 210) + Math.max(0, b.minZ + 40 - z) * 0.16;
    h += 30 * ridged(x / 300, z / 300) * smoothstep(b.minZ + 80, b.minZ - 200, z);
    // headland west of the circuit (tunnel)
    const hd = Math.hypot((x - b.minX - 10) / 120, (z - (b.minZ + b.maxZ) / 2) / 160);
    if (hd < 1) h += 26 * (1 - hd * hd);
    // flatten toward the beach, then drop into the sea
    const sz = shore(x);
    const inland = 1 - smoothstep(sz - 170, sz - 25, z);
    h = h * inland + 2.2 * (1 - inland);
    const sea = smoothstep(sz - 12, sz + 30, z);
    h = h * (1 - sea) + -14 * sea;
    // cliff faces toward the sea (above the beach)
    return h;
  };
  const color = (h: number, slope: number, x: number, z: number, out: THREE.Color) => {
    const grass = [0.36, 0.44, 0.22], dry = [0.58, 0.52, 0.3], rock = [0.5, 0.45, 0.41], sand = [0.86, 0.76, 0.58], wet = [0.42, 0.38, 0.3];
    const d = fbm(x / 40, z / 40);
    let c = [grass[0] + (dry[0] - grass[0]) * d, grass[1] + (dry[1] - grass[1]) * d, grass[2] + (dry[2] - grass[2]) * d];
    const r = smoothstep(0.45, 0.9, slope);
    c = c.map((v, i) => v + (rock[i] - v) * r);
    const s = 1 - smoothstep(3, 7, h);
    c = c.map((v, i) => v + (sand[i] - v) * s);
    const w = 1 - smoothstep(-1.5, 0.6, h);
    c = c.map((v, i) => v + (wet[i] - v) * w);
    out.setRGB(c[0], c[1], c[2]);
    void z;
  };
  const terrain = buildTerrain(tr, { margin: 800, step: 8, falloff: 32, natural, color, detail: detailTexture(3, 34) });
  terrain.mesh.userData.shadow = 'receive';
  group.add(terrain.mesh);
  const night = theme.night;
  const beamPivots: THREE.Group[] = [];

  // ---------- ocean ----------
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(...theme.sunDir).normalize() },
      uSunColor: { value: new THREE.Color(theme.sunColor) },
      uDeep: { value: new THREE.Color(night ? 0x02070e : 0x0b3550) },
      uShallow: { value: new THREE.Color(night ? 0x05141c : 0x1f7480) },
      uSky: { value: new THREE.Color(theme.skyHorizon) },
      uFog: { value: new THREE.Color(theme.fogColor) },
      uDensity: { value: theme.fogDensity * 0.7 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying float vDepth;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uDeep; uniform vec3 uShallow;
      uniform vec3 uSky; uniform vec3 uFog; uniform float uDensity;
      varying vec3 vW; varying float vDepth;
      vec2 wave(vec2 p, vec2 d, float f, float s, float a){ float ph = dot(p, d) * f + uTime * s; return d * cos(ph) * a * f; }
      void main(){
        vec2 p = vW.xz;
        vec2 g = wave(p, normalize(vec2(0.3, 1.0)), 0.06, 1.1, 0.6) + wave(p, normalize(vec2(-0.7, 0.6)), 0.11, 1.7, 0.35)
               + wave(p, normalize(vec2(0.9, 0.2)), 0.23, 2.3, 0.18) + wave(p, normalize(vec2(-0.2, -1.0)), 0.47, 3.1, 0.08);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 1.0, fres * 1.5 + 0.2));
        vec3 col = mix(water, uSky, clamp(fres * 0.85, 0.0, 1.0));
        vec3 h = normalize(uSun + v);
        float spec = pow(max(dot(n, h), 0.0), 220.0);
        col += uSunColor * spec * (uDensity > 0.0009 ? 4.0 : 6.0);
        col += uSunColor * pow(max(dot(reflect(-v, n), uSun), 0.0), 18.0) * 0.35;
        float fog = 1.0 - exp(-uDensity * uDensity * vDepth * vDepth);
        col = mix(col, uFog, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000, 1, 1), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(cx, 0, coastZ + 2000);
  group.add(ocean);

  // ---------- palms ----------
  const rnd = mulberry32(99);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const leafGeo = new THREE.ConeGeometry(0.9, 4.2, 4, 1);
  leafGeo.translate(0, 2.1, 0);
  leafGeo.scale(1, 1, 0.18);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6a2a, roughness: 0.8, side: THREE.DoubleSide });
  const PALMS = 150;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, PALMS);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, PALMS * 7);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let n = 0, li = 0, tries = 0;
  while (n < PALMS && tries < 6000) {
    tries++;
    const x = b.minX - 300 + rnd() * (b.maxX - b.minX + 600);
    const z = coastZ - 140 + rnd() * 170;
    const y = terrain.groundAt(x, z);
    if (y < 1.2 || y > 26 || terrain.roadDist(x, z) < 13) continue;
    const h = 7 + rnd() * 6;
    const lean = (rnd() - 0.5) * 0.35;
    q.setFromEuler(e.set(lean, 0, (rnd() - 0.5) * 0.3));
    m.compose(new THREE.Vector3(x, y - 0.3, z), q, new THREE.Vector3(1, h, 1));
    trunks.setMatrixAt(n, m);
    const top = new THREE.Vector3(0, h, 0).applyQuaternion(q).add(new THREE.Vector3(x, y - 0.3, z));
    for (let k = 0; k < 7; k++) {
      q.setFromEuler(e.set(1.25 + rnd() * 0.35, (k / 7) * Math.PI * 2 + rnd() * 0.4, 0, 'YXZ'));
      m.compose(top, q, new THREE.Vector3(1, 0.9 + rnd() * 0.4, 1));
      leaves.setMatrixAt(li++, m);
    }
    n++;
  }
  trunks.count = n;
  leaves.count = li;
  trunks.userData.shadow = 'cast';
  leaves.userData.shadow = 'cast';
  group.add(trunks, leaves);

  // ---------- sea rocks ----------
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x5d5650, roughness: 0.95, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 160);
  for (let i = 0; i < 160; i++) {
    const x = b.minX - 500 + rnd() * (b.maxX - b.minX + 1000);
    const z = shore(x) + 10 + rnd() * rnd() * 260;
    const s = 2 + rnd() * rnd() * 14;
    q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3));
    m.compose(new THREE.Vector3(x, -s * 0.35, z), q, new THREE.Vector3(s, s * (0.6 + rnd() * 0.6), s * 1.2));
    rocks.setMatrixAt(i, m);
  }
  rocks.userData.shadow = 'cast';
  group.add(rocks);

  // ---------- lighthouse on the headland ----------
  {
    const lx = b.minX - 70, lz = coastZ - 40;
    const ly = terrain.groundAt(lx, lz);
    const lh = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6 });
    for (let k = 0; k < 5; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - k * 0.25, 2.85 - k * 0.25, 5, 16), k % 2 ? red : white);
      seg.position.y = 2.5 + k * 5;
      lh.add(seg);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 12), new THREE.MeshBasicMaterial({ color: night ? hdr(0xfff2c0, 4) : new THREE.Color(0xd8e4ea) }));
    lamp.position.y = 26.2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 12), red);
    roof.position.y = 28.5;
    lh.add(lamp, roof);
    lh.position.set(lx, ly - 0.5, lz);
    lh.traverse((o) => (o.userData.shadow = 'cast'));
    group.add(lh);
    if (night) {
      // rotating twin beam sweeping over the sea and the road
      for (const k of [0, Math.PI]) {
        const beam = searchlight(new THREE.Color(1.0, 0.95, 0.8), 900);
        beam.rotation.z = Math.PI / 2 - 0.06;
        const pivot = new THREE.Group();
        pivot.position.set(lx, ly - 0.5 + 26.2, lz);
        pivot.rotation.y = k;
        pivot.add(beam);
        group.add(pivot);
        beamPivots.push(pivot);
      }
    }
  }

  // ---------- night: houses on the hills and the town along the bay ----------
  let lights: ReturnType<typeof buildLights> | null = null;
  if (night) {
    const pts: LightPoint[] = [];
    let k = 0;
    while (pts.length < 520 && k < 20000) {
      k++;
      const x = b.minX - 900 + rnd() * (b.maxX - b.minX + 1800);
      const z = b.minZ - 700 + rnd() * (coastZ - b.minZ + 650);
      const y = terrain.groundAt(x, z);
      if (y < 2 || terrain.roadDist(x, z) < 25) continue;
      // cluster into villages
      if (Math.sin(x * 0.006) * Math.cos(z * 0.008) < 0.15 && rnd() < 0.8) continue;
      const warm = rnd() < 0.8;
      pts.push({ x, y: y + 2 + rnd() * 4, z, color: warm ? [1, 0.72, 0.42] : [0.85, 0.9, 1], size: 1.4 + rnd() * 1.2, phase: -1 });
    }
    lights = buildLights(pts, theme.fogDensity * 0.5);
    group.add(lights.pts);
  }

  // ---------- distant islands ----------
  const islandMat = new THREE.MeshStandardMaterial({ color: night ? 0x1a2030 : 0x6a7a68, roughness: 1, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const geo = new THREE.ConeGeometry(160 + rnd() * 220, 60 + rnd() * 110, 10, 2);
    const isl = new THREE.Mesh(geo, islandMat);
    isl.position.set(cx - 2500 + rnd() * 5000, 10, coastZ + 1300 + rnd() * 1600);
    isl.scale.set(1, 1, 0.5 + rnd() * 0.6);
    group.add(isl);
  }

  return {
    group,
    update(t: number) {
      oceanMat.uniforms.uTime.value = t;
      for (const p of beamPivots) p.rotation.y += 0.008;
      if (lights) {
        lights.mat.uniforms.uTime.value = t;
        lights.mat.uniforms.uViewH.value = VIEW.h;
      }
    },
    groundAt: terrain.groundAt,
  };
}
