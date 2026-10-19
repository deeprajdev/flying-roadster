import { clamp, wrapAngle } from '../core/math';
import { ROADSTER_SPEC, type CarInput, type CarState, emptyInput } from '../vehicle/CarPhysics';
import { newFrame, type TrackData } from '../track/TrackData';
import type { RaceLine } from './RaceLine';

const F = newFrame();
const P0 = { x: 0, y: 0, z: 0 };
const P1 = { x: 0, y: 0, z: 0 };

export interface AIPersonality {
  name: string;
  skill: number;      // fraction of the safe speed profile (0.86..1)
  aggression: number; // 0..1 overtaking / blocking appetite
  boostiness: number; // 0..1 how eagerly it uses boost
  lineBias: number;   // lateral preference (m)
  wobble: number;     // small steering imprecision
}

/**
 * Track-space pursuit driver. Uses exactly the same CarPhysics as the player.
 * Steering: desired yaw rate = road curvature feed-forward + heading error to a look-ahead
 * point on the racing line. Speed: lookahead into the precomputed safe-speed profile.
 */
export class AIDriver {
  readonly p: AIPersonality;
  input: CarInput = emptyInput();
  skillMod = 1;
  private stuckT = 0;
  private wrongT = 0;
  private avoid = 0;
  private phase: number;

  constructor(p: AIPersonality, seed: number) {
    this.p = p;
    this.phase = seed * 1.7;
  }

