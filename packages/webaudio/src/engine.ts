import { DRUMS, NOISES, OSCILLATORS, VOICES, resolveSound } from '@tartlet/resources';
import { normalizeVowel, parseSyllable } from '@tartlet/registry';
import {
  CONSONANT_SPECS,
  crushCurve,
  envelope,
  fillNoise,
  formantBank,
  glottalWave,
  impulseResponse,
  nasalBank,
  partialTable,
  pulseWave,
  shapeCurve,
  softSquareWave,
  splitWaves,
  TIMBRES,
  timbreWave,
  unisonOffsets,
  voiceTypeScale,
  type Adsr,
  type Formant,
  type NoiseKind,
  type Wave,
} from './dsp';
import { SAFETY_WORKLET_SOURCE } from './safety-worklet';

type ControlMap = Readonly<Record<string, unknown>>;

const OSC_SET = new Set<string>(OSCILLATORS);
const NOISE_SET = new Set<string>(NOISES);
const DRUM_SET = new Set<string>(DRUMS);
const VOICE_SET = new Set<string>(VOICES);
const isNoise = (name: string): name is NoiseKind => NOISE_SET.has(name);

/** Voice cost budget: each running oscillator or buffer source costs one (TS-42). */
const MAX_COST = 64;
/** Upper bound for the binaural beat rate in hertz (TS-40). */
const MAX_BEAT = 40;
/** Interaural time difference bound in milliseconds (TS-62). */
const MAX_ITD = 40;
/** Interaural level difference bound in decibels; large imbalances are uncomfortable (TS-62). */
const MAX_ILD = 12;
/** Upper bound for the interaural phase rotation rate in hertz (TS-67). */
const MAX_IRATE = 10;
/** Range of the dichotic band centre in hertz; zero turns it off (TS-66). */
const DICHOTIC_RANGE: readonly [number, number] = [100, 2000];
/** At most this many reverb buses exist at once (TS-41). */
const MAX_REVERBS = 8;
/** Onset consonants start at most this many seconds before the beat (TS-46). */
const LEAD_CAP = 0.06;
/** Fixed-seed noise beds used for vocal jitter and shimmer (TS-43). */
const JITTER_BEDS = 4;
const DEFAULT_VOWEL: ReadonlyMap<string, string> = new Map([['ooh', 'oo']]);
const DEG = Math.PI / 180;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const fin = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

interface Voice {
  end: number;
  readonly cost: number;
  stop(): void;
  /** Fades the voice out from `at`, for mono lines (TS-42). */
  cut?: (at: number) => void;
}

type Starts = ReadonlyMap<AudioScheduledSourceNode, readonly [number, number]>;
/** Per-ear settings for two-ear voices (TS-40, TS-62, TS-64 to TS-67). */
interface EarShift {
  /** Binaural beat in hertz, including any `irate` rotation. */
  readonly beat: number;
  /** Detune between the ears in cents. */
  readonly cents: number;
  /** Phase offset of the right ear in degrees. */
  readonly phase: number;
  /** Alternate partials go to alternate ears (TS-65). */
  readonly harmonics: boolean;
  /** Interaural correlation of a noise voice, 0–1 (TS-64). */
  readonly icorr: number;
  /** Centre of the phase-shifted band of a noise voice in hertz; 0 is off (TS-66). */
  readonly dichotic: number;
  readonly dichoticq: number;
}
/** Oscillator voices built from one tone per ear. */
function twoTone(e: EarShift): boolean {
  return e.beat > 0 || e.cents !== 0 || e.phase > 0 || e.harmonics;
}
/** Voices with their own stereo image, which bypass pan and HRTF (TS-40, TS-64). */
function twoEar(e: EarShift): boolean {
  return twoTone(e) || e.icorr < 1 || e.dichotic > 0;
}

/** What a sound generator produced: sources still to be started, and when they end. */
interface Spec {
  readonly sources: AudioScheduledSourceNode[];
  readonly end: number;
  /** Start time and buffer offset per source, when not the onset (TS-43, TS-46). */
  readonly starts?: Starts;
}

interface Chain {
  readonly input: AudioNode;
  readonly lfos: readonly OscillatorNode[];
}

interface DelayBus {
  readonly input: GainNode;
  readonly delay: DelayNode;
  readonly feedback: GainNode;
}

interface Line {
  readonly voice: Voice;
  readonly freq: number;
  readonly vowel?: string;
  readonly bank?: readonly Formant[];
}

/** A formant target: reached by ramping for `glide` seconds from `at`. */
interface FormantKey {
  readonly at: number;
  glide: number;
  readonly bank: readonly Formant[];
}

/** How the vowel resonances move during one note (TS-43, TS-45). */
interface FormantPlan {
  readonly keys: readonly FormantKey[];
  /** Wet share of the formant filter, 0–1 (`talk`). */
  readonly talk: number;
  readonly makeup: number;
  readonly onset: readonly string[];
  readonly coda: readonly string[];
  /** Seconds the onset consonants start before the beat. */
  readonly lead: number;
  readonly vowel: string;
  readonly last: readonly Formant[];
  readonly scale: number;
}

function onsetLead(onset: readonly string[], available: number): number {
  let sum = 0;
  for (const p of onset) {
    const s = CONSONANT_SPECS.get(p);
    if (s && s.kind !== 'approximant') sum += s.dur;
  }
  return Math.max(0, Math.min(sum, LEAD_CAP, available));
}

/** Synthesis engine. The master safety chain cannot be bypassed: every voice and bus connects to `input`. */
export class AudioEngine {
  private readonly voices: Voice[] = [];
  private readonly unknownSounds = new Set<string>();
  private readonly beds = new Map<NoiseKind, AudioBuffer>();
  private readonly jitters = new Map<number, AudioBuffer>();
  private readonly waves = new Map<string, PeriodicWave>();
  private readonly glottals = new Map<number, PeriodicWave>();
  private readonly splits = new Map<string, readonly [PeriodicWave, PeriodicWave]>();
  private isoWave: PeriodicWave | undefined;
  private readonly curves = new Map<string, Float32Array<ArrayBuffer>>();
  private readonly reverbs = new Map<string, AudioNode>();
  private readonly delays = new Map<number, DelayBus>();
  private readonly lines = new Map<string, Line>();

  private constructor(
    readonly ctx: AudioContext,
    private readonly input: AudioNode,
  ) {}

