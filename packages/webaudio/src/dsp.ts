// Pure DSP helpers for @tartlet/webaudio (TS-41, TS-42, TS-43). They build no Web Audio objects,
// so they run and are tested in Node. All randomness is a fixed-seed xorshift: identical on
// every machine, and never drawn from Math.random.

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
 */
export function spaceImpulse(out: Float32Array, sampleRate: number, space: string, seed: number): void {
  const spec = SPACES.get(space) ?? ROOM_SPACE;
  const rnd = seededRandom(seed);
  const n = out.length;
  const pre = Math.min(n, Math.round(spec.predelay * sampleRate));
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
    y += (1 - spec.damping * 0.9 * p) * (x - y);
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
