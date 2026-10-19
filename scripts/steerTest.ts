// Measures steering responsiveness for each assist level: heading change after a short tap,
// time to reach 15° of heading change with the button held, and lap stability with on/off steering.
import { buildTrack } from '../src/game/track/TrackBuilder';
import { TRACKS } from '../src/game/track/tracks';
import { newFrame } from '../src/game/track/TrackData';
import { PHYS_DT, Race } from '../src/game/race/Race';
import { emptyInput, newCarState, stepCar } from '../src/game/vehicle/CarPhysics';
import { formatTime, wrapAngle } from '../src/game/core/math';

const { track } = buildTrack(TRACKS.neon);
const S0 = 3250; // start straight on Neon City (s wraps through 0)
const deg = (r: number) => (r * 180) / Math.PI;

function respond(assist: number, kmh: number) {
  // heading after a 120 ms tap, and time until 15° when held
  const tap = () => {
    const c = newCarState(S0, 0);
    c.vx = kmh / 3.6;
    const inp = emptyInput();
    inp.throttle = 1;
    inp.assist = assist;
    let psi0 = c.psi, maxPsi = 0;
    for (let t = 0; t < 0.6; t += PHYS_DT) {
      inp.steer = t < 0.12 ? 1 : 0;
      const s0 = c.s;
      stepCar(c, inp, track, PHYS_DT);
      // track the car's world heading change: psi relative to road + road turn (≈0 on a straight)
      void s0;
      maxPsi = Math.max(maxPsi, c.psi - psi0);
    }
    return deg(maxPsi);
  };
  const hold = () => {
    const c = newCarState(S0, -3);
    c.vx = kmh / 3.6;
    const inp = emptyInput();
    inp.throttle = 1;
    inp.assist = assist;
    inp.steer = 1;
    for (let t = 0; t < 2; t += PHYS_DT) {
      stepCar(c, inp, track, PHYS_DT);
      if (deg(c.psi) >= 15) return t;
    }
    return NaN;
  };
  return { tap: tap(), hold: hold() };
}

console.log('assist | 120 ms tap @150 | 15° held @150 | 120 ms tap @250 | 15° held @250');
for (const a of [0, 1, 2, 3]) {
  const r1 = respond(a, 150), r2 = respond(a, 250);
  console.log(`  ${a}    |   ${r1.tap.toFixed(1)}°        |   ${(r1.hold * 1000).toFixed(0)} ms     |   ${r2.tap.toFixed(1)}°        |   ${(r2.hold * 1000).toFixed(0)} ms`);
}

// lap with on/off steering (like a thumb on the pad) for each level
const F = newFrame();
const A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };
for (const a of [0, 2, 3]) {
  const race = new Race(track, 1);
  const p = race.player;
  const inp = emptyInput();
  inp.assist = a;
  let swaps = 0, last = 0;
  for (let t = 0; t < 200 && !p.finished; t += PHYS_DT) {
    const c = p.car;
    const sp = Math.max(0, c.vx);
    const look = c.s + 7 + sp * 0.33;
    track.toWorld(c.s, c.d, 0, F, A);
    const T = [F.tx, F.ty, F.tz], R = [F.rx, F.ry, F.rz];
    track.toWorld(look, race.line.lineAt(look), 0, F, B);
    const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    const err = wrapAngle(Math.atan2(dx * R[0] + dy * R[1] + dz * R[2], dx * T[0] + dy * T[1] + dz * T[2]) - c.psi);
    inp.steer = err > 0.04 ? 1 : err < -0.04 ? -1 : 0;
    if (inp.steer !== last) swaps++;
    last = inp.steer;
    const vT = race.line.minSpeed(c.s + sp * 0.12, 6 + sp * 0.15) * 0.97;
    inp.throttle = sp < vT ? 1 : 0; // like auto-gas with braking
    inp.brake = sp > vT + 3 ? 1 : 0;
    race.step(PHYS_DT, inp);
  }
  console.log(`lap, on/off steering, assist ${a}: ${p.finished ? formatTime(p.finishTime) : 'DNF'}  walls ${p.wallHits}  resets ${p.resets}`);
}
