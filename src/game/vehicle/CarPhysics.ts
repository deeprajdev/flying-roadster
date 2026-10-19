import { clamp, dampK, wrapAngle } from '../core/math';
import { newFrame, type Frame, type TrackData } from '../track/TrackData';

/**
 * Arcade vehicle model in track space.
 *  s   distance along centre line    d  lateral offset (+ right)    h  height above road
 *  psi heading relative to the road tangent (+ = pointing right)
 *  vx/vy velocity in the car frame (forward / right)
 * Gravity, banking, crests (airtime) and the Skywall loop all fall out of the road frame's
 * curvature, so the car can never "fall through" the track and AI uses identical physics.
 */

export const G = 14; // arcade gravity (m/s²)
export const CAR_HALF_W = 1.05;
export const CAR_HALF_L = 2.25;

export interface CarSpec {
  accel: number;      // peak motor acceleration
  vmax: number;       // motor speed limit (m/s)
  boostAccel: number;
  boostVmax: number;
  brake: number;
  reverseAccel: number;
  reverseMax: number;
  aLat: number;       // lateral grip limit (m/s²)
  maxYawLow: number;  // max yaw rate at low speed (rad/s)
  grip: number;       // lateral velocity damping rate
  driftGrip: number;
}

export const ROADSTER_SPEC: CarSpec = {
  accel: 17,
  vmax: 70,
  boostAccel: 20,
  boostVmax: 98,
  brake: 34,
  reverseAccel: 9,
  reverseMax: 13,
  aLat: 27,
  maxYawLow: 2.3,
  grip: 11,
  driftGrip: 1.9,
};

export interface CarInput {
  throttle: number; // 0..1
  brake: number;    // 0..1
  steer: number;    // -1 (left) .. 1 (right)
  handbrake: boolean; // drift on the ground, flip / barrel roll in the air
  boost: boolean;
  fly: boolean;       // thruster flight: tap to hop, hold to hover
  /** steering response for on/off (touch) steering: 0 = default, 1 smooth, 2 quick, 3 sharp */
  assist?: number;
}

// per assist level: steer ramp in / out (per s), extra turn-in, yaw response, extra grip
const STEER_IN = [4.2, 6, 11, 17];
const STEER_OUT = [7, 9, 14, 20];
const TURN_MUL = [1, 1.06, 1.2, 1.34];
const YAW_K = [12, 13, 17, 22];
const GRIP_MUL = [1, 1.02, 1.08, 1.14];

export const emptyInput = (): CarInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, fly: false });

export type TrickKind = 'none' | 'front' | 'back' | 'rollL' | 'rollR';
export const TRICK_NAMES: Record<Exclude<TrickKind, 'none'>, string> = {
  front: 'Front flip', back: 'Backflip', rollL: 'Barrel roll', rollR: 'Barrel roll',
};

export interface CarState {
  s: number; d: number; h: number; vh: number;
  psi: number; vx: number; vy: number; yawRate: number;
  steer: number;
  grounded: boolean;
  airTime: number;
  boost: number;       // 0..100
  boosting: boolean;
  autoThrust: boolean; // thrusters pinning the car to the Skywall
  thrust: number;      // 0..1 visual thruster intensity
  drifting: boolean;
  gripRecover: number; // 0 → just left a drift, 1 → full grip
  slip: number;        // slip angle (rad)
  smoke: number;       // 0..1 tyre smoke intensity
  normal: number;      // normal accel (for grip / compression)
  dist: number;        // unwrapped race distance
  longAcc: number;
  latAcc: number;
  // per-step events (consumed by FX / audio)
  wallHit: number;
  wallSide: number;
  scraping: number;
  landed: number;
  // fall / respawn
  fallen: boolean;
  respawnTimer: number;
  ghost: number;       // seconds of no car-to-car collision after reset
  input: CarInput;
  // thruster flight & tricks
  flying: boolean;
  flyCeiling: number;  // current hover height target
  trick: TrickKind;
  trickAngle: number;  // 0..2π progress of the current trick
  tricksDone: TrickKind[];
  trickLanded: TrickKind[] | null; // event: clean landing with these tricks
  trickReward: number;
  badLanding: boolean; // event
  launched: boolean;   // event
}

