import { polygonToCmds } from './polygon';
import type { TrackDef, TrackId, Waypoint } from './types';

/**
 * NEON CITY — night highway through a megacity. Clockwise.
 * Main boost straight → fast sweeper → tight right → chicane → hairpin → elevated skyway
 * with an S-section and crest jump → boost tunnel → the Skywall loop → back to the line.
 */
const NEON_PTS: Waypoint[] = [
  { x: 0, z: 0, r: 40, h: 0 },                 // P0  NW corner onto the main straight
  { x: 560, z: 0, r: 170, h: 0 },              // P1  fast sweeper right
  { x: 760, z: 110, r: 28, h: 0 },             // P2  T1 tight right
  { x: 715, z: 215, r: 30, h: 0 },             // P3  chicane left
  { x: 810, z: 300, r: 30, h: 0 },             // P4  chicane right
  { x: 790, z: 470, r: 22, h: 0 },             // P5  hairpin (A)
  { x: 700, z: 480, r: 22, h: 0 },             // P6  hairpin (B) → heading north
  { x: 690, z: 380, r: 30, h: 0, adj: 1 },     // P7  left → heading west, start climbing
  { x: 560, z: 380, r: 40, h: 11 },            // P8  climb onto the skyway
  { x: 470, z: 450, r: 40, h: 20, tag: 'bridge' },  // P9  skyway S-curves
  { x: 380, z: 400, r: 40, h: 20, tag: 'bridge' },  // P10
  { x: 260, z: 470, r: 55, h: 20, tag: 'bridge' },  // P11 skyway sweeper
  // P12 tight right → kicker ramp → drop off the skyway
  { x: 120, z: 470, r: 30, h: 20, knots: [{ at: 0.08, h: 20, tag: 'jump' }, { at: 0.3, h: 24, tag: undefined }] },
  { x: 100, z: 270, r: 28, h: 0, tag: 'tunnel' },   // P13 right into the boost tunnel
  { x: 300, z: 250, r: 50, h: 0, tag: 'tunnel', cornerTag: 'tunnel' }, // P14 tunnel bend
  { x: 500, z: 215, r: 30, h: 0, cornerTag: 'tunnel' },  // P15 left at tunnel exit
  { x: 470, z: 120, r: 24, h: 0, loop: { r: 22, shift: 20, at: 0.55 } }, // P16 left → Skywall straight
  { x: -60, z: 150, r: 30, h: 0, adj: 2 },     // P17 right → north
];

export const NEON_CITY: TrackDef = {
  id: 'neon',
  name: 'Neon City',
  subtitle: 'Elevated skyway · Boost tunnel · The Skywall loop',
  halfWidth: 7.5,
  startHeight: 0,
  bankFactor: 3.2,
  maxBank: 0.2,
  laps: 3,
  cmds: polygonToCmds(NEON_PTS),
};

/**
 * DESERT RUN — daylight canyon circuit. Clockwise.
 * Fast desert straight → sweeper → three alternating switchback hairpins climbing a massif →
 * summit pass → winding canyon descent → crest jump on the return straight.
 */
const DESERT_PTS: Waypoint[] = [
  { x: 0, z: 0, r: 45, h: 0 },                  // P0  onto the desert straight
  { x: 560, z: 0, r: 80, h: 0 },                // P1  sweeper right
  { x: 700, z: 110, r: 26, h: 2 },              // P2  hard right → switchback leg 1 (west)
  { x: 400, z: 110, r: 23, h: 12 },             // P3  left hairpin A
  { x: 400, z: 165, r: 23, h: 14 },             // P4  left hairpin B → leg 2 (east)
  { x: 665, z: 165, r: 23, h: 24 },             // P5  right hairpin A
  { x: 665, z: 220, r: 23, h: 26 },             // P6  right hairpin B → leg 3 (west)
  { x: 420, z: 220, r: 23, h: 36 },             // P7  left hairpin A
  { x: 420, z: 275, r: 23, h: 38 },             // P8  left hairpin B → leg 4 (east)
  { x: 650, z: 275, r: 40, h: 40 },             // P9  summit pass, right → south
  { x: 660, z: 430, r: 50, h: 32 },             // P10 into the canyon
  { x: 510, z: 480, r: 34, h: 25 },             // P11 canyon S-curves
  { x: 390, z: 420, r: 34, h: 19 },             // P12
  { x: 250, z: 490, r: 40, h: 12 },             // P13
  { x: 110, z: 425, r: 30, h: 6 },              // P14
  { x: 10, z: 480, r: 28, h: 2 },               // P15 tight right out of the canyon
  // P16 → return straight north with a crest jump
  { x: -80, z: 360, r: 45, h: 0, knots: [{ at: 0.35, h: 0, tag: 'jump' }, { at: 0.5, h: 5.5, tag: undefined }, { at: 0.68, h: 0 }] },
  { x: -70, z: 90, r: 40, h: 0 },               // P17 right kink back toward the start
];

export const DESERT_RUN: TrackDef = {
  id: 'desert',
  name: 'Desert Run',
  subtitle: 'Switchback climb · Canyon descent · Crest jump',
  halfWidth: 7.5,
  startHeight: 0,
  bankFactor: 3.0,
  maxBank: 0.18,
  laps: 3,
  cmds: polygonToCmds(DESERT_PTS),
};

/**
 * COASTAL DRIVE — sunset cliff road. Clockwise.
 * Cliff-top sweepers → two cliffside hairpin pairs dropping to the beach → long beachfront
 * sweepers for boosting → climb back through a headland tunnel.
 */
const COAST_PTS: Waypoint[] = [
  { x: -80, z: 0, r: 70, h: 34 },               // P0  onto the cliff-top straight
  { x: 420, z: -40, r: 170, h: 36 },            // P1  long sweeper
  { x: 820, z: 50, r: 55, h: 34 },              // P2  right → down the coast
  { x: 800, z: 150, r: 30, h: 30 },             // P3  right → leg 1 (west), descending
  { x: 380, z: 150, r: 23, h: 20 },             // P4  cliffside hairpin (left) A
  { x: 380, z: 205, r: 23, h: 18 },             // P5  B → leg 2 (east)
  { x: 700, z: 205, r: 23, h: 10 },             // P6  cliffside hairpin (right) A
  { x: 700, z: 260, r: 23, h: 7 },              // P7  B → beach (west)
  { x: 380, z: 290, r: 220, h: 4 },             // P8  beachfront sweepers
  { x: 60, z: 255, r: 220, h: 4 },              // P9
  { x: -160, z: 270, r: 60, h: 4, tag: 'tunnel' },        // P10 right into the headland tunnel
  { x: -210, z: 110, r: 45, h: 22, cornerTag: 'tunnel' }, // P11 climbing out
];

export const COASTAL_DRIVE: TrackDef = {
  id: 'coastal',
  name: 'Coastal Drive',
  subtitle: 'Cliffside hairpins · Beachfront sweepers · Lighthouse',
  halfWidth: 7.5,
  startHeight: 34,
  bankFactor: 3.0,
  maxBank: 0.18,
  laps: 3,
  cmds: polygonToCmds(COAST_PTS),
};

export const TRACKS: Record<TrackId, TrackDef> = {
  neon: NEON_CITY,
  desert: DESERT_RUN,
  coastal: COASTAL_DRIVE,
};
