export type ZoneTag = 'tunnel' | 'skywall' | 'bridge' | 'jump';
export type TrackId = 'neon' | 'desert' | 'coastal';

/**
 * Turtle-style track command.
 *  S    – straight of `len` metres
 *  T    – constant-radius turn of `ang` degrees (+ = right) with radius `r`
 *  LOOP – vertical loop-the-loop (the Skywall) of radius `r`, exiting `shift` metres to the right
 * `h` sets the road height at the END of the command (heights are spline-interpolated between knots).
 * `adj` marks one of the two straights whose length is solved so the circuit closes exactly.
 */
export interface TrackCmd {
  t: 'S' | 'T' | 'LOOP';
  len?: number;
  ang?: number;
  r?: number;
  shift?: number;
  h?: number;
  tag?: ZoneTag;
  adj?: 1 | 2;
}

/**
 * Waypoint for polygon-designed tracks. Corners are filleted with radius `r`.
 * `h`: road height at the end of this corner. `tag`/`loop`/`adj` apply to the OUTGOING straight.
 */
export interface Waypoint {
  x: number;
  z: number;
  r: number;
  h?: number;
  tag?: ZoneTag;
  cornerTag?: ZoneTag;
  /** vertical loop placed at fraction `at` of the outgoing straight */
  loop?: { r: number; shift: number; at: number };
  /** extra height knots along the outgoing straight (fraction `at`); `tag` switches the zone tag from there on */
  knots?: { at: number; h: number; tag?: ZoneTag }[];
  adj?: 1 | 2;
}

export interface Zone {
  tag: ZoneTag;
  s0: number;
  s1: number;
}

export interface TrackDef {
  id: TrackId;
  name: string;
  subtitle: string;
  halfWidth: number;
  startHeight: number;
  /** radians of bank per unit curvature (1/m) */
  bankFactor: number;
  maxBank: number;
  laps: number;
  cmds: TrackCmd[];
}