  /** Must be called from a user gesture. */
  static async create(ctx: AudioContext = new AudioContext({ latencyHint: 'interactive' })): Promise<AudioEngine> {
    await ctx.resume();
    const url = URL.createObjectURL(new Blob([SAFETY_WORKLET_SOURCE], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const safety = new AudioWorkletNode(ctx, 'tartlet-safety', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
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
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // nudge moves the onset in seconds; legato scales the held duration (TS-59).
    const at = time + clamp(fin(c.nudge, 0), -0.05, 0.25);
    if (!Number.isFinite(at) || at < now - 0.05) return;
    const t = Math.max(at, now);
    const dur = Math.max(0, fin(duration, 0)) * clamp(fin(c.legato, 1), 0.01, 8);
    const gain = clamp(fin(c.gain, 1), 0, 1.5) * clamp(fin(c.velocity, 1), 0, 1);
    if (gain <= 0) return;
    const note = c.note as { kind?: string; value?: unknown } | undefined;
    const midi = note?.kind === 'midi' ? fin(note.value, NaN) : NaN;
    const hz = num(c.freq);
    const sound = typeof c.s === 'string' ? c.s : Number.isFinite(midi) || hz !== undefined ? 'triangle' : undefined;
    if (sound === undefined) return;
    const res = resolveSound(sound);
    if (res.status === 'missing') {
      this.unknownSounds.add(sound);
      return;
    }
    const name = res.status === 'fallback' ? res.to : sound;
    const osc = OSC_SET.has(name);
    const noise = isNoise(name);
    const vocal = VOICE_SET.has(name);
    if (!osc && !noise && !vocal && !DRUM_SET.has(name)) {
      this.unknownSounds.add(sound);
      return;
    }

    // Two-ear voices need an untouched stereo image, so they bypass pan and HRTF (TS-40, TS-62, TS-64).
    const dich = noise ? clamp(fin(c.dichotic, 0), 0, DICHOTIC_RANGE[1]) : 0;
    const ear: EarShift = {
      beat: osc ? clamp(fin(c.binaural, 0), 0, MAX_BEAT) + clamp(fin(c.irate, 0), 0, MAX_IRATE) : 0,
      cents: osc ? clamp(fin(c.earsh, 0), -100, 100) : 0,
      phase: osc ? clamp(fin(c.iphase, 0), 0, 180) : 0,
      harmonics: osc && c.earsplit === 'harmonics',
      icorr: noise ? clamp(fin(c.icorr, 1), 0, 1) : 1,
      dichotic: dich > 0 ? Math.max(dich, DICHOTIC_RANGE[0]) : 0,
      dichoticq: clamp(fin(c.dichoticq, 10), 1, 50),
    };
    const dual = twoEar(ear);
    const post = ctx.createGain();
    const sink = this.earStage(c);
    post.connect(dual ? sink : this.placer(c, sink));
    this.sends(c, post, t);
    const attack = clamp(fin(c.attack, vocal ? 0.03 : 0.005), 0.001, 5);
    const release = clamp(fin(c.release, vocal ? 0.12 : 0.08), 0.01, 8);

    // Mono lines: a new note ends the previous one on the same line (TS-42).
    const mono = num(c.mono);
    const key = mono === undefined ? undefined : String(clamp(Math.round(mono), 0, 64));
    const prev = key === undefined ? undefined : this.lines.get(key);
    if (prev && prev.voice.end > t) {
      prev.voice.cut?.(t);
      prev.voice.end = Math.min(prev.voice.end, t + 0.03);
    }
    const glideTime = clamp(fin(c.glide, 0), 0, 5);

    const pitched = osc || noise || vocal;
    const freq = pitched
      ? hz !== undefined
        ? clamp(hz, 1, 20000)
        : 440 * 2 ** (((Number.isFinite(midi) ? midi : 57) - 69) / 12)
      : NaN;
    const plan = pitched ? this.formantPlan(c, name, vocal, t, dur, prev) : undefined;
    const fx = this.effects(c, t, t + Math.max(dur, attack), release, post, plan, freq);
    const gate = ctx.createGain();
    gate.connect(fx.input);

    let spec: Spec | undefined;
    if (pitched) {
      const from =
        (osc || vocal) && prev !== undefined && Number.isFinite(prev.freq) && glideTime > 0 ? prev.freq : undefined;
      const glide = from === undefined ? undefined : { from, time: glideTime };
      const env: Adsr = {
        a: attack,
        d: clamp(fin(c.decay, 0.05), 0.001, 5),
        s: clamp(fin(c.sustain, 1), 0, 1),
        r: release,
      };
      spec = vocal
        ? this.vocal(name, c, env, freq, glide, t, dur, gain, gate, post, plan)
        : this.synth(name, c, env, freq, ear, glide, t, dur, gain, gate);
    } else {
      const sp = clamp(Math.abs(fin(c.speed, 1)), 0.125, 8);
      spec = this.drum(name, t, gain, sp, gate);
    }
    if (!spec) return;

    const voice = this.voice([...spec.sources, ...fx.lfos], t, spec.end, gate, spec.starts);
    this.admit(voice, now);
    if (key !== undefined) {
      this.lines.set(key, {
        voice,
        freq: osc || vocal ? freq : NaN,
        ...(plan ? { vowel: plan.vowel, bank: plan.last } : undefined),
      });
    }
  }

  stopAll(): void {
    for (const v of this.voices.splice(0)) v.stop();
    this.lines.clear();
    const now = this.ctx.currentTime;
    for (const bus of this.delays.values()) {
      bus.feedback.gain.cancelScheduledValues(now);
      bus.feedback.gain.setValueAtTime(0, now);
    }
  }

  /** Starts the sources and wraps them as one voice that can be stopped or faded out. */
  private voice(sources: AudioScheduledSourceNode[], t: number, end: number, gate: GainNode, starts?: Starts): Voice {
    for (const s of sources) {
      const st = starts?.get(s);
      const when = st?.[0] ?? t;
      const offset = st?.[1] ?? 0;
      if (offset > 0 && s instanceof AudioBufferSourceNode) s.start(when, offset);
      else s.start(when);
      s.stop(Math.max(end, when + 0.01));
    }
    return {
      end,
      cost: sources.length,
      stop: () => {
        for (const s of sources) safeStop(s);
      },
      cut: (at) => {
        gate.gain.setValueAtTime(1, at);
        gate.gain.linearRampToValueAtTime(0, at + 0.01);
        for (const s of sources) {
          try {
            s.stop(at + 0.02);
          } catch {
            /* already stopped */
          }
        }
      },
    };
  }

  private admit(v: Voice, now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if ((this.voices[i]?.end ?? 0) < now) this.voices.splice(i, 1);
    this.voices.push(v);
    let cost = this.voices.reduce((acc, x) => acc + x.cost, 0);
    while (cost > MAX_COST && this.voices.length > 1) {
      const old = this.voices.shift();
      if (!old) break;
      old.stop();
      cost -= old.cost;
    }
  }

  /**
   * The node a voice feeds, already connected to `out`. Any of azimuth, elevation or
   * distance selects HRTF placement; otherwise a stereo panner reads `pan` (TS-40).
   */
  private placer(c: ControlMap, out: AudioNode): AudioNode {
    const spatial = typeof c.azimuth === 'number' || typeof c.elevation === 'number' || typeof c.distance === 'number';
    if (!spatial) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = clamp(fin(c.pan, 0.5), 0, 1) * 2 - 1;
      pan.connect(out);
      return pan;
    }
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.maxDistance = 50;
    p.rolloffFactor = 1;
    const az = clamp(fin(c.azimuth, 0), -180, 180) * DEG;
    const el = clamp(fin(c.elevation, 0), -90, 90) * DEG;
    const d = clamp(fin(c.distance, 1), 0.5, 50);
    // The default listener faces -z with +y up, so azimuth 90° lies on +x (the right).
    p.positionX.value = Math.sin(az) * Math.cos(el) * d;
    p.positionY.value = Math.sin(el) * d;
    p.positionZ.value = -Math.cos(az) * Math.cos(el) * d;
    p.connect(out);
    return p;
  }
  /**
   * Interaural time and level differences, per-ear filters, the band split and the ear swap,
   * after any panner (TS-62, TS-64). Returns the node a placed voice feeds; without these
   * controls it is the bus itself.
   */
  private earStage(c: ControlMap): AudioNode {
    const itd = clamp(fin(c.itd, 0), -MAX_ITD, MAX_ITD);
    const ild = clamp(fin(c.ild, 0), -MAX_ILD, MAX_ILD);
    const swap = fin(c.earswap, 0) >= 0.5;
    const lows = [num(c.lcutoff), num(c.rcutoff)];
    const highs = [num(c.lhcutoff), num(c.rhcutoff)];
    const bands = c.earsplit === 'bands';
    const crossover = clamp(fin(c.splitfreq, 1000), 100, 8000);
    const filtered = bands || [...lows, ...highs].some((x) => x !== undefined);
    if (itd === 0 && ild === 0 && !swap && !filtered) return this.input;
    const ctx = this.ctx;
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    // Equal total power: gL² + gR² = 2, with gR / gL set by ild in decibels.
    const ratio = 10 ** (ild / 20);
    const left = Math.sqrt(2 / (1 + ratio * ratio));
    const gains = [left, left * ratio];
    // Positive itd delays the left ear, so the sound leans right.
    const delays = [Math.max(0, itd) / 1000, Math.max(0, -itd) / 1000];
    for (let ch = 0; ch < 2; ch++) {
      const g = ctx.createGain();
      g.gain.value = gains[ch] ?? 1;
      split.connect(g, ch);
      let out: AudioNode = g;
      const filter = (type: BiquadFilterType, f: number, q: number): void => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = clamp(f, 20, 20000);
        b.Q.value = q;
        out.connect(b);
        out = b;
      };
      if (bands) {
        // Two cascaded Butterworth sections per side form a Linkwitz–Riley crossover, which sums flat in mono.
        const type: BiquadFilterType = ch === 0 ? 'lowpass' : 'highpass';
        filter(type, crossover, Math.SQRT1_2);
        filter(type, crossover, Math.SQRT1_2);
      }
      const lo = lows[ch];
      if (lo !== undefined) filter('lowpass', lo, 0.7);
      const hi = highs[ch];
      if (hi !== undefined) filter('highpass', hi, 0.7);
      const d = delays[ch] ?? 0;
      if (d > 0) {
        const dl = ctx.createDelay(MAX_ITD / 1000 + 0.01);
        dl.delayTime.value = d;
        g.connect(dl);
        out = dl;
      }
      out.connect(merge, 0, swap ? 1 - ch : ch);
    }
    merge.connect(this.input);
    return split;
  }

  /** Sends to the shared reverb and delay of the event's orbit (TS-41). */
  private sends(c: ControlMap, post: AudioNode, t: number): void {
    const orbit = clamp(Math.round(fin(c.orbit, 0)), 0, 15);
    const room = clamp(fin(c.room, 0), 0, 1);
    if (room > 0) {
      const s = this.ctx.createGain();
      s.gain.value = room;
      post.connect(s);
      s.connect(this.reverb(orbit, clamp(fin(c.size, 0.3), 0, 1)));
    }
    const delay = clamp(fin(c.delay, 0), 0, 1);
    if (delay > 0) {
      const bus = this.delayBus(orbit);
      bus.delay.delayTime.setValueAtTime(clamp(fin(c.delaytime, 0.25), 0.01, 2), t);
      bus.feedback.gain.setValueAtTime(clamp(fin(c.delayfeedback, 0.5), 0, 0.95), t);
      const s = this.ctx.createGain();
      s.gain.value = delay;
      post.connect(s);
      s.connect(bus.input);
    }
  }

  private reverb(orbit: number, size: number): AudioNode {
    const step = Math.round(size * 10);
    const key = `${String(orbit)}:${String(step)}`;
    const hit = this.reverbs.get(key);
    if (hit) return hit;
    if (this.reverbs.size >= MAX_REVERBS) {
      const first = this.reverbs.values().next();
      if (!first.done) return first.value;
    }
    const seconds = 0.4 + step * 0.4;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(2, Math.max(1, Math.round(seconds * sr)), sr);
    for (let ch = 0; ch < 2; ch++) impulseResponse(buf.getChannelData(ch), 0x1234567 + ch * 7919 + step);
    const conv = this.ctx.createConvolver();
    conv.buffer = buf;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.5;
    conv.connect(wet).connect(this.input);
    this.reverbs.set(key, conv);
    return conv;
  }

  private delayBus(orbit: number): DelayBus {
    const hit = this.delays.get(orbit);
    if (hit) return hit;
    const ctx = this.ctx;
    const input = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.25;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5000;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    input.connect(delay);
    delay.connect(wet).connect(this.input);
    delay.connect(tone).connect(feedback).connect(delay);
    const bus = { input, delay, feedback };
    this.delays.set(orbit, bus);
    return bus;
  }

  private curve(key: string, make: () => Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    let c = this.curves.get(key);
    if (!c) {
      c = make();
      this.curves.set(key, c);
    }
    return c;
  }

  /**
   * The formant track of one note (TS-43, TS-45): the vowel or syllable, voice type, shift and
   * vowel glides. Returns undefined when no formant filter is wanted.
   */
  private formantPlan(
    c: ControlMap,
    name: string,
    vocal: boolean,
    t: number,
    dur: number,
    prev: Line | undefined,
  ): FormantPlan | undefined {
    const sylText = typeof c.syl === 'string' ? c.syl : undefined;
    const vowelText = typeof c.vowel === 'string' ? c.vowel : undefined;
    const talkIn = num(c.talk);
    const wanted = vocal || sylText !== undefined || vowelText !== undefined || (talkIn !== undefined && talkIn > 0);
    if (!wanted) return undefined;
    const talk = vocal ? 1 : clamp(talkIn ?? 1, 0, 1);
    if (talk <= 0) return undefined;
    const vt = typeof c.voicetype === 'string' ? c.voicetype.toLowerCase() : undefined;
    const shift = clamp(fin(c.formant, 0), -12, 12);
    const hum = name === 'hum';
    const bankOf = (v: string): readonly Formant[] => (hum ? nasalBank(vt, shift) : formantBank(v, vt, shift));
    const base = (vowelText !== undefined ? normalizeVowel(vowelText) : undefined) ?? DEFAULT_VOWEL.get(name) ?? 'ah';
    const syl = sylText === undefined ? null : parseSyllable(sylText);
    let vowels: readonly string[] = [base];
    let onset: readonly string[] = [];
    let coda: readonly string[] = [];
    if (syl?.hold === true) {
      vowels = [prev?.vowel ?? base];
    } else if (syl) {
      vowels = syl.vowels;
      if (vocal) {
        onset = syl.onset;
        coda = syl.coda;
      }
    }
    const first = vowels[0] ?? base;
    const last = vowels[vowels.length - 1] ?? base;
    const lead = vocal ? onsetLead(onset, t - this.ctx.currentTime) : 0;
    const start = t - lead;
    const vglide = clamp(fin(c.vglide, 0), 0, 5);
    const keys: FormantKey[] = [];
    const locus = onset.length > 0 ? CONSONANT_SPECS.get(onset[onset.length - 1] ?? '')?.locus : undefined;
    const from = prev?.bank;
    if (locus !== undefined) {
      keys.push({ at: start, glide: 0, bank: bankOf(locus) }, { at: t, glide: 0.06, bank: bankOf(first) });
    } else if (from && (syl?.hold === true || vglide > 0)) {
      keys.push({ at: start, glide: 0, bank: from }, { at: t, glide: Math.max(vglide, 0.05), bank: bankOf(first) });
    } else {
      keys.push({ at: start, glide: 0, bank: bankOf(first) });
    }
    const n = vowels.length;
    const span = Math.max(dur, 0.05);
    for (let k = 1; k < n; k++) {
      keys.push({ at: t + (k * span) / n, glide: Math.max(vglide, 0.06), bank: bankOf(vowels[k] ?? base) });
    }
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (a && b) a.glide = Math.min(a.glide, Math.max(0, b.at - a.at));
    }
    return {
      keys,
      talk,
      makeup: vocal ? 3 : 2,
      onset,
      coda,
      lead,
      vowel: last,
      last: bankOf(last),
      scale: voiceTypeScale(vt),
    };
  }

