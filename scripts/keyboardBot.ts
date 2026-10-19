// Drives the player car with DIGITAL inputs only (like a keyboard: steer -1/0/1, throttle on/off,
// handbrake taps, boost button) to verify the car is controllable without analog input,
// then races it against the AI field.
import { clamp, formatTime, wrapAngle } from '../src/game/core/math';
import { buildTrack } from '../src/game/track/TrackBuilder';
import { newFrame } from '../src/game/track/TrackData';
import { TRACKS } from '../src/game/track/tracks';
import type { TrackId } from '../src/game/track/types';
import { PHYS_DT, Race } from '../src/game/race/Race';
import { emptyInput } from '../src/game/vehicle/CarPhysics';

const id = (process.argv[2] ?? 'neon') as TrackId;
const drift = process.argv[3] === 'drift';
const { track } = buildTrack(TRACKS[id]);
const race = new Race(track, 3);
const p = race.player;
const inp = emptyInput();
const F = newFrame();
const A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };
let driftT = 0, boostT = 0, hbHold = 0;
let maxSlip = 0;
for (let t = 0; t < 600; t += PHYS_DT) {
  const c = p.car;
  const sp = Math.max(0, c.vx);
  const look = c.s + 7 + sp * 0.33;
  const td = race.line.lineAt(look);
  track.toWorld(c.s, c.d, 0, F, A);
  const T = [F.tx, F.ty, F.tz], R = [F.rx, F.ry, F.rz];
  track.toWorld(look, td, 0, F, B);
  const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
  const err = wrapAngle(Math.atan2(dx * R[0] + dy * R[1] + dz * R[2], dx * T[0] + dy * T[1] + dz * T[2]) - c.psi);
  // bang-bang steering with a small dead-band, like tapping A/D
  inp.steer = err > 0.035 ? 1 : err < -0.035 ? -1 : 0;
  const vT = race.line.minSpeed(c.s + sp * 0.12, 6 + sp * 0.15) * 0.97;
  inp.throttle = sp < vT ? 1 : 0;
  inp.brake = sp > vT + 3 ? 1 : 0;
  // handbrake tap into hairpins
  if (drift) {
    const tight = race.line.minSpeed(c.s, 25) < 26;
    if (tight && sp > 24 && hbHold <= 0 && Math.abs(err) > 0.05) hbHold = 0.35;
    hbHold -= PHYS_DT;
    inp.handbrake = hbHold > 0;
    if (inp.handbrake) inp.brake = 0;
  }
  const roomy = race.line.minSpeed(c.s, 140) > sp + 15;
  inp.boost = roomy && c.boost > 30 && inp.throttle === 1;
  race.step(PHYS_DT, inp);
  if (c.drifting) driftT += PHYS_DT;
  if (c.boosting) boostT += PHYS_DT;
  maxSlip = Math.max(maxSlip, Math.abs(c.slip));
  if (race.phase === 'finished') break;
}
console.log(`${TRACKS[id].name} keyboard bot${drift ? ' (drift)' : ''}: ${p.finished ? 'FINISHED P' + p.position + ' ' + formatTime(p.finishTime) : 'DNF'}`);
console.log(`  laps [${p.lapTimes.map((x) => x.toFixed(1)).join(', ')}]  walls ${p.wallHits}  resets ${p.resets}  falls ${p.falls}`);
console.log(`  drift ${driftT.toFixed(1)}s  boost ${boostT.toFixed(1)}s  max slip ${(maxSlip * 57.3).toFixed(0)}°`);
console.log(`  AI best: ${formatTime(Math.min(...race.racers.filter((r) => !r.isPlayer).map((r) => r.bestLap)))}`);
void clamp;
