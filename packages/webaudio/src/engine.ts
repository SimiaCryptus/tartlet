import { AMBIENCES, CREATURES, DRUMS, FOLEY, NOISES, OSCILLATORS, VOICES, resolveSound } from '@tartlet/resources';
import { normalizeVowel, parseSyllable } from '@tartlet/registry';
import {
  SPACES,
  airCutoff,
  CONSONANT_SPECS,
  crushCurve,
  distanceWet,
  earlyTaps,
  envelope,
  fillNoise,
  formantBank,
  glottalWave,
  grainSchedule,
  impulseResponse,
  microEvents,
  nasalBank,
  occlusion,
  partialTable,
  pulseWave,
  renderPeriodic,
  shapeCurve,
  smoothCurve,
  softSquareWave,
  spaceImpulse,
  spaceSeconds,
  splitWaves,
  swellCurve,
  TIMBRES,
  timbreWave,
  unisonOffsets,
  voiceTypeScale,
  type Adsr,
  type Formant,
  type NoiseKind,
  type Wave,
} from './dsp';
import {
  BODY_SPECS,
  CABS,
  bodyResponse,
  bodySamples,
  cabResponse,
  cabSamples,
  firKernel,
  firLatency,
  firSpec,
  fshiftSinGain,
  hilbertSections,
  spectralModeIndex,
  spectralSettings,
  STFT_SIZE,
  tiltShelves,
  type FirSpec,
  type IirSection,
  type SpectralParams,
} from './dsp';
import { SAFETY_WORKLET_SOURCE } from './safety-worklet';
import { SPECTRAL_WORKLET_SOURCE } from './spectral-worklet';
import { curveName, curveTable, shapeEnvelope, type CurveTable } from './dsp';
import { GATE_WORKLET_SOURCE } from './gate-worklet';
import { planImpulse, planNote, type DecodedTake, type SampleEntry, type SampleLibrary } from '@tartlet/samples';

type ControlMap = Readonly<Record<string, unknown>>;

const OSC_SET = new Set<string>(OSCILLATORS);
const NOISE_SET = new Set<string>(NOISES);
const DRUM_SET = new Set<string>(DRUMS);
const VOICE_SET = new Set<string>(VOICES);
const isNoise = (name: string): name is NoiseKind => NOISE_SET.has(name);
const AMBIENCE_SET = new Set<string>(AMBIENCES);
const FOLEY_SET = new Set<string>(FOLEY);
const CREATURE_SET = new Set<string>(CREATURES);
/** At most this many grains play per note (TS-75). */
const MAX_GRAINS = 256;

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
/** Extra polyphony cost of a per-voice spectral stage (TS-79). */
const SPECTRAL_COST = 8;
/** At most this many shared spectral buses exist at once (TS-79). */
const MAX_SPECTRAL_BUSES = 4;
/** Voices start at most this many seconds early to compensate stage latency (TS-85). */
const LATENCY_CAP = 0.06;
/** Polyphony cost of a per-voice FIR stage, by length (TS-81). */
const FIR_COST: ReadonlyMap<string, number> = new Map([
  ['short', 1],
  ['medium', 2],
  ['long', 4],
]);
/** At most this many FIR kernels are cached (TS-81). */
const MAX_FIR_KERNELS = 32;
/** Polyphony cost of a per-voice body response (TS-82). */
const BODY_COST = 3;
/** At most this many cabinet buses exist at once (TS-83). */
const MAX_CAB_BUSES = 8;
/** At most this many orbit compressors exist at once (TS-87). */
const MAX_COMP_BUSES = 8;
/** Polyphony cost of a per-voice gate (TS-87). */
const GATE_COST = 2;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const fin = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** The envelope segment shape of an event (TS-88). */
const envShape = (c: ControlMap): string => (typeof c.envcurve === 'string' ? c.envcurve : 'lin');
/** An integer seed from an event draw in [0, 1). */
const seedInt = (u: number): number => Math.floor(clamp(u, 0, 1) * 0x7ffffffe) + 1;

interface Voice {
  end: number;
  readonly cost: number;
  stop(): void;
  /** Fades the voice out from `at`, for mono lines (TS-42). */
  cut?: (at: number) => void;
}

/** Start time, buffer offset and optional stop time per source. */
type Starts = ReadonlyMap<AudioScheduledSourceNode, readonly [number, number, number?]>;
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
  /** Voice cost when it differs from the number of sources, for grains (TS-75). */
  readonly cost?: number;
}
/** Shared state while building a texture voice (TS-73, TS-76). */
interface Frame {
  readonly t: number;
  readonly amp: GainNode;
  readonly end: number;
  readonly span: number;
  readonly points: number;
  readonly rnd: () => number;
  readonly intensity: number;
  readonly density: number | undefined;
  readonly sources: AudioScheduledSourceNode[];
  readonly starts: Map<AudioScheduledSourceNode, readonly [number, number]>;
}
function rateOf(f: Frame, dflt: number): number {
  return clamp(f.density ?? dflt, 0.1, 200);
}
function seedOf(rnd: () => number): number {
  return Math.floor(((rnd() + 1) / 2) * 0x7ffffffe) + 1;
}
function mapCurve(values: Float32Array, lo: number, hi: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = lo + (hi - lo) * (values[i] ?? 0);
  return out;
}
function shape(param: AudioParam, f: Frame, values: Float32Array, lo: number, hi: number): void {
  param.setValueCurveAtTime(mapCurve(values, lo, hi), f.t, f.span);
}
/** A short exponential burst on a gain parameter. */
function blip(param: AudioParam, at: number, peak: number, a: number, d: number): void {
  param.setValueAtTime(0.0001, at);
  param.linearRampToValueAtTime(Math.max(peak, 0.0002), at + a);
  param.exponentialRampToValueAtTime(0.0001, at + a + d);
}

interface Chain {
  readonly input: AudioNode;
  readonly lfos: readonly OscillatorNode[];
  /** Extra polyphony cost of the chain's stages. */
  readonly cost: number;
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
  private readonly earlies = new Map<string, AudioNode>();
  private readonly positions = new Map<
    string,
    { readonly pos: readonly [number, number, number]; readonly at: number }
  >();
  private readonly periodic = new Map<string, AudioBuffer>();
  private readonly spectralBuses = new Map<number, AudioWorkletNode>();
  private cosWave: PeriodicWave | undefined;
  private readonly firKernels = new Map<string, AudioBuffer>();
  private readonly bodies = new Map<string, AudioBuffer>();
  private readonly cabs = new Map<string, AudioBuffer>();
  private readonly cabBuses = new Map<string, AudioNode>();
  private readonly compBuses = new Map<number, DynamicsCompressorNode>();
  private readonly curveTables = new Map<string, CurveTable>();
  private shortLeads = 0;
  /** Host-supplied samples (docs/samples.md Part 4). */
  private library: SampleLibrary | undefined;
  private pendingSkips = 0;
  private readonly sampleBuffers = new WeakMap<DecodedTake, AudioBuffer>();

