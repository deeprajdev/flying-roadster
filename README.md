# Tesla Roadster: Space X10

A 3D browser racing game built with Three.js, React, TypeScript and Vite. Drive a silver Roadster with ten hidden cold-gas thrusters against five AI rivals on three circuits, including the Skywall: a vertical loop modelled on the Roadster ramp demo. The thrusters boost you, lift you off the road, and let you flip and barrel-roll in the air.

## Run it locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173) in Chrome, Edge, Firefox or Safari on desktop or phone. To test on your phone, run `npm run dev -- --host` and open the Network URL on a phone on the same Wi-Fi. Click or tap once so the browser allows sound.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks and builds a static site into `dist/` |
| `npm run preview` | Serves the `dist/` build locally |
| `npm run build:single` | Builds the whole game into one self-contained `dist-single/index.html` |
| `npm run sim -- neon,desert,coastal 3` | Headless race: AI drives every car and reports lap times, wall hits and resets |
| `npx tsx scripts/keyboardBot.ts neon drift` | Headless race driven with keyboard-style on/off inputs |
| `npx tsx scripts/flightTest.ts` | Headless checks for flight, tunnel/Skywall limits and tricks |

## Day and night

Pick **Day** or **Night** in the menu; every circuit has both, and the choice is remembered.

- **By day:** real sun shadows from the cars, barriers and nearby towers, drifting clouds, sunlit glass, limestone, brick and concrete facades, reflections of the sky in the glass towers.
- **By night:** lit office floors and apartments, floodlit crowns, sweeping searchlights, the bridge and street-light grid in Neon City, a wet-look road; headlight beams and light pools on every car, a moon and stars; road studs and a distant town in the desert; lamp-lit coast road, villages on the hills and a rotating lighthouse beam on the coast.

## Settings

**Settings** sits next to Start race on the main menu, and in the pause menu during a race. Choices are saved in the browser.

| Setting | Options |
| --- | --- |
| Music | On / Off, volume Low / Med / High (a synthwave soundtrack generated live) |
| Effects | On / Off, volume Low / Med / High (motor, thrusters, tyres, impacts) |
| Graphics quality | **High**: full-resolution rendering (up to 2× on desktop, 1.75× on phones), 4× anti-aliasing, real sun shadows. **Low**: lighter resolution, 2× anti-aliasing, soft blob shadows, for older phones |
| FPS counter | On / Off |
| Camera | Chase, Far or Bumper to start each race (C still switches during a race) |
| Speed units | km/h or mph |
| Steering (touch) | Smooth, Quick or Sharp |
| Vibration (touch) | On / Off |

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A / D or ← / → | Steer |
| Shift | Rocket boost (all 10 thrusters) |
| Space | Drift / handbrake. In the air: flip (add A/D for a barrel roll, S for a backflip) |
| F (or E) | Fly: tap to hop, hold to lift off and hover |
| C | Change camera (chase, far chase, bumper) |
| R | Reset the car onto the road |
| Esc or P | Pause |
| M | Mute everything |
| Enter | Start race / race again |

## Phone and tablet

Touch devices get on-screen controls automatically, in portrait or landscape (landscape shows more road):

- **Left pad:** steer. Tap for a quick correction, hold to turn, slide across to switch sides. Settings → Steering picks Smooth, Quick or Sharp response; Sharp is the default.
- **Right side:** Boost (the ring around it is the boost meter), Fly, Drift and Brake. Hold Brake to reverse. In the air, Drift turns into Flip; hold a steer side while pressing it for a barrel roll, or Brake for a backflip.
- **Top:** pause, camera and reset.
- The car accelerates by itself; brake to slow down.

Phones render up to 1.75× resolution on High graphics (Settings → Graphics → Low for older phones), and quality steps down automatically if the frame rate falls.

## Flying and tricks

