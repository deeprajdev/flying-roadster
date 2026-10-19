import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AIDriver } from './ai/AIDriver';
import { RaceLine } from './ai/RaceLine';
import { audio } from './audio/AudioEngine';
import { CAMERA_MODES, ChaseCamera } from './ChaseCamera';
import { clamp, formatTime } from './core/math';
import { Particles, softTexture } from './fx/Particles';
import { makeSpeedLines } from './fx/SpeedLines';
import { Input, type Action } from './input';
import { IS_TOUCH, VIEW, fovForAspect } from './device';
import { CHECKPOINTS, PHYS_DT, Race } from './race/Race';
import { makeEnvMap, makeSky } from './scenery/common';
import { buildScenery, type Scenery } from './scenery';
import { store, toast, type ResultRow } from './store';
import type { Graphics, Settings } from './settings';
import { buildTrack } from './track/TrackBuilder';
import { newFrame, type TrackData } from './track/TrackData';
import { buildTrackMesh, type TrackVisuals } from './track/TrackMesh';
import { getTheme, type Theme, type TimeOfDay } from './track/themes';
import { TRACKS } from './track/tracks';
import type { TrackId } from './track/types';
import { TRICK_NAMES, emptyInput, type TrickKind } from './vehicle/CarPhysics';
import { CarView } from './vehicle/CarView';

