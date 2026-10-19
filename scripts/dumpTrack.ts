// Builds a track and dumps its centre line + report as JSON for plotting.
import { writeFileSync } from 'node:fs';
import { buildTrack } from '../src/game/track/TrackBuilder';
import { TRACKS } from '../src/game/track/tracks';
import type { TrackId } from '../src/game/track/types';

const id = (process.argv[2] ?? 'neon') as TrackId;
const out = process.argv[3] ?? `/tmp/track_${id}.json`;
const { track, report } = buildTrack(TRACKS[id]);
console.log(JSON.stringify({ ...report, n: track.n, zones: track.zones.map((z) => [z.tag, z.s0.toFixed(0), z.s1.toFixed(0)]) }, null, 1));
writeFileSync(
  out,
  JSON.stringify({
    x: Array.from(track.px), y: Array.from(track.py), z: Array.from(track.pz),
    k: Array.from(track.kLat), hw: track.halfWidth, zones: track.zones, ds: track.ds,
  }),
);
