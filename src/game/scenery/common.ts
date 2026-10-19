import * as THREE from 'three';
import type { TrackData } from '../track/TrackData';
import type { Theme } from '../track/themes';

/** Coarse occupancy grid around the track so scenery never blocks the road. */
export class Clearance {
  private cells = new Set<number>();
  constructor(readonly cell: number) {}
  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  markTrack(tr: TrackData, radius: number) {
    const r = Math.ceil(radius / this.cell);
    for (let i = 0; i < tr.n; i += 2) {
      const cx = Math.floor(tr.px[i] / this.cell), cz = Math.floor(tr.pz[i] / this.cell);
      for (let a = -r; a <= r; a++)
        for (let b = -r; b <= r; b++) {
          const x = (cx + a + 0.5) * this.cell - tr.px[i], z = (cz + b + 0.5) * this.cell - tr.pz[i];
          if (x * x + z * z <= (radius + this.cell * 0.71) ** 2) this.cells.add(this.key(cx + a, cz + b));
        }
    }
  }
  free(x: number, z: number, halfX: number, halfZ = halfX) {
    const x0 = Math.floor((x - halfX) / this.cell), x1 = Math.floor((x + halfX) / this.cell);
    const z0 = Math.floor((z - halfZ) / this.cell), z1 = Math.floor((z + halfZ) / this.cell);
    for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) if (this.cells.has(this.key(a, b))) return false;
    return true;
  }
}

const SKY_FRAG = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunDisc; uniform float moon;
uniform float stars; uniform float clouds; uniform vec3 cloudLit; uniform vec3 cloudShade;
uniform float uTime;
varying vec3 vDir;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.97;
}
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.0
    ? mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.5))
    : mix(horizon, bottom, pow(clamp(-y * 3.0, 0.0, 1.0), 0.6));
  float sd = max(dot(d, sunDir), 0.0);
  // stars (fixed to the sky, gently twinkling)
  if (stars > 0.0 && y > 0.0) {
    vec3 sp = d * 180.0;
    vec3 id = floor(sp);
    vec3 fr = fract(sp) - 0.5;
    float h = h31(id);
    vec3 off = vec3(h31(id + 1.7), h31(id + 3.1), h31(id + 5.3)) - 0.5;
    float dd = length(fr - off * 0.6);
    float b = step(0.985, h) * smoothstep(0.32, 0.0, dd);
    b *= 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 80.0);
    b *= 0.6 + 2.4 * step(0.997, h);
    col += vec3(0.9, 0.94, 1.0) * b * stars * smoothstep(0.0, 0.18, y);
  }
  // sun
  if (sunDisc > 0.0) {
    col += sunColor * smoothstep(0.99955, 0.9997, sd) * 30.0 * sunDisc;
    col += sunColor * pow(sd, 32.0) * 0.5 * sunDisc;
    col += sunColor * pow(sd, 4.0) * 0.14 * sunDisc;
  }
  // moon: mottled disc with a soft halo
  if (moon > 0.0) {
    float md = smoothstep(0.99925, 0.99945, sd);
    vec3 tang = normalize(cross(sunDir, vec3(0.0, 1.0, 0.0)));
    vec3 bit = cross(tang, sunDir);
    vec2 mp = vec2(dot(d, tang), dot(d, bit)) * 900.0;
    float mott = 0.78 + 0.22 * vn(mp * 0.6) - 0.12 * smoothstep(0.55, 0.8, vn(mp * 0.25 + 3.0));
    col = mix(col, vec3(1.0, 0.98, 0.92) * 1.6 * mott * moon, md);
    col += vec3(0.6, 0.7, 0.95) * pow(sd, 400.0) * 0.6 * moon;
    col += vec3(0.4, 0.5, 0.8) * pow(sd, 18.0) * 0.08 * moon;
  }
  // clouds: a drifting layer projected on a dome
  if (clouds > 0.0 && y > 0.0) {
    vec2 cuv = d.xz / (y + 0.12) * 0.9 + vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(cuv * 1.3);
    float cov = smoothstep(1.0 - clouds * 0.75 - 0.18, 1.0 - clouds * 0.75 + 0.22, n);
    float thick = fbm(cuv * 1.3 + sunDir.xz * 0.06);
    float lit = clamp(0.55 + (n - thick) * 4.0 + pow(sd, 6.0) * 0.6, 0.0, 1.25);
    vec3 cc = mix(cloudShade, cloudLit, lit);
    float fade = smoothstep(0.0, 0.14, y);
    col = mix(col, cc, cov * fade * 0.94);
    // silver lining near the sun / moon
    col += (sunDisc > 0.0 ? sunColor : vec3(0.6, 0.7, 0.95) * moon) * pow(sd, 12.0) * cov * fade * 0.35;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Sky dome: gradient, sun or mooon, stars and a drifting cloud layer. */
export function makeSky(theme: Theme) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      horizon: { value: new THREE.Color(theme.skyHorizon) },
      bottom: { value: new THREE.Color(theme.skyBottom) },
      sunDir: { value: new THREE.Vector3(...theme.sunDir).normalize() },
      sunColor: { value: new THREE.Color(theme.sunColor) },
      sunDisc: { value: theme.sunDisc },
      moon: { value: theme.moon },
      stars: { value: theme.stars },
      clouds: { value: theme.clouds },
      cloudLit: { value: new THREE.Color(theme.cloudLit) },
      cloudShade: { value: new THREE.Color(theme.cloudShade) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: SKY_FRAG,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

/** Small environment scene → PMREM, gives the paint its reflections. */
export function makeEnvMap(renderer: THREE.WebGLRenderer, theme: Theme) {
  const scene = new THREE.Scene();
  const sky = makeSky(theme);
  sky.scale.setScalar(0.01);
  scene.add(sky);
  const panel = (color: number, k: number, pos: [number, number, number], size: [number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(...size), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  if (theme.road === 'city' && theme.night) {
    panel(theme.neonA, 3, [12, 4, 0], [2, 18]);
    panel(theme.neonB, 3, [-12, 5, 3], [2, 18]);
    panel(0xffffff, 2.5, [0, 14, 0], [20, 3]);
    panel(0xff8a2a, 2, [0, 4, -14], [10, 2]);
    panel(0x6a5cff, 2, [0, 6, 14], [12, 3]);
  } else if (!theme.night) {
    const d = new THREE.Vector3(...theme.sunDir).normalize().multiplyScalar(30);
    panel(theme.sunColor, 8, [d.x, d.y, d.z], [6, 6]);
    panel(0xffffff, 1.2, [0, 25, 0], [40, 40]);
    if (theme.road === 'city') {
      // surrounding towers in the reflections
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        panel(i % 2 ? 0x5b6a7c : 0x8a8f96, 1, [Math.cos(a) * 26, 8, Math.sin(a) * 26], [9, 30]);
      }
    }
  } else {
    const d = new THREE.Vector3(...theme.sunDir).normalize().multiplyScalar(30);
    panel(0xcfd8ff, 2.5, [d.x, d.y, d.z], [2.5, 2.5]);
    if (theme.lamps) {
      panel(0xffc070, 2, [14, 6, 0], [2, 2]);
      panel(0xffc070, 2, [-14, 6, 6], [2, 2]);
    }
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: theme.hemiGround }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  scene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  return rt.texture;
}