  private constructor(
    readonly ctx: AudioContext,
    private readonly input: AudioNode,
    private readonly spectralReady: boolean,
    private readonly gateReady: boolean,
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
    // Spectral effects are optional: if the worklet is refused, they are bypassed (TS-79).
    const spectralUrl = URL.createObjectURL(new Blob([SPECTRAL_WORKLET_SOURCE], { type: 'text/javascript' }));
    let spectral = true;
    try {
      await ctx.audioWorklet.addModule(spectralUrl);
    } catch {
      spectral = false;
    } finally {
      URL.revokeObjectURL(spectralUrl);
    }
    // The gate is optional too: if its worklet is refused, `gate` is ignored (TS-87).
    const gateUrl = URL.createObjectURL(new Blob([GATE_WORKLET_SOURCE], { type: 'text/javascript' }));
    let gate = true;
    try {
      await ctx.audioWorklet.addModule(gateUrl);
    } catch {
      gate = false;
    } finally {
      URL.revokeObjectURL(gateUrl);
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
    return new AudioEngine(ctx, bus, spectral, gate);
  }

  get unknown(): ReadonlySet<string> {
    return this.unknownSounds;
  }
  /** Voices whose latency compensation was cut short by the cap or a late event (TS-85). */
  get shortenedLeads(): number {
    return this.shortLeads;
  }
  /** Sets the decoded samples this engine plays; names in it win over kit sounds (TS-91). */
  setLibrary(lib: SampleLibrary | undefined): void {
    this.library = lib;
  }
  /** Events skipped because their sample was still loading. */
  get skippedSamples(): number {
    return this.pendingSkips;
  }

  play(c: ControlMap, time: number, duration: number): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // nudge moves the onset in seconds; legato scales the held duration (TS-59).
    const at = time + clamp(fin(c.nudge, 0), -0.05, 0.25);
    if (!Number.isFinite(at) || at < now - 0.05) return;
    // Stages that delay the signal start the voice early by their latency (TS-85).
    const fir = firSpec(c);
    const perVoiceSpectral =
      spectralModeIndex(c.spectral) > 0 && clamp(fin(c.ssend, 0), 0, 1) === 0 && this.spectralReady;
    const latency =
      (fir ? firLatency(fir.taps) : 0) / ctx.sampleRate + (perVoiceSpectral ? STFT_SIZE / ctx.sampleRate : 0);
    const lead = Math.min(latency, LATENCY_CAP, Math.max(0, at - now));
    if (latency > lead + 1e-4) this.shortLeads++;
    const t = Math.max(at - lead, now);
    const dur = Math.max(0, fin(duration, 0)) * clamp(fin(c.legato, 1), 0.01, 8);
    const vel = clamp(fin(c.velocity, 1), 0, 1);
    // velcurve bends velocity before it sets the level; timbre still reads the raw velocity (TS-88).
    const gain = clamp(fin(c.gain, 1), 0, 1.5) * vel ** clamp(fin(c.velcurve, 1), 0.25, 4);
    if (gain <= 0) return;
    const note = c.note as { kind?: string; value?: unknown } | undefined;
    const midi = note?.kind === 'midi' ? fin(note.value, NaN) : NaN;
    const hz = num(c.freq);
    const lib = this.library;
    const gm = typeof c.s !== 'string' && Number.isFinite(midi) ? lib?.gmName(Math.round(midi)) : undefined;
    const sound =
      typeof c.s === 'string' ? c.s : (gm ?? (Number.isFinite(midi) || hz !== undefined ? 'triangle' : undefined));
    if (sound === undefined) return;
    if (lib?.isPending(sound) === true) {
      this.pendingSkips++;
      return;
    }
    const entry = lib?.get(sound);
    let name = sound;
    if (!entry) {
      const res = resolveSound(sound);
      if (res.status === 'missing') {
        this.unknownSounds.add(sound);
        return;
      }
      name = res.status === 'fallback' ? res.to : sound;
    }
    const kit = entry === undefined;
    const osc = kit && OSC_SET.has(name);
    const noise = kit && isNoise(name);
    const vocal = kit && VOICE_SET.has(name);
    const amb = kit && AMBIENCE_SET.has(name);
    const foley = kit && FOLEY_SET.has(name);
    const creature = kit && CREATURE_SET.has(name);
    if (kit && !osc && !noise && !vocal && !amb && !foley && !creature && !DRUM_SET.has(name)) {
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
    // A cabinet sits in the dry path, after placement and the ear stage (TS-83).
    const cab = typeof c.cab === 'string' && CABS.has(c.cab) ? c.cab : undefined;
    // A compressor shared by the orbit takes the dry path of voices that ask for it (TS-87).
    const orbit = clamp(Math.round(fin(c.orbit, 0)), 0, 15);
    const threshold = num(c.comp);
    const dry = threshold !== undefined && threshold < 0 ? this.compBus(orbit, c, t) : this.input;
    const sink = this.earStage(c, cab ? this.cabBus(orbit, cab, dry) : dry);
    post.connect(dual ? sink : this.air(c, this.placer(c, sink, t)));
    this.sends(c, post, t);
    const textured = amb || creature;
    const attack = clamp(fin(c.attack, vocal ? 0.03 : textured ? 0.3 : 0.005), 0.001, 5);
    const release = clamp(fin(c.release, vocal ? 0.12 : textured ? 0.6 : 0.08), 0.01, 8);

    // Mono lines: a new note ends the previous one on the same line (TS-42).
    const mono = num(c.mono);
    const key = mono === undefined ? undefined : String(clamp(Math.round(mono), 0, 64));
    const prev = key === undefined ? undefined : this.lines.get(key);
    if (prev && prev.voice.end > t) {
      prev.voice.cut?.(t);
      prev.voice.end = Math.min(prev.voice.end, t + 0.03);
    }
    const glideTime = clamp(fin(c.glide, 0), 0, 5);
    const sampleFreq = entry?.kind === 'note' && Number.isFinite(midi) ? 440 * 2 ** ((midi - 69) / 12) : NaN;
    const sampleGlide =
      Number.isFinite(sampleFreq) && prev !== undefined && Number.isFinite(prev.freq) && glideTime > 0
        ? { from: prev.freq, time: glideTime }
        : undefined;

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
    const env: Adsr = {
      a: attack,
      d: clamp(fin(c.decay, 0.05), 0.001, 5),
      s: clamp(fin(c.sustain, 1), 0, 1),
      r: release,
    };
    const grain = num(c.grain);
    const sp = clamp(Math.abs(fin(c.speed, 1)), 0.125, 8);

    let spec: Spec | undefined;
    if (entry) {
      spec = this.sampleVoice(entry, c, env, midi, vel, sampleGlide, t, dur, gain, gate);
    } else if ((osc || noise) && grain !== undefined && grain > 0) {
      spec = this.granular(name, c, env, freq, t, dur, gain, gate);
    } else if (pitched) {
      const from =
        (osc || vocal) && prev !== undefined && Number.isFinite(prev.freq) && glideTime > 0 ? prev.freq : undefined;
      const glide = from === undefined ? undefined : { from, time: glideTime };
      spec = vocal
        ? this.vocal(name, c, env, freq, glide, t, dur, gain, gate, post, plan)
        : this.synth(name, c, env, freq, ear, glide, t, dur, gain, gate);
    } else if (amb) {
      spec = this.ambience(name, c, env, t, dur, gain, gate);
    } else if (creature) {
      const cf = hz ?? (Number.isFinite(midi) ? 440 * 2 ** ((midi - 69) / 12) : undefined);
      spec = this.creature(name, c, env, cf, t, dur, gain, gate);
    } else if (foley) {
      spec = this.foley(name, c, t, gain, sp, gate);
    } else {
      spec = this.drum(name, t, gain, sp, gate);
    }
    if (!spec) return;

    const voice = this.voice(
      [...spec.sources, ...fx.lfos],
      t,
      spec.end,
      gate,
      spec.starts,
      (spec.cost ?? spec.sources.length) + fx.lfos.length + fx.cost,
    );
    this.admit(voice, now);
    if (key !== undefined) {
      this.lines.set(key, {
        voice,
        freq: osc || vocal ? freq : sampleFreq,
        ...(plan ? { vowel: plan.vowel, bank: plan.last } : undefined),
      });
    }
  }

  stopAll(): void {
    for (const v of this.voices.splice(0)) v.stop();
    this.lines.clear();
    this.positions.clear();
    const now = this.ctx.currentTime;
    for (const bus of this.delays.values()) {
      bus.feedback.gain.cancelScheduledValues(now);
      bus.feedback.gain.setValueAtTime(0, now);
    }
    for (const bus of this.spectralBuses.values()) {
      const mode = bus.parameters.get('mode');
      mode?.cancelScheduledValues(now);
      mode?.setValueAtTime(0, now);
    }
  }

  /** Starts the sources and wraps them as one voice that can be stopped or faded out. */
  private voice(
    sources: AudioScheduledSourceNode[],
    t: number,
    end: number,
    gate: GainNode,
    starts?: Starts,
    cost?: number,
  ): Voice {
    for (const s of sources) {
      const st = starts?.get(s);
      const when = st?.[0] ?? t;
      const offset = st?.[1] ?? 0;
      const stopAt = st?.[2];
      if (offset > 0 && s instanceof AudioBufferSourceNode) s.start(when, offset);
      else s.start(when);
      s.stop(stopAt !== undefined ? Math.max(stopAt, when + 0.005) : Math.max(end, when + 0.01));
    }
    return {
      end,
      cost: cost ?? sources.length,
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
   * distance selects HRTF placement; otherwise a stereo panner reads `pan` (TS-40). A placed
   * voice glides from the position of the previous note of the same sound and orbit (TS-71).
   */
  private placer(c: ControlMap, out: AudioNode, t: number): AudioNode {
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
    const target: readonly [number, number, number] = [
      Math.sin(az) * Math.cos(el) * d,
      Math.sin(el) * d,
      -Math.cos(az) * Math.cos(el) * d,
    ];
    const key = `${String(clamp(Math.round(fin(c.orbit, 0)), 0, 15))}:${typeof c.s === 'string' ? c.s : ''}`;
    const prev = this.positions.get(key);
    const glide = clamp(fin(c.posglide, 0.05), 0, 2);
    const from = prev !== undefined && glide > 0 && t >= prev.at && t - prev.at < 2 ? prev.pos : undefined;
    const params = [p.positionX, p.positionY, p.positionZ];
    for (const [i, a] of params.entries()) {
      const to = target[i] ?? 0;
      if (from) {
        const start = from[i] ?? 0;
        a.value = start;
        a.setValueAtTime(start, t);
        a.linearRampToValueAtTime(to, t + glide);
      } else {
        a.value = to;
      }
    }
    this.positions.set(key, { pos: target, at: t });
    p.connect(out);
    return p;
  }
  /** Air absorption for distant placed voices (TS-70). Returns the node the dry path feeds. */
  private air(c: ControlMap, dest: AudioNode): AudioNode {
    const d = num(c.distance);
    if (d === undefined || d <= 1) return dest;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = airCutoff(clamp(d, 0.5, 50));
    f.Q.value = 0.5;
    f.connect(dest);
    return f;
  }
  /**
   * Interaural time and level differences, per-ear filters, the band split and the ear swap,
   * after any panner (TS-62, TS-64). Returns the node a placed voice feeds; without these
   * controls it is `out` itself.
   */
  private earStage(c: ControlMap, out: AudioNode): AudioNode {
    const itd = clamp(fin(c.itd, 0), -MAX_ITD, MAX_ITD);
    const ild = clamp(fin(c.ild, 0), -MAX_ILD, MAX_ILD);
    const swap = fin(c.earswap, 0) >= 0.5;
    const lows = [num(c.lcutoff), num(c.rcutoff)];
    const highs = [num(c.lhcutoff), num(c.rhcutoff)];
    const bands = c.earsplit === 'bands';
    const crossover = clamp(fin(c.splitfreq, 1000), 100, 8000);
    const filtered = bands || [...lows, ...highs].some((x) => x !== undefined);
    if (itd === 0 && ild === 0 && !swap && !filtered) return out;
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
      let node: AudioNode = g;
      const filter = (type: BiquadFilterType, f: number, q: number): void => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = clamp(f, 20, 20000);
        b.Q.value = q;
        node.connect(b);
        node = b;
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
        node = dl;
      }
      node.connect(merge, 0, swap ? 1 - ch : ch);
    }
    merge.connect(out);
    return split;
  }

  /**
   * Sends to the shared reverb, early reflections and delay of the event's orbit (TS-41, TS-69,
   * TS-70). Distant placed voices send more to the reverb.
   */
  private sends(c: ControlMap, post: AudioNode, t: number): void {
    const orbit = clamp(Math.round(fin(c.orbit, 0)), 0, 15);
    const space = typeof c.space === 'string' && SPACES.has(c.space) ? c.space : undefined;
    const spatial = typeof c.azimuth === 'number' || typeof c.elevation === 'number' || typeof c.distance === 'number';
    const far = spatial ? distanceWet(clamp(fin(c.distance, 1), 0.5, 50)) : 0;
    const room = clamp(fin(c.room, 0) + far, 0, 1);
    if (room > 0) {
      const size = clamp(fin(c.size, 0.3), 0, 1);
      const s = this.ctx.createGain();
      s.gain.value = room;
      post.connect(s);
      // spacepre and spacedamp reshape the tail of a space preset (TS-84).
      const pre = space ? num(c.spacepre) : undefined;
      const damp = space ? num(c.spacedamp) : undefined;
      const preStep = pre === undefined ? undefined : Math.round(clamp(pre, 0, 200) / 10);
      const dampStep = damp === undefined ? undefined : Math.round(clamp(damp, 0, 1) * 10);
      s.connect(this.reverb(orbit, size, space, preStep, dampStep));
      const er = this.early(orbit, size, space ?? 'room');
      if (er) {
        const e = this.ctx.createGain();
        e.gain.value = room * 0.6;
        post.connect(e);
        e.connect(er);
      }
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
    // A spectral effect shared per orbit (TS-79). The latest onset on the orbit sets its settings.
    const ssend = clamp(fin(c.ssend, 0), 0, 1);
    const spec = spectralSettings(c);
    if (ssend > 0 && spec.mode > 0 && this.spectralReady) {
      const bus = this.spectralBus(orbit);
      for (const [name, v] of Object.entries(spec)) bus.parameters.get(name)?.setValueAtTime(v, t);
      const s = this.ctx.createGain();
      s.gain.value = ssend;
      post.connect(s);
      s.connect(bus);
    }
  }

  private reverb(orbit: number, size: number, space?: string, preStep?: number, dampStep?: number): AudioNode {
    const step = Math.round(size * 10);
    const key = `${String(orbit)}:${space ?? ''}:${String(step)}:${String(preStep ?? '')}:${String(dampStep ?? '')}`;
    const hit = this.reverbs.get(key);
    if (hit) return hit;
    if (this.reverbs.size >= MAX_REVERBS) {
      const first = this.reverbs.values().next();
      if (!first.done) return first.value;
    }
    const pre = preStep === undefined ? 0 : preStep / 100;
    const seconds = space ? Math.min(10, spaceSeconds(space, step / 10) + pre) : 0.4 + step * 0.4;
    const opts = {
      ...(preStep !== undefined ? { predelay: pre } : {}),
      ...(dampStep !== undefined ? { damping: dampStep / 10 } : {}),
    };
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(2, Math.max(1, Math.round(seconds * sr)), sr);
    const salt = space ? [...SPACES.keys()].indexOf(space) * 131 + 17 : 0;
    for (let ch = 0; ch < 2; ch++) {
      const seed = 0x1234567 + ch * 7919 + step + salt;
      if (space) spaceImpulse(buf.getChannelData(ch), sr, space, seed, opts);
      else impulseResponse(buf.getChannelData(ch), seed);
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = buf;
    const wet = this.ctx.createGain();
    wet.gain.value = space ? (SPACES.get(space)?.wet ?? 0.5) : 0.5;
    conv.connect(wet).connect(this.input);
    this.reverbs.set(key, conv);
    return conv;
  }
  /** A shared early-reflection bus: delayed, filtered, panned taps (TS-70). */
  private early(orbit: number, size: number, space: string): AudioNode | undefined {
    const step = Math.round(size * 10);
    const key = `${String(orbit)}:${space}:${String(step)}`;
    const hit = this.earlies.get(key);
    if (hit) return hit;
    if (this.earlies.size >= MAX_REVERBS) {
      const first = this.earlies.values().next();
      if (!first.done) return first.value;
    }
    const taps = earlyTaps(space, step / 10, 0x2c1b3c6d + step);
    if (taps.length === 0) return undefined;
    const ctx = this.ctx;
    const input = ctx.createGain();
    for (const tap of taps) {
      const d = ctx.createDelay(0.6);
      d.delayTime.value = tap.delay;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = tap.cutoff;
      const g = ctx.createGain();
      g.gain.value = tap.gain;
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(tap.pan, -1, 1);
      input.connect(d).connect(f).connect(g).connect(p).connect(this.input);
    }
    this.earlies.set(key, input);
    return input;
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
  /** A spectral processor node; buses persist, per-voice nodes stop once their input is gone. */
  private spectralNode(s: SpectralParams, persist: boolean, seed: number): AudioWorkletNode {
    return new AudioWorkletNode(this.ctx, 'tartlet-spectral', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      parameterData: { ...s },
      processorOptions: { persist, seed },
    });
  }
  private spectralBus(orbit: number): AudioWorkletNode {
    const hit = this.spectralBuses.get(orbit);
    if (hit) return hit;
    if (this.spectralBuses.size >= MAX_SPECTRAL_BUSES) {
      const first = this.spectralBuses.values().next();
      if (!first.done) return first.value;
    }
    const node = this.spectralNode(spectralSettings({}), true, 0x51ed270b + orbit);
    node.connect(this.input);
    this.spectralBuses.set(orbit, node);
    return node;
  }
  private monoBuffer(data: Float32Array<ArrayBuffer>): AudioBuffer {
    const b = this.ctx.createBuffer(1, Math.max(1, data.length), this.ctx.sampleRate);
    b.copyToChannel(data, 0);
    return b;
  }
  /** A designed FIR kernel, from a small least-recently-used cache (TS-81). */
  private firBuffer(f: FirSpec): AudioBuffer {
    const key = `${f.design}:${String(f.taps)}:${String(f.freq)}:${String(f.width)}`;
    const hit = this.firKernels.get(key);
    if (hit) {
      this.firKernels.delete(key);
      this.firKernels.set(key, hit);
      return hit;
    }
    const b = this.monoBuffer(firKernel(f.design, f.freq, f.width, f.taps, this.ctx.sampleRate));
    this.firKernels.set(key, b);
    if (this.firKernels.size > MAX_FIR_KERNELS) {
      const first = this.firKernels.keys().next();
      if (!first.done) this.firKernels.delete(first.value);
    }
    return b;
  }
  /** A generated body response; sizes are quantised to quarter-octave steps (TS-82). */
  private bodyBuffer(body: string, size: number): AudioBuffer {
    const step = Math.round(Math.log2(size) * 4);
    const key = `${body}:${String(step)}`;
    const hit = this.bodies.get(key);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    const data = new Float32Array(bodySamples(body, sr));
    bodyResponse(data, sr, body, 2 ** (step / 4), 0x3c6ef372 + step);
    const b = this.monoBuffer(data);
    this.bodies.set(key, b);
    return b;
  }
  private cabBuffer(cab: string): AudioBuffer {
    const hit = this.cabs.get(cab);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    const data = new Float32Array(cabSamples(cab, sr));
    cabResponse(data, sr, cab, 0x1f83d9ab);
    const b = this.monoBuffer(data);
    this.cabs.set(cab, b);
    return b;
  }
  /** A cabinet bus per orbit and cabinet, feeding the master bus (TS-83). */
  private cabBus(orbit: number, cab: string, dest: AudioNode): AudioNode {
    const key = `${String(orbit)}:${cab}:${dest === this.input ? 'm' : 'c'}`;
    const hit = this.cabBuses.get(key);
    if (hit) return hit;
    if (this.cabBuses.size >= MAX_CAB_BUSES) {
      const first = this.cabBuses.values().next();
      if (!first.done) return first.value;
    }
    const conv = this.ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = this.cabBuffer(cab);
    conv.connect(dest);
    this.cabBuses.set(key, conv);
    return conv;
  }
  /** The compressor shared by an orbit; the latest onset sets its settings (TS-87). */
  private compBus(orbit: number, c: ControlMap, t: number): AudioNode {
    let bus = this.compBuses.get(orbit);
    if (!bus) {
      if (this.compBuses.size >= MAX_COMP_BUSES) {
        const first = this.compBuses.values().next();
        if (!first.done) return first.value;
      }
      bus = this.ctx.createDynamicsCompressor();
      bus.connect(this.input);
      this.compBuses.set(orbit, bus);
    }
    bus.threshold.setValueAtTime(clamp(fin(c.comp, -24), -60, 0), t);
    bus.ratio.setValueAtTime(clamp(fin(c.compratio, 4), 1, 20), t);
    bus.knee.setValueAtTime(clamp(fin(c.compknee, 6), 0, 40), t);
    bus.attack.setValueAtTime(clamp(fin(c.compattack, 0.003), 0, 1), t);
    bus.release.setValueAtTime(clamp(fin(c.comprelease, 0.25), 0, 1), t);
    return bus;
  }
  /** A transfer curve table, cached per quantised drive and bias (TS-86). */
  private curveFor(name: string, drive: number, bias: number): CurveTable {
    const key = `${name}:${String(drive)}:${String(bias)}`;
    let hit = this.curveTables.get(key);
    if (!hit) {
      hit = curveTable(name, drive, bias);
      this.curveTables.set(key, hit);
    }
    return hit;
  }
  private cosineWave(): PeriodicWave {
    if (!this.cosWave) {
      this.cosWave = this.ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), {
        disableNormalization: true,
      });
    }
    return this.cosWave;
  }
  /**
   * Single-sideband frequency shift (TS-78): two all-pass chains give the signal and its 90°
   * companion, which are mixed with a cosine and a sine at the shift frequency.
   */
  private frequencyShifter(shift: number, dest: AudioNode, lfos: OscillatorNode[]): AudioNode {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const { first, second } = hilbertSections();
    const chain = (sections: readonly IirSection[]): AudioNode => {
      let node: AudioNode = input;
      for (const s of sections) {
        const f = ctx.createIIRFilter([...s.feedforward], [...s.feedback]);
        node.connect(f);
        node = f;
      }
      return node;
    };
    const hz = Math.abs(shift);
    const cosine = ctx.createOscillator();
    cosine.setPeriodicWave(this.cosineWave());
    cosine.frequency.value = hz;
    const sine = ctx.createOscillator();
    sine.frequency.value = hz;
    const a = ctx.createGain();
    a.gain.value = 0;
    cosine.connect(a.gain);
    const b = ctx.createGain();
    b.gain.value = 0;
    sine.connect(b.gain);
    const sign = ctx.createGain();
    sign.gain.value = fshiftSinGain(shift);
    chain(first).connect(a).connect(dest);
    chain(second).connect(b).connect(sign).connect(dest);
    lfos.push(cosine, sine);
    return input;
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
    let cost = 0;
    let head: AudioNode = sink;
    const link = (n: AudioNode): void => {
      n.connect(head);
      head = n;
    };
    // A per-voice gate, closest to the sink (TS-87).
    const gateDb = num(c.gate);
    if (gateDb !== undefined && this.gateReady) {
      const gate = new AudioWorkletNode(ctx, 'tartlet-gate', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        parameterData: { threshold: clamp(gateDb, -90, 0), release: clamp(fin(c.gaterelease, 0.1), 0.005, 1) },
      });
      link(gate);
      cost += GATE_COST;
    }
    // Occlusion sits closest to the sink, so the sends hear the muffled sound too (TS-72).
    const occ = clamp(fin(c.occlude, 0), 0, 1);
    if (occ > 0) {
      const o = occlusion(occ);
      const g = ctx.createGain();
      g.gain.value = o.gain;
      link(g);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.cutoff;
      f.Q.value = 0.5;
      link(f);
    }

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
    // A per-voice spectral stage, unless the event sends to the orbit's shared one (TS-79).
    const spectralMode = spectralModeIndex(c.spectral);
    if (spectralMode > 0 && clamp(fin(c.ssend, 0), 0, 1) === 0 && this.spectralReady) {
      link(this.spectralNode(spectralSettings(c), false, seedInt(fin(c.dseed, 0))));
      cost += SPECTRAL_COST;
    }
    // A generated body response between the vowel colour and the spectral stage (TS-82).
    const body = typeof c.body === 'string' && BODY_SPECS.has(c.body) ? c.body : undefined;
    const bodyMix = clamp(fin(c.bodymix, 1), 0, 1);
    if (body && bodyMix > 0) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = this.bodyBuffer(body, clamp(fin(c.bodysize, 1), 0.25, 4));
      const inp = ctx.createGain();
      const wet = ctx.createGain();
      wet.gain.value = bodyMix;
      inp.connect(conv).connect(wet).connect(head);
      if (bodyMix < 1) {
        const dry = ctx.createGain();
        dry.gain.value = 1 - bodyMix;
        inp.connect(dry).connect(head);
      }
      head = inp;
      cost += BODY_COST;
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
    // A transfer curve with drive, bias and gain compensation, before shape and crush (TS-86).
    const curveId = curveName(c.curve);
    const curveMix = clamp(fin(c.curvemix, 1), 0, 1);
    if (curveId !== undefined && curveMix > 0) {
      const drive = Math.round(clamp(fin(c.drive, 0), 0, 24) * 2) / 2;
      const bias = Math.round(clamp(fin(c.bias, 0), -0.5, 0.5) * 20) / 20;
      const table = this.curveFor(curveId, drive, bias);
      const inp = ctx.createGain();
      const ws = ctx.createWaveShaper();
      ws.curve = table.table;
      ws.oversample = curveId === 'fold' || curveId.startsWith('cheby') ? '4x' : '2x';
      const wet = ctx.createGain();
      wet.gain.value = table.makeup * curveMix;
      inp.connect(ws);
      let tail: AudioNode = ws;
      if (table.asymmetric) {
        const dc = ctx.createBiquadFilter();
        dc.type = 'highpass';
        dc.frequency.value = 10;
        dc.Q.value = 0.7;
        tail.connect(dc);
        tail = dc;
      }
      tail.connect(wet).connect(head);
      if (curveMix < 1) {
        const dryPath = ctx.createGain();
        dryPath.gain.value = 1 - curveMix;
        inp.connect(dryPath).connect(head);
      }
      head = inp;
    }
    // Spectral shaping with native filters, in signal order: shelves, peak, band, notch, tilt,
    // frequency shift and ring modulation (TS-77, TS-78). Each stage exists only when asked for.
    const eq = (type: BiquadFilterType, f: number, q: number, gainDb = 0): void => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = clamp(f, 20, 20000);
      b.Q.value = q;
      b.gain.value = gainDb;
      link(b);
    };
    const rm = clamp(fin(c.ringmod, 0), 0, 4000);
    if (rm > 0) {
      const mix = clamp(fin(c.ringmix, 1), 0, 1);
      const inp = ctx.createGain();
      const wet = ctx.createGain();
      wet.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rm;
      lfo.connect(wet.gain);
      const level = ctx.createGain();
      level.gain.value = mix;
      inp.connect(wet).connect(level).connect(head);
      if (mix < 1) {
        const dry = ctx.createGain();
        dry.gain.value = 1 - mix;
        inp.connect(dry).connect(head);
      }
      head = inp;
      lfos.push(lfo);
    }
    const fshift = clamp(fin(c.fshift, 0), -2000, 2000);
    if (fshift !== 0) head = this.frequencyShifter(fshift, head, lfos);
    const tl = clamp(fin(c.tilt, 0), -6, 6);
    if (tl !== 0) {
      const tilt = tiltShelves(tl);
      const makeup = ctx.createGain();
      makeup.gain.value = 10 ** (tilt.makeup / 20);
      link(makeup);
      for (const s of tilt.shelves) eq('highshelf', s.freq, 0.7, s.gain);
    }
    const notchF = num(c.notch);
    if (notchF !== undefined) eq('notch', notchF, clamp(fin(c.notchq, 4), 0.1, 30));
    const bandF = num(c.bandf);
    if (bandF !== undefined) eq('bandpass', bandF, clamp(fin(c.bandq, 1), 0.1, 30));
    const peak = clamp(fin(c.peak, 0), -18, 12);
    if (peak !== 0) eq('peaking', fin(c.peakfreq, 1000), clamp(fin(c.peakq, 1), 0.1, 18), peak);
    const hs = clamp(fin(c.highshelf, 0), -18, 12);
    if (hs !== 0) eq('highshelf', fin(c.hsfreq, 4000), 0.7, hs);
    const ls = clamp(fin(c.lowshelf, 0), -18, 12);
    if (ls !== 0) eq('lowshelf', fin(c.lsfreq, 200), 0.7, ls);
    // A linear-phase FIR filter right after the high-pass (TS-81).
    const fir = firSpec(c);
    if (fir) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = this.firBuffer(fir);
      link(conv);
      cost += FIR_COST.get(fir.len) ?? 2;
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
    return { input: head, lfos, cost };
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

