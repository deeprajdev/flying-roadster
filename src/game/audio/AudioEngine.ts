import { IS_TOUCH } from '../device';
import { Music } from './Music';

/**
 * Fully synthesised audio (no asset files): electric motor whine, wind, tyre screech,
 * cold-gas thruster hiss, collision thumps, countdown beeps and race chimes.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  // motor
  private mA!: OscillatorNode;
  private mB!: OscillatorNode;
  private mWhine!: OscillatorNode;
  private mGain!: GainNode;
  private mWhineGain!: GainNode;
  private mFilter!: BiquadFilterNode;
  // loops
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private screechGain!: GainNode;
  private screechFilter!: BiquadFilterNode;
  private scrapeGain!: GainNode;
  // cold-gas thrusters: one continuous pressurised-gas voice + a thinner attitude-jet voice
  private gasHiss!: BiquadFilterNode;
  private gasBody!: BiquadFilterNode;
  private gasHissGain!: GainNode;
  private gasBodyGain!: GainNode;
  private rcsFilter!: BiquadFilterNode;
  private rcsGain!: GainNode;
  private gasLevel = 0;
  // per-frame parameter updates are throttled to ~30 Hz (fewer automation events, no zipper noise)
  private lastUpdate = -1;
  private lastGas = -1;
  muted = false;
  /** global output (the M key mutes it); `master` is the sound-effects bus feeding it */
  private out!: GainNode;
  private musicBus!: GainNode;
  music: Music | null = null;
  private sfxOn = true;
  private sfxVol = 0.8;
  private musicOn = true;
  private musicVol = 0.24;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    // a bigger output buffer: slightly more latency, but no crackle when the page is busy rendering
    let ctx: AudioContext;
    try {
      ctx = new Ctx({ latencyHint: IS_TOUCH ? 'playback' : 'balanced' });
    } catch {
      ctx = new Ctx();
    }
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 1;
    this.master = ctx.createGain();
    this.master.gain.value = this.sfxOn ? this.sfxVol : 0;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? this.musicVol : 0;
    // gentle bus compressor + a final trim so music and effects together never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const trim = ctx.createGain();
    trim.gain.value = 0.82;
    this.master.connect(this.out);
    this.musicBus.connect(this.out);
    this.out.connect(comp).connect(trim).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // electric motor: two detuned saws through a low-pass + a high sine whine
    this.mFilter = ctx.createBiquadFilter();
    this.mFilter.type = 'lowpass';
    this.mFilter.Q.value = 6;
    this.mGain = ctx.createGain();
    this.mGain.gain.value = 0;
    this.mA = ctx.createOscillator();
    this.mA.type = 'sawtooth';
    this.mB = ctx.createOscillator();
    this.mB.type = 'square';
    this.mA.connect(this.mFilter);
    const bG = ctx.createGain();
    bG.gain.value = 0.35;
    this.mB.connect(bG).connect(this.mFilter);
    this.mFilter.connect(this.mGain).connect(this.master);
    this.mWhine = ctx.createOscillator();
    this.mWhine.type = 'sine';
    this.mWhineGain = ctx.createGain();
    this.mWhineGain.gain.value = 0;
    this.mWhine.connect(this.mWhineGain).connect(this.master);
    this.mA.start();
    this.mB.start();
    this.mWhine.start();

    const loop = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start(0, Math.random() * 1.5);
      return { f, g };
    };
    ({ f: this.windFilter, g: this.windGain } = loop('lowpass', 500, 0.7));
    ({ f: this.screechFilter, g: this.screechGain } = loop('bandpass', 1900, 7));
    ({ g: this.scrapeGain } = loop('bandpass', 3200, 2));

    // ---- cold-gas thruster voice ----
    // pink noise (smoother than white) → high-pass → [hiss band | low pressure body]
    const plen = ctx.sampleRate * 4;
    const pink = ctx.createBuffer(1, plen, ctx.sampleRate);
    const pd = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < plen; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    // crossfade the loop seam so the hiss never clicks
    const xf = Math.floor(ctx.sampleRate * 0.08);
    for (let i = 0; i < xf; i++) {
      const k = i / xf;
      pd[i] = pd[i] * k + pd[plen - xf + i] * (1 - k);
    }
    const gasSrc = ctx.createBufferSource();
    gasSrc.buffer = pink;
    gasSrc.loop = true;
    gasSrc.loopEnd = (plen - xf) / ctx.sampleRate;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    gasSrc.connect(hp);
    this.gasHiss = ctx.createBiquadFilter();
    this.gasHiss.type = 'bandpass';
    this.gasHiss.frequency.value = 3200;
    this.gasHiss.Q.value = 0.55;
    this.gasBody = ctx.createBiquadFilter();
    this.gasBody.type = 'lowpass';
    this.gasBody.frequency.value = 320;
    this.gasBody.Q.value = 0.4;
    this.gasHissGain = ctx.createGain();
    this.gasBodyGain = ctx.createGain();
    this.gasHissGain.gain.value = 0;
    this.gasBodyGain.gain.value = 0;
    // gentle turbulence: slow wobble in the flow, never a pulse
    const turb = ctx.createGain();
    turb.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.43;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.08;
    lfo.connect(lfoAmt).connect(turb.gain);
    lfo.start();
    hp.connect(this.gasHiss).connect(this.gasHissGain).connect(turb);
    hp.connect(this.gasBody).connect(this.gasBodyGain).connect(turb);
    turb.connect(this.master);
    // attitude jets (flips / rolls): a thinner, higher hiss from the same gas supply
    this.rcsFilter = ctx.createBiquadFilter();
    this.rcsFilter.type = 'bandpass';
    this.rcsFilter.frequency.value = 5200;
    this.rcsFilter.Q.value = 0.9;
    this.rcsGain = ctx.createGain();
    this.rcsGain.gain.value = 0;
    hp.connect(this.rcsFilter).connect(this.rcsGain).connect(this.master);
    gasSrc.start(0, Math.random() * 3);
    this.music = new Music(ctx, this.musicBus, this.noiseBuf);
    if (this.musicOn) this.music.start();
  }

  /**
   * Thruster gas flow. `level` 0..1 = how hard the jets fire, `pressure` 0..1 = tank pressure
   * (the boost meter): as the tank empties the hiss drops in pitch and loses force.
   * `rcs` 0..1 = attitude jets firing for a flip or roll.
   */
  gas(level: number, pressure: number, rcs: number, active: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const L = active ? Math.max(0, Math.min(1, level)) : 0;
    if (t - this.lastGas < 0.03 && Math.abs(L - this.gasLevel) < 0.3) return;
    this.lastGas = t;
    const P = 0.3 + 0.7 * Math.max(0, Math.min(1, pressure));
    // valve opens quickly, pressure bleeds off slowly when it closes
    const tc = L > this.gasLevel + 0.01 ? 0.06 : 0.32;
    this.gasLevel = L;
    this.gasHiss.frequency.setTargetAtTime(1500 + 3000 * P * (0.75 + 0.25 * L), t, 0.12);
    this.gasBody.frequency.setTargetAtTime(150 + 260 * P, t, 0.12);
    this.gasHissGain.gain.setTargetAtTime(0.2 * L * (0.45 + 0.55 * P), t, tc);
    this.gasBodyGain.gain.setTargetAtTime(0.42 * L * (0.4 + 0.6 * P), t, tc);
    const R = active ? Math.max(0, Math.min(1, rcs)) : 0;
    this.rcsFilter.frequency.setTargetAtTime(3800 + 1800 * P, t, 0.1);
    this.rcsGain.gain.setTargetAtTime(0.1 * R * P, t, R > 0 ? 0.05 : 0.22);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** Sound effects on/off and level (1 low, 2 medium, 3 high). */
  setSfx(on: boolean, level: 1 | 2 | 3) {
    this.sfxOn = on;
    this.sfxVol = [0, 0.35, 0.6, 0.85][level];
    if (this.ctx) this.master.gain.setTargetAtTime(on ? this.sfxVol : 0, this.ctx.currentTime, 0.05);
  }

  /** Soundtrack on/off and level (1 low, 2 medium, 3 high). */
  setMusic(on: boolean, level: 1 | 2 | 3) {
    this.musicOn = on;
    this.musicVol = [0, 0.12, 0.24, 0.4][level];
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? this.musicVol : 0, this.ctx.currentTime, 0.08);
    if (on) this.music?.start();
    else setTimeout(() => !this.musicOn && this.music?.stop(), 400);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Called every frame with the player car state. */
  update(speed: number, throttle: number, slip: number, scrape: number, airborne: boolean, active: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastUpdate < 0.03) return;
    this.lastUpdate = t;
    const v = Math.abs(speed);
    const k = active ? 1 : 0;
    const base = 38 + v * 2.4;
    this.mA.frequency.setTargetAtTime(base, t, 0.05);
    this.mB.frequency.setTargetAtTime(base * 1.505, t, 0.05);
    this.mFilter.frequency.setTargetAtTime(300 + v * 26 + throttle * 600, t, 0.06);
    this.mGain.gain.setTargetAtTime(k * (0.05 + throttle * 0.075 + Math.min(v, 60) * 0.0006), t, 0.08);
    this.mWhine.frequency.setTargetAtTime(500 + v * 42, t, 0.05);
    this.mWhineGain.gain.setTargetAtTime(k * (0.012 + throttle * 0.02) * Math.min(1, v / 8), t, 0.08);
    this.windFilter.frequency.setTargetAtTime(300 + v * 22, t, 0.1);
    this.windGain.gain.setTargetAtTime(k * Math.min(0.32, v * v * 0.00005) * (airborne ? 1.4 : 1), t, 0.1);
    const sk = Math.min(1, Math.max(0, Math.abs(slip) - 0.1) * 3.2) * Math.min(1, v / 12);
    this.screechGain.gain.setTargetAtTime(k * (airborne ? 0 : sk * 0.22), t, 0.05);
    this.screechFilter.frequency.setTargetAtTime(1500 + Math.sin(t * 13) * 180 + v * 4, t, 0.05);
    this.scrapeGain.gain.setTargetAtTime(k * Math.min(0.2, scrape * 0.006), t, 0.04);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.mGain, this.mWhineGain, this.windGain, this.screechGain, this.scrapeGain, this.gasHissGain, this.gasBodyGain, this.rcsGain])
      g.gain.setTargetAtTime(0, t, 0.05);
    this.gasLevel = 0;
  }

  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, q = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    // 4 ms fade-in: a hard onset is an audible click
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
  }

  /** Rate limit for impact sounds: cars grinding along a wall or each other report a hit every physics step. */
  private cool = new Map<string, number>();
  private ready(key: string, gap: number) {
    const t = this.ctx?.currentTime ?? 0;
    if (t - (this.cool.get(key) ?? -9) < gap) return false;
    this.cool.set(key, t);
    return true;
  }


  crash(impact: number, key = 'crash', gap = 0.15) {
    if (!this.ctx || !this.ready(key, gap)) return;
    const v = Math.min(1, impact / 14);
    this.burst(0.25 + v * 0.3, 'lowpass', 1400, 60, 0.25 + v * 0.6);
    this.burst(0.18, 'highpass', 5000, 2000, 0.08 + v * 0.18);
  }

  thud(impact: number, key = 'thud', gap = 0.15) {
    if (!this.ctx || !this.ready(key, gap)) return;
    this.burst(0.3, 'lowpass', 400, 40, Math.min(0.8, impact * 0.06));
  }

  tone(freq: number, dur: number, vol = 0.25, type: OscillatorType = 'sine', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  beep(go: boolean) {
    if (go) {
      this.tone(880, 0.6, 0.3, 'square');
      this.tone(1320, 0.6, 0.12, 'sine');
    } else this.tone(440, 0.25, 0.25, 'square');
  }

  chime() {
    this.tone(1046, 0.25, 0.15, 'triangle');
    this.tone(1568, 0.35, 0.12, 'triangle', 0.08);
  }

  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, 0.18, 'triangle', i * 0.12));
  }

  click() {
    this.tone(1400, 0.05, 0.08, 'square');
  }
}

export const audio = new AudioEngine();
