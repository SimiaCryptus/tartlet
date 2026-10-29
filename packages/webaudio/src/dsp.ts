// Pure DSP helpers for @tartlet/webaudio (TS-41, TS-42, TS-43). They build no Web Audio objects,
// so they run and are tested in Node. All randomness is a fixed-seed xorshift: identical on
// every machine, and never drawn from Math.random.
import { CURVE_NAMES, FIR_DESIGNS, SPECTRAL_MODES } from '@tartlet/registry';

export type NoiseKind = 'white' | 'pink' | 'brown';

/** Fourier coefficients for a PeriodicWave. Index 0 is DC and is always zero. */
export interface Wave {
  readonly real: Float32Array<ArrayBuffer>;
  readonly imag: Float32Array<ArrayBuffer>;
}

/** Envelope times are seconds; `s` is a fraction of the peak. */
export interface Adsr {
  readonly a: number;
  readonly d: number;
  readonly s: number;
  readonly r: number;
}

/** One vocal-tract resonance: [frequency in Hz, gain, Q]. */
export type Formant = readonly [number, number, number];

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** A deterministic xorshift generator with values in [-1, 1). */
export function seededRandom(seed: number): () => number {
  let x = seed | 0;
  if (x === 0) x = 0x2545f491;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 0xffffffff) * 2 - 1;
  };
}

/** Fills `out` with deterministic noise. Pink and brown are normalised to a 0.9 peak. */
export function fillNoise(kind: NoiseKind, out: Float32Array, seed = 0x2545f491): void {
  const rnd = seededRandom(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rnd();
    let v = w;
    if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      v = b0 + b1 + b2 + w * 0.1848;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      v = last;
    }
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (kind !== 'white' && peak > 0) {
    const g = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * g;
  }
}

/** A reverb impulse response: seeded noise decaying by 60 dB over the buffer. */
export function impulseResponse(out: Float32Array, seed: number): void {
  fillNoise('white', out, seed);
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) * Math.exp((-6.9 * i) / n);
}

/**
 * Breakpoints [time, level] for linear ramps of an ADSR envelope that is held for `hold`
 * seconds after the onset (at least the attack). If the hold ends during the decay, the
 * release starts from the level reached at that moment.
 */
export function envelope(t: number, hold: number, e: Adsr, peak: number): [number, number][] {
  const end = t + Math.max(hold, e.a);
  const pts: [number, number][] = [
    [t, 0],
    [t + e.a, peak],
  ];
  const sus = peak * e.s;
  let level = peak;
  if (e.s < 1) {
    const d = Math.max(e.d, 1e-3);
    if (t + e.a + d <= end) {
      pts.push([t + e.a + d, sus]);
      level = sus;
    } else {
      level = peak - (peak - sus) * ((end - t - e.a) / d);
    }
  }
  pts.push([end, level], [end + e.r, 0]);
  return pts;
}

/** A pulse wave with duty cycle `duty` in (0, 1). A duty of one half is a square. */
export function pulseWave(duty: number, harmonics = 64): Wave {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    const s = Math.sin(Math.PI * n * duty);
    real[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty);
    imag[n] = (4 / (n * Math.PI)) * s * s;
  }
  return { real, imag };
}

/** Named harmonic tables for `timbre` (TS-42). Entry i is the amplitude of harmonic i + 1. */
export const TIMBRES: ReadonlyMap<string, readonly number[]> = new Map<string, readonly number[]>([
  ['organ', [1, 0.8, 0, 0.6, 0, 0, 0, 0.4]],
  ['hollow', [1, 0, 0.33, 0, 0.2, 0, 0.14, 0, 0.11]],
  ['bright', Array.from({ length: 16 }, (_, i) => 1 / (i + 1))],
  ['soft', [1, 0.2, 0.05]],
  ['reed', [1, 0.5, 0.8, 0.3, 0.6, 0.2, 0.4, 0.15]],
  ['glass', [1, 0, 0, 0.5, 0, 0, 0, 0, 0.25]],
]);

export function timbreWave(name: string): Wave | null {
  const amps = TIMBRES.get(name.toLowerCase());
  if (!amps) return null;
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => {
    imag[i + 1] = a;
  });
  return { real, imag };
}
/**
 * Signed sine-series amplitudes of the basic oscillator waveforms. Entry i is harmonic i + 1.
 * Returns null for anything that is not a basic oscillator.
 */
export function partialTable(type: string, harmonics = 32): readonly number[] | null {
  const n = (i: number): number => i + 1;
  switch (type) {
    case 'sine':
      return [1];
    case 'sawtooth':
      return Array.from({ length: harmonics }, (_, i) => ((i % 2 === 0 ? 1 : -1) * 2) / (Math.PI * n(i)));
    case 'square':
      return Array.from({ length: harmonics }, (_, i) => (n(i) % 2 === 1 ? 4 / (Math.PI * n(i)) : 0));
    case 'triangle':
      return Array.from({ length: harmonics }, (_, i) => {
        const h = n(i);
        if (h % 2 === 0) return 0;
        return ((((h - 1) / 2) % 2 === 0 ? 1 : -1) * 8) / (Math.PI * Math.PI * h * h);
      });
    default:
      return null;
  }
}
/**
 * Splits a partial table between the ears for `earsplit("harmonics")` (TS-65): alternate
 * non-zero partials go left and right. Both halves share one scale, set so the summed waveform
 * peaks at one. Build the PeriodicWaves with normalisation disabled to keep that scale.
 */
export function splitWaves(amps: readonly number[]): { left: Wave; right: Wave } {
  const len = amps.length + 1;
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  let k = 0;
  amps.forEach((a, i) => {
    if (a === 0) return;
    const side = k % 2 === 0 ? left : right;
    side[i + 1] = a;
    k++;
  });
  let peak = 0;
  const steps = 512;
  for (let s = 0; s < steps; s++) {
    const x = (2 * Math.PI * s) / steps;
    let v = 0;
    amps.forEach((a, i) => {
      v += a * Math.sin((i + 1) * x);
    });
    peak = Math.max(peak, Math.abs(v));
  }
  const g = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < len; i++) {
    left[i] = (left[i] ?? 0) * g;
    right[i] = (right[i] ?? 0) * g;
  }
  return { left: { real: new Float32Array(len), imag: left }, right: { real: new Float32Array(len), imag: right } };
}
/** A softened square for isochronic pulses (TS-67): four odd harmonics with a sinc roll-off, so edges do not click. */
export function softSquareWave(): Wave {
  const real = new Float32Array(8);
  const imag = new Float32Array(8);
  for (const h of [1, 3, 5, 7]) {
    const x = (Math.PI * h) / 8;
    imag[h] = (1 / h) * (Math.sin(x) / x);
  }
  return { real, imag };
}

/**
 * A glottal source (TS-43): harmonic n has amplitude n^-(2 − effort), so soft voices fall off
 * at about 12 dB per octave and strong voices at about 6 dB per octave.
 */
export function glottalWave(effort: number, harmonics = 48): Wave {
  const tilt = 2 - clamp(effort, 0, 1);
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) imag[n] = n ** -tilt;
  return { real, imag };
}