    const pts = shapeEnvelope(envelope(t, dur, env, gain * 0.35), envShape(c));
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
    const pts = shapeEnvelope(envelope(t, dur, env, gain * (noise ? 0.25 : 0.3)), envShape(c));
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
    g.gain.value = 0.0001;
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
  /** A decoded sample as an AudioBuffer; the source resamples files at other rates (TS-92). */
  private sampleBuffer(take: DecodedTake): AudioBuffer {
    const hit = this.sampleBuffers.get(take);
    if (hit) return hit;
    const { wav } = take;
    const frames = Math.max(1, wav.channels[0]?.length ?? 0);
    const buf = this.ctx.createBuffer(Math.max(1, wav.channels.length), frames, wav.sampleRate);
    wav.channels.forEach((ch, i) => {
      buf.copyToChannel(ch, i);
    });
    this.sampleBuffers.set(take, buf);
    return buf;
  }
  /** Host samples through the impulse or note interpreter (docs/samples.md Part 4, TS-93). */
  private sampleVoice(
    entry: SampleEntry,
    c: ControlMap,
    env: Adsr,
    midi: number,
    vel: number,
    glide: { readonly from: number; readonly time: number } | undefined,
    t: number,
    dur: number,
    gain: number,
    out: AudioNode,
  ): Spec | undefined {
    const ctx = this.ctx;
    const speed = fin(c.speed, 1);
    const note = Number.isFinite(midi) ? midi : undefined;
    const plan =
      entry.kind === 'note'
        ? planNote(entry.takes, {
            ...(note !== undefined ? { note } : {}),
            velocity: vel,
            speed,
            rseed: fin(c.rseed, 0),
          })
        : planImpulse(entry.takes.length, { n: fin(c.n, 0), speed });
    const take = plan ? entry.takes[plan.take] : undefined;
    if (!plan || !take) return undefined;
    const buf = this.sampleBuffer(take);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = plan.rate;
    if (glide && note !== undefined && entry.kind === 'note') {
      const ratio = clamp(glide.from / (440 * 2 ** ((note - 69) / 12)), 0.125, 8);
      src.playbackRate.setValueAtTime(rate * ratio, t);
      src.playbackRate.exponentialRampToValueAtTime(rate, t + glide.time);
    } else {
      src.playbackRate.value = rate;
    }
    const amp = ctx.createGain();
    src.connect(amp).connect(out);
    const level = gain * 0.7;
    const length = buf.duration / rate;
    if (entry.kind === 'note') {
      if (take.loop) {
        src.loop = true;
        src.loopStart = take.loop.start / buf.sampleRate;
        src.loopEnd = take.loop.end / buf.sampleRate;
      }
      const pts = shapeEnvelope(envelope(t, dur, env, level), envShape(c));
      amp.gain.setValueAtTime(0, t);
      for (const [time, v] of pts.slice(1)) amp.gain.linearRampToValueAtTime(v, time);
      const last = pts[pts.length - 1]?.[0] ?? t;
      return { sources: [src], end: (take.loop ? last : Math.min(last, t + length)) + 0.02 };
    }
    // An impulse plays the whole file unless legato cuts it (docs/samples.md §4.1).
    amp.gain.value = level;
    if (typeof c.legato !== 'number') return { sources: [src], end: t + length + 0.01 };
    const cut = t + Math.max(0.005, dur);
    amp.gain.setValueAtTime(level, cut);
    amp.gain.linearRampToValueAtTime(0, cut + env.r);
    return { sources: [src], end: Math.min(t + length, cut + env.r) + 0.01 };
  }
  // ---- Textures (TS-73 to TS-76)
  private frame(c: ControlMap, env: Adsr, t: number, dur: number, peak: number, out: AudioNode): Frame {
    const pts = shapeEnvelope(envelope(t, dur, env, peak), envShape(c));
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    for (const [time, v] of pts.slice(1)) amp.gain.linearRampToValueAtTime(v, time);
    amp.connect(out);
    const end = (pts[pts.length - 1]?.[0] ?? t) + 0.02;
    const span = Math.max(0.05, end - t);
    return {
      t,
      amp,
      end,
      span,
      points: Math.min(2000, Math.max(2, Math.ceil(span * 20))),
      rnd: seededFrom(fin(c.tseed, 0)),
      intensity: clamp(fin(c.intensity, 0.5), 0, 1),
      density: num(c.density),
      sources: [],
      starts: new Map(),
    };
  }
  /** A looping noise bed starting at a seeded offset, so overlapping notes never phase-cancel. */
  private bed(f: Frame, kind: NoiseKind): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBed(kind);
    s.loop = true;
    f.sources.push(s);
    f.starts.set(s, [f.t, ((f.rnd() + 1) / 2) * 1.9]);
    return s;
  }
  private biquad(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = clamp(freq, 20, 20000);
    b.Q.value = q;
    return b;
  }
  private level(g: number): GainNode {
    const n = this.ctx.createGain();
    n.gain.value = g;
    return n;
  }
  private wander(f: Frame, perSecond: number): Float32Array<ArrayBuffer> {
    return smoothCurve(seedOf(f.rnd), f.points, Math.max(1, Math.min(f.points / 2, f.span * perSecond)));
  }
  /** Procedural ambiences: noise beds plus seeded micro-events (TS-73). */
  private ambience(name: string, c: ControlMap, env: Adsr, t: number, dur: number, gain: number, out: AudioNode): Spec {
    const ctx = this.ctx;
    const f = this.frame(c, env, t, dur, gain * 0.4, out);
    const k = f.intensity;
    switch (name) {
      case 'rain': {
        this.bed(f, 'pink')
          .connect(this.biquad('highpass', 700))
          .connect(this.level(0.5 + 0.5 * k))
          .connect(f.amp);
        const drop = ctx.createOscillator();
        const dg = this.level(0);
        drop.connect(dg).connect(f.amp);
        for (const e of microEvents(seedOf(f.rnd), f.span, rateOf(f, 4 + 40 * k), 240, 0.03)) {
          const at = t + e.at;
          const f0 = 900 + 2600 * e.v;
          drop.frequency.setValueAtTime(f0, at);
          drop.frequency.exponentialRampToValueAtTime(f0 * 1.7, at + 0.018);
          blip(dg.gain, at, 0.06 + 0.2 * e.w, 0.001, 0.02);
        }
        f.sources.push(drop);
        break;
      }
      case 'wind': {
        const rate = rateOf(f, 0.3 + k);
        const bp = this.biquad('bandpass', 600, 1 + 3 * k);
        shape(bp.frequency, f, this.wander(f, rate), 250, 700 + 1800 * k);
        const gust = this.level(0);
        shape(gust.gain, f, this.wander(f, rate), 0.15, 0.6 + 0.8 * k);
        this.bed(f, 'pink').connect(bp).connect(this.level(2)).connect(gust).connect(f.amp);
        this.bed(f, 'brown').connect(this.biquad('lowpass', 250)).connect(this.level(0.5)).connect(f.amp);
        break;
      }
      case 'fire': {
        this.bed(f, 'brown').connect(this.biquad('lowpass', 400)).connect(this.level(0.7)).connect(f.amp);
        this.bed(f, 'white')
          .connect(this.biquad('bandpass', 3000))
          .connect(this.level(0.05 + 0.1 * k))
          .connect(f.amp);
        const cg = this.level(0);
        this.bed(f, 'white').connect(this.biquad('highpass', 1800)).connect(cg).connect(f.amp);
        for (const e of microEvents(seedOf(f.rnd), f.span, rateOf(f, 2 + 25 * k), 400, 0.012)) {
          blip(cg.gain, t + e.at, 0.2 + 0.7 * e.w, 0.0005, 0.002 + 0.008 * e.v);
        }
        break;
      }
      case 'stream': {
        const rate = rateOf(f, 3 + 4 * k);
        const src = this.bed(f, 'white');
        for (let i = 0; i < 3; i++) {
          const bp = this.biquad('bandpass', 1000, 6 + 2 * i);
          shape(bp.frequency, f, this.wander(f, rate), 300 + 300 * i, 1200 + 900 * i);
          src
            .connect(bp)
            .connect(this.level(1.5 / (i + 1)))
            .connect(f.amp);
        }
        this.bed(f, 'pink')
          .connect(this.biquad('lowpass', 500))
          .connect(this.level(0.25 + 0.3 * k))
          .connect(f.amp);
        break;
      }
      case 'surf': {
        const sw = swellCurve(seedOf(f.rnd), f.points, f.span, rateOf(f, 0.08 + 0.1 * k));
        const lp = this.biquad('lowpass', 800, 0.5);
        shape(lp.frequency, f, sw, 300, 1500 + 2500 * k);
        const g = this.level(0);
        shape(g.gain, f, sw, 0.15, 1);
        this.bed(f, 'pink').connect(lp).connect(g).connect(f.amp);
        break;
      }
      case 'crowd': {
        const rate = rateOf(f, 2 + 6 * k);
        const src = this.bed(f, 'pink');
        const bands: readonly (readonly [number, number])[] = [
          [350, 2],
          [1000, 3],
          [2300, 4],
        ];
        for (const [freq, q] of bands) {
          const g = this.level(0);
          shape(g.gain, f, this.wander(f, rate), 0.3, 1.5 + k);
          src
            .connect(this.biquad('bandpass', freq, q))
            .connect(g)
            .connect(f.amp);
        }
        break;
      }
      default:
        break;
    }
    return { sources: f.sources, end: f.end, starts: f.starts };
  }
  /** Creature and machine models (TS-76). `hz` comes from `note` or `freq` when given. */
  private creature(
    name: string,
    c: ControlMap,
    env: Adsr,
    hz: number | undefined,
    t: number,
    dur: number,
    gain: number,
    out: AudioNode,
  ): Spec {
    const ctx = this.ctx;
    const f = this.frame(c, env, t, dur, gain * 0.4, out);
    const k = f.intensity;
    switch (name) {
      case 'bird': {
        const carrier = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const mg = this.level(0);
        mod.connect(mg).connect(carrier.frequency);
        const cg = this.level(0);
        carrier.connect(cg).connect(f.amp);
        const base = clamp(hz ?? 2600, 200, 10000);
        for (const e of microEvents(seedOf(f.rnd), f.span, rateOf(f, 2 + 5 * k), 96, 0.15)) {
          const at = t + e.at;
          const cd = 0.05 + 0.1 * e.v;
          const f0 = clamp(base * (0.75 + 0.5 * e.w), 200, 12000);
          const f1 = clamp(f0 * (f.rnd() > 0 ? 1.6 : 0.6), 100, 16000);
          carrier.frequency.setValueAtTime(f0, at);
          carrier.frequency.exponentialRampToValueAtTime(f1, at + cd);
          mod.frequency.setValueAtTime(f0 * 0.5, at);
          mod.frequency.exponentialRampToValueAtTime(f1 * 0.5, at + cd);
          mg.gain.setValueAtTime(f0 * (0.1 + 0.4 * k), at);
          mg.gain.setValueAtTime(0, at + cd);
          cg.gain.setValueAtTime(0.0001, at);
          cg.gain.linearRampToValueAtTime(0.6, at + 0.006);
          cg.gain.linearRampToValueAtTime(0.4, at + cd * 0.7);
          cg.gain.exponentialRampToValueAtTime(0.0001, at + cd);
        }
        f.sources.push(carrier, mod);
        break;
      }
      case 'insect': {
        const am = this.level(0.5);
        const lfo1 = ctx.createOscillator();
        lfo1.frequency.value = 30 + 60 * k;
        lfo1.connect(this.level(0.5)).connect(am.gain);
        const pulse = this.level(0.5);
        const lfo2 = ctx.createOscillator();
        lfo2.setPeriodicWave(this.isochronicWave());
        lfo2.frequency.value = rateOf(f, 2.5);
        lfo2.connect(this.level(0.5)).connect(pulse.gain);
        this.bed(f, 'white')
          .connect(this.biquad('bandpass', clamp(hz ?? 4500, 500, 12000), 12))
          .connect(am)
          .connect(pulse)
          .connect(this.level(3))
          .connect(f.amp);
        f.sources.push(lfo1, lfo2);
        break;
      }
      case 'engine': {
        const r = clamp(hz ?? 25 + 40 * k, 5, 400);
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(this.pulse(0.1));
        shape(osc.frequency, f, this.wander(f, rateOf(f, 0.5)), r * 0.96, r * 1.04);
        const bands: readonly (readonly [number, number, number])[] = [
          [120, 4, 1],
          [380, 5, 0.6],
          [900, 6, 0.3 + 0.4 * k],
        ];
        for (const [freq, q, g] of bands) {
          osc
            .connect(this.biquad('bandpass', freq, q))
            .connect(this.level(g * 2))
            .connect(f.amp);
        }
        this.bed(f, 'brown').connect(this.biquad('lowpass', 180)).connect(this.level(0.4)).connect(f.amp);
        f.sources.push(osc);
        break;
      }
      default:
        break;
    }
    return { sources: f.sources, end: f.end, starts: f.starts };
  }
  private pulse(d: number): PeriodicWave {
    const key = `pw:${String(d)}`;
    let w = this.waves.get(key);
    if (!w) {
      const wave = pulseWave(d);
      w = this.ctx.createPeriodicWave(wave.real, wave.imag);
      this.waves.set(key, w);
    }
    return w;
  }
  /** Foley one-shots (TS-74). `sp` is the `speed` ratio; `tseed` varies each hit slightly. */
  private foley(name: string, c: ControlMap, t: number, gain: number, sp: number, out: AudioNode): Spec | undefined {
    const ctx = this.ctx;
    const rnd = seededFrom(fin(c.tseed, 0));
    const vary = 1 + 0.06 * rnd();
    const hz = (f: number): number => clamp(f * vary * sp, 1, 20000);
    switch (name) {
      case 'drip': {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(hz(650), t);
        o.frequency.exponentialRampToValueAtTime(hz(1900), t + 0.035 / sp);
        o.connect(this.env(t, gain * 0.6, 0.07 / sp)).connect(out);
        return { sources: [o], end: t + 0.1 / sp };
      }
      case 'click': {
        const n = this.noiseSource(sp);
        n.connect(this.biquad('bandpass', hz(3500), 1.2))
          .connect(this.env(t, gain * 0.7, 0.006 / sp))
          .connect(out);
        return { sources: [n], end: t + 0.02 / sp };
      }
      case 'tick': {
        const o = ctx.createOscillator();
        o.frequency.value = hz(4200);
        o.connect(this.env(t, gain * 0.35, 0.015 / sp)).connect(out);
        const n = this.noiseSource(sp);
        n.connect(this.biquad('bandpass', hz(7000), 2))
          .connect(this.env(t, gain * 0.3, 0.004 / sp))
          .connect(out);
        return { sources: [o, n], end: t + 0.04 / sp };
      }
      case 'creak': {
        const len = 0.45 / sp;
        const o = ctx.createOscillator();
        o.type = 'square';
        const base = hz(42);
        o.frequency.setValueCurveAtTime(mapCurve(smoothCurve(seedOf(rnd), 32, 4), base * 0.6, base * 1.5), t, len);
        const g = ctx.createGain();
        g.gain.value = 0;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain * 0.45, t + 0.03 / sp);
        g.gain.setValueAtTime(gain * 0.45, t + len * 0.7);
        g.gain.linearRampToValueAtTime(0, t + len);
        o.connect(this.biquad('bandpass', hz(900), 4)).connect(g);
        o.connect(this.biquad('bandpass', hz(2300), 6)).connect(g);
        g.connect(out);
        return { sources: [o], end: t + len + 0.02 };
      }
      case 'step': {
        const heel = this.noiseSource(sp);
        heel
          .connect(this.biquad('lowpass', hz(380)))
          .connect(this.env(t, gain * 0.9, 0.09 / sp))
          .connect(out);
        const toe = this.noiseSource(sp);
        toe
          .connect(this.biquad('bandpass', hz(1800), 1))
          .connect(this.env(t + 0.03 / sp, gain * 0.25, 0.04 / sp))
          .connect(out);
        return { sources: [heel, toe], end: t + 0.16 / sp };
      }
      default:
        return undefined;
    }
  }
  /** A cached band-limited buffer of an oscillator at one pitch, the source for grains (TS-75). */
  private periodicBuffer(type: string, freq: number): AudioBuffer {
    const f = Math.round(clamp(freq, 20, 8000) * 4) / 4;
    const key = `${type}:${String(f)}`;
    let b = this.periodic.get(key);
    if (!b) {
      if (this.periodic.size >= 32) this.periodic.clear();
      const sr = this.ctx.sampleRate;
      const data = renderPeriodic(type, f, sr, 0.5);
      b = this.ctx.createBuffer(1, data.length, sr);
      b.copyToChannel(data, 0);
      this.periodic.set(key, b);
    }
    return b;
  }
  /** Granular playback of oscillator and noise sounds (TS-75). Grain positions come from `tseed`. */
  private granular(
    name: string,
    c: ControlMap,
    env: Adsr,
    freq: number,
    t: number,
    dur: number,
    gain: number,
    out: AudioNode,
  ): Spec {
    const ctx = this.ctx;
    const buf = isNoise(name) ? this.noiseBed(name) : this.periodicBuffer(name, freq);
    const size = clamp(fin(c.grain, 50), 5, 500) / 1000;
    const density = clamp(fin(c.gdensity, 20), 1, 200);
    const jitter = clamp(fin(c.gjitter, 0.2), 0, 1);
    const pos = clamp(fin(c.gpos, 0), 0, 1);
    const f = this.frame(c, env, t, dur, gain * 0.3, out);
    const grains = grainSchedule(seedOf(f.rnd), f.span, density, size, pos, jitter, buf.duration, MAX_GRAINS);
    const sources: AudioScheduledSourceNode[] = [];
    const starts = new Map<AudioScheduledSourceNode, readonly [number, number, number]>();
    for (const g of grains) {
      const at = t + g.at;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const w = ctx.createGain();
      w.gain.value = 0;
      w.gain.setValueAtTime(0, at);
      w.gain.linearRampToValueAtTime(1, at + g.len / 2);
      w.gain.linearRampToValueAtTime(0, at + g.len);
      src.connect(w).connect(f.amp);
      sources.push(src);
      starts.set(src, [at, g.offset, at + g.len]);
    }
    return { sources, end: f.end, starts, cost: Math.min(sources.length, Math.ceil(size * density) + 1) };
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