export function newCarState(s: number, d: number): CarState {
  return {
    s, d, h: 0, vh: 0, psi: 0, vx: 0, vy: 0, yawRate: 0, steer: 0,
    grounded: true, airTime: 0, boost: 100, boosting: false, autoThrust: false, thrust: 0,
    drifting: false, gripRecover: 1, slip: 0, smoke: 0, normal: G, dist: 0, longAcc: 0, latAcc: 0,
    wallHit: 0, wallSide: 0, scraping: 0, landed: 0, fallen: false, respawnTimer: 0, ghost: 0,
    input: emptyInput(),
    flying: false, flyCeiling: 0, trick: 'none', trickAngle: 0, tricksDone: [], trickLanded: null, trickReward: 0,
    badLanding: false, launched: false,
  };
}

const BOOST_DRAIN = 26;
const BOOST_REGEN = 6.5;
const DRIFT_CHARGE = 16;
const AIR_CHARGE = 10;
const FLY_LAUNCH_V = 8.5;   // m/s upward kick when the lift jets fire
const FLY_CEILING = 11;     // hover height above the road (m)
const TUNNEL_CEILING = 3.3;
const FLY_DRAIN = 15;       // boost per second while flying
const LAUNCH_COST = 5;
const FLY_ACCEL = 10;
const FLY_VMAX = 54;        // ~195 km/h on jets alone
const FLY_MAX_YAW = 1.5;   // rad/s: hairpins still need a lift or a brake
const TRICK_REWARD = 18;
const TWO_PI = Math.PI * 2;

const f: Frame = newFrame();

export function speedOf(c: CarState) {
  return Math.hypot(c.vx, c.vy);
}

/** Velocity along / across the road. */
export function trackVel(c: CarState) {
  const cp = Math.cos(c.psi), sp = Math.sin(c.psi);
  return { va: c.vx * cp - c.vy * sp, vb: c.vx * sp + c.vy * cp };
}

export function setTrackVel(c: CarState, va: number, vb: number) {
  const cp = Math.cos(c.psi), sp = Math.sin(c.psi);
  c.vx = va * cp + vb * sp;
  c.vy = -va * sp + vb * cp;
}

