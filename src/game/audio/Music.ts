/**
 * Procedural synthwave soundtrack (no audio files): bass, pads, arpeggio and drums
 * in A minor at 100 BPM, scheduled a little ahead of time on the Web Audio clock.
 */
const BPM = 100;
const STEP = 60 / BPM / 4; // one 16th note
const AHEAD = 0.7;         // seconds scheduled in advance (rides out main-thread stalls)

// 8-bar progression, chord tones as MIDI notes (octave 2–3)
const CHORDS: number[][] = [
  [45, 48, 52], // Am
  [41, 45, 48], // F
  [48, 52, 55], // C
  [43, 47, 50], // G
  [45, 48, 52], // Am
  [41, 45, 48], // F
  [43, 47, 50], // G
  [40, 43, 47], // Em
];
const BASS_OCT = [0, 0, 12, 0, 0, 12, 0, 12];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private timer: number | null = null;
  private next = 0;
  private step = 0;
  // shared filters (one per voice) instead of a new filter for every note
  private bassLp: BiquadFilterNode;
  private arpLp: BiquadFilterNode;
  private padLp: BiquadFilterNode;
  private hatHp: BiquadFilterNode;
  private snareBp: BiquadFilterNode;

  constructor(private ctx: AudioContext, private out: AudioNode, private noise: AudioBuffer) {
    const f = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = freq;
      n.Q.value = q;
      n.connect(out);
      return n;
    };
    this.bassLp = f('lowpass', 600, 3);
    this.arpLp = f('lowpass', 3200);
    this.padLp = f('lowpass', 900);
    this.hatHp = f('highpass', 7500);
    this.snareBp = f('bandpass', 1900, 0.9);
  }

  get playing() {
    return this.timer !== null;
  }

  start() {
    if (this.timer !== null) return;
    this.next = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.tick(), 120);
  }

  stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    // fell behind (tab throttled): skip ahead rather than bunching notes up
    if (this.next < ctx.currentTime - 0.05) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + AHEAD) {
      this.play(this.step, this.next);
      this.step++;
      this.next += STEP;
    }
  }

  private play(step: number, t: number) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const cycle = bar % 16;
    const chord = CHORDS[bar % CHORDS.length];
    const full = cycle >= 2;

    if (s === 0) this.pad(chord, t, STEP * 16);
    if (s % 2 === 0) this.bass(chord[0] - 12 + BASS_OCT[(s / 2) | 0], t, STEP * 1.7);
    if (cycle >= 4 && cycle !== 12) this.arp(chord[ARP[s % 8]] + 24 + (s >= 8 ? 12 : 0) * (cycle >= 8 ? 1 : 0), t);
    if (full) {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t, 0.16);
      if (s % 4 === 2) this.hat(t, 0.05);
      else if (cycle >= 8 && s % 2 === 1) this.hat(t, 0.018);
      // a short fill into every 8th bar
      if (bar % 8 === 7 && s >= 13) this.snare(t, 0.07 + (s - 13) * 0.03);
    }
  }

  /** Note envelope into `dest`; the gain node is disconnected once its sources stop. */
  private env(dest: AudioNode, t: number, peak: number, attack: number, hold: number, release: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0005, t + attack + hold + release);
    g.connect(dest);
    return g;
  }

  private osc(type: OscillatorType, f: number, g: GainNode, t: number, end: number, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(g);
    o.start(t);
    o.stop(end);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    return o;
  }

  private pad(chord: number[], t: number, dur: number) {
    const lp = this.padLp.frequency;
    lp.setValueAtTime(500, t);
    lp.linearRampToValueAtTime(1300, t + dur * 0.5);
    lp.linearRampToValueAtTime(700, t + dur);
    const g = this.env(this.padLp, t, 0.045, 0.5, dur - 0.7, 0.6);
    for (const m of chord) {
      this.osc('sawtooth', hz(m + 12), g, t, t + dur + 0.5, -7);
      this.osc('sawtooth', hz(m + 12), g, t, t + dur + 0.5, 7);
    }
  }

  private bass(m: number, t: number, dur: number) {
    const lp = this.bassLp.frequency;
    lp.setValueAtTime(1500, t);
    lp.exponentialRampToValueAtTime(260, t + dur);
    const g = this.env(this.bassLp, t, 0.18, 0.005, dur * 0.4, dur * 0.6);
    this.osc('sawtooth', hz(m), g, t, t + dur + 0.05);
    this.osc('square', hz(m - 12), g, t, t + dur + 0.05);
  }

  private arp(m: number, t: number) {
    const g = this.env(this.arpLp, t, 0.03, 0.004, 0.03, 0.14);
    this.osc('square', hz(m), g, t, t + 0.2);
  }

  private kick(t: number) {
    const g = this.env(this.out, t, 0.38, 0.002, 0.02, 0.24);
    const o = this.osc('sine', 130, g, t, t + 0.3);
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  }

  private noiseHit(t: number, dest: AudioNode, vol: number, dur: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.env(dest, t, vol, 0.002, 0.005, dur);
    src.connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
  }

  private snare(t: number, vol: number) {
    this.noiseHit(t, this.snareBp, vol, 0.17);
    const g = this.env(this.out, t, vol * 0.6, 0.002, 0.01, 0.09);
    const o = this.osc('triangle', 220, g, t, t + 0.15);
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, this.hatHp, vol, 0.045);
  }
}