// Vowel formants for an adult voice, from published acoustic-phonetic averages:
// [F1, F2, F3 in Hz, gain of F2, gain of F3]. F1 has gain 1.
const VOWEL_TABLE: ReadonlyMap<string, readonly [number, number, number, number, number]> = new Map<
  string,
  readonly [number, number, number, number, number]
>([
  ['a', [800, 1150, 2900, 0.5, 0.25]],
  ['e', [400, 1600, 2700, 0.4, 0.25]],
  ['i', [270, 2140, 2950, 0.3, 0.2]],
  ['o', [450, 800, 2830, 0.5, 0.15]],
  ['u', [325, 700, 2530, 0.3, 0.1]],
  ['ae', [660, 1720, 2410, 0.5, 0.3]],
  ['ah', [730, 1090, 2440, 0.6, 0.25]],
  ['aw', [570, 840, 2410, 0.6, 0.2]],
  ['eh', [530, 1840, 2480, 0.4, 0.3]],
  ['er', [490, 1350, 1690, 0.5, 0.4]],
  ['ih', [390, 1990, 2550, 0.35, 0.25]],
  ['oh', [480, 820, 2600, 0.5, 0.15]],
  ['oo', [300, 870, 2240, 0.3, 0.1]],
  ['uh', [640, 1190, 2390, 0.55, 0.25]],
]);

interface VoiceType {
  readonly scale: number;
  readonly f4: number;
  readonly f5: number;
}

/** Voice types scale F1–F3 and set F4 and F5 (TS-43). */
export const VOICE_TYPE_TABLE: ReadonlyMap<string, VoiceType> = new Map<string, VoiceType>([
  ['bass', { scale: 0.9, f4: 3200, f5: 3700 }],
  ['tenor', { scale: 1, f4: 3400, f5: 3950 }],
  ['alto', { scale: 1.12, f4: 3750, f5: 4350 }],
  ['soprano', { scale: 1.22, f4: 4000, f5: 4700 }],
  ['child', { scale: 1.35, f4: 4400, f5: 5200 }],
]);
const TENOR: VoiceType = { scale: 1, f4: 3400, f5: 3950 };
const BANDWIDTH = [90, 110, 170, 250, 300];

function voiceType(name?: string): VoiceType {
  return VOICE_TYPE_TABLE.get((name ?? 'tenor').toLowerCase()) ?? TENOR;
}

export function voiceTypeScale(name?: string): number {
  return voiceType(name).scale;
}

function bank(f: readonly [number, number, number], gains: readonly number[], vt: VoiceType, shift: number): Formant[] {
  const k = 2 ** (shift / 12);
  const fs = [f[0] * vt.scale, f[1] * vt.scale, f[2] * vt.scale, vt.f4, vt.f5].map((x) => clamp(x * k, 50, 16000));
  return fs.map((x, i): Formant => [x, gains[i] ?? 0, clamp(x / ((BANDWIDTH[i] ?? 200) * vt.scale), 2, 30)]);
}

/** Five formants for a vowel, voice type and shift in semitones. Unknown vowels use `ah`. */
export function formantBank(vowel: string, voicetype?: string, shift = 0): Formant[] {
  const row = VOWEL_TABLE.get(vowel) ?? VOWEL_TABLE.get('ah') ?? [730, 1090, 2440, 0.6, 0.25];
  return bank([row[0], row[1], row[2]], [1, row[3], row[4], 0.12, 0.06], voiceType(voicetype), shift);
}

/** A closed-mouth, nasal resonance for `hum` and nasal consonants. */
export function nasalBank(voicetype?: string, shift = 0): Formant[] {
  return bank([250, 1100, 2500], [1, 0.06, 0.03, 0.02, 0.01], voiceType(voicetype), shift);
}

/** The first three formants of each vowel (the original `vowel` filter shape). */
export const FORMANTS: ReadonlyMap<string, readonly (readonly [number, number, number])[]> = new Map(
  [...VOWEL_TABLE.keys()].map((v) => [v, formantBank(v).slice(0, 3)] as const),
);

/** How a consonant of the singing alphabet is rendered (TS-45, TS-46). */
export interface ConsonantSpec {
  readonly kind: 'plosive' | 'fricative' | 'nasal' | 'approximant';
  /** Seconds. */
  readonly dur: number;
  readonly filter: 'bandpass' | 'highpass' | 'lowpass';
  readonly f: number;
  readonly q: number;
  readonly gain: number;
  readonly voiced: boolean;
  /** True when the sound passes through the vowel formants (aspiration). */
  readonly tract: boolean;
  /** For approximants: the vowel the formants start from. */
  readonly locus?: string;
}

const plosive = (f: number, q: number, gain: number, voiced: boolean): ConsonantSpec => ({
  kind: 'plosive',
  dur: 0.03,
  filter: 'bandpass',
  f,
  q,
  gain,
  voiced,
  tract: false,
});
const fricative = (
  filter: ConsonantSpec['filter'],
  f: number,
  q: number,
  gain: number,
  voiced: boolean,
  tract = false,
): ConsonantSpec => ({ kind: 'fricative', dur: tract ? 0.06 : 0.08, filter, f, q, gain, voiced, tract });
const nasal = (f: number): ConsonantSpec => ({
  kind: 'nasal',
  dur: 0.06,
  filter: 'lowpass',
  f,
  q: 0.7,
  gain: 0.6,
  voiced: true,
  tract: false,
});
const approximant = (locus: string): ConsonantSpec => ({
  kind: 'approximant',
  dur: 0.05,
  filter: 'bandpass',
  f: 1000,
  q: 1,
  gain: 0,
  voiced: true,
  tract: true,
  locus,
});

export const CONSONANT_SPECS: ReadonlyMap<string, ConsonantSpec> = new Map<string, ConsonantSpec>([
  ['p', plosive(900, 1, 0.5, false)],
  ['t', plosive(4000, 1.5, 0.5, false)],
  ['k', plosive(2000, 2, 0.5, false)],
  ['b', plosive(700, 1, 0.3, true)],
  ['d', plosive(3500, 1.5, 0.3, true)],
  ['g', plosive(1800, 2, 0.3, true)],
  ['f', fricative('bandpass', 7000, 0.7, 0.25, false)],
  ['th', fricative('bandpass', 6500, 0.8, 0.15, false)],
  ['s', fricative('highpass', 5500, 0.7, 0.5, false)],
  ['sh', fricative('bandpass', 2800, 1.5, 0.5, false)],
  ['h', fricative('bandpass', 1500, 0.5, 0.4, false, true)],
  ['v', fricative('bandpass', 6000, 0.7, 0.15, true)],
  ['z', fricative('highpass', 5000, 0.7, 0.3, true)],
  ['m', nasal(300)],
  ['n', nasal(400)],
  ['ng', nasal(500)],
  ['l', approximant('oo')],
  ['r', approximant('er')],
  ['w', approximant('u')],
  ['y', approximant('i')],
]);

/** A stepped waveshaper curve that reduces the signal to `bits` of depth (1–16). */
export function crushCurve(bits: number, length = 4096): Float32Array<ArrayBuffer> {
  const b = Math.min(16, Math.max(1, Math.round(bits)));
  const levels = 2 ** (b - 1);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    out[i] = Math.round(x * levels) / levels;
  }
  return out;
}

