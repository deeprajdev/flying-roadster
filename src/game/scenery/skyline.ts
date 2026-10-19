import * as THREE from 'three';

/**
 * Instanced skyline in the spirit of San Francisco and New York at night:
 * glass supertalls, Art Deco setback towers with floodlit crowns and spires, a white pyramid
 * tower, mid-rise brick blocks with rooftop water tanks, and a suspension bridge over a bay.
 *
 * Every building part is one instance of a shared box / cylinder / pyramid / spire geometry.
 * Per-instance `aStyle` = (style, seed, topY, litFraction); instanceColor = accent light colour.
 */

export const S = {
  GLASS: 0,     // curtain wall: reflective glass, lit office floors
  DECO: 1,      // masonry: punched warm windows, floodlit crown
  WHITE: 2,     // pale concrete (pyramid tower)
  CROWN: 3,     // solid emissive crown / light band
  SPIRE: 4,     // metal spire lit from below
  FINS: 5,      // dark glass with vertical LED fins
  PLAIN: 7,     // no windows (water tanks, decks)
  STEEL: 8,     // floodlit painted steel (bridge)
  CYL: 10,      // add to a style for cylinder parts
} as const;

export type PartGeo = 'box' | 'cyl' | 'pyr' | 'spire';

export interface Part {
  geo: PartGeo;
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  style: number; seed: number; top: number; lit: number;
  color: number;
}

