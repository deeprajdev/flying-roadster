// Headless race simulation: every car (including the player slot) is AI-driven.
// Verifies the circuit is completable, AI survives the corners, the Skywall loop works,
// and reports lap times, wall hits, resets and falls.
import { formatTime } from '../src/game/core/math';
import { emptyInput } from '../src/game/vehicle/CarPhysics';
import { buildTrack } from '../src/game/track/TrackBuilder';
import { TRACKS } from '../src/game/track/tracks';
import type { TrackId } from '../src/game/track/types';
import { PHYS_DT, Race } from '../src/game/race/Race';

const ids = (process.argv[2] ? process.argv[2].split(',') : ['neon']) as TrackId[];
const laps = Number(process.argv[3] ?? 3);
let ok = true;
for (const id of ids) {
  const { track, report } = buildTrack(TRACKS[id]);
  const race = new Race(track, laps, { autopilot: true });
  const inp = emptyInput();
  let maxSpeed = 0, air = 0, boostT = 0, loopsDone = 0, driftT = 0;
  const sky = track.zoneOf('skywall');
  const lastSky: number[] = race.racers.map(() => 0);
  let t = 0;
  const limit = 60 * 12;
  while (t < limit) {
    race.step(PHYS_DT, inp);
    t += PHYS_DT;
    for (const r of race.racers) {
      const c = r.car;
      maxSpeed = Math.max(maxSpeed, c.vx);
      if (!c.grounded) air += PHYS_DT;
      if (c.boosting) boostT += PHYS_DT;
      if (c.drifting) driftT += PHYS_DT;
      if (sky) {
        const inLoop = track.inZone('skywall', c.s) ? 1 : 0;
        if (lastSky[r.idx] === 1 && inLoop === 0 && !c.fallen && track.delta(sky.s1, c.s) > 0 && track.delta(sky.s1, c.s) < 20) loopsDone++;
        lastSky[r.idx] = inLoop;
      }
    }
    if (race.racers.every((r) => r.finished)) break;
  }
  console.log(`\n=== ${TRACKS[id].name}  length ${track.length.toFixed(0)} m  minR ${report.minRadius.toFixed(1)}  crossings ${report.crossings.length}`);
  for (const r of [...race.racers].sort((a, b) => a.position - b.position)) {
    console.log(
      `P${r.position} ${r.name.padEnd(6)} ${r.finished ? formatTime(r.finishTime) : 'DNF ' + (r.car.dist / track.length).toFixed(2) + ' laps'}` +
        `  best ${formatTime(r.bestLap)}  laps [${r.lapTimes.map((x) => x.toFixed(1)).join(', ')}]  walls ${r.wallHits}  resets ${r.resets}  falls ${r.falls}`,
    );
    if (!r.finished || r.falls > 0 || r.resets > 1) ok = false;
  }
  console.log(`max speed ${(maxSpeed * 3.6).toFixed(0)} km/h · airtime ${air.toFixed(1)}s · boost ${boostT.toFixed(1)}s · drift ${driftT.toFixed(1)}s · loops ${loopsDone}`);
}
console.log(ok ? '\nSIM OK' : '\nSIM ISSUES');