/** A soft-clipping curve for `shape` in (0, 1], gain-compensated so louder drive is not much louder. */
export function shapeCurve(amount: number, length = 1024): Float32Array<ArrayBuffer> {
  const a = Math.min(1, Math.max(0, amount));
  const drive = 1 + a * 30;
  const norm = Math.tanh(drive);
  const comp = 1 - 0.4 * a;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    out[i] = (Math.tanh(drive * x) / norm) * comp;
  }
  return out;
}

/** Detune offsets in cents for `n` unison copies spread evenly over `cents` in total. */
export function unisonOffsets(n: number, cents: number): number[] {
  if (n <= 1) return [0];
  return Array.from({ length: n }, (_, i) => (i / (n - 1) - 0.5) * cents);
}
// ---- Space and environment (TS-69 to TS-72)
/** The character of one reverb space. */
export interface SpaceSpec {
  /** Tail length in seconds at size 0, and how much size 1 adds. */
  readonly base: number;
  readonly span: number;
  /** Seconds of silence before the tail starts. */
  readonly predelay: number;
  /** How much darker the tail grows as it decays, 0–1. */
  readonly damping: number;
  /** Share of non-zero samples; below one the tail is a sparse set of echoes. */
  readonly density: number;
  /** Wet level of the bus. */
  readonly wet: number;
}
const ROOM_SPACE: SpaceSpec = { base: 0.3, span: 1.2, predelay: 0.004, damping: 0.6, density: 1, wet: 0.5 };
export const SPACES: ReadonlyMap<string, SpaceSpec> = new Map<string, SpaceSpec>([
  ['room', ROOM_SPACE],
  ['hall', { base: 1.2, span: 2.8, predelay: 0.02, damping: 0.4, density: 1, wet: 0.5 }],
  ['plate', { base: 0.8, span: 2.2, predelay: 0, damping: 0.15, density: 1, wet: 0.55 }],
  ['church', { base: 2.5, span: 4.5, predelay: 0.04, damping: 0.55, density: 1, wet: 0.45 }],
  ['outdoor', { base: 0.15, span: 0.6, predelay: 0.01, damping: 0.8, density: 0.08, wet: 0.35 }],
]);
/** Impulse length in seconds for a space and a size in [0, 1]. */
export function spaceSeconds(space: string, size: number): number {
  const s = SPACES.get(space) ?? ROOM_SPACE;
  return s.base + s.span * clamp(size, 0, 1);
}
/**
 * Fills `out` with a seeded impulse response for a named space: predelay, then noise that decays
 * by 60 dB over the buffer while a one-pole low-pass closes, so the tail darkens.
 * `opts` overrides the predelay (seconds) and the damping of the space (TS-84).
 */
export function spaceImpulse(
  out: Float32Array,
  sampleRate: number,
  space: string,
  seed: number,
  opts: { readonly predelay?: number; readonly damping?: number } = {},
): void {
  const spec = SPACES.get(space) ?? ROOM_SPACE;
  const predelay = clamp(opts.predelay ?? spec.predelay, 0, 0.5);
  const damping = clamp(opts.damping ?? spec.damping, 0, 1);
  const rnd = seededRandom(seed);
  const n = out.length;
  const pre = Math.min(n, Math.round(predelay * sampleRate));
  let y = 0;
  for (let i = 0; i < n; i++) {
    if (i < pre) {
      out[i] = 0;
      continue;
    }
    const p = (i - pre) / Math.max(1, n - pre);
    let x = rnd();
    if (spec.density < 1 && Math.abs(rnd()) > spec.density) x = 0;
    else if (spec.density < 1) x /= Math.sqrt(spec.density);
    y += (1 - damping * 0.9 * p) * (x - y);
    out[i] = y * Math.exp(-6.9 * p);
  }
}
interface TapSpec {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly gain: number;
}
const EARLY_ROOM: TapSpec = { count: 6, min: 0.004, max: 0.025, gain: 0.5 };
const EARLY: ReadonlyMap<string, TapSpec> = new Map<string, TapSpec>([
  ['room', EARLY_ROOM],
  ['hall', { count: 6, min: 0.012, max: 0.07, gain: 0.4 }],
  ['plate', { count: 0, min: 0, max: 0, gain: 0 }],
  ['church', { count: 8, min: 0.02, max: 0.12, gain: 0.35 }],
  ['outdoor', { count: 2, min: 0.06, max: 0.25, gain: 0.25 }],
]);
/** One early reflection: delay in seconds, level, pan in [-1, 1] and low-pass cutoff. */
export interface Tap {
  readonly delay: number;
  readonly gain: number;
  readonly pan: number;
  readonly cutoff: number;
}
/** Early reflections for a space, spread wider as size grows. Delays are increasing (TS-70). */
export function earlyTaps(space: string, size: number, seed: number): Tap[] {
  const spec = EARLY.get(space) ?? EARLY_ROOM;
  const rnd = seededRandom(seed);
  const scale = 0.5 + clamp(size, 0, 1);
  const out: Tap[] = [];
  for (let i = 0; i < spec.count; i++) {
    const x = (i + 0.5 + 0.4 * rnd()) / spec.count;
    const side = i % 2 === 0 ? -1 : 1;
    out.push({
      delay: Math.min(0.5, (spec.min + (spec.max - spec.min) * x) * scale),
      gain: spec.gain * 0.75 ** i,
      pan: side * (0.3 + 0.6 * Math.abs(rnd())),
      cutoff: 6000 * 0.8 ** i,
    });
  }
  return out;
}
/** Air absorption: a low-pass cutoff that falls with distance beyond 1 (TS-70). */
export function airCutoff(distance: number): number {
  if (!(distance > 1)) return 20000;
  return clamp(20000 * distance ** -0.65, 1200, 20000);
}
/** Extra reverb send for a distant source, 0 at distance 1 and 0.5 at 50 (TS-70). */
export function distanceWet(distance: number): number {
  if (!(distance > 1)) return 0;
  return Math.min(0.5, (0.5 * Math.log(distance)) / Math.log(50));
}
/** Low-pass cutoff and level for an occluded sound, `amount` in [0, 1] (TS-72). */
export function occlusion(amount: number): { cutoff: number; gain: number } {
  const o = clamp(amount, 0, 1);
  return { cutoff: 20000 * 0.02 ** o, gain: 1 - 0.5 * o };
}
// ---- Textures (TS-73 to TS-76)
/** A small event inside a texture: time in seconds from the onset and two draws in [0, 1). */
export interface MicroEvent {
  readonly at: number;
  readonly v: number;
  readonly w: number;
}
/**
 * Seeded event times with exponential gaps (about `rate` per second), at least `minGap` apart,
 * before `dur`, and at most `max` of them.
 */
