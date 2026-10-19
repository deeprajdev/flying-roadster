import type { TrackId } from './types';
import type { RoadStyle } from './textures';

export type TimeOfDay = 'day' | 'night';

export interface Theme {
  road: RoadStyle;
  tod: TimeOfDay;
  night: boolean;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  /** direction TO the sun by day, to the moon at night */
  sunDir: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  sunDisc: number;     // 0 = none
  moon: number;        // 0 = none, else moon disc brightness
  stars: number;       // 0..1 star brightness
  clouds: number;      // 0..1 coverage
  cloudLit: number;    // colour of the lit side of clouds
  cloudShade: number;  // colour of the shaded underside
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  envIntensity: number;
  neonA: number;       // barrier strip colour (left)
  neonB: number;       // barrier strip colour (right)
  neonPower: number;
  headlights: boolean;
  roadRoughness: number;
  wet: number;         // 0..1 wet-look road (night city)
  shadows: boolean;    // real sun shadows
  lamps: boolean;      // street lamps lit
  smoke: [number, number, number];
}

type Base = Omit<Theme, 'tod' | 'night'>;

const DAY_CLOUDS = { cloudLit: 0xffffff, cloudShade: 0x9aa8bc };

const T: Record<TrackId, Record<TimeOfDay, Base>> = {
  neon: {
    night: {
      road: 'city',
      skyTop: 0x03030c, skyHorizon: 0x2a1440, skyBottom: 0x07040f,
      sunDir: [-0.35, 0.42, -0.6], sunColor: 0x8fa6ff, sunIntensity: 0.32, sunDisc: 0, moon: 0.9, stars: 0.75,
      clouds: 0.32, cloudLit: 0x6a4a86, cloudShade: 0x1a1028,
      fogColor: 0x150c28, fogDensity: 0.0013,
      hemiSky: 0x6a5ab8, hemiGround: 0x0a0812, hemiIntensity: 0.55,
      exposure: 1.05, bloom: { strength: 0.8, radius: 0.45, threshold: 0.82 }, envIntensity: 1,
      neonA: 0x19e0ff, neonB: 0xff2bd6, neonPower: 1.25,
      headlights: true, roadRoughness: 0.42, wet: 0.65, shadows: false, lamps: true,
      smoke: [0.72, 0.72, 0.8],
    },
    day: {
      road: 'city',
      skyTop: 0x2f6cc4, skyHorizon: 0xc4d6e8, skyBottom: 0x8d9aa8,
      sunDir: [-0.6, 0.6, -0.42], sunColor: 0xfff2dd, sunIntensity: 2.7, sunDisc: 1, moon: 0, stars: 0,
      clouds: 0.42, ...DAY_CLOUDS,
      fogColor: 0xbccbdc, fogDensity: 0.00085,
      hemiSky: 0xc8dcff, hemiGround: 0x6e6a66, hemiIntensity: 1.35,
      exposure: 0.9, bloom: { strength: 0.22, radius: 0.35, threshold: 1.5 }, envIntensity: 1,
      neonA: 0x19e0ff, neonB: 0xff2bd6, neonPower: 0.75,
      headlights: false, roadRoughness: 0.78, wet: 0, shadows: true, lamps: false,
      smoke: [0.86, 0.86, 0.88],
    },
  },
  desert: {
    day: {
      road: 'desert',
      skyTop: 0x2c6fc4, skyHorizon: 0xf0d2a8, skyBottom: 0xd8a877,
      sunDir: [0.55, 0.62, 0.3], sunColor: 0xfff0d6, sunIntensity: 2.6, sunDisc: 1, moon: 0, stars: 0,
      clouds: 0.18, ...DAY_CLOUDS,
      fogColor: 0xe2c09a, fogDensity: 0.0014,
      hemiSky: 0xbcd7ff, hemiGround: 0x8a5a33, hemiIntensity: 1.05,
      exposure: 0.92, bloom: { strength: 0.3, radius: 0.35, threshold: 1.5 }, envIntensity: 1.1,
      neonA: 0xff7a1a, neonB: 0xff7a1a, neonPower: 0.9,
      headlights: false, roadRoughness: 0.85, wet: 0, shadows: true, lamps: false,
      smoke: [0.86, 0.68, 0.5],
    },
    night: {
      road: 'desert',
      skyTop: 0x01030a, skyHorizon: 0x1a2440, skyBottom: 0x0b0d14,
      sunDir: [0.45, 0.45, -0.55], sunColor: 0x9fb6e8, sunIntensity: 0.95, sunDisc: 0, moon: 1.2, stars: 1,
      clouds: 0.12, cloudLit: 0x3a4664, cloudShade: 0x0c1018,
      fogColor: 0x141b2c, fogDensity: 0.0011,
      hemiSky: 0x3a4a74, hemiGround: 0x1c1610, hemiIntensity: 0.95,
      exposure: 1.2, bloom: { strength: 0.75, radius: 0.45, threshold: 0.8 }, envIntensity: 0.8,
      neonA: 0xff7a1a, neonB: 0xff7a1a, neonPower: 1.5,
      headlights: true, roadRoughness: 0.8, wet: 0, shadows: false, lamps: false,
      smoke: [0.5, 0.5, 0.56],
    },
  },
  coastal: {
    day: {
      road: 'coastal',
      skyTop: 0x2f6cc8, skyHorizon: 0xcfe2f2, skyBottom: 0x8fb0c8,
      sunDir: [-0.3, 0.58, 0.76], sunColor: 0xfff1dc, sunIntensity: 2.6, sunDisc: 1, moon: 0, stars: 0,
      clouds: 0.36, ...DAY_CLOUDS,
      fogColor: 0xc2d4e4, fogDensity: 0.00085,
      hemiSky: 0xd0e4ff, hemiGround: 0x4c5a3c, hemiIntensity: 1.0,
      exposure: 0.92, bloom: { strength: 0.28, radius: 0.35, threshold: 1.5 }, envIntensity: 1.2,
      neonA: 0xffd27a, neonB: 0xffd27a, neonPower: 0.6,
      headlights: false, roadRoughness: 0.7, wet: 0, shadows: true, lamps: false,
      smoke: [0.88, 0.86, 0.84],
    },
    night: {
      road: 'coastal',
      skyTop: 0x02050f, skyHorizon: 0x1c2a48, skyBottom: 0x0a0f1c,
      sunDir: [-0.22, 0.3, 1], sunColor: 0xaac0f0, sunIntensity: 0.95, sunDisc: 0, moon: 1.3, stars: 0.9,
      clouds: 0.28, cloudLit: 0x4a5a7c, cloudShade: 0x0e1420,
      fogColor: 0x111a2c, fogDensity: 0.001,
      hemiSky: 0x34466e, hemiGround: 0x101418, hemiIntensity: 0.9,
      exposure: 1.2, bloom: { strength: 0.75, radius: 0.5, threshold: 0.8 }, envIntensity: 0.9,
      neonA: 0xffd27a, neonB: 0xffd27a, neonPower: 1.1,
      headlights: true, roadRoughness: 0.55, wet: 0.25, shadows: false, lamps: true,
      smoke: [0.6, 0.62, 0.68],
    },
  },
};

export function getTheme(id: TrackId, tod: TimeOfDay): Theme {
  return { ...T[id][tod], tod, night: tod === 'night' };
}
