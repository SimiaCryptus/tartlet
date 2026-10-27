import { SAFETY_WORKLET_SOURCE } from "./safety-worklet";

type ControlMap = Readonly<Record<string, unknown>>;

const OSCILLATORS = new Set<OscillatorType>(["sine", "square", "triangle", "sawtooth"]);
const MAX_VOICES = 64;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const fin = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? v : dflt);

interface Voice {
  readonly end: number;
  stop(): void;
}

/** Synthesis engine. The master safety chain cannot be bypassed: every voice connects to `input`. */
export class AudioEngine {
  private readonly voices: Voice[] = [];
  private readonly unknownSounds = new Set<string>();
  private noise: AudioBuffer | undefined;

  private constructor(
    readonly ctx: AudioContext,
    private readonly input: AudioNode,
  ) {}

  /** Must be called from a user gesture. */
  static async create(ctx: AudioContext = new AudioContext({ latencyHint: "interactive" })): Promise<AudioEngine> {
    await ctx.resume();
    const url = URL.createObjectURL(new Blob([SAFETY_WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const safety = new AudioWorkletNode(ctx, "tartlet-safety", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const bus = ctx.createGain();
    bus.gain.value = 0.7;
    bus.connect(comp).connect(safety).connect(ctx.destination);
    return new AudioEngine(ctx, bus);
  }

  get unknown(): ReadonlySet<string> {
    return this.unknownSounds;
  }

  play(c: ControlMap, time: number, duration: number): void {
    const now = this.ctx.currentTime;
    if (!Number.isFinite(time) || time < now - 0.05) return;
    const t = Math.max(time, now);
    const gain = clamp(fin(c.gain, 1), 0, 1.5) * clamp(fin(c.velocity, 1), 0, 1);
    if (gain <= 0) return;
    const note = c.note as { kind?: string; value?: unknown } | undefined;
    const midi = note?.kind === "midi" ? fin(note.value, NaN) : NaN;
    const sound = typeof c.s === "string" ? c.s : Number.isFinite(midi) || typeof c.freq === "number" ? "triangle" : undefined;
    if (sound === undefined) return;

    const pan = this.ctx.createStereoPanner();
    pan.pan.value = clamp(fin(c.pan, 0.5), 0, 1) * 2 - 1;
    let out: AudioNode = pan;
    if (typeof c.cutoff === "number") {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = clamp(c.cutoff, 20, 20000);
      f.Q.value = clamp(fin(c.resonance, 0.7), 0.0001, 20); // bounded Q (§11.5)
      f.connect(pan);
      out = f;
    }
    pan.connect(this.input);

    this.reap(now);
    let voice: Voice | undefined;
    if (OSCILLATORS.has(sound as OscillatorType)) {
      const freq = typeof c.freq === "number" ? clamp(c.freq, 1, 20000) : 440 * 2 ** (((Number.isFinite(midi) ? midi : 57) - 69) / 12);
      voice = this.osc(sound as OscillatorType, freq, t, duration, gain * 0.3, c, out);
    } else if (sound === "bd") voice = this.kick(t, gain, out);
    else if (sound === "sd") voice = this.snare(t, gain, out);
    else if (sound === "hh") voice = this.hat(t, gain, out);
    else this.unknownSounds.add(sound); // general kit and fallback arrive in T2
    if (voice) this.voices.push(voice);
  }

  stopAll(): void {
    for (const v of this.voices.splice(0)) v.stop();
  }

  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if ((this.voices[i]?.end ?? 0) < now) this.voices.splice(i, 1);
    while (this.voices.length >= MAX_VOICES) this.voices.shift()?.stop();
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, c: ControlMap, out: AudioNode): Voice {
    const a = clamp(fin(c.attack, 0.005), 0.001, 5);
    const r = clamp(fin(c.release, 0.08), 0.01, 8);
    const hold = Math.max(dur, a);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.setValueAtTime(peak, t + hold);
    amp.gain.linearRampToValueAtTime(0, t + hold + r);
    o.connect(amp).connect(out);
    const end = t + hold + r + 0.02;
    o.start(t);
    o.stop(end);
    return { end, stop: () => { safeStop(o); } };
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let x = 0x2545f491; // deterministic noise, xorshift
      for (let i = 0; i < len; i++) {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        d[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
      }
      this.noise = buf;
    }
    return this.noise;
  }

  private env(t: number, peak: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    return g;
  }

  private kick(t: number, gain: number, out: AudioNode): Voice {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(this.env(t, gain * 0.9, 0.35)).connect(out);
    o.start(t);
    o.stop(t + 0.4);
    return { end: t + 0.4, stop: () => { safeStop(o); } };
  }

  private snare(t: number, gain: number, out: AudioNode): Voice {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    n.connect(bp).connect(this.env(t, gain * 0.6, 0.18)).connect(out);
    const body = this.ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(190, t);
    body.connect(this.env(t, gain * 0.4, 0.08)).connect(out);
    n.start(t); n.stop(t + 0.2);
    body.start(t); body.stop(t + 0.1);
    return { end: t + 0.2, stop: () => { safeStop(n); safeStop(body); } };
  }

  private hat(t: number, gain: number, out: AudioNode): Voice {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    n.connect(hp).connect(this.env(t, gain * 0.35, 0.05)).connect(out);
    n.start(t); n.stop(t + 0.06);
    return { end: t + 0.06, stop: () => { safeStop(n); } };
  }
}

function safeStop(n: AudioScheduledSourceNode): void {
  try {
    n.stop();
  } catch {
    /* already stopped */
  }
}