export function microEvents(seed: number, dur: number, rate: number, max: number, minGap = 0.02): MicroEvent[] {
  const out: MicroEvent[] = [];
  if (!(rate > 0) || !(dur > 0)) return out;
  const rnd = seededRandom(seed);
  const u = (): number => Math.min(0.999999, (rnd() + 1) / 2);
  let at = 0;
  while (out.length < max) {
    at += Math.max(minGap, -Math.log(1 - u()) / rate);
    if (at >= dur) break;
    out.push({ at, v: u(), w: u() });
  }
  return out;
}
/** `n` values in [0, 1] eased between `knots` seeded random levels. */
export function smoothCurve(seed: number, n: number, knots: number): Float32Array<ArrayBuffer> {
  const len = Math.max(2, Math.round(n));
  const k = Math.max(1, Math.round(knots));
  const rnd = seededRandom(seed);
  const levels = Array.from({ length: k + 1 }, () => clamp((rnd() + 1) / 2, 0, 1));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * k;
    const j = Math.min(k - 1, Math.floor(x));
    const f = x - j;
    const s = (1 - Math.cos(Math.PI * f)) / 2;
    const a = levels[j] ?? 0;
    const b = levels[j + 1] ?? a;
    out[i] = a + (b - a) * s;
  }
  return out;
}
/** Slow swells in [0, 1] at about `rate` per second over `seconds`, with seeded drift (surf). */
export function swellCurve(seed: number, n: number, seconds: number, rate: number): Float32Array<ArrayBuffer> {
  const len = Math.max(2, Math.round(n));
  const out = new Float32Array(len);
  const drift = smoothCurve(seed ^ 0x5bd1e995, len, Math.max(1, Math.min(len / 2, seconds * rate)));
  const rnd = seededRandom(seed);
  let phase = (rnd() + 1) / 2;
  const dt = seconds / (len - 1);
  for (let i = 0; i < len; i++) {
    out[i] = ((1 - Math.cos(2 * Math.PI * phase)) / 2) ** 1.5;
    phase += rate * dt * (0.75 + 0.5 * (drift[i] ?? 0.5));
  }
  return out;
}
/** One grain: start in seconds from the onset, source offset in seconds and length. */
export interface Grain {
  readonly at: number;
  readonly offset: number;
  readonly len: number;
}
/**
 * A seeded grain schedule (TS-75). Grains start every 1/density seconds, moved by up to half a
 * step with `jitter`; offsets sit at `pos` of the source, moved by up to half the source with
 * `jitter`, and always fit inside it.
 */
export function grainSchedule(
  seed: number,
  dur: number,
  density: number,
  size: number,
  pos: number,
  jitter: number,
  bufferDur: number,
  max: number,
): Grain[] {
  const out: Grain[] = [];
  if (!(density > 0) || !(dur > 0) || !(size > 0) || !(bufferDur > 0)) return out;
  const rnd = seededRandom(seed);
  const len = Math.min(size, bufferDur);
  const room = Math.max(0, bufferDur - len);
  const step = 1 / density;
  const j = clamp(jitter, 0, 1);
  const p = clamp(pos, 0, 1);
  for (let i = 0; out.length < max; i++) {
    const at = i * step + j * step * 0.5 * rnd();
    if (at >= dur) break;
    out.push({ at: Math.max(0, at), offset: clamp(p * room + j * room * 0.5 * rnd(), 0, room), len });
  }
  return out;
}
/** A band-limited buffer of a basic waveform at `freq`, peaking at 0.9 (source for grains). */
export function renderPeriodic(
  type: string,
  freq: number,
  sampleRate: number,
  seconds = 0.5,
): Float32Array<ArrayBuffer> {
  const amps = partialTable(type) ?? [1];
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sampleRate;
  amps.forEach((a, i) => {
    const h = i + 1;
    if (a === 0 || h * freq >= sampleRate / 2) return;
    for (let k = 0; k < n; k++) out[k] = (out[k] ?? 0) + a * Math.sin(h * w * k);
  });
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let k = 0; k < n; k++) out[k] = ((out[k] ?? 0) * 0.9) / peak;
  return out;
}
// ---- Frequency-domain shaping (TS-77 to TS-79)
const finite = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
/**
 * Shelves for `tilt` in dB per octave (TS-77): four high shelves an octave apart around 1 kHz,
 * each with the slope as its gain, and a makeup gain that keeps 1 kHz at its level.
 */
export function tiltShelves(slope: number): { shelves: { freq: number; gain: number }[]; makeup: number } {
  const s = clamp(slope, -6, 6);
  return {
    shelves: [0, 1, 2, 3].map((i) => ({ freq: 1000 * 2 ** (i - 1.5), gain: s })),
    makeup: -2 * s,
  };
}
/** One section for an IIRFilterNode: feedforward (b) and feedback (a) coefficients. */
export interface IirSection {
  readonly feedforward: readonly number[];
  readonly feedback: readonly number[];
}
// A published 90-degree phase-difference network: two chains of four all-pass sections in z²,
// out(t) = c²·(in(t) + out(t − 2)) − in(t − 2). The first chain is delayed by one sample (TS-78).
const HILBERT_FIRST = [0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737];
const HILBERT_SECOND = [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278];
/** The two all-pass chains of the frequency shifter (TS-78). */
export function hilbertSections(): { readonly first: IirSection[]; readonly second: IirSection[] } {
  const section = (c: number, delay: boolean): IirSection => {
    const b = c * c;
    return { feedforward: delay ? [0, b, 0, -1] : [b, 0, -1], feedback: [1, 0, -b] };
  };
  return {
    first: HILBERT_FIRST.map((c, i) => section(c, i === 0)),
    second: HILBERT_SECOND.map((c) => section(c, false)),
  };
}
/** Complex response [re, im] of one section at angular frequency `w` (radians per sample). */
export function iirResponse(s: IirSection, w: number): readonly [number, number] {
  let nr = 0;
  let ni = 0;
  s.feedforward.forEach((b, k) => {
    nr += b * Math.cos(w * k);
    ni -= b * Math.sin(w * k);
  });
  let dr = 0;
  let di = 0;
  s.feedback.forEach((a, k) => {
    dr += a * Math.cos(w * k);
    di -= a * Math.sin(w * k);
  });
  const den = dr * dr + di * di;
  return [(nr * dr + ni * di) / den, (ni * dr - nr * di) / den];
}
/** Phase of the second chain relative to the first, in radians, at `f` as a fraction of the sample rate. */
export function hilbertPhaseDifference(f: number): number {
  const w = 2 * Math.PI * f;
  const product = (sections: readonly IirSection[]): readonly [number, number] =>
    sections.reduce<readonly [number, number]>(
      ([ar, ai], s) => {
        const [br, bi] = iirResponse(s, w);
        return [ar * br - ai * bi, ar * bi + ai * br];
      },
      [1, 0],
    );
  const { first, second } = hilbertSections();
  const [ar, ai] = product(first);
  const [br, bi] = product(second);
  return Math.atan2(bi * ar - br * ai, br * ar + bi * ai);
}
/** +1 when the second chain leads the first by 90°, -1 when it lags. Derived, not assumed (TS-78). */
const HILBERT_LEAD = Math.sign(hilbertPhaseDifference(0.125));
/**
 * Gain of the sine branch of the shifter: out = first·cos(Ωt) + gain·second·sin(Ωt), with
 * Ω = 2π·|shift|. Positive shifts move partials up, negative ones down.
 */