  /**
   * The per-voice effects chain, built from the output backwards:
   * source → lpf (+ envelope) → hpf → shape → crush → formants → overtone → ring → tremolo → `sink`.
   */
  private effects(
    c: ControlMap,
    t: number,
    noteEnd: number,
    release: number,
    sink: AudioNode,
    plan: FormantPlan | undefined,
    freq: number,
  ): Chain {
    const ctx = this.ctx;
    const lfos: OscillatorNode[] = [];
    let head: AudioNode = sink;
    const link = (n: AudioNode): void => {
      n.connect(head);
      head = n;
    };

    const trem = clamp(fin(c.trem, 0), 0, 30);
    if (trem > 0) {
      const depth = clamp(fin(c.tremdepth, 0.5), 0, 1);
      const g = ctx.createGain();
      g.gain.value = 1 - depth / 2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = trem;
      const lg = ctx.createGain();
      lg.gain.value = depth / 2;
      lfo.connect(lg).connect(g.gain);
      link(g);
      lfos.push(lfo);
    }
    // Isochronic pulses: a softened square on the amplitude, heard on speakers too (TS-67).
    const iso = clamp(fin(c.isochronic, 0), 0, 40);
    if (iso > 0) {
      const depth = clamp(fin(c.isodepth, 1), 0, 1);
      const g = ctx.createGain();
      g.gain.value = 1 - depth / 2;
      const lfo = ctx.createOscillator();
      lfo.setPeriodicWave(this.isochronicWave());
      lfo.frequency.value = iso;
      const lg = ctx.createGain();
      lg.gain.value = depth / 2;
      lfo.connect(lg).connect(g.gain);
      link(g);
      lfos.push(lfo);
    }

    // The singer's ring and overtone whistles (TS-47).
    const ring = clamp(fin(c.ring, 0), 0, 1);
    if (ring > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = clamp(2800 * (plan?.scale ?? 1), 20, 20000);
      f.Q.value = 1.4;
      f.gain.value = ring * 10;
      link(f);
    }
    const overtone = num(c.overtone);
    if (overtone !== undefined && Number.isFinite(freq)) {
      const h = clamp(Math.round(overtone), 4, 16);
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = clamp(freq * h, 20, 18000);
      f.Q.value = 40;
      f.gain.value = 20;
      link(f);
    }

    // Formant bank: vowels, voice types and glides (TS-41, TS-43).
    if (plan) {
      const merge = ctx.createGain();
      merge.gain.value = plan.makeup * plan.talk;
      merge.connect(head);
      const split = ctx.createGain();
      const count = plan.keys[0]?.bank.length ?? 0;
      for (let j = 0; j < count; j++) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        const fg = ctx.createGain();
        plan.keys.forEach((k, i) => {
          const f = k.bank[j];
          if (!f) return;
          const before = i > 0 ? plan.keys[i - 1]?.bank[j] : undefined;
          if (!before) {
            bp.frequency.value = f[0];
            bp.frequency.setValueAtTime(f[0], k.at);
            fg.gain.setValueAtTime(f[1], k.at);
            bp.Q.setValueAtTime(f[2], k.at);
            return;
          }
          const end = k.at + Math.max(k.glide, 0.005);
          bp.frequency.setValueAtTime(before[0], k.at);
          bp.frequency.exponentialRampToValueAtTime(f[0], end);
          fg.gain.setValueAtTime(before[1], k.at);
          fg.gain.linearRampToValueAtTime(f[1], end);
          bp.Q.setValueAtTime(before[2], k.at);
          bp.Q.linearRampToValueAtTime(f[2], end);
        });
        split.connect(bp).connect(fg).connect(merge);
      }
      if (plan.talk < 1) {
        const dry = ctx.createGain();
        dry.gain.value = 1 - plan.talk;
        split.connect(dry).connect(head);
      }
      head = split;
    }