- Tap Fly to hop, hold it to rise to about 11 m and hover. Flying burns boost (about 7 seconds from a full meter); you drop when it runs out or you let go.
- In flight the jets follow the curve of the road and steering moves you across it. Above the barriers an invisible force field keeps you on the circuit.
- While airborne, press Flip (Space) for a front flip, with left/right for a barrel roll, or with Brake (S) for a backflip. Keep it held to chain tricks.
- Land with the trick finished to earn boost (18% per trick, more for combos). Touch down halfway through a flip and you lose half your speed.
- Ceilings: flight drops to 3.3 m in tunnels, and the jets lock 150 m before the Skywall so you meet the loop on the road.
- Crest jumps work too: press Flip over a ramp for a quick trick.

## Driving tips

- Boost drains the meter and refills slowly. Drifting and airtime refill it faster.
- Tap Space while steering into a hairpin to start a drift; hold the throttle to carry speed through it.
- The Skywall loop needs speed. If you enter it too slowly, the deck thrusters fire automatically to pin the car to the wall, using boost energy. Run out of boost and you fall off and respawn before the loop.

## Circuits

- **Neon City** (3.4 km): a night city mixing New York and San Francisco. Glass supertalls, Art Deco setback towers with floodlit crowns and spires, a white pyramid tower, rooftop water tanks, blinking aircraft beacons and sweeping searchlights. The start straight runs along a bay with a lit suspension bridge, moving traffic and a second skyline across the water. Track: fast sweepers, a tight right, chicane, hairpin, elevated skyway S-curves with a kicker jump, a boost tunnel, and the Skywall loop.
- **Desert Run** (3.2 km): three alternating switchback hairpins up a red-rock massif, a canyon descent and a crest jump on the return straight.
- **Coastal Drive** (3.0 km): cliff-top sweepers, two cliffside hairpin pairs down to the beach, beachfront sweepers, a headland tunnel and a lighthouse.

## How it works

- `src/game/track/` builds each circuit from a waypoint polygon with filleted corners, height knots and banking, then samples it into road frames (position, tangent, up, right). Everything runs in track space: distance along the road, lateral offset, height.
- `src/game/vehicle/RoadsterBody.ts` builds the hard-surface body: cross-sections are split into panels at the character lines (rocker, shoulder, deck edge), so creases stay crisp; real wheel-arch cut-outs, side scoops, panel shut lines, LED light strips, splitter and diffuser. The paint reflects the actual world, captured as a cube map at the start grid when a circuit loads.
- `src/game/vehicle/CarPhysics.ts` is an arcade model in that track space. Gravity, banking, crests (airtime) and the loop come from the road's curvature, so cars can't fall through the track. Barriers, drift, boost and car-to-car collisions live here too.
- `src/game/ai/` precomputes a curvature-minimising racing line and a safe-speed profile. AI drivers use pure-pursuit steering on the same physics as the player, with five personalities (pace, aggression, boost use, line bias).
- `src/game/race/Race.ts` handles the grid, countdown, laps, checkpoints, positions, rubber-banding and results. It has no rendering code, which is what the headless `scripts/` tests run.
- `src/game/Game.ts` owns the renderer, bloom post-processing, cameras, particles and audio. `src/ui/` is the React menu, HUD, pause and results screens.
- `src/game/audio/Music.ts` sequences the soundtrack (bass, pads, arpeggio, drums) on the Web Audio clock.
- All audio is synthesised with the Web Audio API and all textures are generated at runtime, so there are no asset files. The thrusters are one continuous cold-gas voice (pink noise through a pressure-dependent hiss band and a low body), so the hiss drops in pitch as the boost tank empties.
- `src/game/scenery/skyline.ts` builds the city from four instanced shapes (box, cylinder, pyramid, spire) with one shader that draws sunlit facades by day and lit windows, crowns, LED fins by night.
- `src/game/track/themes.ts` holds the six track × time-of-day looks (sky, sun or moon, clouds, fog, lights, shadows, road wetness).
