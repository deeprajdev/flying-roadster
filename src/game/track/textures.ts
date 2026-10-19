import * as THREE from 'three';
import { mulberry32 } from '../core/math';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, seed: number, count = 9000) {
  const rnd = mulberry32(seed);
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (rnd() - 0.5) * amp;
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    const s = 1 + rnd() * 2;
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

function tex(c: HTMLCanvasElement, repeatV = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = repeatV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type RoadStyle = 'city' | 'desert' | 'coastal';

/** Road surface: u across (0..1), v along (one tile = 16 m). */
/**
 * Asphalt: aggregate grain, tonal patches, darker racing line and oil stains, sealed cracks,
 * worn paint. Returns colour, normal and roughness maps (u across the road, v along, tile = 16 m).
 */
export function roadTexture(style: RoadStyle, wet = 0) {
  const W = 512, H = 1024;
  const rnd = mulberry32(style === 'city' ? 11 : style === 'desert' ? 12 : 13);
  const { c, g } = canvas(W, H);
  const height = canvas(W, H);
  const rough = canvas(W, H);
  const base: [number, number, number] = style === 'city' ? [40, 42, 48] : style === 'desert' ? [78, 70, 63] : [52, 53, 57];
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, W, H);
  height.g.fillStyle = 'rgb(128,128,128)';
  height.g.fillRect(0, 0, W, H);
  rough.g.fillStyle = `rgb(${Math.round(200 - wet * 120)},0,0)`;
  rough.g.fillRect(0, 0, W, H);
  // large tonal patches and patch repairs
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, r = 40 + rnd() * 140;
    const v = (rnd() - 0.5) * 14;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 3; i++) {
    const x = rnd() * W * 0.8, y = rnd() * H, w = 40 + rnd() * 90, h = 60 + rnd() * 160;
    g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.05})`;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1.5;
    g.strokeRect(x, y, w, h);
  }
  // aggregate grain (colour + height)
  for (let i = 0; i < 70000; i++) {
    const x = rnd() * W, y = rnd() * H, s = 0.8 + rnd() * 1.8;
    const v = rnd();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.16})` : `rgba(0,0,0,${(0.5 - v) * 0.22})`;
    g.fillRect(x, y, s, s);
    height.g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.9})` : `rgba(0,0,0,${(0.5 - v) * 0.9})`;
    height.g.fillRect(x, y, s, s);
  }
  // racing-line wear and oil drips down the lane centres
  for (const u of [0.3, 0.7]) {
    const grd = g.createLinearGradient(u * W - 60, 0, u * W + 60, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.14)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(u * W - 60, 0, 120, H);
    for (let i = 0; i < 18; i++) {
      const y = rnd() * H, r = 6 + rnd() * 16;
      g.fillStyle = 'rgba(10,10,14,0.22)';
      g.beginPath();
      g.ellipse(u * W + (rnd() - 0.5) * 30, y, r * 0.7, r * 1.6, 0, 0, Math.PI * 2);
      g.fill();
      rough.g.fillStyle = `rgba(${Math.round(110 - wet * 80)},0,0,0.6)`;
      rough.g.beginPath();
      rough.g.ellipse(u * W, y, r * 0.7, r * 1.6, 0, 0, Math.PI * 2);
      rough.g.fill();
    }
  }
  // sealed cracks
  g.strokeStyle = 'rgba(8,8,10,0.55)';
  g.lineWidth = 2.2;
  for (let i = 0; i < 9; i++) {
    let x = rnd() * W, y = rnd() * H;
    g.beginPath();
    g.moveTo(x, y);
    const n = 6 + Math.floor(rnd() * 10);
    for (let k = 0; k < n; k++) {
      x += (rnd() - 0.5) * 40;
      y += (rnd() - 0.2) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // puddles on a wet road: smooth patches in the roughness map
  if (wet > 0) {
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 70;
      const grd = rough.g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(20,0,0,0.9)');
      grd.addColorStop(1, 'rgba(20,0,0,0)');
      rough.g.fillStyle = grd;
      rough.g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  // paint (slightly worn): edge lines, centre / lane lines
  const paint = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    for (let i = 0; i < (w * h) / 30; i++) {
      g.fillStyle = `rgba(${base.join(',')},${0.4 + rnd() * 0.5})`;
      g.fillRect(x + rnd() * w, y + rnd() * h, 1.5, 1.5);
    }
    height.g.fillStyle = 'rgba(255,255,255,0.35)';
    height.g.fillRect(x, y, w, h);
    rough.g.fillStyle = `rgb(${Math.round(150 - wet * 60)},0,0)`;
    rough.g.fillRect(x, y, w, h);
  };
  const edge = style === 'desert' ? '#e6dfcc' : '#e9edf2';
  paint(0.035 * W, 0, 9, H, edge);
  paint(0.965 * W - 9, 0, 9, H, edge);
  if (style === 'desert') {
    paint(W / 2 - 11, 0, 7, H, '#e2b02c');
    paint(W / 2 + 4, 0, 7, H, '#e2b02c');
  } else {
    for (const u of [1 / 3, 2 / 3]) for (let v = 0; v < H; v += 256) paint(u * W - 4, v + 40, 8, 128, edge);
  }
  if (style === 'city') {
    g.fillStyle = 'rgba(80,220,255,0.9)';
    for (const u of [1 / 3, 2 / 3]) for (let v = 0; v < H; v += 256) g.fillRect(u * W - 5, v + 200, 10, 10);
  }
  // height → normal map
  const hd = height.g.getImageData(0, 0, W, H).data;
  const nimg = height.g.createImageData(W, H);
  const nd = nimg.data;
  const at = (x: number, y: number) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      nd[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      nd[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      nd[i + 2] = (1 / l) * 0.5 * 255 + 127;
      nd[i + 3] = 255;
    }
  height.g.putImageData(nimg, 0, 0);
  const map = tex(c);
  const normalMap = tex(height.c);
  normalMap.colorSpace = THREE.NoColorSpace;
  const roughnessMap = tex(rough.c);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  // roughness is read from the green channel
  const rd = rough.g.getImageData(0, 0, W, H);
  for (let i = 0; i < rd.data.length; i += 4) rd.data[i + 1] = rd.data[i];
  rough.g.putImageData(rd, 0, 0);
  roughnessMap.needsUpdate = true;
  return { map, normalMap, roughnessMap };
}

/** Concrete for jersey barriers (u across the profile, v along: joints every 4 m). */
export function concreteBarrierTexture(style: RoadStyle) {
  const W = 64, H = 256;
  const { c, g } = canvas(W, H);
  if (style === 'desert') {
    noise(g, W, H, [160, 150, 140], 40, 4, 2000);
    g.fillStyle = 'rgba(192,40,32,0.92)';
    for (let v = 0; v < H; v += 128) g.fillRect(0, v, W, 64);
  } else {
    noise(g, W, H, [150, 150, 148], 38, 4, 2500);
    // grime toward the road
    const grd = g.createLinearGradient(0, 0, W * 0.4, 0);
    grd.addColorStop(0, 'rgba(30,30,30,0.35)');
    grd.addColorStop(1, 'rgba(30,30,30,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let v = 0; v < H; v += 128) g.fillRect(0, v, W, 2);
  return tex(c);
}

/** Red / white racing kerb (u across, v along: 2 m blocks). */
export function kerbTexture() {
  const { c, g } = canvas(32, 128);
  g.fillStyle = '#d42a24';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 64, 32, 64);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < 128; y += 8) g.fillRect(0, y, 32, 1);
  return tex(c);
}

/** Skywall concrete: like the photo ramp — pale concrete, panel seams, thin white centre line. */
export function concreteTexture() {
  const W = 256, H = 512;
  const { c, g } = canvas(W, H);
  noise(g, W, H, [150, 150, 148], 40, 21, 14000);
  const rnd = mulberry32(5);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? 255 : 60},${rnd() > 0.5 ? 255 : 60},${rnd() > 0.5 ? 255 : 60},0.05)`;
    g.beginPath();
    g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 60, 10 + rnd() * 40, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(40,40,40,0.35)';
  g.fillRect(0, 0, W, 2);
  g.fillRect(0, H / 2, W, 2);
  g.fillRect(W * 0.25, 0, 1, H);
  g.fillRect(W * 0.75, 0, 1, H);
  g.fillStyle = '#f2f2ee';
  g.fillRect(W / 2 - 3, 0, 6, H);
  return tex(c);
}