export function stepCar(c: CarState, inp: CarInput, tr: TrackData, dt: number, spec: CarSpec = ROADSTER_SPEC) {
  c.wallHit = 0;
  c.scraping = 0;
  c.landed = 0;
  c.trickLanded = null;
  c.badLanding = false;
  c.launched = false;
  c.input = inp;
  if (c.ghost > 0) c.ghost -= dt;

  if (c.fallen) {
    c.respawnTimer -= dt;
    c.thrust = 0;
    c.smoke = 0;
    // keep falling visually
    c.vh -= G * dt;
    c.h += c.vh * dt;
    return;
  }

  tr.frame(c.s, f);
  const inSkywall = tr.inZone('skywall', c.s);

  // ---- steering input smoothing (faster return to centre) ----
  const st = clamp(inp.steer, -1, 1);
  const A = clamp(Math.round(inp.assist ?? 0), 0, 3);
  const returning = st === 0 || Math.sign(st) !== Math.sign(c.steer);
  const sRate = returning ? STEER_OUT[A] : STEER_IN[A];
  c.steer += clamp(st - c.steer, -sRate * dt, sRate * dt);

  // ---- boost ----
  const wantsBoost = inp.boost && c.boost > 0.5;
  c.boosting = wantsBoost;
  if (wantsBoost) c.boost = Math.max(0, c.boost - BOOST_DRAIN * dt);

  // ---- normal force (road curvature + gravity) ----
  const cp0 = Math.cos(c.psi), sp0 = Math.sin(c.psi);
  const va0 = c.vx * cp0 - c.vy * sp0;
  let n = va0 * va0 * f.kUp + G * f.uy;
  // Skywall: thrusters fire automatically to keep the car glued when it is slow
  c.autoThrust = false;
  let extraDown = 0;
  if (inSkywall && c.grounded && n < 9 && c.boost > 0) {
    extraDown = clamp(9 - n, 0, 22);
    c.autoThrust = true;
    c.boost = Math.max(0, c.boost - 22 * dt);
  }
  if (c.boosting) extraDown += 4; // thrusters angle slightly down → extra grip
  const nTotal = n + extraDown;

  // ---- thruster flight ----
  // locked inside / just before the Skywall (the jets are busy pinning the car to the wall)
  const sky = tr.zoneOf('skywall');
  const toSky = sky ? tr.delta(c.s, sky.s0) : -1;
  const flyLocked = inSkywall || (toSky > 0 && toSky < 150);
  const look = c.s + Math.max(0, va0) * 1.3;
  const inTunnel = tr.inZone('tunnel', c.s, 4) || tr.inZone('tunnel', look, 4);
  c.flyCeiling = inTunnel ? TUNNEL_CEILING : FLY_CEILING;
  const wantsFly = inp.fly && !flyLocked && c.boost > 0.5;
  if (wantsFly && c.grounded && c.boost > LAUNCH_COST) {
    c.grounded = false;
    c.h = 0.02;
    c.vh = Math.max(c.vh, FLY_LAUNCH_V);
    c.boost -= LAUNCH_COST;
    c.launched = true;
  }
  c.flying = wantsFly && !c.grounded;
  if (c.flying) c.boost = Math.max(0, c.boost - FLY_DRAIN * dt);

  // ---- vertical / airborne ----
  if (c.grounded && nTotal < 0) {
    c.grounded = false;
    c.vh = 0;
  }
  if (!c.grounded) {
    c.airTime += dt;
    let ah: number;
    if (c.flying) {
      // jets hold the car at the hover ceiling (critically damped)
      ah = clamp(4.2 * (c.flyCeiling - c.h) - 3.4 * c.vh, -14, 11);
    } else {
      ah = -n;
      if (flyLocked && c.h > 0.5) ah -= 10; // jets push down so the car lands before the loop
    }
    c.vh += ah * dt;
    c.h += c.vh * dt;
    if (inTunnel && c.h > TUNNEL_CEILING + 0.6) {
      c.h = TUNNEL_CEILING + 0.6;
      c.vh = Math.min(c.vh, 0);
    }
    if (!c.flying) c.boost = Math.min(100, c.boost + AIR_CHARGE * dt);

    // ---- tricks: flips and barrel rolls ----
    if (!inSkywall) {
      if (c.trick === 'none' && inp.handbrake && c.h > 0.5) {
        c.trick = st < -0.35 ? 'rollL' : st > 0.35 ? 'rollR' : inp.brake > 0 ? 'back' : 'front';
        c.trickAngle = 0;
      }
      if (c.trick !== 'none') {
        c.trickAngle += (c.trick === 'rollL' || c.trick === 'rollR' ? 7.4 : 6.6) * dt;
        if (c.trickAngle >= TWO_PI) {
          c.tricksDone.push(c.trick);
          c.trick = 'none';
          c.trickAngle = 0;
        }
      }
    }

    if (c.h <= 0) {
      c.landed = Math.max(0, -c.vh);
      c.h = 0;
      c.vh = 0;
      c.grounded = true;
      c.airTime = 0;
      c.flying = false;
      // judge the landing
      let bad = false;
      if (c.trick !== 'none') {
        if (TWO_PI - c.trickAngle < 0.75) c.tricksDone.push(c.trick); // close enough: snap upright
        else if (c.trickAngle > 0.5) bad = true;
        c.trick = 'none';
        c.trickAngle = 0;
      }
      if (bad) {
        c.badLanding = true;
        c.vx *= 0.5;
        c.vy *= 0.3;
        c.yawRate += (Math.random() - 0.5) * 2;
        c.tricksDone = [];
      } else if (c.tricksDone.length) {
        const k = c.tricksDone.length;
        c.trickReward = Math.round(TRICK_REWARD * k * (1 + 0.15 * (k - 1)));
        c.boost = Math.min(100, c.boost + c.trickReward);
        c.trickLanded = c.tricksDone;
        c.tricksDone = [];
      }
    } else if ((inSkywall && c.h > 3.5) || c.h > 40) {
      c.fallen = true;
      c.respawnTimer = 1.4;
      return;
    }
  } else {
    c.h = 0;
  }
  c.normal = c.grounded ? nTotal : 0;
  const gripScale = c.grounded ? clamp(nTotal / G, 0.4, 1.5) : 0;

  // ---- longitudinal forces ----
  let ax = 0, ay = 0;
  const v = c.vx;
  const vmaxNow = c.boosting ? spec.boostVmax : spec.vmax;
  if (c.grounded) {
    if (inp.throttle > 0) {
      if (v < -0.5) ax += spec.brake * inp.throttle;
      else {
        const r = Math.max(0, v) / vmaxNow;
        ax += spec.accel * inp.throttle * Math.max(0, 1 - r * r) * (v < 8 ? 0.75 + v / 32 : 1);
      }
    }
    if (inp.brake > 0) {
      if (v > 0.5) ax -= spec.brake * inp.brake;
      else if (v > -spec.reverseMax) ax -= spec.reverseAccel * inp.brake;
    }
    if (inp.handbrake && Math.abs(v) > 1) ax -= Math.sign(v) * 3.5;
    // rolling + aero drag
    ax -= Math.sign(v) * (0.35 + 0.00055 * v * v);
    if (inp.throttle === 0 && inp.brake === 0 && Math.abs(v) < 0.6) c.vx *= 0.9;
  } else {
    ax -= Math.sign(v) * 0.00055 * v * v;
    // rear jets drive the car forward in flight (slower than the motor on tarmac)
    if (c.flying && inp.throttle > 0) {
      const r = Math.max(0, v) / FLY_VMAX;
      ax += FLY_ACCEL * inp.throttle * Math.max(0, 1 - r * r);
    }
    if (c.flying && inp.brake > 0 && v > 0) ax -= 12 * inp.brake;
  }
  if (c.boosting) ax += spec.boostAccel * Math.max(0, 1 - Math.max(0, v) / spec.boostVmax) * (c.grounded ? 1 : 0.7);
  if (c.autoThrust) ax += 4; // rear thrusters help up the wall
  // gravity along the road plane (hovering jets cancel it)
  if (!c.flying) {
    const gA = -G * f.ty, gB = -G * f.ry;
    ax += gA * cp0 + gB * sp0;
    ay += -gA * sp0 + gB * cp0;
  }

  // ---- yaw ----
  const speed = Math.abs(c.vx);
  if (c.grounded) {
    // drift state machine
    if (!c.drifting && inp.handbrake && speed > 13 && Math.abs(c.steer) > 0.15) c.drifting = true;
    if (c.drifting && (!inp.handbrake && Math.abs(c.slip) < 0.22) ) c.drifting = false;
    if (c.drifting && speed < 7) c.drifting = false;
    if (c.drifting) c.gripRecover = 0;
    else c.gripRecover = Math.min(1, c.gripRecover + dt * 2.8);

    const aLat = spec.aLat * gripScale * GRIP_MUL[A];
    let maxYaw = Math.min(spec.maxYawLow, (aLat / Math.max(speed, 1)) * TURN_MUL[A]) * clamp(speed / 4, 0, 1);
    let yawK = YAW_K[A];
    if (c.drifting) {
      maxYaw = Math.max(maxYaw * 1.7, 0.95 * clamp(speed / 10, 0, 1));
      yawK = 5;
    }
    const dir = c.vx >= -0.5 ? 1 : -1;
    const target = c.steer * maxYaw * dir;
    c.yawRate += (target - c.yawRate) * dampK(yawK, dt);
  } else if (c.flying) {
    // thrust vectoring: the jets follow the road's curve; steering moves you across it
    const follow = f.kLat * va0 + clamp(-c.psi * 2.2, -0.9, 0.9);
    const target = clamp(follow + c.steer * 0.9, -FLY_MAX_YAW, FLY_MAX_YAW);
    c.yawRate += (target - c.yawRate) * dampK(6, dt);
  } else {
    c.yawRate += (c.steer * 0.45 - c.yawRate) * dampK(3, dt);
  }

  // rotate car; world velocity is unchanged so car-frame velocity counter-rotates
  const dpsi = c.yawRate * dt;
  c.psi += dpsi;
  {
    const cr = Math.cos(dpsi), sr = Math.sin(dpsi);
    const nvx = c.vx * cr + c.vy * sr;
    const nvy = -c.vx * sr + c.vy * cr;
    c.vx = nvx;
    c.vy = nvy;
  }

  c.vx += ax * dt;
  c.vy += ay * dt;

  // flying: jets cancel most sideways drift
  if (c.flying) c.vy *= Math.exp(-2.4 * dt);
  // lateral grip
  if (c.grounded) {
    const g = c.drifting ? spec.driftGrip : spec.driftGrip + (spec.grip - spec.driftGrip) * c.gripRecover * c.gripRecover;
    const keep = Math.exp(-g * gripScale * dt);
    const lost = c.vy * (1 - keep);
    c.vy -= lost;
    // drifting converts part of the scrubbed sideways speed back into forward speed
    const conserve = c.drifting ? 0.62 : 0.25 * (1 - c.gripRecover);
    if (c.vx > 0) c.vx += Math.abs(lost) * conserve;
  }

  c.slip = Math.atan2(c.vy, Math.max(Math.abs(c.vx), 2));
  const sp = Math.hypot(c.vx, c.vy);
  if (c.grounded && sp > 6) {
    let sm = 0;
    if (c.drifting) sm = 0.6 + Math.min(0.4, Math.abs(c.slip));
    else if (Math.abs(c.slip) > 0.12) sm = Math.min(1, (Math.abs(c.slip) - 0.12) * 4);
    if (inp.brake > 0.5 && c.vx > 20) sm = Math.max(sm, 0.35);
    c.smoke = sm;
  } else c.smoke = 0;
  if (c.drifting && sp > 10) c.boost = Math.min(100, c.boost + DRIFT_CHARGE * dt * Math.min(1, Math.abs(c.slip) * 2.5));
  if (!wantsBoost && !c.autoThrust && !c.flying) c.boost = Math.min(100, c.boost + BOOST_REGEN * dt);

  c.thrust = c.autoThrust || c.boosting || c.flying ? 1 : 0;
  c.longAcc = ax;
  c.latAcc = c.yawRate * c.vx;

  // ---- integrate along the track ----
  const cp = Math.cos(c.psi), spn = Math.sin(c.psi);
  let va = c.vx * cp - c.vy * spn;
  let vb = c.vx * spn + c.vy * cp;
  const denom = Math.max(0.3, 1 - c.d * f.kLat);
  const dsC = (va * dt) / denom;
  c.s = tr.wrap(c.s + dsC);
  c.dist += dsC;
  c.d += vb * dt;
  c.psi = wrapAngle(c.psi - f.kLat * dsC);

  // ---- barriers ----
  const ext = CAR_HALF_W * Math.abs(Math.cos(c.psi)) + CAR_HALF_L * Math.abs(Math.sin(c.psi));
  const lim = tr.halfWidth - Math.min(ext, 2.4) - 0.15;
  if (Math.abs(c.d) > lim) {
    const side = Math.sign(c.d);
    c.d = side * lim;
    if (vb * side > 0 && !c.grounded && c.h > 1.3) {
      // above the barriers: an invisible force field nudges the car back, no crash
      vb = -side * Math.min(Math.abs(vb) * 0.2, 3);
      va *= 0.996; // brushing the field costs a little speed
      c.psi *= 0.85;
      setTrackVel(c, va, vb);
    } else if (vb * side > 0) {
      const impact = Math.abs(vb);
      vb = -side * Math.min(impact * 0.28, 6);
      va *= 1 - Math.min(0.32, impact * 0.018);
      // swing the nose to run parallel with the wall
      const into = c.psi * side * Math.sign(va || 1) > 0;
      if (into) c.psi *= Math.max(0.25, 1 - impact * 0.06);
      c.yawRate *= 0.4;
      if (impact > 2.5) {
        c.wallHit = impact;
        c.wallSide = side;
      } else {
        c.scraping = Math.abs(va);
        c.wallSide = side;
      }
      setTrackVel(c, va, vb);
    } else if (Math.abs(va) > 4) {
      c.scraping = Math.abs(va) * 0.5;
      c.wallSide = side;
    }
  }
}

/** Put a car back on the road (R key / AI unstick / Skywall fall). */
export function resetCar(c: CarState, tr: TrackData, opts: { backOff?: number; speed?: number } = {}) {
  let s = c.s;
  const sky = tr.zoneOf('skywall');
  if (sky && tr.inZone('skywall', s, 25)) {
    const back = tr.delta(s, sky.s0) - 140; // land well before the loop
    s = tr.wrap(s + back);
    c.dist += back;
  } else if (opts.backOff) {
    s = tr.wrap(s - opts.backOff);
    c.dist -= opts.backOff;
  }
  c.s = s;
  c.d = clamp(c.d, -2.5, 2.5) * 0.5;
  c.h = 0;
  c.vh = 0;
  c.psi = 0;
  c.vx = opts.speed ?? 0;
  c.vy = 0;
  c.yawRate = 0;
  c.grounded = true;
  c.airTime = 0;
  c.drifting = false;
  c.gripRecover = 1;
  c.fallen = false;
  c.respawnTimer = 0;
  c.ghost = 2;
  c.flying = false;
  c.trick = 'none';
  c.trickAngle = 0;
  c.tricksDone = [];
}
