import { AIDriver, AI_ROSTER } from '../ai/AIDriver';
import { RaceLine } from '../ai/RaceLine';
import { clamp } from '../core/math';
import type { TrackData } from '../track/TrackData';
import {
  CAR_HALF_L, CAR_HALF_W, type CarInput, type CarState, type TrickKind, emptyInput, newCarState, resetCar, setTrackVel, stepCar, trackVel,
} from '../vehicle/CarPhysics';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface Racer {
  idx: number;
  name: string;
  color: number;
  accent: number;
  isPlayer: boolean;
  car: CarState;
  ai: AIDriver | null;
  finished: boolean;
  finishTime: number;
  lapStart: number;
  lapTimes: number[];
  bestLap: number;
  position: number;
  checkpoint: number;
  resets: number;
  wallHits: number;
  falls: number;
}

export type RaceEvent =
  | { type: 'go' }
  | { type: 'beep'; n: number }
  | { type: 'checkpoint'; idx: number; of: number }
  | { type: 'lap'; lap: number; time: number; best: boolean }
  | { type: 'finalLap' }
  | { type: 'finish'; position: number; time: number }
  | { type: 'wall'; racer: number; impact: number; side: number }
  | { type: 'carHit'; a: number; b: number; impact: number }
  | { type: 'fall'; racer: number }
  | { type: 'land'; racer: number; impact: number }
  | { type: 'trick'; racer: number; tricks: TrickKind[]; reward: number }
  | { type: 'badLanding'; racer: number }
  | { type: 'launch'; racer: number };

export const CHECKPOINTS = 8;
export const PHYS_DT = 1 / 120;

export class Race {
  readonly track: TrackData;
  readonly line: RaceLine;
  readonly racers: Racer[] = [];
  readonly laps: number;
  phase: RacePhase = 'countdown';
  countdown = 3.6;
  time = 0;
  events: RaceEvent[] = [];
  playerFinishedAt = 0;
  /** if true the "player" slot is driven by AI too (headless tests / attract mode) */
  autopilot: boolean;
  private lastBeep = 4;

  constructor(track: TrackData, laps: number, opts: { autopilot?: boolean; line?: RaceLine } = {}) {
    this.track = track;
    this.laps = laps;
    this.autopilot = !!opts.autopilot;
    this.line = opts.line ?? new RaceLine(track);
    const playerSlot = 4;
    const total = AI_ROSTER.length + 1;
    let ai = 0;
    for (let slot = 0; slot < total; slot++) {
      const row = Math.floor(slot / 2);
      const s = -14 - row * 11 - (slot % 2) * 4;
      const d = slot % 2 === 0 ? -3.2 : 3.2;
      const car = newCarState(track.wrap(s), d);
      car.dist = s;
      const isPlayer = slot === playerSlot;
      let r: Racer;
      if (isPlayer) {
        r = mkRacer(slot, 'YOU', 0xc9ced6, 0xff2a3a, true, car,
          this.autopilot ? new AIDriver({ name: 'YOU', skill: 0.97, aggression: 0.7, boostiness: 0.8, lineBias: 0, wobble: 0.1 }, 99) : null);
      } else {
        const a = AI_ROSTER[ai++];
        r = mkRacer(slot, a.p.name, a.color, a.accent, false, car, new AIDriver(a.p, slot));
      }
      this.racers.push(r);
    }
    this.updatePositions();
  }

  get player() {
    return this.racers.find((r) => r.isPlayer)!;
  }

