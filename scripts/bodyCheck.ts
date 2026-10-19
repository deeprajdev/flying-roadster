// Sanity checks for the procedural body: outward normals, no NaNs, triangle counts.
import { bodyGeometries } from '../src/game/vehicle/RoadsterBody';
const g = bodyGeometries();
for (const [name, geo] of Object.entries(g)) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  let nan = 0;
  for (let i = 0; i < pos.count * 3; i++) if (!isFinite(pos.array[i] as number) || (nor && !isFinite(nor.array[i] as number))) nan++;
  const tris = geo.index ? geo.index.count / 3 : pos.count / 3;
  // outward test: dot(normal, position - centre) for paint should be mostly positive
  let out = 0, inn = 0;
  if (nor && name !== 'fins' && name !== 'splitter' && name !== 'mirror') {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i) - 0.55, z = pos.getZ(i) * 0.35;
      const d = x * nor.getX(i) + y * nor.getY(i) + z * nor.getZ(i);
      if (d > 0) out++; else inn++;
    }
  }
  console.log(`${name.padEnd(9)} tris ${String(Math.round(tris)).padStart(6)}  NaN ${nan}  outward ${out} inward ${inn}`);
}
