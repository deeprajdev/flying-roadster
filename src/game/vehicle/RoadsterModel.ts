import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bodyGeometries, prep, WHEEL_Z, AXLE_Y } from './RoadsterBody';

/**
 * Procedural Roadster: lofted body + glass canopy, 4 wheels, LED lights and
 * 10 hidden cold-gas jets (4 rear, 2 side, 4 underbody lift). The vents are flush with the
 * bodywork, so nothing is visible until a jet fires.
 * Nose points +Z, up is +Y. Geometries are cached and shared between cars.
 */

export type ThrusterKind = 'rear' | 'side' | 'lift';
export interface Thruster {
  kind: ThrusterKind;
  pos: THREE.Vector3;   // local vent position
  dir: THREE.Vector3;   // local exhaust direction
  plume: THREE.Mesh;     // turbulent cold-gas vapour column
  mat: THREE.ShaderMaterial;
  length: number;       // nominal plume length (lift jets stretch to reach the road)
  width: number;
}

export interface RoadsterParts {
  root: THREE.Group;      // world transform (set by CarView)
  chassis: THREE.Group;   // whole car minus shadow: flips / barrel rolls rotate this
  body: THREE.Group;      // suspension pitch/roll lives here
  wheels: THREE.Group[];  // spinning wheel groups
  steerPivots: THREE.Group[];
  thrusters: Thruster[];
  tailMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  beams: THREE.Group;     // night headlight cones + light pool on the road
  pool: THREE.Mesh;
  paint: THREE.MeshPhysicalMaterial;
  flameMats: THREE.ShaderMaterial[];
  shadow: THREE.Mesh;
}

interface Station { z: number; w: number; top: number; bot: number }