  step(dt: number, playerInput: CarInput) {
    this.events.length = 0;
    const tr = this.track;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n < this.lastBeep && n >= 1 && n <= 3) {
        this.events.push({ type: 'beep', n });
      }
      this.lastBeep = n;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.events.push({ type: 'go' });
      }
    } else {
      this.time += dt;
    }
    const racing = this.phase !== 'countdown';
    const cars = this.racers.map((r) => r.car);

    for (const r of this.racers) {
      const c = r.car;
      let inp: CarInput;
      if (!racing) {
        inp = emptyInput();
        // launch control: hold the brakes, let the motor sound rev
        inp.brake = 1;
        if (r.isPlayer && !this.autopilot) inp.throttle = playerInput.throttle;
      } else if (r.finished && !r.isPlayer) {
        inp = r.ai!.input;
        r.ai!.update(c, r.idx, cars, tr, this.line, dt, this.time);
        inp.throttle *= 0.6;
        inp.boost = false;
      } else if (r.ai && (!r.isPlayer || this.autopilot || r.finished)) {
        const reset = r.ai.update(c, r.idx, cars, tr, this.line, dt, this.time);
        inp = r.ai.input;
        if (r.isPlayer && r.finished) {
          inp.throttle *= 0.5;
          inp.boost = false;
        }
        if (reset) {
          resetCar(c, tr, { speed: 8 });
          r.resets++;
        }
      } else if (r.isPlayer && r.finished) {
        // cruise after the flag
        if (!r.ai) r.ai = new AIDriver({ name: 'YOU', skill: 0.8, aggression: 0, boostiness: 0, lineBias: 0, wobble: 0 }, 7);
        inp = r.ai.input;
      } else {
        inp = playerInput;
      }
      if (!racing) {
        // frozen on the grid
        c.input = inp;
        c.steer = 0;
        continue;
      }
      stepCar(c, inp, tr, dt);
      if (c.fallen && c.respawnTimer <= 0) {
        resetCar(c, tr, { speed: 10 });
        r.falls++;
      } else if (c.fallen && c.respawnTimer > 1.3) {
        this.events.push({ type: 'fall', racer: r.idx });
      }
      if (c.wallHit > 0) {
        r.wallHits++;
        this.events.push({ type: 'wall', racer: r.idx, impact: c.wallHit, side: c.wallSide });
      }
      if (c.landed > 3) this.events.push({ type: 'land', racer: r.idx, impact: c.landed });
      if (c.trickLanded) this.events.push({ type: 'trick', racer: r.idx, tricks: c.trickLanded, reward: c.trickReward });
      if (c.badLanding) this.events.push({ type: 'badLanding', racer: r.idx });
      if (c.launched) this.events.push({ type: 'launch', racer: r.idx });
    }
    if (racing) this.collideCars();

    // ---- laps / checkpoints / finish ----
    const L = tr.length;
    for (const r of this.racers) {
      if (r.finished) continue;
      const c = r.car;
      if (!racing) continue;
      const cp = Math.floor(Math.max(0, c.dist) / (L / CHECKPOINTS));
      if (cp > r.checkpoint) {
        r.checkpoint = cp;
        const lapNow = Math.floor(cp / CHECKPOINTS);
        if (cp % CHECKPOINTS === 0 && lapNow >= 1) {
          const lapTime = this.time - r.lapStart;
          r.lapStart = this.time;
          r.lapTimes.push(lapTime);
          const best = lapTime < r.bestLap;
          if (best) r.bestLap = lapTime;
          if (lapNow >= this.laps) {
            r.finished = true;
            r.finishTime = this.time;
            if (r.isPlayer) {
              this.playerFinishedAt = this.time;
              this.updatePositions();
              this.events.push({ type: 'finish', position: r.position, time: this.time });
            }
          } else if (r.isPlayer) {
            this.events.push({ type: 'lap', lap: lapNow + 1, time: lapTime, best });
            if (lapNow + 1 === this.laps) this.events.push({ type: 'finalLap' });
          }
        } else if (r.isPlayer) {
          this.events.push({ type: 'checkpoint', idx: cp % CHECKPOINTS, of: CHECKPOINTS });
        }
      }
    }
    this.updatePositions();
    if (this.player.finished && this.phase === 'racing') this.phase = 'finished';
    this.rubberBand();
  }

  private rubberBand() {
    const p = this.player.car;
    for (const r of this.racers) {
      if (!r.ai || r.isPlayer) continue;
      const gap = r.car.dist - p.dist; // + = AI ahead
      r.ai.skillMod = 1 + clamp(-gap / 2500, -0.035, 0.03);
    }
  }

  private collideCars() {
    const tr = this.track;
    const rs = this.racers;
    const LEN = CAR_HALF_L * 2 + 0.1;
    const WID = CAR_HALF_W * 2 + 0.15;
    for (let i = 0; i < rs.length; i++) {
      const a = rs[i].car;
      if (a.fallen || a.ghost > 0 || a.h > 1.2) continue;
      for (let j = i + 1; j < rs.length; j++) {
        const b = rs[j].car;
        if (b.fallen || b.ghost > 0 || b.h > 1.2) continue;
        const ds = tr.delta(a.s, b.s); // + => b ahead
        const dd = b.d - a.d;
        if (Math.abs(ds) >= LEN || Math.abs(dd) >= WID) continue;
        const penS = LEN - Math.abs(ds);
        const penD = WID - Math.abs(dd);
        const va = trackVel(a), vb = trackVel(b);
        let impact = 0;
        if (penD / WID < penS / LEN) {
          // side-by-side contact: push apart laterally
          const sd = Math.sign(dd) || 1;
          a.d -= (sd * penD) / 2;
          b.d += (sd * penD) / 2;
          const rel = (vb.vb - va.vb) * sd;
          if (rel < 0) {
            impact = -rel;
            const avg = (va.vb + vb.vb) / 2;
            va.vb = avg - sd * impact * 0.25;
            vb.vb = avg + sd * impact * 0.25;
            va.va *= 0.995;
            vb.va *= 0.995;
          }
        } else {
          // nose-to-tail: the car behind transfers momentum to the car in front
          const sd = Math.sign(ds) || 1;
          const back = sd > 0 ? a : b;
          const front = sd > 0 ? b : a;
          const vBack = sd > 0 ? va : vb;
          const vFront = sd > 0 ? vb : va;
          back.s = tr.wrap(back.s - penS * 0.5);
          back.dist -= penS * 0.5;
          front.s = tr.wrap(front.s + penS * 0.5);
          front.dist += penS * 0.5;
          const rel = vBack.va - vFront.va;
          if (rel > 0) {
            impact = rel;
            const avg = (vBack.va + vFront.va) / 2;
            vBack.va = avg - rel * 0.15;
            vFront.va = avg + rel * 0.15;
            // a little spin for the car that got hit off-centre
            front.yawRate += (dd * sd) * 0.15 * Math.min(rel, 10) * 0.1;
          }
        }
        setTrackVel(a, va.va, va.vb);
        setTrackVel(b, vb.va, vb.vb);
        if (impact > 1.5) this.events.push({ type: 'carHit', a: i, b: j, impact });
      }
    }
  }

  private updatePositions() {
    const order = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.car.dist - a.car.dist;
    });
    order.forEach((r, i) => (r.position = i + 1));
  }

  /** Estimated total time for racers still running (used by the results screen). */
  estimateFinish(r: Racer) {
    if (r.finished) return r.finishTime;
    const remaining = this.laps * this.track.length - r.car.dist;
    const avg = Math.max(20, r.car.dist / Math.max(1, this.time));
    return this.time + remaining / avg;
  }

  resetPlayer() {
    const p = this.player;
    if (this.phase !== 'racing') return;
    resetCar(p.car, this.track);
    p.resets++;
  }
}

function mkRacer(idx: number, name: string, color: number, accent: number, isPlayer: boolean, car: CarState, ai: AIDriver | null): Racer {
  return {
    idx, name, color, accent, isPlayer, car, ai, finished: false, finishTime: 0, lapStart: 0, lapTimes: [], bestLap: Infinity,
    position: 0, checkpoint: 0, resets: 0, wallHits: 0, falls: 0,
  };
}