export function fshiftSinGain(shift: number): number {
  return HILBERT_LEAD * Math.sign(shift);
}
export const STFT_SIZE = 1024;
export const STFT_HOP = 256;
/** Settings of the spectral kernel. `mode` is an index into SPECTRAL_MODES. */
export type SpectralParams = {
  mode: number;
  amount: number;
  gate: number;
  comb: number;
  shift: number;
};
/** The index of a spectral mode name, or 0 (`none`) when it is unknown. */
export function spectralModeIndex(v: unknown): number {
  const i = typeof v === 'string' ? SPECTRAL_MODES.indexOf(v) : -1;
  return i < 0 ? 0 : i;
}
/** Clamped spectral settings of an event, with their defaults (TS-79). */
export function spectralSettings(c: Readonly<Record<string, unknown>>): SpectralParams {
  return {
    mode: spectralModeIndex(c.spectral),
    amount: clamp(finite(c.samount, 1), 0, 1),
    gate: clamp(finite(c.sgate, -40), -90, 0),
    comb: clamp(finite(c.scomb, 110), 20, 2000),
    shift: clamp(finite(c.sshift, 0), -24, 24),
  };
}
/** State of one channel of the short-time spectral processor. */
export interface StftState {
  readonly n: number;
  readonly hop: number;
  readonly sr: number;
  readonly scale: number;
  readonly ring: Float64Array;
  ringPos: number;
  count: number;
  readonly acc: Float64Array;
  readonly outQ: Float64Array;
  outIdx: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly win: Float64Array;
  readonly mag: Float64Array;
  readonly avg: Float64Array;
  readonly frozen: Float64Array;
  readonly fphase: Float64Array;
  readonly smag: Float64Array;
  readonly sphase: Float64Array;
  capFrames: number;
  capEnergy: number;
  rng: number;
  fade: number;
  mode: number;
}
// The kernel functions below are also the source of the spectral worklet (spectral-worklet.ts).
// They must stay self-contained: no references to module-level names, no inner functions.
/** In-place radix-2 FFT. The inverse divides by the length. */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while ((j & bit) !== 0) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k;
        const b = a + h;
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const xr = br * cr - bi * ci;
        const xi = br * ci + bi * cr;
        const ar = re[a] ?? 0;
        const ai = im[a] ?? 0;
        re[b] = ar - xr;
        im[b] = ai - xi;
        re[a] = ar + xr;
        im[a] = ai + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}
/** A fresh channel state: Hann analysis and synthesis windows, frame size `n`, hop `hop`. */
export function createStftState(n: number, hop: number, sr: number, seed: number): StftState {
  const win = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    win[i] = w;
    sum += w * w;
  }
  const bins = n / 2 + 1;
  const s = seed | 0;
  return {
    n,
    hop,
    sr,
    scale: hop / sum,
    ring: new Float64Array(n),
    ringPos: 0,
    count: 0,
    acc: new Float64Array(n),
    outQ: new Float64Array(hop),
    outIdx: 0,
    re: new Float64Array(n),
    im: new Float64Array(n),
    win,
    mag: new Float64Array(bins),
    avg: new Float64Array(bins),
    frozen: new Float64Array(bins),
    fphase: new Float64Array(bins),
    smag: new Float64Array(bins),
    sphase: new Float64Array(bins),
    capFrames: 0,
    capEnergy: 0,
    rng: s === 0 ? 0x2545f491 : s,
    fade: 1,
    mode: 0,
  };
}
/**
 * Processes one block through the short-time spectral processor (TS-79). Output lags input by
 * exactly one frame. A null input means the source has gone away; a freeze then fades out.
 */