function loft(st: Station[], segs: number, nTop: number, nBot: number, waist = 0.42, capEnds = true): THREE.BufferGeometry {
  st = [...st].sort((a, b) => a.z - b.z); // winding assumes stations ordered rear → front
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    for (let k = 0; k <= segs; k++) {
      const t = (k / segs) * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const ex = sn >= 0 ? 2 / nTop : 2 / nBot;
      const x = s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / nTop);
      const sy = Math.sign(sn) * Math.pow(Math.abs(sn), ex);
      const h = s.top - s.bot;
      const y = sy >= 0 ? s.bot + h * (waist + (1 - waist) * sy) : s.bot + h * waist * (1 + sy);
      pos.push(x, y, s.z);
      uv.push(k / segs, i / (st.length - 1));
    }
  }
  const row = segs + 1;
  for (let i = 0; i < st.length - 1; i++)
    for (let k = 0; k < segs; k++) {
      const a = i * row + k, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  if (capEnds) {
    for (const [ring, flip] of [[0, true], [st.length - 1, false]] as [number, boolean][]) {
      const s = st[ring];
      const center = pos.length / 3;
      pos.push(0, (s.top + s.bot) / 2, s.z);
      uv.push(0.5, 0.5);
      for (let k = 0; k < segs; k++) {
        const a = ring * row + k, b = a + 1;
        if (flip) idx.push(center, b, a);
        else idx.push(center, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const CANOPY: Station[] = [
  { z: 1.12, w: 0.7, top: 0.74, bot: 0.66 },
  { z: 0.72, w: 0.75, top: 0.96, bot: 0.68 },
  { z: 0.22, w: 0.73, top: 1.1, bot: 0.7 },
  { z: -0.32, w: 0.69, top: 1.12, bot: 0.72 },
  { z: -0.86, w: 0.62, top: 1.05, bot: 0.76 },
  { z: -1.34, w: 0.52, top: 0.97, bot: 0.82 },
  { z: -1.7, w: 0.4, top: 0.93, bot: 0.86 },
];

/** Resample stations along z with Catmull-Rom so lofted surfaces stay smooth lengthwise. */
function resample(st: Station[], per: number): Station[] {
  const a = [...st].sort((p, q) => p.z - q.z);
  const out: Station[] = [];
  const P = (i: number) => a[Math.max(0, Math.min(a.length - 1, i))];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < a.length - 1; i++)
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
      out.push({
        z: p1.z + (p2.z - p1.z) * t,
        w: cr(p0.w, p1.w, p2.w, p3.w, t),
        top: cr(p0.top, p1.top, p2.top, p3.top, t),
        bot: cr(p0.bot, p1.bot, p2.bot, p3.bot, t),
      });
    }
  out.push(a[a.length - 1]);
  return out;
}

let cache: {
  canopy: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  /** polished spokes + hub + lip, per side (index 0 = left, 1 = right) */
  rimSet: THREE.BufferGeometry[];
  /** dark inner barrel + brake disc, per side */
  hubSet: THREE.BufferGeometry[];
  beam: THREE.BufferGeometry;
  pool: THREE.BufferGeometry;
  poolTex: THREE.Texture;
  caliper: THREE.BufferGeometry;
  plume: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
  shadowTex: THREE.Texture;
} | null = null;

function geos() {
  if (cache) return cache;
  // tyre with a rounded sidewall (lathe profile around the axle)
  const prof: THREE.Vector2[] = [];
  const TW = 0.15;
  prof.push(new THREE.Vector2(0.255, -TW));
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    prof.push(new THREE.Vector2(0.325 + Math.cos(a) * 0.04, Math.sin(a) * TW));
  }
  prof.push(new THREE.Vector2(0.255, TW));
  const tire = new THREE.LatheGeometry(prof, 28);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.255, 0.255, 0.29, 32, 1, true);
  rim.rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.035, 0.23, 0.05);
  spoke.translate(0, 0.12, 0);
  const caliper = new THREE.BoxGeometry(0.08, 0.16, 0.2);
  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24);
  disc.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.055, 0.065, 0.06, 12);
  hub.rotateZ(Math.PI / 2);
  // headlight beam: soft cone along +Z
  const beam = new THREE.CylinderGeometry(3.4, 0.12, 26, 18, 1, true);
  beam.translate(0, -13, 0);
  beam.rotateX(-Math.PI / 2);
  const pool = new THREE.PlaneGeometry(7, 16);
  pool.rotateX(-Math.PI / 2);
  // crisp polished rim lip
  const lip = new THREE.TorusGeometry(0.258, 0.014, 5, 32);
  lip.rotateY(Math.PI / 2);
  // merge each wheel's static parts so a wheel is 3 draw calls, not 14
  const rimSet: THREE.BufferGeometry[] = [];
  const hubSet: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 10; k++) {
      const m = new THREE.Matrix4().makeTranslation(side * 0.12, 0, 0).multiply(new THREE.Matrix4().makeRotationX((k / 10) * Math.PI * 2 + (k % 2 ? 0.08 : -0.08)));
      parts.push(prep(spoke.clone(), m));
    }
    parts.push(prep(lip.clone(), new THREE.Matrix4().makeTranslation(side * 0.135, 0, 0)));
    parts.push(prep(hub.clone(), new THREE.Matrix4().makeTranslation(side * 0.13, 0, 0)));
    rimSet.push(mergeGeometries(parts)!);
    hubSet.push(mergeGeometries([
      prep(rim.clone(), new THREE.Matrix4().makeScale(0.35, 1, 1)), // inner barrel only; the face is open spokes
      prep(disc.clone(), new THREE.Matrix4().makeTranslation(side * 0.02, 0, 0)),
    ])!);
  }
  // open cone: narrow at the vent (y = 0), wide at the far end (y = 1)
  const plume = new THREE.CylinderGeometry(1, 0.07, 1, 24, 22, true);
  plume.translate(0, 0.5, 0);
  {
    // stays a tight jet near the vent, then billows out (radius ~ y^1.6)
    const pa = plume.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      const rOld = 0.07 + 0.93 * y;
      const rNew = 0.06 + 0.94 * Math.pow(y, 1.6);
      const k = rNew / rOld;
      pa.setX(i, pa.getX(i) * k);
      pa.setZ(i, pa.getZ(i) * k);
    }
    plume.computeVertexNormals();
  }
  const shadow = new THREE.PlaneGeometry(2.6, 5.4);
  shadow.rotateX(-Math.PI / 2);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(c);
  cache = {
    canopy: loft(resample(CANOPY, 4), 44, 2.5, 8, 0.05),
    tire, rimSet, hubSet, caliper, plume, shadow, shadowTex, beam, pool, poolTex: poolTexture(),
  };
  return cache;
}

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 96, 4, 32, 70, 70);
  grd.addColorStop(0, 'rgba(255,248,235,1)');
  grd.addColorStop(0.45, 'rgba(255,240,220,0.45)');
  grd.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(c);
}