const VERT = /* glsl */ `
attribute vec4 aStyle;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vS; varying vec4 vSt; varying vec3 vC;
varying float vDepth; varying float vBase;
void main(){
  mat4 im = instanceMatrix;
  vec3 sc = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vW = wp.xyz;
  // inverse-transpose for a scale(+rotation) instance matrix
  vN = normalize(mat3(modelMatrix) * (mat3(im) * (normal / (sc * sc))));
  vL = position; vS = sc; vSt = aStyle; vBase = (modelMatrix * im[3]).y;
  #ifdef USE_INSTANCING_COLOR
    vC = instanceColor;
  #else
    vC = vec3(1.0);
  #endif
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uFog; uniform float uDensity; uniform float uTime; uniform vec3 uSkyTop; uniform vec3 uSkyHz;
uniform float uDay; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmbSky; uniform vec3 uAmbGround;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vS; varying vec4 vSt; varying vec3 vC;
varying float vDepth; varying float vBase;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 skyRefl(vec3 R){
  return R.y > 0.0 ? mix(uSkyHz, uSkyTop, clamp(R.y * 1.5, 0.0, 1.0)) : mix(uSkyHz, uAmbGround * 0.5, clamp(-R.y * 3.0, 0.0, 1.0));
}

void main(){
  float style = vSt.x; float seed = vSt.y; float topY = vSt.z; float litF = vSt.w;
  bool cyl = style > 9.5;
  if (cyl) style -= 10.0;
  vec3 n = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 R = reflect(-V, n);
  float wall = 1.0 - smoothstep(0.6, 0.9, abs(n.y));
  float y = vW.y;
  bool day = uDay > 0.5;
  // daylight: sun + sky/ground ambient, a little darker down in the street canyons
  float ndl = max(dot(n, uSunDir), 0.0);
  float ao = mix(0.5, 1.0, smoothstep(0.0, 45.0, y - vBase * 0.0));
  vec3 light = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5) * ao + uSunCol * ndl;
  float glint = pow(max(dot(R, uSunDir), 0.0), 260.0);
  vec3 base = vec3(0.0);
  vec3 emis = vec3(0.0);

  if (style > 2.5 && style < 3.5) {
    // crown / light band: polished metal by day, glowing at night
    if (day) base = mix(vec3(0.55), vC, 0.25) * light + skyRefl(R) * 0.25 + uSunCol * glint;
    else emis = vC * (0.95 + 0.2 * sin(uTime * 1.1 + seed * 40.0));
  } else if (style > 3.5 && style < 4.5) {
    float g = clamp((y - vBase) / max(1.0, topY - vBase), 0.0, 1.0);
    if (day) base = vec3(0.62, 0.64, 0.68) * light * 0.8 + skyRefl(R) * 0.3 + uSunCol * glint * 1.5;
    else {
      base = vec3(0.05, 0.055, 0.07);
      emis = vC * (0.12 + 0.6 * g) + vec3(1.0) * pow(g, 12.0) * 1.4;
    }
  } else if (style > 6.5 && style < 7.5) {
    base = day ? vC * light * 0.9 : vC * 0.3;
  } else if (style > 7.5 && style < 8.5) {
    float g = clamp((y - vBase) / max(1.0, topY - vBase), 0.0, 1.0);
    if (day) base = vC * light * 0.75 + uSunCol * glint * 0.3;
    else {
      base = vC * 0.22;
      emis = vC * (0.22 + 0.2 * g);
    }
  } else {
    bool curtain = style < 0.5 || style > 4.5;
    float u = cyl ? atan(vL.z, vL.x) * 0.5 * vS.x : (abs(n.x) > abs(n.z) ? vW.z : vW.x);
    float colW = curtain ? 1.65 : (style < 1.5 ? 2.5 : 2.1);
    float floorH = style > 0.5 && style < 1.5 ? 3.5 : 3.9;
    vec2 cell = vec2(u / colW, y / floorH);
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float win = curtain
      ? step(0.06, f.x) * step(f.x, 0.94) * step(0.14, f.y) * step(f.y, 0.94)
      : step(0.24, f.x) * step(f.x, 0.76) * step(0.2, f.y) * step(f.y, 0.78);
    vec2 fw = fwidth(cell);
    float aa = smoothstep(0.3, 0.85, max(fw.x, fw.y));
    float rFloor = h21(vec2(id.y, seed * 91.7));
    float rWin = h21(id + seed * 57.3 + n.xz * 13.1);
    float seed2 = fract(seed * 7.13);

    if (day) {
      if (curtain) {
        // glass tint per tower: blue-green, silver, bronze or smoked
        vec3 tint = seed2 < 0.3 ? vec3(0.09, 0.15, 0.19) : seed2 < 0.6 ? vec3(0.19, 0.21, 0.23) : seed2 < 0.8 ? vec3(0.15, 0.12, 0.09) : vec3(0.05, 0.06, 0.07);
        float F = 0.18 + 0.82 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 pane = tint * light * 0.3 * (0.85 + 0.3 * rWin) + skyRefl(R) * F + uSunCol * glint * 1.2;
        vec3 frame = vec3(0.5, 0.52, 0.55) * light;
        vec3 spandrel = mix(tint * 2.0, vec3(0.35), 0.5) * light;
        vec3 c = f.y < 0.14 ? spandrel : frame;
        base = mix(mix(c, pane, win), pane * 0.9 + frame * 0.1, aa);
        if (style > 4.5) {
          float fin = smoothstep(0.42, 0.47, abs(fract(u / 5.0) - 0.5));
          base = mix(base, vec3(0.6, 0.62, 0.65) * light, fin);
        }
      } else {
        // masonry: limestone, brick, sandstone, granite; white concrete for style 2
        vec3 stone = style > 1.5 ? vec3(0.72, 0.71, 0.68)
          : seed2 < 0.35 ? vec3(0.62, 0.57, 0.48) : seed2 < 0.65 ? vec3(0.42, 0.23, 0.16) : seed2 < 0.85 ? vec3(0.55, 0.45, 0.33) : vec3(0.42, 0.42, 0.44);
        stone *= 0.92 + 0.16 * h21(vec2(id.y, 3.0));
        float course = step(0.94, fract(y / (floorH * 4.0)));
        stone = mix(stone, stone * 1.18, course);
        vec3 glass = vec3(0.03, 0.035, 0.045) * light + skyRefl(R) * 0.22 + uSunCol * glint * 0.6;
        // recessed windows: lintel shadow across the top of the pane, a bright sill below
        float wy = clamp((f.y - 0.2) / 0.58, 0.0, 1.0);
        glass *= mix(1.0, 0.45, smoothstep(0.62, 0.95, wy));
        vec3 wall2 = stone * light * 0.85;
        wall2 *= 1.0 + 0.25 * step(0.16, f.y) * step(f.y, 0.2) * step(0.24, f.x) * step(f.x, 0.76);
        base = mix(mix(wall2, glass, win), mix(wall2, glass, 0.35), aa);
      }
      // ground floor: shop windows and canopies
      float street = 1.0 - step(5.5, y);
      base = mix(base, vec3(0.05, 0.06, 0.07) * light + skyRefl(R) * 0.3, street * wall * 0.8);
      base = mix(vec3(0.32, 0.32, 0.33) * light * 0.8, base, wall); // roofs
    } else {
      // ---- night: lit interiors ----
      float lit = curtain
        ? min(1.0, step(1.0 - litF, rFloor) * step(0.14, rWin) + step(0.95, rWin))
        : step(1.0 - litF, rWin);
      float temp = h21(vec2(rWin, seed));
      vec3 warm = vec3(1.0, 0.7, 0.4), neutral = vec3(1.0, 0.86, 0.66), cool = vec3(0.8, 0.9, 1.0);
      vec3 wc = curtain ? (rFloor > 0.72 ? neutral : cool) : (temp < 0.55 ? warm : temp < 0.9 ? neutral : cool);
      float hb = h21(id * 1.71 + seed);
      float bright = 0.32 + 0.4 * hb + step(0.985, hb) * 0.8;
      // ceiling light falloff inside the room, and blinds on some windows
      bright *= mix(0.7, 1.12, f.y);
      if (hb > 0.75 && hb < 0.9) bright *= 0.55 + 0.45 * step(0.5, fract(f.y * 9.0));
      // the odd TV glow
      if (rWin > 0.993) { wc = vec3(0.45, 0.6, 1.0); bright *= 0.6 + 0.4 * sin(uTime * 7.0 + hb * 30.0); }
      float winLit = mix(win * lit, litF * (curtain ? 0.4 : 0.22), aa);
      if (curtain) {
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        base = vec3(0.006, 0.009, 0.016) + skyRefl(R) * (0.12 + 0.6 * fres);
      } else if (style < 1.5) {
        base = vec3(0.032, 0.027, 0.023);
      } else {
        base = vec3(0.085, 0.085, 0.09);
      }
      base *= 1.0 - winLit * 0.6;
      emis += wc * bright * winLit * wall;
      // crown floodlighting washing up the top of the tower
      float wash = min(curtain ? 24.0 : 50.0, topY * 0.16);
      float crown = smoothstep(topY - wash, topY, y) * wall * step(80.0, topY);
      emis += vC * crown * (curtain ? 0.1 : 0.32);
      if (!curtain) {
        base += vC * crown * 0.06;
        // architectural uplighting at the base of stone towers
        emis += vec3(1.0, 0.78, 0.5) * (1.0 - smoothstep(4.0, 16.0, y)) * (1.0 - win) * wall * 0.1;
      }
      // lobbies and shop fronts at street level
      float street = (1.0 - smoothstep(0.0, 6.5, y)) * wall;
      emis += vec3(1.0, 0.72, 0.42) * street * (0.12 + 0.3 * h21(vec2(id.x, seed)));
      if (style > 4.5) {
        float fin = smoothstep(0.44, 0.49, abs(fract(u / 5.0) - 0.5));
        emis += vC * fin * 0.5 * wall;
      }
      if (!cyl) {
        // distance to the nearest vertical corner, measured along this face
        float ex = abs(n.x) > abs(n.z) ? abs(abs(vL.z) - 0.5) * vS.z : abs(abs(vL.x) - 0.5) * vS.x;
        float edge = (1.0 - smoothstep(0.12, 0.4, ex)) * step(0.7, seed) * wall;
        emis += vC * edge * 0.75;
      }
      base = mix(vec3(0.018, 0.018, 0.026), base, wall);
    }
  }
  float fogF = 1.0 - exp(-uDensity * uDensity * vDepth * vDepth);
  vec3 col = mix(base, uFog, fogF) + emis * (1.0 - fogF * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;
export interface SkyLight {
  day: boolean;
  sunDir: THREE.Vector3;
  sun: THREE.Color;      // colour × intensity
  ambSky: THREE.Color;
  ambGround: THREE.Color;
}

export function skylineMaterial(fog: THREE.Color, density: number, skyTop: THREE.Color, skyHz: THREE.Color, L: SkyLight) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFog: { value: fog },
      uDensity: { value: density },
      uTime: { value: 0 },
      uSkyTop: { value: skyTop },
      uSkyHz: { value: skyHz },
      uDay: { value: L.day ? 1 : 0 },
      uSunDir: { value: L.sunDir },
      uSunCol: { value: L.sun },
      uAmbSky: { value: L.ambSky },
      uAmbGround: { value: L.ambGround },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

let GEOS: Record<PartGeo, THREE.BufferGeometry> | null = null;
function geos() {
  if (GEOS) return GEOS;
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1);
  cyl.translate(0, 0.5, 0);
  let pyr: THREE.BufferGeometry = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  pyr.rotateY(Math.PI / 4);
  pyr.translate(0, 0.5, 0);
  pyr = pyr.toNonIndexed();
  pyr.computeVertexNormals();
  const spire = new THREE.ConeGeometry(0.5, 1, 8, 1);
  spire.translate(0, 0.5, 0);
  GEOS = { box, cyl, pyr, spire };
  return GEOS;
}

/** Turn a list of parts into one InstancedMesh per geometry. */
export function buildParts(parts: Part[], mat: THREE.ShaderMaterial) {
  const group = new THREE.Group();
  const G = geos();
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const kind of ['box', 'cyl', 'pyr', 'spire'] as PartGeo[]) {
    const list = parts.filter((p) => p.geo === kind);
    if (!list.length) continue;
    const geo = G[kind].clone();
    const st = new Float32Array(list.length * 4);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      m.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(p.color));
      st[i * 4] = p.style + (kind === 'cyl' ? S.CYL : 0);
      st[i * 4 + 1] = p.seed;
      st[i * 4 + 2] = p.top;
      st[i * 4 + 3] = p.lit;
    });
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(st, 4));
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

// ------------------------------------------------------------------ tower recipes
const CROWN_COLORS = [0xffffff, 0xffc46b, 0x6fd0ff, 0xff4fa8, 0x9b7bff, 0x4fffb0, 0xff6a3d, 0xe8f0ff];

export interface Beacon { x: number; y: number; z: number; strobe: boolean }

export class TowerKit {
  parts: Part[] = [];
  beacons: Beacon[] = [];
  roofs: { x: number; y: number; z: number; h: number }[] = []; // candidate searchlight spots
  constructor(private rnd: () => number) {}

  private push(p: Omit<Part, 'seed'> & { seed?: number }) {
    this.parts.push({ seed: this.rnd(), ...p } as Part);
  }

  private crownColor() {
    return CROWN_COLORS[Math.floor(this.rnd() * CROWN_COLORS.length)];
  }

  /** NY / SF glass supertall: podium, shaft, light band, optional setback cap. */
  glass(x: number, z: number, w: number, d: number, H: number) {
    const r = this.rnd;
    const col = this.crownColor();
    const lit = 0.35 + r() * 0.4;
    const pod = 10 + r() * 8;
    this.push({ geo: 'box', x, y: 0, z, sx: w * 1.5, sy: pod, sz: d * 1.5, style: S.DECO, top: pod, lit: 0.6, color: 0xffc070 });
    const fins = r() < 0.3;
    const cap = r() < 0.5 ? H * (0.08 + r() * 0.06) : 0;
    const shaftTop = H - cap;
    this.push({ geo: 'box', x, y: 0, z, sx: w, sy: shaftTop, sz: d, style: fins ? S.FINS : S.GLASS, top: H, lit, color: col });
    if (cap) this.push({ geo: 'box', x, y: shaftTop, z, sx: w * 0.72, sy: cap, sz: d * 0.72, style: S.GLASS, top: H, lit, color: col });
    this.push({ geo: 'box', x, y: H - 0.6, z, sx: (cap ? w * 0.72 : w) + 0.3, sy: 2.4, sz: (cap ? d * 0.72 : d) + 0.3, style: S.CROWN, top: H, lit: 0, color: col });
    if (r() < 0.5) {
      const mh = 18 + r() * 40;
      this.push({ geo: 'spire', x, y: H + 1.8, z, sx: 1.2, sy: mh, sz: 1.2, style: S.SPIRE, top: H + mh, lit: 0, color: 0xff5040 });
      this.beacons.push({ x, y: H + mh + 1.8, z, strobe: H > 260 });
    } else this.beacons.push({ x: x + w * 0.4, y: H + 1.8, z: z + d * 0.4, strobe: false }, { x: x - w * 0.4, y: H + 1.8, z: z - d * 0.4, strobe: false });
    this.roofs.push({ x, y: H + 2, z, h: H });
    if (!cap) this.roofPlant(x, z, w, d, H);
  }

  /** Rooftop plant: mechanical boxes, a cooling tower and an antenna mast. */
  roofPlant(x: number, z: number, w: number, d: number, H: number) {
    const r = this.rnd;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const bw = 3 + r() * Math.min(9, w * 0.35), bd = 3 + r() * Math.min(9, d * 0.35), bh = 2 + r() * 3;
      const ox = (r() - 0.5) * (w - bw) * 0.8, oz = (r() - 0.5) * (d - bd) * 0.8;
      this.push({ geo: 'box', x: x + ox, y: H, z: z + oz, sx: bw, sy: bh, sz: bd, style: S.PLAIN, top: H + bh, lit: 0, color: 0x6c6e72 });
    }
    if (r() < 0.4) this.push({ geo: 'cyl', x: x + (r() - 0.5) * w * 0.4, y: H, z: z + (r() - 0.5) * d * 0.4, sx: 4, sy: 3.5, sz: 4, style: S.PLAIN, top: H + 4, lit: 0, color: 0x8a8c90 });
    if (r() < 0.35) {
      const ah = 8 + r() * 14;
      this.push({ geo: 'spire', x: x + w * 0.3, y: H, z: z - d * 0.3, sx: 0.5, sy: ah, sz: 0.5, style: S.PLAIN, top: H + ah, lit: 0, color: 0x9a9ca0 });
      this.beacons.push({ x: x + w * 0.3, y: H + ah + 0.3, z: z - d * 0.3, strobe: false });
    }
  }

  /** SF-style cylinder tower with a lit glass crown. */
  round(x: number, z: number, dia: number, H: number) {
    const r = this.rnd;
    const col = this.crownColor();
    const lit = 0.4 + r() * 0.35;
    this.push({ geo: 'cyl', x, y: 0, z, sx: dia, sy: H, sz: dia, style: S.GLASS, top: H, lit, color: col });
    this.push({ geo: 'cyl', x, y: H - 22, z, sx: dia * 1.01, sy: 22, sz: dia * 1.01, style: S.CROWN, top: H, lit: 0, color: col });
    this.beacons.push({ x, y: H + 1, z, strobe: H > 260 });
    this.roofs.push({ x, y: H + 1, z, h: H });
  }

  /** NY Art Deco setback tower: tiers stepping in, floodlit crown, needle spire. */
  deco(x: number, z: number, w: number, H: number) {
    const r = this.rnd;
    const col = this.crownColor();
    const lit = 0.4 + r() * 0.3;
    const tiers = [
      [1.0, 0.36], [0.78, 0.26], [0.58, 0.18], [0.4, 0.12],
    ];
    let y = 0;
    const body = H * 0.92;
    for (const [k, f] of tiers) {
      const h = body * f;
      this.push({ geo: 'box', x, y, z, sx: w * k, sy: h, sz: w * k * (0.9 + r() * 0.2), style: S.DECO, top: body, lit, color: col });
      y += h;
    }
    this.push({ geo: 'box', x, y: y - 6, z, sx: w * 0.42, sy: 3, sz: w * 0.42, style: S.CROWN, top: y, lit: 0, color: col });
    const sp = H - y + 25 + r() * 25;
    this.push({ geo: 'spire', x, y, z, sx: w * 0.14, sy: sp, sz: w * 0.14, style: S.SPIRE, top: y + sp, lit: 0, color: col });
    this.beacons.push({ x, y: y + sp + 0.5, z, strobe: false });
    this.roofs.push({ x, y, z, h: y });
  }

  /** SF-style white pyramid tower with a lit tip. */
  pyramid(x: number, z: number, base: number, H: number) {
    this.push({ geo: 'box', x, y: 0, z, sx: base * 1.15, sy: 8, sz: base * 1.15, style: S.DECO, top: 8, lit: 0.7, color: 0xffc070 });
    this.push({ geo: 'pyr', x, y: 8, z, sx: base, sy: H - 8, sz: base, style: S.WHITE, top: H, lit: 0.55, color: 0xfff1d0 });
    this.push({ geo: 'spire', x, y: H - 30, z, sx: 3, sy: 62, sz: 3, style: S.SPIRE, top: H + 32, lit: 0, color: 0xffe0a0 });
    this.beacons.push({ x, y: H + 33, z, strobe: true });
  }

  /** Mid-rise brick / glass block, sometimes with a NY rooftop water tank. */
  midrise(x: number, z: number, w: number, d: number, H: number) {
    const r = this.rnd;
    const glass = r() < 0.35;
    const col = this.crownColor();
    this.push({ geo: 'box', x, y: 0, z, sx: w, sy: H, sz: d, style: glass ? S.GLASS : S.DECO, top: H, lit: 0.35 + r() * 0.4, color: col });
    if (!glass && r() < 0.45) {
      const ox = (r() - 0.5) * w * 0.5, oz = (r() - 0.5) * d * 0.5;
      this.push({ geo: 'box', x: x + ox, y: H, z: z + oz, sx: 3.6, sy: 3.2, sz: 3.6, style: S.PLAIN, top: H + 3, lit: 0, color: 0x2a2420 });
      this.push({ geo: 'cyl', x: x + ox, y: H + 3.2, z: z + oz, sx: 4.4, sy: 5, sz: 4.4, style: S.PLAIN, top: H + 8, lit: 0, color: 0x5a4636 });
      this.push({ geo: 'spire', x: x + ox, y: H + 8.2, z: z + oz, sx: 4.8, sy: 2.4, sz: 4.8, style: S.PLAIN, top: H + 11, lit: 0, color: 0x3a2e26 });
    } else if (r() < 0.5) this.roofPlant(x, z, w, d, H);
  }

  /** Long glass slab (SF financial district). */
  slab(x: number, z: number, w: number, d: number, H: number) {
    const col = this.crownColor();
    this.push({ geo: 'box', x, y: 0, z, sx: w, sy: H, sz: d, style: this.rnd() < 0.5 ? S.FINS : S.GLASS, top: H, lit: 0.4 + this.rnd() * 0.35, color: col });
    this.push({ geo: 'box', x, y: H - 0.5, z, sx: w + 0.3, sy: 1.6, sz: d + 0.3, style: S.CROWN, top: H, lit: 0, color: col });
    this.roofPlant(x, z, w, d, H + 1.1);
  }

  /** Pick a tower type for a lot, scaled by how "downtown" the lot is (0 near track → 1 core). */
  random(x: number, z: number, lot: number, core: number) {
    const r = this.rnd();
    if (core < 0.25) {
      if (r < 0.72) this.midrise(x, z, lot * (0.7 + this.rnd() * 0.25), lot * (0.7 + this.rnd() * 0.25), 18 + this.rnd() * 45);
      else if (r < 0.9) this.glass(x, z, lot * 0.62, lot * 0.62, 80 + this.rnd() * 90);
      else this.deco(x, z, lot * 0.8, 110 + this.rnd() * 90);
      return;
    }
    const tall = 140 + core * 220 + this.rnd() * 120;
    if (r < 0.34) this.glass(x, z, lot * (0.5 + this.rnd() * 0.2), lot * (0.5 + this.rnd() * 0.2), tall);
    else if (r < 0.58) this.deco(x, z, lot * 0.85, tall * 0.9);
    else if (r < 0.7) this.round(x, z, lot * 0.6, tall * 0.85);
    else if (r < 0.82) this.slab(x, z, lot * 0.9, lot * 0.4, 70 + this.rnd() * 90);
    else this.midrise(x, z, lot * 0.8, lot * 0.8, 30 + this.rnd() * 60);
  }
}

// ------------------------------------------------------------------ lights (points)
const POINT_VERT = /* glsl */ `
attribute vec3 aColor; attribute float aSize; attribute float aPhase; attribute vec4 aMove;
uniform float uTime; uniform float uViewH; uniform float uDensity;
varying vec3 vC; varying float vA;
void main(){
  vec3 p = position;
  if (aMove.z != 0.0) {
    float t = mod(aPhase * aMove.w + uTime * aMove.z, aMove.w);
    p.xz += aMove.xy * t;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float blink = 1.0;
  if (aMove.z == 0.0 && aPhase >= 0.0) {
    float ph = fract(uTime * 0.55 + aPhase);
    blink = aSize > 3.5 ? step(ph, 0.06) : smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.32, 0.45, ph));
  }
  float fog = 1.0 - exp(-uDensity * uDensity * d * d);
  vC = aColor;
  vA = blink * (1.0 - fog * 0.85);
  gl_PointSize = max(1.6, aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(d, 1.0));
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAG = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float a = (exp(-r * 3.5) * 0.85 + exp(-r * 18.0)) * vA;
  gl_FragColor = vec4(vC * a, a);
}`;

export interface LightPoint { x: number; y: number; z: number; color: [number, number, number]; size: number; phase: number; move?: [number, number, number, number] }

export function buildLights(points: LightPoint[], density: number) {
  const n = points.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), move = new Float32Array(n * 4);
  points.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    col.set(p.color, i * 3);
    size[i] = p.size;
    phase[i] = p.phase;
    if (p.move) move.set(p.move, i * 4);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aMove', new THREE.BufferAttribute(move, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uViewH: { value: 800 }, uDensity: { value: density } },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { pts, mat };
}

// ------------------------------------------------------------------ searchlights
export function searchlight(color: THREE.Color, length: number) {
  const geo = new THREE.CylinderGeometry(length * 0.055, 0.6, length, 20, 1, true);
  geo.translate(0, length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uLen: { value: length } },
    vertexShader: /* glsl */ `
      varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uLen;
      varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){
        float t = clamp(vY / uLen, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float a = pow(1.0 - t, 1.6) * edge * 0.1 * smoothstep(0.0, 0.08, t);
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ bay water
export function bayWater(fog: THREE.Color, density: number, skyHz: THREE.Color, skyTop: THREE.Color, L: SkyLight) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uFog: { value: fog }, uDensity: { value: density }, uSky: { value: skyHz }, uTop: { value: skyTop },
      uDay: { value: L.day ? 1 : 0 }, uSunDir: { value: L.sunDir }, uSun: { value: L.sun },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying float vDepth;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uFog; uniform float uDensity; uniform vec3 uSky; uniform vec3 uTop;
      uniform float uDay; uniform vec3 uSunDir; uniform vec3 uSun;
      varying vec3 vW; varying float vDepth;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
      void main(){
        vec2 p = vW.xz;
        // small wind waves → a perturbed normal
        float e = 0.6;
        float w0 = vn(p * 0.08 + uTime * 0.25) * 0.6 + vn(p * 0.21 - uTime * 0.4) * 0.4;
        float wx = vn((p + vec2(e, 0.0)) * 0.08 + uTime * 0.25) * 0.6 + vn((p + vec2(e, 0.0)) * 0.21 - uTime * 0.4) * 0.4;
        float wz = vn((p + vec2(0.0, e)) * 0.08 + uTime * 0.25) * 0.6 + vn((p + vec2(0.0, e)) * 0.21 - uTime * 0.4) * 0.4;
        vec3 n = normalize(vec3((w0 - wx) * 1.6, 1.0, (w0 - wz) * 1.6));
        vec3 v = normalize(cameraPosition - vW);
        vec3 R = reflect(-v, n);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 sky = mix(uSky, uTop, clamp(R.y * 1.4, 0.0, 1.0));
        vec3 col;
        if (uDay > 0.5) {
          vec3 deep = vec3(0.02, 0.07, 0.1);
          col = mix(deep, sky, fres);
          col += uSun * pow(max(dot(R, uSunDir), 0.0), 380.0) * 6.0;
        } else {
          col = vec3(0.006, 0.01, 0.022) + uSky * fres * 0.8;
          // city light shimmering on the water
          float w = vn(p * vec2(0.05, 0.6) + vec2(uTime * 0.3, uTime * 0.9)) * 0.6 + vn(p * vec2(0.11, 1.4) - uTime * 0.6) * 0.4;
          float glitter = pow(w, 7.0) * 2.2;
          float warm = vn(p * 0.012);
          col += mix(vec3(0.9, 0.55, 0.3), vec3(0.4, 0.6, 1.0), warm) * glitter * (0.35 + fres);
        }
        float fog = 1.0 - exp(-uDensity * uDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(col, uFog, fog * 0.92), 1.0);
      }`,
  });
}