export function stftBlock(
  st: StftState,
  input: Float32Array | null,
  output: Float32Array,
  p: SpectralParams,
  fft: (re: Float64Array, im: Float64Array, inverse: boolean) => void,
): void {
  const n = st.n;
  const hop = st.hop;
  const half = n / 2;
  const tau = 2 * Math.PI;
  const mode = Math.round(p.mode);
  if (mode !== st.mode) {
    st.mode = mode;
    st.capFrames = 0;
    st.capEnergy = 0;
    st.fade = 1;
  }
  const amount = Math.min(1, Math.max(0, p.amount));
  const re = st.re;
  const im = st.im;
  const win = st.win;
  const mag = st.mag;
  const ring = st.ring;
  const acc = st.acc;
  for (let i = 0; i < output.length; i++) {
    output[i] = st.outQ[st.outIdx] ?? 0;
    st.outIdx++;
    ring[st.ringPos] = input === null ? 0 : (input[i] ?? 0);
    st.ringPos = (st.ringPos + 1) % n;
    st.count++;
    if (st.count < hop) continue;
    st.count = 0;
    st.outIdx = 0;
    if (input === null) st.fade = Math.max(0, st.fade - 0.1);
    for (let j = 0; j < n; j++) {
      re[j] = (ring[(st.ringPos + j) % n] ?? 0) * (win[j] ?? 0);
      im[j] = 0;
    }
    fft(re, im, false);
    if (mode > 0 && amount > 0) {
      let energy = 0;
      for (let k = 0; k <= half; k++) {
        const a = re[k] ?? 0;
        const b = im[k] ?? 0;
        const m2 = a * a + b * b;
        energy += m2;
        mag[k] = Math.sqrt(m2);
      }
      if (mode === 1) {
        // freeze: hold the loudest of the first four sounding frames
        if (energy > 1e-9 && st.capFrames < 4) {
          st.capFrames++;
          if (energy > st.capEnergy) {
            st.capEnergy = energy;
            st.frozen.set(mag);
          }
        }
        const f = amount * st.fade;
        for (let k = 0; k <= half; k++) {
          const ph = ((st.fphase[k] ?? 0) + (tau * k * hop) / n) % tau;
          st.fphase[k] = ph;
          const m = st.frozen[k] ?? 0;
          re[k] = (1 - f) * (re[k] ?? 0) + f * m * Math.cos(ph);
          im[k] = (1 - f) * (im[k] ?? 0) + f * m * Math.sin(ph);
        }
      } else if (mode === 2) {
        // blur: magnitudes smoothed over time, live phases
        const c = 0.99 * amount;
        for (let k = 0; k <= half; k++) {
          const m = mag[k] ?? 0;
          const v = (st.avg[k] ?? 0) * c + m * (1 - c);
          st.avg[k] = v;
          if (m > 1e-20) {
            re[k] = ((re[k] ?? 0) * v) / m;
            im[k] = ((im[k] ?? 0) * v) / m;
          } else {
            re[k] = v;
            im[k] = 0;
          }
        }
      } else if (mode === 3) {
        // gate: bins below the threshold are removed; a full-scale sine peaks at n/4
        const thr = (n / 4) * 10 ** (Math.min(0, Math.max(-90, p.gate)) / 20);
        for (let k = 0; k <= half; k++) {
          if ((mag[k] ?? 0) < thr) {
            re[k] = (re[k] ?? 0) * (1 - amount);
            im[k] = (im[k] ?? 0) * (1 - amount);
          }
        }
      } else if (mode === 4) {
        // robot: every phase set to zero
        for (let k = 0; k <= half; k++) {
          re[k] = (1 - amount) * (re[k] ?? 0) + amount * (mag[k] ?? 0);
          im[k] = (1 - amount) * (im[k] ?? 0);
        }
      } else if (mode === 5) {
        // whisper: seeded random phases
        let x = st.rng;
        for (let k = 0; k <= half; k++) {
          x ^= x << 13;
          x ^= x >>> 17;
          x ^= x << 5;
          const ph = ((x >>> 0) / 4294967296) * tau;
          const m = mag[k] ?? 0;
          re[k] = (1 - amount) * (re[k] ?? 0) + amount * m * Math.cos(ph);
          im[k] = (1 - amount) * (im[k] ?? 0) + amount * m * Math.sin(ph);
        }
        st.rng = x;
      } else if (mode === 6) {
        // comb: keep bins near multiples of the spacing
        const spacing = Math.min(2000, Math.max(20, p.comb));
        for (let k = 0; k <= half; k++) {
          const h = (k * st.sr) / n / spacing;
          let w = 0;
          if (h >= 0.5) w = Math.max(0, 1 - 4 * Math.abs(h - Math.round(h)));
          const g = 1 - amount + amount * w;
          re[k] = (re[k] ?? 0) * g;
          im[k] = (im[k] ?? 0) * g;
        }
      } else if (mode === 7) {
        // shift: move magnitudes to scaled bins, resynthesise with bin-centre phases
        const r = 2 ** (Math.min(24, Math.max(-24, p.shift)) / 12);
        st.smag.fill(0);
        for (let k = 0; k <= half; k++) {
          const j = Math.round(k * r);
          if (j <= half) st.smag[j] = (st.smag[j] ?? 0) + (mag[k] ?? 0);
        }
        for (let j = 0; j <= half; j++) {
          const ph = ((st.sphase[j] ?? 0) + (tau * j * hop) / n) % tau;
          st.sphase[j] = ph;
          const m = st.smag[j] ?? 0;
          re[j] = (1 - amount) * (re[j] ?? 0) + amount * m * Math.cos(ph);
          im[j] = (1 - amount) * (im[j] ?? 0) + amount * m * Math.sin(ph);
        }
      }
      im[0] = 0;
      im[half] = 0;
      for (let k = 1; k < half; k++) {
        re[n - k] = re[k] ?? 0;
        im[n - k] = -(im[k] ?? 0);
      }
    }
    fft(re, im, true);
    for (let j = 0; j < n; j++) acc[j] = (acc[j] ?? 0) + (re[j] ?? 0) * (win[j] ?? 0) * st.scale;
    for (let j = 0; j < hop; j++) st.outQ[j] = acc[j] ?? 0;
    acc.copyWithin(0, hop);
    acc.fill(0, n - hop);
  }
}
// ---- Impulse-response filters (TS-81 to TS-85)
/** Kernel lengths for `firlen`. All are odd, so the delay is a whole number of samples. */
export const FIR_TAPS: ReadonlyMap<string, number> = new Map([
  ['short', 255],
  ['medium', 1023],
  ['long', 4095],
]);
/** Kaiser window shape: about 63 dB of stop-band attenuation. */
export const FIR_KAISER_BETA = 6;
const FIR_DESIGN_SET: ReadonlySet<string> = new Set(FIR_DESIGNS);
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}
export function kaiserWindow(n: number, beta = FIR_KAISER_BETA): Float64Array {
  const w = new Float64Array(n);
  const m = n - 1;
  const d = besselI0(beta);
  for (let i = 0; i < n; i++) {
    const r = m > 0 ? (2 * i) / m - 1 : 0;
    w[i] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / d;
  }
  return w;
}
/** A windowed ideal low-pass at `fc` (a fraction of the sample rate), with unit gain at DC. */
function lowpassKernel(taps: number, fc: number, win: Float64Array): Float64Array {
  const h = new Float64Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - m;
    const v = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const y = v * (win[i] ?? 0);
    h[i] = y;
    sum += y;
  }
  if (sum !== 0) for (let i = 0; i < taps; i++) h[i] = (h[i] ?? 0) / sum;
  return h;
}
/** Magnitude response of a kernel at `f`, a fraction of the sample rate. */
export function firResponse(h: ArrayLike<number>, f: number): number {
  let re = 0;
  let im = 0;
  const w = 2 * Math.PI * f;
  for (let i = 0; i < h.length; i++) {
    const v = h[i] ?? 0;
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return Math.hypot(re, im);
}
/**
 * A linear-phase FIR kernel (TS-81): a Kaiser-windowed sinc. High-pass and band-stop come from
 * spectral inversion; band-pass is the difference of two low-passes, normalised at its centre.
 * `width` is in octaves around `freq` for the band designs.
 */
export function firKernel(
  design: string,
  freq: number,
  width: number,
  taps: number,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  const n = taps % 2 === 1 ? taps : taps + 1;
  const nyq = sampleRate / 2;
  const fr = (hz: number): number => clamp(hz, 10, nyq * 0.98) / sampleRate;
  const win = kaiserWindow(n);
  const m = (n - 1) / 2;
  let h: Float64Array;
  if (design === 'lowpass' || design === 'highpass') {
    h = lowpassKernel(n, fr(freq), win);
    if (design === 'highpass') {
      for (let i = 0; i < n; i++) h[i] = -(h[i] ?? 0);
      h[m] = (h[m] ?? 0) + 1;
    }
  } else {
    const half = 2 ** (clamp(width, 0.1, 4) / 2);
    const lo = lowpassKernel(n, fr(freq / half), win);
    const hi = lowpassKernel(n, fr(freq * half), win);
    h = new Float64Array(n);
    for (let i = 0; i < n; i++) h[i] = (hi[i] ?? 0) - (lo[i] ?? 0);
    const g = firResponse(h, fr(freq));
    if (g > 1e-6) for (let i = 0; i < n; i++) h[i] = (h[i] ?? 0) / g;
    if (design === 'bandstop') {
      for (let i = 0; i < n; i++) h[i] = -(h[i] ?? 0);
      h[m] = (h[m] ?? 0) + 1;
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = h[i] ?? 0;
  return out;
}
/** The delay of a linear-phase kernel, in samples. */
export function firLatency(taps: number): number {
  return (taps - 1) / 2;
}
/** Rounds a frequency to the nearest quarter-tone, for the kernel cache (TS-81). */
export function quarterTone(hz: number): number {
  const f = clamp(hz, 20, 20000);
  return 440 * 2 ** (Math.round(24 * Math.log2(f / 440)) / 24);
}
export interface FirSpec {
  readonly design: string;
  readonly len: string;
  readonly taps: number;
  readonly freq: number;
  readonly width: number;
}
/** The quantised FIR settings of an event, or null when it has no FIR stage (TS-81). */
export function firSpec(c: Readonly<Record<string, unknown>>): FirSpec | null {
  const design = typeof c.fir === 'string' && FIR_DESIGN_SET.has(c.fir) ? c.fir : 'none';
  if (design === 'none') return null;
  const len = typeof c.firlen === 'string' && FIR_TAPS.has(c.firlen) ? c.firlen : 'medium';
  return {
    design,
    len,
    taps: FIR_TAPS.get(len) ?? 1023,
    freq: quarterTone(finite(c.firfreq, 1000)),
    width: Math.round(clamp(finite(c.firwidth, 1), 0.1, 4) * 4) / 4,
  };
}
function normalizeEnergy(out: Float32Array): void {
  let e = 0;
  for (const v of out) e += v * v;
  if (e <= 0) return;
  const g = 1 / Math.sqrt(e);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * g;
}
/** One resonance of a body: frequency in hertz, time to fall 60 dB in seconds, amplitude. */
type BodyMode = readonly [number, number, number];
export interface BodySpec {
  readonly modes: readonly BodyMode[];
  readonly noise: number;
  readonly noiseDecay: number;
  readonly seconds: number;
}
export const BODY_MAX_SECONDS = 0.1;
/** Generated bodies, designed from published descriptions of each resonator (TS-82). */
export const BODY_SPECS: ReadonlyMap<string, BodySpec> = new Map<string, BodySpec>([
  [
    'box',
    {
      modes: [
        [180, 0.04, 1],
        [310, 0.03, 0.7],
        [470, 0.025, 0.5],
        [690, 0.02, 0.35],
      ],
      noise: 0.1,
      noiseDecay: 0.01,
      seconds: 0.06,
    },
  ],
  [
    'guitar',
    {
      modes: [
        [100, 0.08, 1],
        [200, 0.06, 0.9],
        [390, 0.04, 0.5],
        [580, 0.03, 0.4],
        [850, 0.02, 0.3],
        [1300, 0.015, 0.25],
        [2600, 0.01, 0.2],
      ],
      noise: 0.2,
      noiseDecay: 0.008,
      seconds: 0.1,
    },
  ],
  [
    'violin',
    {
      modes: [
        [280, 0.05, 0.8],
        [460, 0.04, 1],
        [700, 0.035, 0.7],
        [1000, 0.03, 0.6],
        [1500, 0.025, 0.5],
        [2100, 0.02, 0.7],
        [2500, 0.02, 0.9],
        [2900, 0.015, 0.6],
        [3400, 0.012, 0.3],
      ],
      noise: 0.1,
      noiseDecay: 0.005,
      seconds: 0.08,
    },
  ],
  [
    'tube',
    {
      modes: [
        [220, 0.06, 1],
        [440, 0.05, 0.6],
        [660, 0.045, 0.45],
        [880, 0.04, 0.3],
        [1100, 0.035, 0.2],
      ],
      noise: 0.05,
      noiseDecay: 0.005,
      seconds: 0.1,
    },
  ],
  [
    'can',
    {
      modes: [
        [540, 0.06, 1],
        [1270, 0.05, 0.8],
        [2030, 0.04, 0.7],
        [3150, 0.035, 0.5],
        [4400, 0.03, 0.4],
      ],
      noise: 0.15,
      noiseDecay: 0.004,
      seconds: 0.09,
    },
  ],
  [
    'phone',
    {
      modes: [
        [350, 0.01, 0.6],
        [600, 0.012, 0.9],
        [900, 0.012, 1],
        [1300, 0.01, 0.9],
        [1800, 0.01, 0.9],
        [2400, 0.008, 0.8],
        [3000, 0.008, 0.6],
        [3400, 0.006, 0.4],
      ],
      noise: 0.05,
      noiseDecay: 0.003,
      seconds: 0.03,
    },
  ],
  [
    'radio',
    {
      modes: [
        [180, 0.02, 0.5],
        [450, 0.03, 1],
        [800, 0.015, 0.7],
        [1400, 0.012, 0.7],
        [2500, 0.01, 0.6],
        [4000, 0.008, 0.3],
      ],
      noise: 0.1,
      noiseDecay: 0.004,
      seconds: 0.05,
    },
  ],
  [
    'megaphone',
    {
      modes: [
        [600, 0.03, 0.7],
        [1100, 0.04, 1],
        [1700, 0.035, 0.9],
        [2300, 0.03, 0.8],
        [3100, 0.02, 0.5],
      ],
      noise: 0.1,
      noiseDecay: 0.004,
      seconds: 0.07,
    },
  ],
]);
/** Length in samples of a body response, at most BODY_MAX_SECONDS. */
export function bodySamples(body: string, sampleRate: number): number {
  const spec = BODY_SPECS.get(body);
  return Math.max(1, Math.round(Math.min(BODY_MAX_SECONDS, spec?.seconds ?? 0.01) * sampleRate));
}
/**
 * A generated body response (TS-82): decaying sinusoids plus seeded noise, normalised to unit
 * energy. `size` above one lowers every mode, below one raises them.
 */
export function bodyResponse(out: Float32Array, sampleRate: number, body: string, size: number, seed: number): void {
  out.fill(0);
  const spec = BODY_SPECS.get(body);
  if (!spec) return;
  const rnd = seededRandom(seed);
  const k = 1 / clamp(size, 0.25, 4);
  const top = sampleRate * 0.45;
  for (const [f0, decay, amp] of spec.modes) {
    const f = f0 * k;
    const ph = Math.PI * rnd();
    if (f >= top) continue;
    const w = (2 * Math.PI * f) / sampleRate;
    const r = 6.9 / (decay * sampleRate);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + amp * Math.exp(-r * i) * Math.sin(w * i + ph);
  }
  if (spec.noise > 0) {
    const r = 6.9 / (spec.noiseDecay * sampleRate);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + spec.noise * rnd() * Math.exp(-r * i);
  }
  normalizeEnergy(out);
}
export interface CabSpec {
  /** Low cut and high cut in hertz. */
  readonly low: number;
  readonly high: number;
  /** Cone resonance in hertz and its level. */
  readonly cone: number;
  readonly coneGain: number;
  /** Box resonance level, near 1.6 times the low cut. */
  readonly box: number;
  readonly seconds: number;
}
export const CAB_MAX_SECONDS = 0.05;
/** Generated speaker cabinets (TS-83). */
export const CABS: ReadonlyMap<string, CabSpec> = new Map<string, CabSpec>([
  ['small', { low: 150, high: 3500, cone: 900, coneGain: 0.5, box: 0.2, seconds: 0.02 }],
  ['open', { low: 90, high: 5000, cone: 120, coneGain: 0.6, box: 0.1, seconds: 0.03 }],
  ['closed', { low: 80, high: 4500, cone: 110, coneGain: 0.9, box: 0.4, seconds: 0.035 }],
  ['combo', { low: 100, high: 4200, cone: 700, coneGain: 0.6, box: 0.3, seconds: 0.03 }],
  ['stack', { low: 70, high: 5500, cone: 95, coneGain: 1, box: 0.5, seconds: 0.045 }],
]);
export function cabSamples(cab: string, sampleRate: number): number {
  const spec = CABS.get(cab);
  return Math.max(1, Math.round(Math.min(CAB_MAX_SECONDS, spec?.seconds ?? 0.01) * sampleRate));
}
/**
 * A generated cabinet response (TS-83): an impulse plus a short seeded noise tail and two
 * resonances, through a one-pole high-pass and two one-pole low-passes. Unit energy.
 */
export function cabResponse(out: Float32Array, sampleRate: number, cab: string, seed: number): void {
  out.fill(0);
  const spec = CABS.get(cab);
  if (!spec) return;
  const rnd = seededRandom(seed);
  const r = 6.9 / (spec.seconds * sampleRate);
  const rc = r / 1.5;
  const aLow = 1 - Math.exp((-2 * Math.PI * spec.low) / sampleRate);
  const aHigh = 1 - Math.exp((-2 * Math.PI * Math.min(spec.high, sampleRate * 0.45)) / sampleRate);
  const wc = (2 * Math.PI * spec.cone) / sampleRate;
  const wb = (2 * Math.PI * spec.low * 1.6) / sampleRate;
  let lowState = 0;
  let l1 = 0;
  let l2 = 0;
  for (let i = 0; i < out.length; i++) {
    const res = Math.exp(-rc * i) * 0.3;
    const x =
      (i === 0 ? 1 : 0) +
      0.4 * rnd() * Math.exp(-r * i) +
      spec.coneGain * res * Math.sin(wc * i) +
      spec.box * res * Math.sin(wb * i);
    lowState += aLow * (x - lowState);
    const hp = x - lowState;
    l1 += aHigh * (hp - l1);
    l2 += aHigh * (l1 - l2);
    out[i] = l2;
  }
  normalizeEnergy(out);
}
// ---- Signal-level response curves (TS-86 to TS-88)
/** Peak level of the reference sine used for gain compensation. */
export const CURVE_REF = 0.5;
const CURVE_LEN = 4096;
const CURVE_SET: ReadonlySet<string> = new Set(CURVE_NAMES);
const ASYMMETRIC: ReadonlySet<string> = new Set(['tube', 'rect', 'half', 'cheby2', 'cheby4', 'cheby6']);
/** A known curve name other than `none`, or undefined. */
export function curveName(v: unknown): string | undefined {
  return typeof v === 'string' && v !== 'none' && CURVE_SET.has(v) ? v : undefined;
}
function curveFn(name: string, x: number): number {
  switch (name) {
    case 'soft': {
      const v = clamp(x, -1, 1);
      return 1.5 * v - 0.5 * v * v * v;
    }
    case 'hard':
      return clamp(x, -1, 1);
    case 'tanh':
      return Math.tanh(x);
    case 'tube':
      return x >= 0 ? Math.tanh(x) : Math.tanh(1.6 * x) / 1.6;
    case 'fold': {
      const y = (((x + 1) % 4) + 4) % 4;
      return y < 2 ? y - 1 : 3 - y;
    }
    case 'rect':
      return Math.min(1, Math.abs(x));
    case 'half':
      return clamp(x, 0, 1);
    default: {
      const k = name.startsWith('cheby') ? Number(name.slice(5)) : NaN;
      if (!(k >= 2 && k <= 7)) return x;
      return Math.cos(k * Math.acos(clamp(x, -1, 1)));
    }
  }
}
/** Reads a waveshaper table at `x` in [-1, 1] with linear interpolation, as a WaveShaperNode does. */
export function curveLookup(table: ArrayLike<number>, x: number): number {
  const len = table.length;
  const pos = ((clamp(x, -1, 1) + 1) / 2) * (len - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const a = table[i] ?? 0;
  const b = table[Math.min(len - 1, i + 1)] ?? a;
  return a + (b - a) * f;
}
export interface CurveTable {
  /** Within [-1, 1]; zero input gives zero output. */
  readonly table: Float32Array<ArrayBuffer>;
  /** Gain that gives a reference sine the same RMS as without the curve. */
  readonly makeup: number;
  /** True when the curve can produce DC, so a DC blocker should follow. */
  readonly asymmetric: boolean;
}
/**
 * A transfer curve with drive (dB) and bias baked in (TS-86). The table is f(g·u + b) − f(b),
 * normalised to full scale; `makeup` restores the RMS of a sine at CURVE_REF.
 */
export function curveTable(name: string, driveDb: number, bias: number, length = CURVE_LEN): CurveTable {
  const g = 10 ** (clamp(driveDb, 0, 24) / 20);
  const b = clamp(bias, -0.5, 0.5);
  const f0 = curveFn(name, b);
  const table = new Float32Array(length);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const u = (i / (length - 1)) * 2 - 1;
    const v = curveFn(name, g * u + b) - f0;
    table[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak > 1) for (let i = 0; i < length; i++) table[i] = (table[i] ?? 0) / peak;
  const n = 1024;
  let si = 0;
  let so = 0;
  for (let k = 0; k < n; k++) {
    const x = CURVE_REF * Math.sin((2 * Math.PI * k) / n);
    const y = curveLookup(table, x);
    si += x * x;
    so += y * y;
  }
  const makeup = so > 1e-12 ? clamp(Math.sqrt(si / so), 0.25, 4) : 1;
  return { table, makeup, asymmetric: b !== 0 || ASYMMETRIC.has(name) };
}
/**
 * Bends the linear segments of an envelope (TS-88). `exp` changes fast and then slowly, `log`
 * slowly and then fast; each changing segment becomes `steps` linear pieces. Breakpoints keep
 * their times and levels.
 */
export function shapeEnvelope(
  pts: readonly (readonly [number, number])[],
  shape: string,
  steps = 8,
): [number, number][] {
  if (shape !== 'exp' && shape !== 'log') return pts.map(([t, v]) => [t, v]);
  const k = 5;
  const f =
    shape === 'exp'
      ? (x: number): number => (1 - Math.exp(-k * x)) / (1 - Math.exp(-k))
      : (x: number): number => (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
  const out: [number, number][] = [];
  const first = pts[0];
  if (!first) return out;
  out.push([first[0], first[1]]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] ?? first;
    const b = pts[i] ?? a;
    if (b[1] === a[1] || b[0] <= a[0]) {
      out.push([b[0], b[1]]);
      continue;
    }
    for (let s = 1; s <= steps; s++) {
      const x = s / steps;
      out.push([a[0] + (b[0] - a[0]) * x, a[1] + (b[1] - a[1]) * f(x)]);
    }
  }
  return out;
}
/** State of the per-voice gate (TS-87). */
export interface GateState {
  env: number;
  gain: number;
}
// The gate functions below are also the source of the gate worklet (gate-worklet.ts).
// They must stay self-contained: no references to module-level names, no inner functions.
export function createGateState(): GateState {
  return { env: 0, gain: 0 };
}
/**
 * Processes one block through the gate: a peak follower (50 ms release) opens the gate within
 * about 1 ms when it reaches the threshold and closes it over `release` seconds. All channels
 * share one gain.
 */
export function gateBlock(
  st: GateState,
  input: readonly Float32Array[],
  output: readonly Float32Array[],
  thresholdDb: number,
  release: number,
  sr: number,
): void {
  const frames = output[0] ? output[0].length : 0;
  const thr = 10 ** (Math.min(0, Math.max(-90, thresholdDb)) / 20);
  const envRel = Math.exp(-1 / (0.05 * sr));
  const open = 1 - Math.exp(-1 / (0.001 * sr));
  const close = 1 - Math.exp(-1 / (Math.min(1, Math.max(0.005, release)) * sr));
  for (let i = 0; i < frames; i++) {
    let peak = 0;
    for (let c = 0; c < input.length; c++) {
      const v = Math.abs(input[c]?.[i] ?? 0);
      if (v > peak) peak = v;
    }
    st.env = peak > st.env ? peak : st.env * envRel;
    const target = st.env >= thr ? 1 : 0;
    st.gain += (target - st.gain) * (target > st.gain ? open : close);
    for (let c = 0; c < output.length; c++) {
      const out = output[c];
      if (!out) continue;
      const src = input[c] ?? input[0];
      const x = src ? (src[i] ?? 0) : 0;
      out[i] = Number.isFinite(x) ? x * st.gain : 0;
    }
  }
}
