// Headless checks for thruster flight and tricks.
import { buildTrack } from '../src/game/track/TrackBuilder';
import { TRACKS } from '../src/game/track/tracks';
import type { TrackId } from '../src/game/track/types';
import { PHYS_DT, Race } from '../src/game/race/Race';
import { AIDriver } from '../src/game/ai/AIDriver';
import { emptyInput } from '../src/game/vehicle/CarPhysics';

let ok = true;
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) ok = false;
};

for (const id of ['neon', 'desert', 'coastal'] as TrackId[]) {
  const { track } = buildTrack(TRACKS[id]);
  console.log(`\n${TRACKS[id].name}`);

  // 1) hold Fly for a whole lap with the AI steering: height, curves, tunnels, Skywall lockout
  {
    const race = new Race(track, 1, { autopilot: true });
    const p = race.player;
    const ai = p.ai as AIDriver;
    const c = p.car;
    let maxH = 0, maxTunnelH = 0, skyH = 0, flyT = 0, field = 0, wallHits = 0, refills = 0;
    for (let t = 0; t < 200 && !p.finished; t += PHYS_DT) {
      race.step(PHYS_DT, emptyInput());
      // after the AI decides, hold fly and keep the meter topped up so we can fly the whole lap
      ai.input.fly = race.phase === 'racing';
      ai.input.boost = false;
      if (c.boost < 30) { c.boost = 100; refills++; }
      if (c.flying) flyT += PHYS_DT;
      maxH = Math.max(maxH, c.h);
      if (track.inZone('tunnel', c.s, -10)) maxTunnelH = Math.max(maxTunnelH, c.h);
      if (track.inZone('skywall', c.s)) skyH = Math.max(skyH, c.h);
      if (c.wallHit > 0) wallHits++;
      if (!c.grounded && c.h > 1.3 && Math.abs(c.d) > track.halfWidth - 2.5) field++;
    }
    check(p.finished, `flew the lap and finished (${flyT.toFixed(0)} s in the air)`);
    check(maxH > 10 && maxH < 12.5, `hover ceiling ${maxH.toFixed(1)} m`);
    if (track.zones.some((z) => z.tag === 'tunnel')) check(maxTunnelH < 4, `tunnel ceiling respected (max ${maxTunnelH.toFixed(1)} m)`);
    if (track.zoneOf('skywall')) check(skyH < 0.5 && c.fallen === false && p.falls === 0, `Skywall: thrusters locked, car on the wall (max h ${skyH.toFixed(2)})`);
    check(wallHits === 0, `no crashes while flying (${wallHits})`);
    console.log(`    force-field nudges: ${Math.round(field * PHYS_DT * 10) / 10} s`);
  }

  // 2) tricks: hop + flip, hop + barrel roll, late flip -> bad landing, hover double flip
  const trial = (_label: string, script: (t: number) => { fly: boolean; flip: boolean; steer: number; brake: number }) => {
    const race = new Race(track, 3);
    const c = race.player.car;
    // start on a straight just after the grid, already moving
    c.vx = 40;
    race.countdown = 0;
    let t0 = -1;
    let result = 'none';
    for (let t = 0; t < 8; t += PHYS_DT) {
      const inp = emptyInput();
      inp.throttle = 1;
      if (race.phase === 'racing') {
        if (t0 < 0) t0 = t;
        const s = script(t - t0);
        inp.fly = s.fly;
        inp.handbrake = s.flip;
        inp.steer = s.steer;
        inp.brake = s.brake;
        if (s.brake) inp.throttle = 0;
      }
      race.step(PHYS_DT, inp);
      for (const e of race.events) {
        if (e.type === 'trick' && e.racer === race.player.idx) result = `clean: ${e.tricks.join('+')} +${e.reward}`;
        if (e.type === 'badLanding' && e.racer === race.player.idx) result = 'bad landing';
      }
      if (result !== 'none') break;
    }
    return result;
  };
  const hop = (t: number) => t < 0.08;
  let r = trial('front', (t) => ({ fly: hop(t), flip: t > 0.1 && t < 0.3, steer: 0, brake: 0 }));
  check(r.startsWith('clean: front'), `hop + front flip → ${r}`);
  r = trial('roll', (t) => ({ fly: hop(t), flip: t > 0.1 && t < 0.3, steer: t > 0.1 && t < 0.3 ? 1 : 0, brake: 0 }));
  check(r.startsWith('clean: rollR'), `hop + barrel roll → ${r}`);
  r = trial('back', (t) => ({ fly: hop(t), flip: t > 0.1 && t < 0.3, steer: 0, brake: t > 0.1 && t < 0.3 ? 1 : 0 }));
  check(r.startsWith('clean: back'), `hop + backflip → ${r}`);
  r = trial('late', (t) => ({ fly: hop(t), flip: t > 0.75 && t < 0.9, steer: 0, brake: 0 }));
  check(r === 'bad landing', `late flip → ${r}`);
  r = trial('combo', (t) => ({ fly: t < 2.2, flip: t > 0.4 && t < 2.0, steer: 0, brake: 0 }));
  check(/clean: front\+front/.test(r), `hover + chained flips → ${r}`);
}
console.log(ok ? '\nFLIGHT OK' : '\nFLIGHT ISSUES');