/** Visible headlight cone: faint, fades with distance and toward its edges. */
export function makeBeamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.96, 0.88) } },
    vertexShader: /* glsl */ `
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main(){ vT = clamp(position.z / 26.0, 0.0, 1.0); vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vT; varying vec3 vN; varying vec3 vV;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = pow(1.0 - vT, 1.8) * edge * 0.17;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export const plumeVert = /* glsl */ `
varying float vY;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main(){
  vY = position.y;
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

/** Cold-gas vapour: dense bright jet at the vent, expanding turbulent column, soft edges. */
export const plumeFrag = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
uniform float uLen;
uniform float uTail;
varying float vY;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// value noise that wraps around the cone (period P along x) so there is no seam
float vn(vec2 p, float P){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, P), x1 = mod(i.x + 1.0, P);
  float a = h21(vec2(x0, i.y)), b = h21(vec2(x1, i.y));
  float c = h21(vec2(x0, i.y + 1.0)), d = h21(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main(){
  float y = clamp(vY, 0.0, 1.0);
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float soft = smoothstep(0.08, 0.85, facing);
  float flow = uTime * (2.6 + uLen * 0.22);
  vec2 q = vec2(vUv.x * 9.0, y * uLen * 0.6 - flow + uSeed);
  float n = 0.55 * vn(q, 9.0) + 0.3 * vn(q * vec2(2.0, 2.2) + 3.7, 18.0) + 0.15 * vn(q * 4.1 + 1.3, 36.0);
  float billow = 0.45 + 0.55 * vn(vec2(vUv.x * 4.0, y * uLen * 0.22 - flow * 0.55 + uSeed * 2.0), 4.0);
  float start = smoothstep(0.0, 0.02, y);
  float tail = 1.0 - smoothstep(uTail, 1.0, y);
  float jet = exp(-y * uLen * 0.55);
  float a = uIntensity * soft * start * tail * (0.12 + 0.88 * pow(n, 1.5)) * billow * (0.28 + 0.55 * jet + 0.3 * y);
  vec3 col = mix(vec3(1.0, 1.08, 1.16), vec3(0.58, 0.7, 0.88), smoothstep(0.0, 0.4, y));
  col += vec3(0.25, 0.45, 0.9) * jet * 0.55;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.72));
}`;

export function makePlumeMaterial(seed: number, tail: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uSeed: { value: seed },
      uLen: { value: 3 },
      uTail: { value: tail },
    },
    vertexShader: plumeVert,
    fragmentShader: plumeFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function buildRoadster(paintColor: number, accentColor: number, envMap: THREE.Texture | null): RoadsterParts {
  const G = geos();
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const body = new THREE.Group();
  chassis.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.9,
    roughness: 0.17,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMap,
    envMapIntensity: 1.3,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x05070a,
    metalness: 0.9,
    roughness: 0.02,
    clearcoat: 1,
    clearcoatRoughness: 0,
    envMap,
    envMapIntensity: 1.9,
  });
  const trim = new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.5, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, envMap, envMapIntensity: 1.1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.2, roughness: 0.7, envMap, envMapIntensity: 0.35 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0d0e11, metalness: 0.55, roughness: 0.3, envMap, envMapIntensity: 0.8 });
  const gapMat = new THREE.MeshBasicMaterial({ color: 0x020203, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.82 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 1, roughness: 0.14, envMap, envMapIntensity: 1.3 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.35, envMap, envMapIntensity: 0.6, side: THREE.DoubleSide });
  const caliperMat = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 0.15, roughness: 0.35 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdcefff, emissiveIntensity: 2.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1428, emissiveIntensity: 2.2, side: THREE.DoubleSide });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 1.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  // ---- hard-surface body: separate panels meet at crisp character lines ----
  const B = bodyGeometries();
  add(B.paint, paint);
  add(B.trim, trim);
  add(B.dark, black);
  add(B.carbon, carbon);
  add(G.canopy, glass);
  // small emissive / detail parts don't need to cast shadows
  for (const [geo, mat] of [[B.gaps, gapMat], [B.head, headMat], [B.tail, tailMat], [B.accent, accentMat]] as const) add(geo, mat).userData.noShadow = true;

  // ---- night headlight beams + light pool ----
  const beams = new THREE.Group();
  const beamMat = makeBeamMaterial();
  for (const sx of [-1, 1]) {
    const bm = new THREE.Mesh(G.beam, beamMat);
    bm.position.set(sx * 0.62, 0.52, 2.15);
    bm.rotation.set(0.05, sx * -0.04, 0);
    bm.frustumCulled = false;
    bm.userData.fx = true;
    beams.add(bm);
  }
  const pool = new THREE.Mesh(
    G.pool,
    new THREE.MeshBasicMaterial({ map: G.poolTex, color: new THREE.Color(0.95, 0.9, 0.84), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  pool.position.set(0, 0.05, 9.5);
  pool.renderOrder = 2;
  pool.userData.fx = true;
  beams.add(pool);
  beams.visible = false;
  root.add(beams);

  // ---- wheels ----
  const wheels: THREE.Group[] = [];
  const steerPivots: THREE.Group[] = [];
  const wheelPos: [number, number][] = [[-0.9, WHEEL_Z[0]], [0.9, WHEEL_Z[0]], [-0.9, WHEEL_Z[1]], [0.9, WHEEL_Z[1]]];
  for (const [x, z] of wheelPos) {
    const pivot = new THREE.Group();
    pivot.position.set(x, AXLE_Y, z);
    chassis.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    const side = x > 0 ? 1 : 0;
    add(G.tire, rubber, spin);
    add(G.hubSet[side], barrelMat, spin).userData.noShadow = true;
    add(G.rimSet[side], rimMat, spin).userData.noShadow = true;
    const cal = add(G.caliper, caliperMat, pivot);
    cal.userData.noShadow = true;
    cal.position.set(Math.sign(x) * 0.08, 0.12, z > 0 ? -0.1 : 0.1);
    wheels.push(spin);
    if (z > 0) steerPivots.push(pivot);
  }

  // ---- 10 hidden jets (no visible nozzles) ----
  const thrusters: Thruster[] = [];
  const flameMats: THREE.ShaderMaterial[] = [];
  const specs: [ThrusterKind, number, number, number, number, number, number, number, number][] = [
    // kind, px, py, pz, dx, dy, dz, length, width   (vents sit inside the diffuser / skirt / floor)
    ['rear', -0.55, 0.3, -2.3, 0, 0, -1, 4.2, 0.45],
    ['rear', -0.19, 0.3, -2.31, 0, 0, -1, 4.8, 0.5],
    ['rear', 0.19, 0.3, -2.31, 0, 0, -1, 4.8, 0.5],
    ['rear', 0.55, 0.3, -2.3, 0, 0, -1, 4.2, 0.45],
    ['side', -0.98, 0.24, -1.95, -0.3, -0.05, -1, 3.0, 0.38],
    ['side', 0.98, 0.24, -1.95, 0.3, -0.05, -1, 3.0, 0.38],
    ['lift', -0.6, 0.16, 1.2, 0, -1, -0.06, 3.5, 0.5],
    ['lift', 0.6, 0.16, 1.2, 0, -1, -0.06, 3.5, 0.5],
    ['lift', -0.6, 0.16, -1.25, 0, -1, -0.06, 3.5, 0.5],
    ['lift', 0.6, 0.16, -1.25, 0, -1, -0.06, 3.5, 0.5],
  ];
  const up = new THREE.Vector3(0, 1, 0);
  specs.forEach(([kind, px, py, pz, dx, dy, dz, len, width], i) => {
    const pos = new THREE.Vector3(px, py, pz);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const mat = makePlumeMaterial(i * 1.37, kind === 'lift' ? 0.8 : 0.35);
    flameMats.push(mat);
    const plume = add(G.plume, mat);
    plume.position.copy(pos).addScaledVector(dir, 0.04);
    plume.quaternion.copy(q);
    plume.scale.set(width, 0.001, width);
    plume.frustumCulled = false;
    plume.visible = false;
    plume.renderOrder = 6;
    thrusters.push({ kind, pos, dir, plume, mat, length: len, width });
  });

  // blob shadow
  const shadowMat = new THREE.MeshBasicMaterial({ map: G.shadowTex, transparent: true, depthWrite: false, opacity: 0.9 });
  const shadow = new THREE.Mesh(G.shadow, shadowMat);
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, chassis, body, wheels, steerPivots, thrusters, tailMat, headMat, paint, flameMats, shadow, beams, pool };
}