    const crush = num(c.crush);
    if (crush !== undefined) {
      const bits = clamp(Math.round(crush), 1, 16);
      const ws = ctx.createWaveShaper();
      ws.curve = this.curve(`crush:${String(bits)}`, () => crushCurve(bits));
      link(ws);
    }

    const shape = clamp(fin(c.shape, 0), 0, 1);
    if (shape > 0) {
      const amount = Math.round(shape * 20) / 20;
      const ws = ctx.createWaveShaper();
      ws.curve = this.curve(`shape:${String(amount)}`, () => shapeCurve(amount));
      ws.oversample = '2x';
      link(ws);
    }

    const hp = num(c.hcutoff);
    if (hp !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = clamp(hp, 20, 20000);
      f.Q.value = 0.7;
      link(f);
    }

    const lpenv = clamp(fin(c.lpenv, 0), -8, 8);
    const cutoff = num(c.cutoff);
    if (cutoff !== undefined || lpenv !== 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = clamp(fin(c.resonance, 0.7), 0.0001, 20); // bounded Q (§11.5)
      const base = clamp(cutoff ?? 300, 20, 20000);
      if (lpenv === 0) {
        f.frequency.value = base;
      } else {
        const env: Adsr = {
          a: clamp(fin(c.lpattack, 0.005), 0.001, 10),
          d: clamp(fin(c.lpdecay, 0.2), 0.001, 10),
          s: clamp(fin(c.lpsustain, 0), 0, 1),
          r: clamp(fin(c.lprelease, release), 0.01, 10),
        };
        const at = (x: number): number => clamp(base * 2 ** (lpenv * x), 20, 20000);
        f.frequency.setValueAtTime(at(0), t);
        for (const [time, x] of envelope(t, noteEnd - t, env, 1).slice(1)) {
          f.frequency.exponentialRampToValueAtTime(at(x), time);
        }
      }
      link(f);
    }
    return { input: head, lfos };
  }

  private waveFor(type: string, c: ControlMap): PeriodicWave | undefined {
    let key: string | undefined;
    let wave: Wave | null = null;
    if (typeof c.timbre === 'string') {
      wave = timbreWave(c.timbre);
      if (wave) key = `timbre:${c.timbre.toLowerCase()}`;
    }
    const pw = num(c.pw);
    if (!wave && type === 'square' && pw !== undefined) {
      const d = Math.round(clamp(pw, 0.01, 0.99) * 100) / 100;
      if (d !== 0.5) {
        wave = pulseWave(d);
        key = `pw:${String(d)}`;
      }
    }
    if (!wave || key === undefined) return undefined;
    let w = this.waves.get(key);
    if (!w) {
      w = this.ctx.createPeriodicWave(wave.real, wave.imag);
      this.waves.set(key, w);
    }
    return w;
  }
  /** The two halves of a voice's partial table for `earsplit("harmonics")` (TS-65). */
  private splitPair(type: string, c: ControlMap): readonly [PeriodicWave, PeriodicWave] | undefined {
    const timbre = typeof c.timbre === 'string' ? c.timbre.toLowerCase() : '';
    const named = timbre ? TIMBRES.get(timbre) : undefined;
    const amps = named ?? partialTable(type);
    if (!amps) return undefined;
    const key = named ? `timbre:${timbre}` : type;
    let hit = this.splits.get(key);
    if (!hit) {
      const s = splitWaves(amps);
      const mk = (w: Wave): PeriodicWave => this.ctx.createPeriodicWave(w.real, w.imag, { disableNormalization: true });
      hit = [mk(s.left), mk(s.right)];
      this.splits.set(key, hit);
    }
    return hit;
  }
  private isochronicWave(): PeriodicWave {
    if (!this.isoWave) {
      const w = softSquareWave();
      this.isoWave = this.ctx.createPeriodicWave(w.real, w.imag);
    }
    return this.isoWave;
  }

  private glottal(effort: number): PeriodicWave {
    const k = Math.round(clamp(effort, 0, 1) * 10);
    let w = this.glottals.get(k);
    if (!w) {
      const wave = glottalWave(k / 10);
      w = this.ctx.createPeriodicWave(wave.real, wave.imag);
      this.glottals.set(k, w);
    }
    return w;
  }

  private jitterBed(i: number): AudioBuffer {
    let b = this.jitters.get(i);
    if (!b) {
      const sr = this.ctx.sampleRate;
      b = this.ctx.createBuffer(1, sr, sr);
      fillNoise('brown', b.getChannelData(0), 0x51ed270b + i * 0x9e37);
      this.jitters.set(i, b);
    }
    return b;
  }

  /**
   * Voices, choirs and whispers (TS-43): a glottal source and breath noise, shaped by the
   * formant plan in the effects chain. Every variation comes from the event's `vseed` (TS-44).
   */
  private vocal(
    name: string,
    c: ControlMap,
    env: Adsr,
    freq: number,
    glide: { readonly from: number; readonly time: number } | undefined,
    t: number,
    dur: number,
    gain: number,
    tract: AudioNode,
    post: AudioNode,
    plan: FormantPlan | undefined,
  ): Spec {
    const ctx = this.ctx;
    const rnd = seededFrom(fin(c.vseed, 0));
    const u = (): number => (rnd() + 1) / 2;
    const whisper = name === 'whisper';
    const choir = name === 'choir';
    const hum = name === 'hum';
    const effort = clamp(fin(c.effort, fin(c.velocity, 0.6)), 0, 1);
    const breath = whisper ? 1 : clamp(fin(c.breath, hum ? 0.03 : 0.08) + (1 - effort) * 0.12, 0, 1);
    const sources: AudioScheduledSourceNode[] = [];
    const starts = new Map<AudioScheduledSourceNode, readonly [number, number]>();

    const pts = envelope(t, dur, env, gain * 0.35);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    for (const [time, v] of pts.slice(1)) amp.gain.linearRampToValueAtTime(v, time);
    amp.connect(tract);
    let end = (pts[pts.length - 1]?.[0] ?? t) + 0.02;

    // Breath: pink noise through the vocal tract.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBed('pink');
    noise.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = breath * (whisper ? 1.2 : 0.6);
    noise.connect(ng).connect(amp);
    sources.push(noise);
    starts.set(noise, [t, u() * 1.9]);

    if (!whisper) {
      const shim = ctx.createGain();
      shim.connect(amp);
      const voiced = ctx.createGain();
      voiced.gain.value = 1 - breath * 0.7;
      voiced.connect(shim);
      const wave = this.glottal(effort);
      const copies = choir ? clamp(Math.round(fin(c.unison, 5)), 1, 16) : clamp(Math.round(fin(c.unison, 1)), 1, 8);
      const offsets = unisonOffsets(copies, clamp(fin(c.detune, choir ? 14 : 12), 0, 100));
      const level = 1 / Math.sqrt(copies);
      const scatter = clamp(fin(c.scatter, choir ? 0.025 : 0), 0, 0.06);
      const width = clamp(fin(c.width, choir ? 0.6 : 0), 0, 1);
      const vibRate = clamp(fin(c.vib, hum ? 0 : 5.2), 0, 30);
      const vibDepth = clamp(fin(c.vibdepth, 0.15), 0, 12) * 100;
      const vibDel = clamp(fin(c.vibdel, 0.25), 0, 2);
      const penv = clamp(fin(c.penv, 0), -48, 48);
      const bend = clamp(fin(c.scoop, 0), -12, 0) + penv;
      const bendTime = penv !== 0 ? clamp(fin(c.pdecay, 0.1), 0.001, 5) : 0.08;
      const vibGain = (at: number): GainNode => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.setValueAtTime(0, at + vibDel);
        g.gain.linearRampToValueAtTime(vibDepth, at + vibDel + 0.3);
        return g;
      };
      const carriers: OscillatorNode[] = [];
      let shared: GainNode | undefined;
      if (vibRate > 0 && !choir) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = vibRate;
        shared = vibGain(t);
        lfo.connect(shared);
        sources.push(lfo);
      }
      offsets.forEach((cents0, i) => {
        const at = t + (copies > 1 ? u() * scatter : 0);
        const cents = cents0 + (choir ? rnd() * 3 : 0);
        const o = ctx.createOscillator();
        o.setPeriodicWave(wave);
        const ratio = 2 ** (cents / 1200);
        const target = clamp(freq * ratio, 1, 20000);
        if (glide) {
          o.frequency.setValueAtTime(clamp(glide.from * ratio, 1, 20000), at);
          o.frequency.exponentialRampToValueAtTime(target, at + glide.time);
        } else {
          o.frequency.value = target;
        }
        if (bend !== 0) {
          o.detune.setValueAtTime(bend * 100, at);
          o.detune.linearRampToValueAtTime(0, at + bendTime);
        }
        if (shared) {
          shared.connect(o.detune);
        } else if (vibRate > 0) {
          // Each choir voice has its own, unsynchronised vibrato.
          const lfo = ctx.createOscillator();
          const rate = vibRate * (1 + 0.08 * rnd());
          lfo.frequency.value = rate;
          lfo.connect(vibGain(at)).connect(o.detune);
          sources.push(lfo);
          starts.set(lfo, [at + u() / rate, 0]);
        }
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g);
        if (width > 0 && copies > 1) {
          const p = ctx.createStereoPanner();
          p.pan.value = clamp((i / (copies - 1) - 0.5) * 2 * width, -1, 1);
          g.connect(p).connect(voiced);
        } else {
          g.connect(voiced);
        }
        carriers.push(o);
        starts.set(o, [at, 0]);
      });

      const fry = clamp(fin(c.fry, 0), 0, 1);
      if (fry > 0) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(wave);
        o.frequency.value = clamp(freq / 2, 1, 20000);
        const g = ctx.createGain();
        g.gain.value = fry * 0.5;
        o.connect(g).connect(voiced);
        carriers.push(o);
      }

      const jitter = clamp(fin(c.jitter, 0.1), 0, 1);
      const shimmer = clamp(fin(c.shimmer, 0.1), 0, 1);
      if (jitter > 0 || shimmer > 0) {
        const bed = ctx.createBufferSource();
        bed.buffer = this.jitterBed(Math.floor(u() * JITTER_BEDS) % JITTER_BEDS);
        bed.loop = true;
        if (jitter > 0) {
          const jg = ctx.createGain();
          jg.gain.value = jitter * 20;
          bed.connect(jg);
          for (const o of carriers) jg.connect(o.detune);
        }
        if (shimmer > 0) {
          const sg = ctx.createGain();
          sg.gain.value = shimmer * 0.3;
          bed.connect(sg).connect(shim.gain);
        }
        sources.push(bed);
        starts.set(bed, [t, u() * 0.9]);
      }
      sources.push(...carriers);
    }

    if (plan) {
      const cons = this.consonants(plan, t, dur, gain, freq, tract, post);
      sources.push(...cons.sources);
      for (const [s, v] of cons.starts) starts.set(s, v);
      end = Math.max(end, cons.end);
    }
    return { sources, end, starts };
  }

  /**
   * Onset consonants end at the beat and start up to LEAD_CAP before it; coda consonants sit
   * at the end of the note (TS-46). Approximants are formant transitions and make no sound here.
   */
  private consonants(
    plan: FormantPlan,
    t: number,
    dur: number,
    gain: number,
    freq: number,
    tract: AudioNode,
    out: AudioNode,
  ): {
    sources: AudioScheduledSourceNode[];
    starts: Map<AudioScheduledSourceNode, readonly [number, number]>;
    end: number;
  } {
    const ctx = this.ctx;
    const sources: AudioScheduledSourceNode[] = [];
    const starts = new Map<AudioScheduledSourceNode, readonly [number, number]>();
    let end = t;
    const add = (src: AudioScheduledSourceNode, when: number): void => {
      sources.push(src);
      starts.set(src, [when, 0]);
    };
    const render = (p: string, at: number, d: number): void => {
      const s = CONSONANT_SPECS.get(p);
      if (!s || s.kind === 'approximant') return;
      const peak = Math.max(gain * s.gain * 0.5, 0.0002);
      const filt = (): BiquadFilterNode => {
        const f = ctx.createBiquadFilter();
        f.type = s.filter;
        f.frequency.value = s.f;
        f.Q.value = s.q;
        return f;
      };
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.connect(s.tract ? tract : out);
      if (s.kind === 'plosive') {
        const burst = at + d * 0.6;
        const n = this.noiseSource(1);
        n.connect(filt()).connect(env);
        env.gain.setValueAtTime(0, burst);
        env.gain.linearRampToValueAtTime(peak, burst + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, burst + 0.018);
        env.gain.setValueAtTime(0, burst + 0.02);
        add(n, burst);
        if (s.voiced) {
          const bar = ctx.createOscillator();
          bar.frequency.value = 140;
          const bg = ctx.createGain();
          bg.gain.setValueAtTime(0, at);
          bg.gain.linearRampToValueAtTime(peak * 0.3, at + 0.005);
          bg.gain.setValueAtTime(peak * 0.3, burst);
          bg.gain.linearRampToValueAtTime(0, burst + 0.005);
          bar.connect(bg).connect(out);
          add(bar, at);
        }
        end = Math.max(end, burst + 0.03);
        return;
      }
      if (s.kind === 'fricative') {
        const n = this.noiseSource(1);
        n.connect(filt()).connect(env);
        add(n, at);
      } else {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = clamp(Number.isFinite(freq) ? freq : 220, 60, 1000);
        o.connect(filt()).connect(env);
        add(o, at);
      }
      env.gain.linearRampToValueAtTime(peak, at + d * 0.3);
      env.gain.setValueAtTime(peak, at + d * 0.7);
      env.gain.linearRampToValueAtTime(0, at + d);
      end = Math.max(end, at + d + 0.02);
    };
    const durOf = (p: string): number => {
      const s = CONSONANT_SPECS.get(p);
      return s && s.kind !== 'approximant' ? s.dur : 0;
    };

    const front = plan.onset.filter((p) => durOf(p) > 0);
    const sum = front.reduce((acc, p) => acc + durOf(p), 0);
    if (sum > 0) {
      // A shortened lead compresses the consonants, at most to a quarter, overlapping the vowel.
      const scale = Math.max(0.25, plan.lead / sum);
      let at = t - plan.lead;
      for (const p of front) {
        const d = durOf(p) * scale;
        render(p, at, d);
        at += d;
      }
    }
    const back = plan.coda.filter((p) => durOf(p) > 0);
    const csum = back.reduce((acc, p) => acc + durOf(p), 0);
    let at = Math.max(t + 0.04, t + Math.max(dur, 0.05) - csum * 0.5);
    for (const p of back) {
      render(p, at, durOf(p));
      at += durOf(p);
    }
    return { sources, starts, end };
  }

  /** Oscillator and noise voices with the full synthesis toolkit (TS-41, TS-42). */
  private synth(
    name: string,
    c: ControlMap,
    env: Adsr,
    freq: number,
    ear: EarShift,
    glide: { readonly from: number; readonly time: number } | undefined,
    t: number,
    dur: number,
    gain: number,
    out: AudioNode,
  ): Spec {
    const ctx = this.ctx;
    const noise = isNoise(name);
    const pts = envelope(t, dur, env, gain * (noise ? 0.25 : 0.3));
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    for (const [time, v] of pts.slice(1)) amp.gain.linearRampToValueAtTime(v, time);
    amp.connect(out);
    const end = (pts[pts.length - 1]?.[0] ?? t) + 0.02;

    if (isNoise(name)) {
      if (ear.icorr < 1 || ear.dichotic > 0) {
        const two = this.noiseEars(name, c, ear, amp, t);
        return { sources: two.sources, end, starts: two.starts };
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBed(name);
      src.loop = true;
      src.connect(amp);
      return { sources: [src], end };
    }

    const sources: AudioScheduledSourceNode[] = [];
    const carriers: OscillatorNode[] = [];
    const wave = this.waveFor(name, c);
    const copies = clamp(Math.round(fin(c.unison, 1)), 1, 8);
    const offsets = unisonOffsets(copies, clamp(fin(c.detune, 12), 0, 100));
    const level = 1 / Math.sqrt(copies);
    // Two-tone voices: one tone per ear, detuned by ±beat/2 hertz and ±cents/2 (TS-40, TS-62),
    // or splitting the partials between the ears (TS-65).
    const dual = twoTone(ear);
    const sides = ear.harmonics ? this.splitPair(name, c) : undefined;
    const k = 2 ** (ear.cents / 2400);
    const ears: (readonly [number, number])[] = [];
    if (dual) {
      ears.push([clamp(freq / k - ear.beat / 2, 1, 20000), 0], [clamp(freq * k + ear.beat / 2, 1, 20000), 1]);
    } else {
      ears.push([freq, 0]);
    }
    const buses: AudioNode[] = [];
    if (dual) {
      const merger = ctx.createChannelMerger(2);
      merger.connect(amp);
      const left = ctx.createGain();
      left.connect(merger, 0, 0);
      const right = ctx.createGain();
      const rf = ears[1]?.[0] ?? freq;
      if (ear.phase > 0) {
        // Delaying by phase/360 of a period shifts every harmonic of the right ear by that phase.
        const d = ctx.createDelay(1);
        d.delayTime.value = clamp(ear.phase / 360 / rf, 0, 1);
        right.connect(d).connect(merger, 0, 1);
      } else {
        right.connect(merger, 0, 1);
      }
      buses.push(left, right);
    }
    for (const [f, side] of ears) {
      for (const cents of offsets) {
        const o = ctx.createOscillator();
        const w = sides?.[side] ?? wave;
        if (w) o.setPeriodicWave(w);
        else o.type = name as OscillatorType;
        const ratio = 2 ** (cents / 1200);
        const target = clamp(f * ratio, 1, 20000);
        if (glide) {
          o.frequency.setValueAtTime(clamp(glide.from * (f / freq) * ratio, 1, 20000), t);
          o.frequency.exponentialRampToValueAtTime(target, t + glide.time);
        } else {
          o.frequency.value = target;
        }
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g);
        const bus = buses[side];
        if (bus) g.connect(bus);
        else g.connect(amp);
        carriers.push(o);
      }
    }

    const penv = clamp(fin(c.penv, 0), -48, 48);
    if (penv !== 0) {
      const pd = clamp(fin(c.pdecay, 0.1), 0.001, 5);
      for (const o of carriers) {
        o.detune.setValueAtTime(penv * 100, t);
        o.detune.linearRampToValueAtTime(0, t + pd);
      }
    }

    const vib = clamp(fin(c.vib, 0), 0, 30);
    if (vib > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = vib;
      const depth = ctx.createGain();
      depth.gain.value = clamp(fin(c.vibdepth, 0.2), 0, 12) * 100;
      lfo.connect(depth);
      for (const o of carriers) depth.connect(o.detune);
      sources.push(lfo);
    }

    const fm = clamp(fin(c.fm, 0), 0, 50);
    if (fm > 0) {
      const mf = clamp(freq * clamp(fin(c.fmh, 1), 0.01, 16), 0.1, 20000);
      const mod = ctx.createOscillator();
      mod.frequency.value = mf;
      const mg = ctx.createGain();
      mg.gain.value = Math.min(fm * mf, 20000);
      mod.connect(mg);
      for (const o of carriers) mg.connect(o.frequency);
      sources.push(mod);
    }

    sources.push(...carriers);
    return { sources, end };
  }

  /**
   * Noise heard differently in each ear (TS-64, TS-66): a shared bed mixed with an independent
   * bed per ear by `icorr`, then an all-pass band on the right ear for `dichotic`. Independent
   * beds are distant offsets into the same fixed-seed buffer, chosen by the event's `iseed`.
   */
  private noiseEars(
    kind: NoiseKind,
    c: ControlMap,
    ear: EarShift,
    out: AudioNode,
    t: number,
  ): { sources: AudioScheduledSourceNode[]; starts: Map<AudioScheduledSourceNode, readonly [number, number]> } {
    const ctx = this.ctx;
    const buf = this.noiseBed(kind);
    const len = buf.duration;
    const rnd = seededFrom(fin(c.iseed, 0));
    const base = ((rnd() + 1) / 2) * len;
    const sources: AudioScheduledSourceNode[] = [];
    const starts = new Map<AudioScheduledSourceNode, readonly [number, number]>();
    const bed = (offset: number): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      sources.push(s);
      starts.set(s, [t, offset % len]);
      return s;
    };
    const merger = ctx.createChannelMerger(2);
    merger.connect(out);
    const shared = bed(base);
    // Equal power per ear; the correlation between the ears is icorr.
    const together = Math.sqrt(ear.icorr);
    const apart = Math.sqrt(1 - ear.icorr);
    for (let ch = 0; ch < 2; ch++) {
      const sum = ctx.createGain();
      const sg = ctx.createGain();
      sg.gain.value = together;
      shared.connect(sg).connect(sum);
      if (apart > 0) {
        const og = ctx.createGain();
        og.gain.value = apart;
        bed(base + (len * (ch + 1)) / 3)
          .connect(og)
          .connect(sum);
      }
      let tail: AudioNode = sum;
      if (ch === 1 && ear.dichotic > 0) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = ear.dichotic;
        ap.Q.value = ear.dichoticq;
        tail.connect(ap);
        tail = ap;
      }
      tail.connect(merger, 0, ch);
    }
    return { sources, starts };
  }

  private noiseBed(kind: NoiseKind): AudioBuffer {
    let b = this.beds.get(kind);
    if (!b) {
      const sr = this.ctx.sampleRate;
      b = this.ctx.createBuffer(1, sr * 2, sr);
      fillNoise(kind, b.getChannelData(0), kind === 'white' ? 0x2545f491 : kind === 'pink' ? 0x1b873593 : 0x7feb352d);
      this.beds.set(kind, b);
    }
    return b;
  }

  private noiseSource(sp: number): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBed('white');
    n.loop = true;
    n.playbackRate.value = sp;
    return n;
  }

  /** The synthesized general kit (TS-38). `sp` is the `speed` ratio (TS-41). */
  private drum(name: string, t: number, gain: number, sp: number, out: AudioNode): Spec | undefined {
    switch (name) {
      case 'bd':
        return this.kick(t, gain, out, sp, 150, 45, 0.35);
      case 'lt':
        return this.kick(t, gain * 0.8, out, sp, 160, 90, 0.3);
      case 'mt':
        return this.kick(t, gain * 0.8, out, sp, 220, 130, 0.25);
      case 'ht':
        return this.kick(t, gain * 0.8, out, sp, 300, 180, 0.2);
      case 'sd':
        return this.snare(t, gain, out, sp);
      case 'hh':
        return this.hat(t, gain, out, sp, 0.05, 7000);
      case 'oh':
        return this.hat(t, gain, out, sp, 0.3, 6500);
      case 'cr':
        return this.hat(t, gain * 0.8, out, sp, 1.2, 5000);
      case 'rd':
        return this.hat(t, gain * 0.6, out, sp, 0.6, 8000);
      case 'cp':
        return this.clap(t, gain, out, sp);
      case 'rim':
        return this.rim(t, gain, out, sp);
      default:
        return undefined;
    }
  }

  private env(t: number, peak: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(decay, 0.005));
    return g;
  }

  private kick(t: number, gain: number, out: AudioNode, sp: number, f0: number, f1: number, decay: number): Spec {
    const d = Math.max(0.005, decay / sp);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(clamp(f0 * sp, 1, 20000), t);
    o.frequency.exponentialRampToValueAtTime(clamp(f1 * sp, 1, 20000), t + 0.12 / sp);
    o.connect(this.env(t, gain * 0.9, d)).connect(out);
    return { sources: [o], end: t + d + 0.05 };
  }

  private snare(t: number, gain: number, out: AudioNode, sp: number): Spec {
    const n = this.noiseSource(sp);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clamp(1800 * sp, 20, 20000);
    n.connect(bp)
      .connect(this.env(t, gain * 0.6, 0.18 / sp))
      .connect(out);
    const body = this.ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(clamp(190 * sp, 1, 20000), t);
    body.connect(this.env(t, gain * 0.4, 0.08 / sp)).connect(out);
    return { sources: [n, body], end: t + Math.max(0.01, 0.2 / sp) };
  }

  private hat(t: number, gain: number, out: AudioNode, sp: number, decay: number, cutoff: number): Spec {
    const d = Math.max(0.005, decay / sp);
    const n = this.noiseSource(sp);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = clamp(cutoff * sp, 20, 20000);
    n.connect(hp)
      .connect(this.env(t, gain * 0.35, d))
      .connect(out);
    return { sources: [n], end: t + d + 0.01 };
  }

  private clap(t: number, gain: number, out: AudioNode, sp: number): Spec {
    const n = this.noiseSource(sp);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clamp(1200 * sp, 20, 20000);
    bp.Q.value = 1.5;
    const g = this.ctx.createGain();
    const peak = Math.max(gain * 0.7, 0.0002);
    g.gain.setValueAtTime(0.0001, t);
    for (const off of [0, 0.012, 0.024]) {
      g.gain.setValueAtTime(peak, t + off / sp);
      g.gain.exponentialRampToValueAtTime(peak * 0.1, t + (off + 0.01) / sp);
    }
    g.gain.setValueAtTime(peak * 0.7, t + 0.036 / sp);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 / sp);
    n.connect(bp).connect(g).connect(out);
    return { sources: [n], end: t + 0.26 / sp };
  }

  private rim(t: number, gain: number, out: AudioNode, sp: number): Spec {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(clamp(1700 * sp, 1, 20000), t);
    o.connect(this.env(t, gain * 0.5, 0.03 / sp)).connect(out);
    return { sources: [o], end: t + Math.max(0.01, 0.05 / sp) };
  }
}

/** A deterministic generator derived from the event's `vseed` in [0, 1) (TS-44). */
function seededFrom(vseed: number): () => number {
  let x = (Math.floor(clamp(vseed, 0, 1) * 0x7ffffffe) + 1) | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 0xffffffff) * 2 - 1;
  };
}

function safeStop(n: AudioScheduledSourceNode): void {
  try {
    n.stop();
  } catch {
    /* already stopped */
  }
}
