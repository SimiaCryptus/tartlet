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