  /** returns true if the car should be reset */
  update(c: CarState, me: number, cars: CarState[], tr: TrackData, line: RaceLine, dt: number, t: number): boolean {
    const inp = this.input;
    const speed = Math.max(0, c.vx);
    const skill = clamp(this.p.skill * this.skillMod, 0.8, 1.04);

    // ---- traffic awareness ----
    let blockD: number | null = null;
    let blockGap = Infinity;
    let blockSpeed = 0;
    for (let i = 0; i < cars.length; i++) {
      if (i === me) continue;
      const o = cars[i];
      if (o.fallen) continue;
      const gap = tr.delta(c.s, o.s);
      if (gap > 0 && gap < 32 && Math.abs(o.d - c.d) < 3.4 && gap < blockGap) {
        blockGap = gap;
        blockD = o.d;
        blockSpeed = o.vx;
      }
    }
    const lookS = c.s + 7 + speed * 0.33;
    let targetD = line.lineAt(lookS) + this.p.lineBias;
    if (blockD !== null && speed > blockSpeed - 2) {
      // pass on the side with more room, biased toward the racing line
      const lim = tr.halfWidth - 2.3;
      const left = blockD - 3.6, right = blockD + 3.6;
      const lineD = line.lineAt(c.s + blockGap);
      const pickRight = right <= lim && (left < -lim || Math.abs(right - lineD) < Math.abs(left - lineD));
      const want = clamp(pickRight ? right : left, -lim, lim);
      const w = clamp(1 - blockGap / 32, 0, 1) * (0.55 + this.p.aggression * 0.45);
      this.avoid += (want - targetD - this.avoid) * Math.min(1, dt * 4) * w;
    } else {
      this.avoid *= Math.exp(-dt * 1.2);
    }
    targetD = clamp(targetD + this.avoid, -(tr.halfWidth - 2.1), tr.halfWidth - 2.1);
    targetD += Math.sin(t * 0.7 + this.phase) * this.p.wobble;

    // ---- steering: pure pursuit toward a look-ahead point on the line (true geometry) ----
    tr.toWorld(c.s, c.d, 0, F, P0);
    const tx = F.tx, ty = F.ty, tz = F.tz, rx = F.rx, ry = F.ry, rz = F.rz;
    tr.toWorld(lookS, targetD, 0, F, P1);
    const dx = P1.x - P0.x, dy = P1.y - P0.y, dz = P1.z - P0.z;
    const fx = dx * tx + dy * ty + dz * tz; // forward along road
    const fy = dx * rx + dy * ry + dz * rz; // right
    const psiDes = Math.atan2(fy, fx);
    const err = wrapAngle(psiDes - c.psi);
    const Ld = Math.max(4, Math.hypot(fx, fy));
    const rDes = (2 * Math.max(speed, 3) * Math.sin(err)) / Ld - (c.yawRate - (2 * Math.max(speed, 3) * Math.sin(err)) / Ld) * 0.08;
    const spec = ROADSTER_SPEC;
    const gs = clamp(c.normal / 14, 0.4, 1.5);
    const maxYaw = Math.min(spec.maxYawLow, (spec.aLat * gs) / Math.max(speed, 1)) * clamp(speed / 4, 0, 1);
    inp.steer = c.grounded || c.flying ? clamp(rDes / Math.max(maxYaw, 0.05), -1, 1) : 0;

    // ---- speed ----
    const brakeLead = speed * 0.12;
    let vT = line.minSpeed(c.s + brakeLead, 6 + speed * 0.15) * skill;
    // never crawl into the Skywall
    const sky = tr.zoneOf('skywall');
    if (sky) {
      const toSky = tr.delta(c.s, sky.s0);
      if (toSky > 0 && toSky < 260) vT = Math.max(vT, 52);
    }
    if (blockD !== null && blockGap < 9 && Math.abs(blockD - c.d) < 2.4) vT = Math.min(vT, blockSpeed - 0.5);
    if (speed > vT + 0.8) {
      inp.throttle = 0;
      inp.brake = clamp((speed - vT) / 5, 0.15, 1);
    } else {
      inp.brake = 0;
      inp.throttle = clamp((vT - speed) / 3 + 0.35, 0, 1);
    }
    inp.handbrake = false;

    // ---- boost ----
    const ahead = line.minSpeed(c.s, 90 + speed * 0.8);
    const roomy = ahead > speed + 14 && Math.abs(err) < 0.12;
    const toLoop = sky ? tr.delta(c.s, sky.s0) : -1;
    const loopRun = toLoop > 0 && toLoop < 150;
    const threshold = 70 - this.p.boostiness * 55;
    inp.boost = (roomy && c.boost > threshold && inp.throttle > 0.9) || (loopRun && c.boost > 15);
    if (c.boosting && !roomy && !loopRun) inp.boost = false;

    // ---- stuck / wrong-way recovery ----
    if (Math.abs(c.vx) < 2.5 && !c.fallen) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (Math.cos(c.psi) < 0.1) this.wrongT += dt;
    else this.wrongT = 0;
    if (this.stuckT > 2.2 || this.wrongT > 1.5) {
      this.stuckT = 0;
      this.wrongT = 0;
      return true;
    }
    return false;
  }
}

export const AI_ROSTER: { p: AIPersonality; color: number; accent: number }[] = [
  { p: { name: 'NOVA', skill: 0.985, aggression: 0.8, boostiness: 0.7, lineBias: 0, wobble: 0.15 }, color: 0xff6a10, accent: 0xffa040 },
  { p: { name: 'VEGA', skill: 0.965, aggression: 0.5, boostiness: 0.9, lineBias: 0.6, wobble: 0.2 }, color: 0x1b4fd8, accent: 0x4ea0ff },
  { p: { name: 'ORION', skill: 0.95, aggression: 0.95, boostiness: 0.5, lineBias: -0.6, wobble: 0.25 }, color: 0xf2c418, accent: 0xffe066 },
  { p: { name: 'LYRA', skill: 0.93, aggression: 0.3, boostiness: 0.35, lineBias: 0.3, wobble: 0.2 }, color: 0x17b26a, accent: 0x5dffad },
  { p: { name: 'ATLAS', skill: 0.915, aggression: 0.6, boostiness: 0.6, lineBias: -0.3, wobble: 0.3 }, color: 0x8a2be2, accent: 0xc77dff },
];