interface World {
  key: string;
  id: TrackId;
  tod: TimeOfDay;
  sky: THREE.Mesh;
  track: TrackData;
  line: RaceLine;
  theme: Theme;
  root: THREE.Group;
  visuals: TrackVisuals;
  scenery: Scenery;
  envMap: THREE.Texture;
  /** reflections for the cars, captured from the real world at the start grid */
  carEnv: THREE.Texture | null;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const UP = new THREE.Vector3(0, 1, 0);
const SR = new THREE.Vector3();
const SU = new THREE.Vector3();
const SC = new THREE.Vector3();

/** "Double front flip", "Barrel roll + Backflip", ... */
function trickTitle(tricks: TrickKind[]) {
  const names = tricks.map((t) => TRICK_NAMES[t as Exclude<TrickKind, 'none'>]);
  const groups: { name: string; n: number }[] = [];
  for (const nm of names) {
    const last = groups[groups.length - 1];
    if (last && last.name === nm) last.n++;
    else groups.push({ name: nm, n: 1 });
  }
  const mult = ['', '', 'Double ', 'Triple ', 'Quad '];
  return groups.map((g) => (g.n > 1 ? (mult[g.n] ?? `${g.n}x `) + g.name.toLowerCase() : g.name)).join(' + ').toUpperCase();
}
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(66, 1, 0.1, 6500);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private chase: ChaseCamera;
  private input = new Input();
  private worlds = new Map<string, World>();
  private world: World | null = null;
  private race: Race | null = null;
  private views: CarView[] = [];
  private smoke: Particles;
  private sparks: Particles;
  private speedLines = makeSpeedLines();
  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  private sunDir = new THREE.Vector3(0, 1, 0);
  private mode: 'menu' | 'race' = 'menu';
  private paused = false;
  private acc = 0;
  private last = 0;
  private t = 0;
  private hudT = 0;
  private finishT = -1;
  private loopWarned = -1;
  private raf = 0;
  private playerInput = emptyInput();
  private frameTimes: number[] = [];
  private quality = 1;
  private qualityDropT = -99;
  private lastBuzz = -9;
  private fastWindows = 0;
  private disposed = false;
  private loading: Promise<void> | null = null;
  private menuAngle = 0;
  private flyHintShown = false;
  /** test hook: fixed menu camera [px,py,pz, lx,ly,lz, fov] */
  camOverride: number[] | null = null;
  private baseDpr = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.75 : 2);
  private gfxHigh = true;
  private appliedSettings: Settings | null = null;
  private unsubSettings: (() => void) | null = null;

  constructor(private container: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(this.baseDpr);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.style.display = 'block';
    this.renderer = r;
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.55, 0.75);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.chase = new ChaseCamera(this.camera);
    this.scene.add(this.camera);
    this.camera.add(this.speedLines.mesh);
    this.smoke = new Particles(IS_TOUCH ? 1800 : 3600, false, softTexture(0.1));
    this.sparks = new Particles(2600, true, softTexture(0.25));
    this.scene.add(this.smoke.points, this.sparks.points, this.hemi, this.sun, this.sun.target);
    // sun shadow: a 140 m box around the player
    this.sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 20; sc.far = 600;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.input.attach();
    this.input.onPress = (code) => this.onKey(code);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.applySettings(store.get().settings);
    this.unsubSettings = store.subscribe(() => this.applySettings(store.get().settings));
    this.onResize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Apply whatever changed in the player's settings. */
  private applySettings(st: Settings) {
    const prev = this.appliedSettings;
    if (prev === st) return;
    this.appliedSettings = st;
    if (!prev || prev.music !== st.music || prev.musicVol !== st.musicVol) audio.setMusic(st.music, st.musicVol);
    if (!prev || prev.sfx !== st.sfx || prev.sfxVol !== st.sfxVol) audio.setSfx(st.sfx, st.sfxVol);
    if (!prev || prev.graphics !== st.graphics) this.setGraphics(st.graphics);
    if (prev && prev.camera !== st.camera && this.mode === 'race') {
      this.chase.mode = st.camera;
      store.setHud({ camera: CAMERA_MODES[st.camera] });
    }
  }

  /** High: full pixel ratio, 4x MSAA, real sun shadows. Low: lighter pixel ratio, 2x MSAA, blob shadows. */
  private setGraphics(g: Graphics) {
    const high = g === 'high';
    this.gfxHigh = high;
    const dpr = window.devicePixelRatio || 1;
    this.baseDpr = Math.min(dpr, high ? (IS_TOUCH ? 1.75 : 2) : (IS_TOUCH ? 1.1 : 1.25));
    this.quality = 1;
    this.frameTimes.length = 0;
    this.fastWindows = 0;
    this.renderer.setPixelRatio(this.baseDpr);
    const samples = high && !IS_TOUCH && this.baseDpr < 1.5 ? 4 : 2;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    }
    const shadows = high && !!this.world?.theme.shadows;
    this.sun.castShadow = shadows;
    this.renderer.shadowMap.needsUpdate = true;
    for (const v of this.views) v.setRealShadows(shadows);
    this.onResize();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.unsubSettings?.();
    audio.silence();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.resolution.set(w / (IS_TOUCH ? 4 : 2), h / (IS_TOUCH ? 4 : 2));
    this.speedLines.mat.uniforms.uAspect.value = w / h;
    const ph = h * this.renderer.getPixelRatio();
    VIEW.h = ph;
    this.smoke.setViewportScale(ph, this.camera.fov);
    this.sparks.setViewportScale(ph, this.camera.fov);
  };

  private onVisibility = () => {
    if (document.hidden && this.mode === 'race' && this.race?.phase !== 'finished') this.setPaused(true);
  };

  private onKey(code: string) {
    if (store.get().settingsOpen) {
      if (code === 'Escape') store.set({ settingsOpen: false });
      return;
    }
    if (code === 'KeyM') {
      const m = !store.get().muted;
      audio.setMuted(m);
      store.set({ muted: m });
      return;
    }
    if (this.mode !== 'race' || !this.race) return;
    if (code === 'Escape' || code === 'KeyP') {
      if (this.race.phase !== 'finished') this.setPaused(!this.paused);
      return;
    }
    if (this.paused) return;
    if (code === 'KeyC') {
      this.chase.cycle();
      store.setHud({ camera: CAMERA_MODES[this.chase.mode] });
      toast(`CAMERA · ${CAMERA_MODES[this.chase.mode]}`, 'info', undefined, 900);
    } else if (code === 'KeyR') {
      if (this.race.phase === 'racing') {
        this.race.resetPlayer();
        this.chase.reset();
        toast('RESET', 'info', undefined, 800);
      }
    }
  }

  setPaused(p: boolean) {
    if (this.mode !== 'race') return;
    this.paused = p;
    this.input.clear();
    if (p) audio.silence();
    store.set({ paused: p });
  }

  // ------------------------------------------------------------------ worlds
  async showTrack(id: TrackId, tod: TimeOfDay = store.get().tod) {
    if (this.loading) await this.loading;
    if (this.world?.key === `${id}:${tod}` && this.race) return;
    this.loading = this.loadWorld(id, tod);
    await this.loading;
    this.loading = null;
    this.setupRace(store.get().laps, true);
  }

  private async loadWorld(id: TrackId, tod: TimeOfDay) {
    const key = `${id}:${tod}`;
    if (this.world?.key === key) return;
    let w = this.worlds.get(key);
    if (!w) {
      store.set({ loadingText: 'Building circuit…' });
      await nextFrame();
      try {
        await Promise.race([
          Promise.all([document.fonts.load("800 64px 'Barlow Condensed'"), document.fonts.load('600 24px Barlow')]),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      } catch {
        /* fonts are optional */
      }
      const theme = getTheme(id, tod);
      const { track } = buildTrack(TRACKS[id]);
      const line = new RaceLine(track);
      store.set({ loadingText: 'Raising the skyline…' });
      await nextFrame();
      const envMap = makeEnvMap(this.renderer, theme);
      const root = new THREE.Group();
      const scenery = buildScenery(id, track, theme, envMap);
      const visuals = buildTrackMesh(track, theme, envMap, scenery.groundAt);
      const sky = makeSky(theme);
      root.add(sky);
      root.add(scenery.group, visuals.group);
      this.applyShadowFlags(root, theme);
      store.set({ loadingText: 'Compiling shaders…' });
      await nextFrame();
      w = { key, id, tod, sky, track, line, theme, root, visuals, scenery, envMap, carEnv: null };
      this.worlds.set(key, w);
      this.trimWorlds(key);
    }
    if (this.world) this.scene.remove(this.world.root);
    this.world = w;
    this.scene.add(w.root);
    const th = w.theme;
    this.scene.fog = new THREE.FogExp2(th.fogColor, th.fogDensity);
    this.scene.background = new THREE.Color(th.skyHorizon);
    this.hemi.color.set(th.hemiSky);
    this.hemi.groundColor.set(th.hemiGround);
    this.hemi.intensity = th.hemiIntensity;
    this.sun.color.set(th.sunColor);
    this.sun.intensity = th.sunIntensity;
    this.sun.position.set(th.sunDir[0] * 100, th.sunDir[1] * 100, th.sunDir[2] * 100);
    this.sunDir.set(...th.sunDir).normalize();
    this.sun.castShadow = th.shadows && this.gfxHigh;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMappingExposure = th.exposure;
    this.bloom.strength = th.bloom.strength;
    this.bloom.radius = th.bloom.radius;
    this.bloom.threshold = th.bloom.threshold;
    if (!w.carEnv) w.carEnv = this.captureCarEnv(w);
    this.renderer.compile(this.scene, this.camera);
  }

  /** Render the actual world around the start grid into a cube map, prefiltered for the car paint. */
  private captureCarEnv(w: World): THREE.Texture | null {
    try {
      const size = IS_TOUCH ? 128 : 256;
      const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cam = new THREE.CubeCamera(0.5, 6000, rt);
      const p = w.track.toWorld(w.track.length - 30, 0, 1.4, newFrame(), { x: 0, y: 0, z: 0 });
      cam.position.set(p.x, p.y, p.z);
      this.scene.add(cam);
      const hidden: THREE.Object3D[] = [];
      for (const v of this.views) if (v.root.visible) { v.root.visible = false; hidden.push(v.root); }
      for (const o of [this.smoke.points, this.sparks.points]) if (o.visible) { o.visible = false; hidden.push(o); }
      const skyPos = w.sky.position.clone();
      w.sky.position.copy(cam.position);
      // point sprites are sized for the screen: size them for the cube face instead
      const sprites: { u: { value: number }; v: number }[] = [];
      w.root.traverse((o) => {
        const u = ((o as THREE.Points).material as THREE.ShaderMaterial | undefined)?.uniforms?.uViewH;
        if ((o as THREE.Points).isPoints && u) {
          sprites.push({ u, v: u.value });
          u.value = size;
        }
      });
      this.renderer.shadowMap.needsUpdate = true;
      cam.update(this.renderer, this.scene);
      for (const sp of sprites) sp.u.value = sp.v;
      w.sky.position.copy(skyPos);
      for (const o of hidden) o.visible = true;
      this.scene.remove(cam);
      // clamp very bright texels (lamps, the sun) so they reflect as crisp highlights, not glowing blobs
      const rt2 = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      const clampScene = new THREE.Scene();
      const clampMat = new THREE.ShaderMaterial({
        uniforms: { tCube: { value: rt.texture }, uMax: { value: 2.5 } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform samplerCube tCube; uniform float uMax; varying vec3 vDir; void main(){ vec3 c = textureCube(tCube, normalize(vDir)).rgb; float l = max(max(c.r, c.g), c.b); gl_FragColor = vec4(c * min(1.0, uMax / max(l, 1e-4)), 1.0); }',
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), clampMat);
      clampScene.add(box);
      const cam2 = new THREE.CubeCamera(0.1, 100, rt2);
      clampScene.add(cam2);
      cam2.update(this.renderer, clampScene);
      box.geometry.dispose();
      clampMat.dispose();
      const pm = new THREE.PMREMGenerator(this.renderer);
      const env = pm.fromCubemap(rt2.texture).texture;
      pm.dispose();
      rt.dispose();
      rt2.dispose();
      return env;
    } catch {
      return null;
    }
  }

  private setupRace(laps: number, menu: boolean) {
    const w = this.world!;
    for (const v of this.views) this.scene.remove(v.root);
    this.views = [];
    this.smoke.clear();
    this.sparks.clear();
    this.race = new Race(w.track, laps, { line: w.line });
    for (const r of this.race.racers) {
      const v = new CarView(r.color, r.accent, w.carEnv ?? w.envMap, r.isPlayer, w.theme.headlights && !IS_TOUCH && this.gfxHigh, w.theme.headlights, w.theme.shadows && this.gfxHigh);
      v.smokeTint = w.theme.smoke;
      this.views.push(v);
      this.scene.add(v.root);
      v.sync(r.car, w.track, 0, this.smoke, this.sparks);
    }
    this.mode = menu ? 'menu' : 'race';
    this.paused = false;
    this.acc = 0;
    this.finishT = -1;
    this.loopWarned = -1;
    this.renderer.compile(this.scene, this.camera);
    this.chase.reset();
    this.chase.mode = menu ? 0 : store.get().settings.camera;
    this.chase.intro = menu ? 0 : 3.6;
    if (!menu) {
      store.set({ paused: false, finished: false, results: null });
      store.setHud({ laps, lap: 1, countdown: 3, go: 99, bestLap: Infinity, camera: CAMERA_MODES[this.chase.mode] });
    }
  }

  async startRace(id: TrackId, laps: number) {
    audio.init();
    store.set({ screen: 'loading', track: id, laps });
    if (this.loading) await this.loading;
    this.loading = this.loadWorld(id, store.get().tod);
    await this.loading;
    this.loading = null;
    this.setupRace(laps, false);
    store.set({ screen: 'race' });
    this.renderer.domElement.focus?.();
  }

  restart() {
    if (!this.world) return;
    audio.init();
    this.setupRace(store.get().laps, false);
    store.set({ screen: 'race' });
  }

  quitToMenu() {
    if (!this.world) return;
    audio.silence();
    this.setupRace(store.get().laps, true);
    store.set({ screen: 'menu', paused: false, finished: false, results: null });
  }

  // ------------------------------------------------------------------ loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.t += dt;
    this.adaptQuality(dt);
    if (!this.world || !this.race) {
      this.composer.render(dt);
      return;
    }
    if (this.mode === 'menu') this.menuFrame(dt);
    else this.raceFrame(dt);
    this.world.visuals.update(this.t, this.race.player.checkpoint % CHECKPOINTS + 1);
    this.world.scenery.update(this.t, this.camera.position);
    (this.world.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = this.t;
    this.world.sky.position.copy(this.camera.position);
    this.followSun();
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.composer.render(dt);
  };

  private menuFrame(dt: number) {
    const race = this.race!;
    const p = race.player;
    const v = this.views[p.idx];
    this.menuAngle += dt * 0.18;
    const a = this.menuAngle;
    if (this.camOverride) {
      const [px, py, pz, lx, ly, lz, fov] = this.camOverride;
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(lx, ly, lz);
      if (this.camera.fov !== fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      for (let i = 0; i < this.views.length; i++) this.views[i].sync(race.racers[i].car, race.track, dt, this.smoke, this.sparks);
      return;
    }
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(v.pos).addScaledVector(v.fwd, Math.cos(a) * 9).addScaledVector(v.right, Math.sin(a) * 9).addScaledVector(v.up, 2.4 + Math.sin(a * 0.7) * 0.8);
    this.camera.lookAt(v.pos.x, v.pos.y + 0.6, v.pos.z);
    const mf = fovForAspect(50, this.camera.aspect);
    if (Math.abs(this.camera.fov - mf) > 0.01) {
      this.camera.fov = mf;
      this.camera.updateProjectionMatrix();
    }
    this.speedLines.mat.uniforms.uAmount.value = 0;
    for (let i = 0; i < this.views.length; i++) this.views[i].sync(race.racers[i].car, race.track, dt, this.smoke, this.sparks);
  }

  private raceFrame(dt: number) {
    const race = this.race!;
    const tr = race.track;
    if (!this.paused) {
      this.acc += dt;
      this.input.read(this.playerInput);
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 12) {
        race.step(PHYS_DT, this.playerInput);
        this.handleEvents();
        this.acc -= PHYS_DT;
        steps++;
      }
      if (steps === 12) this.acc = 0;
      for (let i = 0; i < this.views.length; i++) this.views[i].sync(race.racers[i].car, tr, dt, this.smoke, this.sparks);
    }
    const p = race.player;
    const pc = p.car;
    const pv = this.views[p.idx];
    this.chase.update(pv, pc, this.paused ? 0 : dt);

    // speed lines
    const sp = Math.max(0, pc.vx);
    const amt = clamp((sp - 45) / 40, 0, 1) * 0.35 + (pc.boosting ? 0.55 : 0) + (pc.autoThrust ? 0.3 : 0);
    const u = this.speedLines.mat.uniforms;
    u.uAmount.value += (amt - u.uAmount.value) * Math.min(1, dt * 6);
    u.uTime.value = this.t;

    // audio
    if (!this.paused) {
      const active = race.phase !== 'countdown' || this.playerInput.throttle > 0;
      const on = (active && !p.finished) || p.finished;
      audio.update(pc.vx, race.phase === 'countdown' ? this.playerInput.throttle : pc.input.throttle, pc.drifting ? 0.5 : pc.slip, pc.scraping, !pc.grounded, on);
      const gasLevel = pc.fallen ? 0 : Math.max(pc.boosting ? 1 : 0, pc.flying ? 0.85 : 0, pc.autoThrust ? 0.8 : 0);
      audio.gas(gasLevel, pc.boost / 100, pc.trick !== 'none' && !pc.fallen ? 1 : 0, on);
    }

    // loop hint
    const sky = tr.zoneOf('skywall');
    if (sky && race.phase === 'racing') {
      const to = tr.delta(pc.s, sky.s0);
      const lap = Math.floor(pc.dist / tr.length);
      if (to > 120 && to < 260 && this.loopWarned !== lap) {
        this.loopWarned = lap;
        toast('SKYWALL AHEAD', 'warn', 'Carry speed · hold SHIFT to boost', 2200);
      }
    }

    // finish → results
    if (this.finishT >= 0) {
      this.finishT += dt;
      if (this.finishT > 2.6 && !store.get().finished) this.showResults();
    }

    this.hudT += dt;
    if (this.hudT > 1 / 20) {
      this.hudT = 0;
      this.pushHud();
    }
  }

  private handleEvents() {
    const race = this.race!;
    const pIdx = race.player.idx;
    const pv = this.views[pIdx];
    for (const e of race.events) {
      switch (e.type) {
        case 'beep':
          audio.beep(false);
          break;
        case 'go':
          audio.beep(true);
          break;
        case 'checkpoint':
          audio.chime();
          toast(`CHECKPOINT ${e.idx}/${e.of}`, 'info', formatTime(race.time - race.player.lapStart), 1100);
          break;
        case 'lap':
          audio.fanfare();
          toast(`LAP ${e.lap}/${race.laps}`, 'lap', `${e.best ? 'BEST ' : ''}${formatTime(e.time)}`, 2200);
          break;
        case 'finalLap':
          setTimeout(() => toast('FINAL LAP', 'big', undefined, 1800), 600);
          break;
        case 'finish':
          audio.fanfare();
          toast(e.position === 1 ? 'VICTORY!' : `FINISHED P${e.position}`, 'big', formatTime(e.time), 2600);
          this.finishT = 0;
          break;
        case 'wall': {
          const v = this.views[e.racer];
          const dist = v.pos.distanceTo(pv.pos);
          if (e.racer === pIdx) {
            audio.crash(e.impact);
            if (e.impact > 4 && store.get().settings.vibration && this.t - this.lastBuzz > 0.3) {
              this.lastBuzz = this.t;
              try {
                navigator.vibrate?.(Math.min(60, 10 + e.impact * 3));
              } catch {
                /* haptics optional */
              }
            }
            this.chase.kick(Math.min(1, e.impact / 12));
          } else if (dist < 60) audio.crash(e.impact * (1 - dist / 60) * 0.6, 'ai', 0.35);
          break;
        }
        case 'carHit':
          if (e.a === pIdx || e.b === pIdx) {
            audio.thud(e.impact * 2, 'carHit', 0.2);
            this.chase.kick(Math.min(0.8, e.impact / 10));
          }
          break;
        case 'land':
          if (e.racer === pIdx) {
            if (e.impact > 8) audio.thud(e.impact * 0.3, 'land');
            this.chase.kick(Math.min(0.9, e.impact / 14));
          }
          break;
        case 'fall':
          if (e.racer === pIdx) toast('TOO SLOW FOR THE SKYWALL', 'warn', 'Respawning…', 1600);
          break;
        case 'launch':
          if (e.racer === pIdx) {
            this.chase.kick(0.15);
            if (!this.flyHintShown) {
              this.flyHintShown = true;
              toast('THRUSTERS UP', 'info', store.get().touch ? 'Tap Flip in the air · add ◀ ▶ to roll' : 'Space in the air to flip · A/D to roll · S for a backflip', 2600);
            }
          }
          break;
        case 'trick':
          if (e.racer === pIdx) {
            audio.chime();
            toast(trickTitle(e.tricks), 'lap', `Clean landing · +${e.reward}% boost`, 2000);
          }
          break;
        case 'badLanding':
          if (e.racer === pIdx) {
            audio.thud(5);
            this.chase.kick(0.8);
            toast('BAD LANDING', 'warn', 'Finish the flip before touchdown', 1600);
          }
          break;
      }
    }
  }

  private pushHud() {
    const race = this.race!;
    const p = race.player;
    const c = p.car;
    const L = race.track.length;
    const lap = clamp(Math.floor(Math.max(0, c.dist) / L) + 1, 1, race.laps);
    const sorted = [...race.racers].sort((a, b) => a.position - b.position);
    const leader = sorted[0];
    const standings = sorted.map((r) => {
      let gap = '';
      if (r === leader) gap = r.finished ? 'FIN' : 'LEADER';
      else if (r.finished && leader.finished) gap = '+' + (r.finishTime - leader.finishTime).toFixed(1) + 's';
      else {
        const d = leader.car.dist - r.car.dist;
        const v = Math.max(20, r.car.vx);
        gap = '+' + (d / v).toFixed(1) + 's';
      }
      return { name: r.name, color: hex(r.isPlayer ? 0xff2a3a : r.color), isPlayer: r.isPlayer, gap };
    });
    store.setHud({
      speed: Math.round(Math.abs(c.vx) * 3.6),
      position: p.position,
      racers: race.racers.length,
      lap,
      laps: race.laps,
      progress: clamp(c.dist / (L * race.laps), 0, 1),
      lapProgress: clamp((Math.max(0, c.dist) % L) / L, 0, 1),
      boost: c.boost,
      boosting: c.boosting,
      autoThrust: c.autoThrust,
      drifting: c.drifting,
      time: race.time,
      lapTime: race.time - p.lapStart,
      bestLap: p.bestLap,
      countdown: race.phase === 'countdown' ? race.countdown : 0,
      go: race.phase === 'countdown' ? 99 : race.time,
      wrongWay: race.phase === 'racing' && Math.cos(c.psi) < -0.35 && !c.fallen,
      airborne: !c.grounded && c.h > 1,
      flying: c.flying,
      inAir: !c.grounded && c.h > 0.5,
      standings,
    });
  }

  private showResults() {
    const race = this.race!;
    const rows: ResultRow[] = [...race.racers]
      .map((r) => ({ r, t: race.estimateFinish(r) }))
      .sort((a, b) => a.t - b.t)
      .map(({ r, t }) => ({ name: r.name, color: hex(r.isPlayer ? 0xff2a3a : r.color), isPlayer: r.isPlayer, time: t, finished: r.finished, best: r.bestLap }));
    const pos = rows.findIndex((r) => r.isPlayer) + 1;
    store.set({ finished: true, results: rows, playerPos: pos });
  }

  /** Sun shadow camera follows the player, snapped to shadow-map texels to stop shimmering. */
  private followSun() {
    if (!this.sun.castShadow || !this.race) return;
    const v = this.views[this.race.player.idx] ?? null;
    if (!v) return;
    const f = this.sunDir;
    const r = SR.crossVectors(f, UP).normalize();
    const u = SU.crossVectors(r, f);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const c = v.pos;
    const a = Math.round(c.dot(r) / texel) * texel, b = Math.round(c.dot(u) / texel) * texel, k = c.dot(f);
    SC.copy(r).multiplyScalar(a).addScaledVector(u, b).addScaledVector(f, k);
    this.sun.target.position.copy(SC);
    this.sun.position.copy(SC).addScaledVector(f, 260);
  }

  /** Real shadows by day: cars, barriers, nearby buildings and props cast; ground surfaces receive. */
  private applyShadowFlags(root: THREE.Object3D, theme: Theme) {
    if (!theme.shadows) return;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const tag = m.userData.shadow as string | undefined;
      if (tag === 'none') return;
      if (tag === 'receive' || tag === 'both') m.receiveShadow = true;
      if (tag === 'cast' || tag === 'both') m.castShadow = !(IS_TOUCH && m.userData.heavy);
    });
  }

  /** Keep at most two built worlds in memory (phones), disposing the rest. */
  private trimWorlds(keep: string) {
    const current = this.world?.key;
    for (const [k, w] of this.worlds) {
      if (this.worlds.size <= 2) break;
      if (k === keep || k === current) continue;
      w.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mt of mats) {
          for (const v of Object.values(mt)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
          mt.dispose();
        }
      });
      w.envMap.dispose();
      w.carEnv?.dispose();
      this.worlds.delete(k);
    }
  }

  /** Switch day / night: rebuilds the world for the menu preview. */
  async setTimeOfDay(tod: TimeOfDay) {
    store.set({ tod });
    try {
      localStorage.setItem('x10.tod', tod);
    } catch {
      /* storage unavailable */
    }
    await this.showTrack(store.get().track, tod);
  }

  /** On-screen buttons: one-shot actions (pause, camera, reset, mute). */
  press(code: string) {
    this.onKey(code);
  }

  /** On-screen buttons: held actions (steer, brake, boost, drift). */
  touch(action: Action, down: boolean) {
    this.input.setVirtual(action, down);
  }

  setTouchMode(on: boolean) {
    this.input.autoGas = on;
  }

  setSteering(level: number) {
    this.input.steerLevel = level;
  }

  /** Minimap data access for the HUD (read every animation frame, no React re-render). */
  minimapData() {
    if (!this.world || !this.race) return null;
    return { track: this.world.track, racers: this.race.racers };
  }

  /**
   * Keep the frame rate up: step the render resolution down quickly when frames are slow
   * (down to about 1x), and only step back up after a sustained run of fast frames, so it
   * never flips back and forth (each change reallocates the render targets).
   */
  private adaptQuality(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    this.frameTimes.length = 0;
    const typical = sorted[Math.floor(sorted.length * 0.5)];
    const now = this.t;
    const floorQ = Math.min(1, 0.9 / this.baseDpr);
    let q = this.quality;
    if (typical > 1 / 45 && q > floorQ) {
      q = Math.max(floorQ, q - (typical > 1 / 30 ? 0.25 : 0.12));
      this.qualityDropT = now;
      this.fastWindows = 0;
    } else if (typical > 1 / 40 && q <= floorQ && this.sun.castShadow) {
      // already at the lowest resolution and still slow: fall back to blob shadows
      this.sun.castShadow = false;
      for (const v of this.views) v.setRealShadows(false);
      this.qualityDropT = now;
    } else if (typical < 1 / 57) {
      this.fastWindows++;
      if (q < 1 && this.fastWindows >= 4 && now - this.qualityDropT > 10) {
        q = Math.min(1, q + 0.1);
        this.fastWindows = 0;
      }
    } else this.fastWindows = 0;
    if (q === this.quality) return;
    this.quality = q;
    const pr = this.baseDpr * q;
    if (Math.abs(pr - this.renderer.getPixelRatio()) > 0.04) {
      this.renderer.setPixelRatio(pr);
      this.onResize();
    }
  }

  /** Test hook: let the AI drive the player car (used by automated browser tests). */
  setAutopilot(on: boolean) {
    if (!this.race) return;
    this.race.autopilot = on;
    if (on && !this.race.player.ai)
      this.race.player.ai = new AIDriver({ name: 'YOU', skill: 0.97, aggression: 0.7, boostiness: 0.8, lineBias: 0, wobble: 0.1 }, 99);
  }

  /** Test hook: move the player car to distance s with speed v (m/s). */
  debugTeleport(s: number, v: number, autopilot = true) {
    const r = this.race;
    if (!r) return;
    const c = r.player.car;
    const delta = r.track.delta(c.s, s);
    c.s = r.track.wrap(s);
    c.dist += delta;
    r.player.checkpoint = Math.floor(Math.max(0, c.dist) / (r.track.length / CHECKPOINTS));
    c.d = 0; c.psi = 0; c.vx = v; c.vy = 0; c.h = 0; c.vh = 0; c.grounded = true; c.yawRate = 0;
    this.setAutopilot(autopilot);
    this.chase.reset();
  }

  /** Test hook: simulate `seconds` of race time instantly (no rendering). */
  debugFastForward(seconds: number) {
    const r = this.race;
    if (!r) return;
    for (let t = 0; t < seconds && r.phase !== 'finished'; t += PHYS_DT) {
      r.step(PHYS_DT, this.playerInput);
      if (r.events.some((e) => e.type === 'finish')) this.handleEvents();
    }
    for (let i = 0; i < this.views.length; i++) this.views[i].sync(r.racers[i].car, r.track, 0, this.smoke, this.sparks);
    this.chase.reset();
  }

  /** Test hook: snapshot of the player car. */
  debugState() {
    const r = this.race;
    if (!r) return null;
    const c = r.player.car;
    return { phase: r.phase, time: r.time, s: c.s, d: c.d, dist: c.dist, vx: c.vx, boost: c.boost, boosting: c.boosting, drifting: c.drifting, grounded: c.grounded, position: r.player.position, finished: r.player.finished, lap: Math.floor(Math.max(0, c.dist) / r.track.length) + 1, wallHits: r.player.wallHits, falls: r.player.falls };
  }
}