/** Tunnel ceiling light strip: bright dash every tile (tile = 6 m). */
export function dashTexture() {
  const { c, g } = canvas(16, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 16, 128);
  g.fillStyle = '#fff';
  g.fillRect(0, 16, 16, 70);
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function barrierTexture(style: RoadStyle) {
  const W = 64, H = 256;
  const { c, g } = canvas(W, H);
  if (style === 'coastal') {
    noise(g, W, H, [200, 204, 210], 30, 3, 1500);
    g.fillStyle = '#9aa0a8';
    g.fillRect(0, H * 0.45, W, 6);
  } else if (style === 'desert') {
    noise(g, W, H, [150, 120, 96], 50, 4, 2000);
    g.fillStyle = '#c0392b';
    for (let v = 0; v < H; v += 64) g.fillRect(0, v, W, 32);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let v = 32; v < H; v += 64) g.fillRect(0, v, W, 32);
  } else {
    noise(g, W, H, [40, 42, 52], 40, 5, 1500);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let v = 0; v < H; v += 64) g.fillRect(0, v, W, 2);
  }
  return tex(c);
}

export function checkerTexture() {
  const { c, g } = canvas(256, 32);
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = tex(c, false);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Neon sign / billboard text texture. */
export function signTexture(text: string, color: string, sub?: string, w = 1024, h = 256, bg = 'rgba(4,6,14,0.92)') {
  const { c, g } = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.floor(h * (sub ? 0.5 : 0.62))}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
  g.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) {
    g.font = `600 ${Math.floor(h * 0.2)}px Barlow, Arial, sans-serif`;
    g.fillStyle = '#e8f6ff';
    g.fillText(sub, w / 2, h * 0.76);
  }
  const t = tex(c, false, 4);
  return t;
}

export function groundCityTexture(lines = true, base: [number, number, number] = [12, 13, 20]) {
  const W = 512, H = 512;
  const { c, g } = canvas(W, H);
  noise(g, W, H, base, 18, 31, 4000);
  // city blocks
  g.strokeStyle = 'rgba(70,90,140,0.25)';
  g.lineWidth = 3;
  for (let i = 0; i <= (lines ? 4 : -1); i++) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, H); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(W, i * 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function sandTexture(seed = 9, base: [number, number, number] = [196, 156, 108]) {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  noise(g, W, H, base, 50, seed, 12000);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function radialSprite(inner: string, outer: string) {
  const { c, g } = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
