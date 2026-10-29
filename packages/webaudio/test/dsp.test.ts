// Pure DSP helpers behind Tier 0 and Tier 1 (TS-41, TS-42). Expectations come from the maths.
import { describe, expect, it } from 'vitest';
import { CONSONANTS, SPACE_NAMES, VOWELS } from '@tartlet/registry';
import {
  CONSONANT_SPECS,
  FORMANTS,
  SPACES,
  TIMBRES,
  airCutoff,
  crushCurve,
  distanceWet,
  earlyTaps,
  envelope,
  fillNoise,
  formantBank,
  glottalWave,
  grainSchedule,
  microEvents,
  nasalBank,
  occlusion,
  partialTable,
  pulseWave,
  renderPeriodic,
  seededRandom,
  shapeCurve,
  smoothCurve,
  softSquareWave,
  spaceImpulse,
  spaceSeconds,
  splitWaves,
  swellCurve,
  timbreWave,
  unisonOffsets,
} from '../src/dsp';
import {
  STFT_HOP,
  STFT_SIZE,
  createStftState,
  fftInPlace,
  fshiftSinGain,
  hilbertPhaseDifference,
  hilbertSections,
  spectralModeIndex,
  spectralSettings,
  stftBlock,
  tiltShelves,
  type IirSection,
  type SpectralParams,
} from '../src/dsp';
import { SPECTRAL_WORKLET_SOURCE } from '../src/spectral-worklet';
import { SPECTRAL_MODES } from '@tartlet/registry';
import { BODY_NAMES, CAB_NAMES, FIR_DESIGNS, FIR_LENGTHS } from '@tartlet/registry';
import {
  BODY_SPECS,
  CABS,
  FIR_TAPS,
  bodyResponse,
  bodySamples,
  cabResponse,
  cabSamples,
  firKernel,
  firLatency,
  firResponse,
  firSpec,
  quarterTone,
} from '../src/dsp';
import { CURVE_NAMES, ENVCURVE_NAMES } from '@tartlet/registry';
import { CURVE_REF, createGateState, curveLookup, curveName, curveTable, gateBlock, shapeEnvelope } from '../src/dsp';

describe('dsp helpers', () => {
  it('envelope holds at the sustain level for long notes', () => {
    const pts = envelope(0, 2, { a: 0.1, d: 0.2, s: 0.5, r: 0.4 }, 1);
    expect(pts).toEqual([
      [0, 0],
      [0.1, 1],
      [0.30000000000000004, 0.5],
      [2, 0.5],
      [2.4, 0],
    ]);
  });
  it('envelope releases from mid-decay for short notes', () => {
    const pts = envelope(0, 0.2, { a: 0.1, d: 0.2, s: 0, r: 0.1 }, 1);
    expect(pts[pts.length - 2]?.[1]).toBeCloseTo(0.5, 9);
    expect(pts[pts.length - 1]?.[0]).toBeCloseTo(0.3, 9);
  });
  it('envelope with full sustain has no decay stage', () => {
    expect(envelope(1, 1, { a: 0.01, d: 0.3, s: 1, r: 0.1 }, 0.3)).toHaveLength(4);
  });
  it('a pulse wave with duty one half is a square', () => {
    const w = pulseWave(0.5, 8);
    expect(w.imag[1]).toBeCloseTo(4 / Math.PI, 5);
    expect(w.imag[2]).toBeCloseTo(0, 5);
    expect(w.imag[3]).toBeCloseTo(4 / (3 * Math.PI), 5);
    for (const r of w.real) expect(Math.abs(r)).toBeLessThan(1e-6);
  });
  it('noise is deterministic and bounded', () => {
    for (const kind of ['white', 'pink', 'brown'] as const) {
      const a = new Float32Array(4096);
      const b = new Float32Array(4096);
      fillNoise(kind, a);
      fillNoise(kind, b);
      expect(a).toEqual(b);
      for (const v of a) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    const p = new Float32Array(4096);
    fillNoise('pink', p);
    expect(Math.max(...p.map(Math.abs))).toBeCloseTo(0.9, 5);
  });
  it('crush curves step to the requested depth', () => {
    expect(new Set(crushCurve(1, 101))).toEqual(new Set([-1, 0, 1]));
    const fine = crushCurve(16, 101);
    fine.forEach((v, i) => {
      expect(v).toBeCloseTo((i / 100) * 2 - 1, 3);
    });
  });
  it('shape curves are odd, monotone and bounded', () => {
    const c = shapeCurve(0.5, 101);
    for (let i = 0; i < 101; i++) {
      expect(c[i]).toBeCloseTo(-(c[100 - i] ?? 0), 6);
      expect(Math.abs(c[i] ?? 0)).toBeLessThanOrEqual(1);
      if (i > 0) expect(c[i] ?? 0).toBeGreaterThanOrEqual(c[i - 1] ?? 0);
    }
  });
  it('unison spreads copies evenly around the note', () => {
    expect(unisonOffsets(1, 20)).toEqual([0]);
    expect(unisonOffsets(3, 20)).toEqual([-10, 0, 10]);
  });
  it('named timbres and vowels', () => {
    expect(timbreWave('nope')).toBeNull();
    expect(timbreWave('organ')?.imag[1]).toBe(1);
    expect([...TIMBRES.keys()]).toEqual(['organ', 'hollow', 'bright', 'soft', 'reed', 'glass']);
    for (const v of ['a', 'e', 'i', 'o', 'u']) expect(FORMANTS.get(v)).toHaveLength(3);
  });
  it('every vowel and consonant of the singing alphabet has a rendering table (TS-45)', () => {
    expect(new Set(FORMANTS.keys())).toEqual(new Set(VOWELS));
    expect(new Set(CONSONANT_SPECS.keys())).toEqual(new Set(CONSONANTS));
    for (const s of CONSONANT_SPECS.values()) if (s.kind === 'approximant') expect(VOWELS).toContain(s.locus);
  });
  it('formant banks follow voice type, shift and vowel (TS-43)', () => {
    const tenor = formantBank('ah');
    expect(tenor).toHaveLength(5);
    expect(formantBank('ah', 'child')[0]![0]).toBeGreaterThan(tenor[0]![0]);
    expect(formantBank('ah', 'bass')[0]![0]).toBeLessThan(tenor[0]![0]);
    expect(formantBank('ah', 'tenor', 12)[0]![0]).toBeCloseTo(tenor[0]![0] * 2, 6);
    expect(formantBank('zz')).toEqual(tenor);
    expect(formantBank('i')[1]![0]).toBeGreaterThan(formantBank('oo')[1]![0]);
    expect(nasalBank()[1]![1]).toBeLessThan(0.1);
  });
  it('the glottal source is darker at low effort', () => {
    expect(glottalWave(0.5).imag[1]).toBe(1);
    expect(glottalWave(0).imag[4]!).toBeLessThan(glottalWave(1).imag[4]!);
  });
  it('earsplit harmonics alternates partials between the ears (TS-65)', () => {
    const saw = partialTable('sawtooth', 8)!;
    const { left, right } = splitWaves(saw);
    for (let n = 1; n <= 8; n++) {
      if (n % 2 === 1) {
        expect(left.imag[n]).not.toBe(0);
        expect(right.imag[n]).toBe(0);
      } else {
        expect(left.imag[n]).toBe(0);
        expect(right.imag[n]).not.toBe(0);
      }
    }
    const g = left.imag[1]! / saw[0]!;
    for (let n = 1; n <= 8; n++) expect(left.imag[n]! + right.imag[n]!).toBeCloseTo(saw[n - 1]! * g, 5);
    let peak = 0;
    for (let s = 0; s < 1024; s++) {
      const x = (2 * Math.PI * s) / 1024;
      let v = 0;
      for (let n = 1; n <= 8; n++) v += (left.imag[n]! + right.imag[n]!) * Math.sin(n * x);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThan(1.01);
    const sq = splitWaves(partialTable('square', 8)!);
    expect(sq.left.imag[1]).not.toBe(0);
    expect(sq.left.imag[3]).toBe(0);
    expect(sq.right.imag[3]).not.toBe(0);
    expect(sq.left.imag[5]).not.toBe(0);
    expect(partialTable('white')).toBeNull();
  });
  it('the isochronic pulse is a soft square (TS-67)', () => {
    const w = softSquareWave();
    for (const h of [2, 4, 6]) expect(w.imag[h]).toBe(0);
    expect(w.imag[1]!).toBeGreaterThan(w.imag[3]!);
    expect(w.imag[3]!).toBeGreaterThan(w.imag[5]!);
    expect(w.imag[7]!).toBeGreaterThan(0);
  });
  it('seeded random is deterministic and bounded', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= -1 && x < 1).toBe(true);
    }
  });
});
describe('space and environment helpers (TS-69 to TS-72)', () => {
  it('every space name has a table', () => {
    expect(new Set(SPACES.keys())).toEqual(new Set(SPACE_NAMES));
  });
  it('space lengths follow the character of each space and grow with size', () => {
    expect(spaceSeconds('hall', 0.5)).toBeGreaterThan(spaceSeconds('room', 0.5));
    expect(spaceSeconds('church', 0.5)).toBeGreaterThan(spaceSeconds('hall', 0.5));
    expect(spaceSeconds('outdoor', 0.5)).toBeLessThan(spaceSeconds('room', 0.5));
    expect(spaceSeconds('room', 1)).toBeGreaterThan(spaceSeconds('room', 0));
  });
  it('impulses are deterministic, finite, delayed and decaying', () => {
    const a = new Float32Array(48000);
    const b = new Float32Array(48000);
    spaceImpulse(a, 48000, 'church', 7);
    spaceImpulse(b, 48000, 'church', 7);
    expect(a).toEqual(b);
    for (const v of a) expect(Number.isFinite(v)).toBe(true);
    expect(a.slice(0, 1900).every((v) => v === 0)).toBe(true);
    const energy = (x: Float32Array) => x.reduce((s, v) => s + v * v, 0);
    expect(energy(a.slice(2000, 14000))).toBeGreaterThan(energy(a.slice(36000)));
  });
  it('early reflections are ordered, bounded and deterministic', () => {
    expect(earlyTaps('plate', 0.5, 1)).toEqual([]);
    const room = earlyTaps('room', 0.5, 3);
    expect(room).toHaveLength(6);
    for (let i = 1; i < room.length; i++) expect(room[i]!.delay).toBeGreaterThanOrEqual(room[i - 1]!.delay);
    for (const t of room) {
      expect(t.delay).toBeGreaterThan(0);
      expect(t.delay).toBeLessThanOrEqual(0.5);
      expect(Math.abs(t.pan)).toBeLessThanOrEqual(1);
    }
    expect(earlyTaps('room', 0.5, 3)).toEqual(room);
    expect(earlyTaps('room', 1, 3)[5]!.delay).toBeGreaterThan(earlyTaps('room', 0, 3)[5]!.delay);
  });
  it('distance darkens and adds reverb; occlusion muffles and softens', () => {
    expect(airCutoff(1)).toBe(20000);
    expect(airCutoff(10)).toBeLessThan(airCutoff(2));
    expect(airCutoff(50)).toBeGreaterThanOrEqual(1200);
    expect(distanceWet(1)).toBe(0);
    expect(distanceWet(10)).toBeGreaterThan(distanceWet(2));
    expect(distanceWet(50)).toBeCloseTo(0.5, 9);
    expect(occlusion(0)).toEqual({ cutoff: 20000, gain: 1 });
    expect(occlusion(1).cutoff).toBeCloseTo(400, 6);
    expect(occlusion(1).gain).toBe(0.5);
  });
});
describe('texture helpers (TS-73 to TS-75)', () => {
  it('micro-events are seeded, ordered, spaced and capped', () => {
    const a = microEvents(11, 10, 10, 1000, 0.02);
    expect(microEvents(11, 10, 10, 1000, 0.02)).toEqual(a);
    expect(a.length).toBeGreaterThan(60);
    expect(a.length).toBeLessThan(140);
    for (let i = 1; i < a.length; i++) expect(a[i]!.at - a[i - 1]!.at).toBeGreaterThanOrEqual(0.02 - 1e-12);
    for (const e of a) {
      expect(e.at).toBeLessThan(10);
      expect(e.v >= 0 && e.v < 1 && e.w >= 0 && e.w < 1).toBe(true);
    }
    expect(microEvents(11, 10, 10, 5)).toHaveLength(5);
    expect(microEvents(11, 10, 0, 5)).toEqual([]);
  });
  it('curves stay in [0, 1] and are deterministic', () => {
    const s = smoothCurve(5, 200, 8);
    expect(s).toHaveLength(200);
    expect(smoothCurve(5, 200, 8)).toEqual(s);
    for (const v of s) expect(v >= 0 && v <= 1).toBe(true);
    const w = swellCurve(5, 600, 30, 0.1);
    for (const v of w) expect(v >= 0 && v <= 1).toBe(true);
    expect(Math.min(...w)).toBeLessThan(0.1);
    expect(Math.max(...w)).toBeGreaterThan(0.9);
  });
  it('grains fit their source and follow density', () => {
    const g = grainSchedule(3, 2, 20, 0.05, 0.5, 0.5, 1, 1000);
    expect(g.length).toBeGreaterThan(35);
    expect(g.length).toBeLessThanOrEqual(41);
    for (const x of g) {
      expect(x.offset).toBeGreaterThanOrEqual(0);
      expect(x.offset + x.len).toBeLessThanOrEqual(1 + 1e-9);
    }
    const steady = grainSchedule(3, 1, 10, 0.05, 0.25, 0, 1, 1000);
    steady.forEach((x, i) => {
      expect(x.at).toBeCloseTo(i / 10, 9);
      expect(x.offset).toBeCloseTo(0.25 * 0.95, 9);
    });
    expect(grainSchedule(3, 100, 200, 0.05, 0, 0, 1, 256)).toHaveLength(256);
  });
  it('periodic buffers repeat every period and stay below full scale', () => {
    const b = renderPeriodic('sawtooth', 480, 48000, 0.01);
    for (let i = 0; i < 300; i++) expect(b[i + 100]).toBeCloseTo(b[i]!, 4);
    expect(Math.max(...b.map(Math.abs))).toBeCloseTo(0.9, 5);
  });
});
const SR = 48000;
/** Amplitude of the component at `f` in x[from..], by a single-bin DFT. */
const amp = (x: ArrayLike<number>, f: number, from: number): number => {
  let re = 0;
  let im = 0;
  for (let i = from; i < x.length; i++) {
    const a = (2 * Math.PI * f * i) / SR;
    re += x[i]! * Math.cos(a);
    im -= x[i]! * Math.sin(a);
  }
  return (2 * Math.hypot(re, im)) / (x.length - from);
};
/** Direct-form IIR filtering, for simulating the shifter in Node. */
const iir = (s: IirSection, x: Float64Array): Float64Array => {
  const y = new Float64Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let v = 0;
    s.feedforward.forEach((b, k) => {
      if (n - k >= 0) v += b * x[n - k]!;
    });
    s.feedback.forEach((a, k) => {
      if (k > 0 && n - k >= 0) v -= a * y[n - k]!;
    });
    y[n] = v / s.feedback[0]!;
  }
  return y;
};
describe('frequency-domain shaping (TS-77, TS-78)', () => {
  it('tilt is a staircase of shelves that keeps 1 kHz level', () => {
    const staircase = (s: number, f: number): number => {
      const t = tiltShelves(s);
      return t.shelves.reduce((g, x) => g + (f > x.freq ? x.gain : 0), t.makeup);
    };
    expect(tiltShelves(3).shelves).toHaveLength(4);
    expect(staircase(3, 1000)).toBe(0);
    expect(staircase(3, 20000)).toBe(6);
    expect(staircase(3, 20)).toBe(-6);
    expect(staircase(-6, 20000)).toBe(-12);
  });
  it('the all-pass chains are stable and 90° apart across the band', () => {
    const { first, second } = hilbertSections();
    for (const s of [...first, ...second]) {
      const b = -s.feedback[2]!;
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThan(1);
    }
    const d0 = hilbertPhaseDifference(0.125);
    expect(Math.abs(Math.abs(d0) - Math.PI / 2)).toBeLessThan(0.01);
    for (let f = 300; f <= 15000; f *= 1.25) {
      expect(Math.abs(hilbertPhaseDifference(f / SR) - d0)).toBeLessThan(0.035);
    }
  });
  it('a simulated frequency shift moves a tone by the requested hertz', () => {
    const shiftTone = (shift: number): Float64Array => {
      const len = 24000;
      const x = Float64Array.from({ length: len }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR));
      const { first, second } = hilbertSections();
      const p1 = first.reduce<Float64Array>((y, s) => iir(s, y), x);
      const p2 = second.reduce<Float64Array>((y, s) => iir(s, y), x);
      const w = (2 * Math.PI * Math.abs(shift)) / SR;
      const g = fshiftSinGain(shift);
      return Float64Array.from({ length: len }, (_, i) => p1[i]! * Math.cos(w * i) + g * p2[i]! * Math.sin(w * i));
    };
    const up = shiftTone(200);
    expect(amp(up, 1200, 4800)).toBeGreaterThan(0.9);
    expect(amp(up, 800, 4800)).toBeLessThan(0.03);
    const down = shiftTone(-200);
    expect(amp(down, 800, 4800)).toBeGreaterThan(0.9);
    expect(amp(down, 1200, 4800)).toBeLessThan(0.03);
  });
});
describe('short-time spectral processing (TS-79)', () => {
  const params = (over: Partial<SpectralParams> = {}): SpectralParams => ({
    mode: 0,
    amount: 1,
    gate: -40,
    comb: 110,
    shift: 0,
    ...over,
  });
  const run = (x: Float32Array, p: SpectralParams, seed = 1): Float32Array => {
    const st = createStftState(STFT_SIZE, STFT_HOP, SR, seed);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i += 128)
      stftBlock(st, x.subarray(i, i + 128), y.subarray(i, i + 128), p, fftInPlace);
    return y;
  };
  it('mode names map to kernel indices', () => {
    SPECTRAL_MODES.forEach((m, i) => {
      expect(spectralModeIndex(m)).toBe(i);
    });
    expect(spectralModeIndex('nope')).toBe(0);
    expect(spectralSettings({})).toEqual({ mode: 0, amount: 1, gate: -40, comb: 110, shift: 0 });
    expect(spectralSettings({ spectral: 'comb', scomb: 5000 }).comb).toBe(2000);
  });
  it('analysis and synthesis reconstruct the input one frame later', () => {
    const rnd = seededRandom(9);
    const x = Float32Array.from({ length: 8192 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR) + 0.1 * rnd());
    const y = run(x, params());
    let err = 0;
    for (let t = STFT_SIZE; t < x.length; t++) err = Math.max(err, Math.abs(y[t]! - x[t - STFT_SIZE]!));
    expect(err).toBeLessThan(1e-6);
  });
  it('gate removes quiet partials and keeps loud ones', () => {
    const x = Float32Array.from(
      { length: 16384 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR) + 0.002 * Math.sin((2 * Math.PI * 5000 * i) / SR),
    );
    const y = run(x, params({ mode: 3, gate: -30 }));
    expect(amp(y, 1000, 4096)).toBeGreaterThan(0.45);
    expect(amp(y, 5000, 4096)).toBeLessThan(0.0003);
  });
  it('freeze keeps sounding after the input stops', () => {
    const x = Float32Array.from({ length: 16384 }, (_, i) =>
      i < 4096 ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0,
    );
    const rms = (y: Float32Array): number => Math.sqrt(y.slice(10240).reduce((s, v) => s + v * v, 0) / (16384 - 10240));
    expect(rms(run(x, params({ mode: 1 })))).toBeGreaterThan(0.02);
    expect(rms(run(x, params()))).toBeLessThan(1e-6);
  });
  it('whisper is deterministic for a seed', () => {
    const x = Float32Array.from({ length: 8192 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 330 * i) / SR));
    const a = run(x, params({ mode: 5 }), 7);
    expect(run(x, params({ mode: 5 }), 7)).toEqual(a);
    expect(run(x, params({ mode: 5 }), 8)).not.toEqual(a);
    for (const v of a) expect(Number.isFinite(v)).toBe(true);
  });
  it('the worklet source is built from the kernel', () => {
    expect(SPECTRAL_WORKLET_SOURCE).toContain('registerProcessor("tartlet-spectral"');
    expect(SPECTRAL_WORKLET_SOURCE).not.toContain('[native code]');
  });
});
describe('impulse-response filters (TS-81 to TS-84)', () => {
  const energy = (x: Float32Array): number => x.reduce((s, v) => s + v * v, 0);
  it('tables match the registry', () => {
    expect(new Set(['none', ...BODY_SPECS.keys()])).toEqual(new Set(BODY_NAMES));
    expect(new Set(['none', ...CABS.keys()])).toEqual(new Set(CAB_NAMES));
    expect(new Set(FIR_TAPS.keys())).toEqual(new Set(FIR_LENGTHS));
    expect(FIR_DESIGNS[0]).toBe('none');
  });
  it('low-pass and high-pass kernels are symmetric with the designed gains', () => {
    const lp = firKernel('lowpass', 2000, 1, 255, SR);
    expect(lp).toHaveLength(255);
    for (let i = 0; i < lp.length; i++) expect(lp[i]).toBeCloseTo(lp[lp.length - 1 - i]!, 6);
    expect(firResponse(lp, 0)).toBeCloseTo(1, 5);
    expect(firResponse(lp, 8000 / SR)).toBeLessThan(2e-3);
    const hp = firKernel('highpass', 2000, 1, 255, SR);
    expect(firResponse(hp, 0)).toBeLessThan(2e-3);
    expect(firResponse(hp, 0.5)).toBeCloseTo(1, 2);
  });
  it('band kernels pass or remove their centre', () => {
    const bp = firKernel('bandpass', 1000, 1, 1023, SR);
    expect(firResponse(bp, 1000 / SR)).toBeCloseTo(1, 4);
    expect(firResponse(bp, 100 / SR)).toBeLessThan(0.01);
    expect(firResponse(bp, 8000 / SR)).toBeLessThan(0.01);
    const bs = firKernel('bandstop', 1000, 1, 1023, SR);
    expect(firResponse(bs, 1000 / SR)).toBeLessThan(0.01);
    expect(firResponse(bs, 0)).toBeCloseTo(1, 2);
  });
  it('latency, quantisation and settings', () => {
    expect(firLatency(255)).toBe(127);
    expect(quarterTone(440)).toBe(440);
    expect(quarterTone(453)).toBeCloseTo(440 * 2 ** (1 / 24), 6);
    expect(firSpec({})).toBeNull();
    expect(firSpec({ fir: 'nope' })).toBeNull();
    expect(firSpec({ fir: 'lowpass' })).toMatchObject({ design: 'lowpass', len: 'medium', taps: 1023 });
    expect(firSpec({ fir: 'bandpass', firlen: 'long', firwidth: 1.3 })).toMatchObject({ taps: 4095, width: 1.25 });
  });
  it('body responses are unit energy, bounded, deterministic and follow size', () => {
    for (const name of BODY_SPECS.keys()) {
      const n = bodySamples(name, SR);
      expect(n).toBeLessThanOrEqual(0.1 * SR);
      const a = new Float32Array(n);
      const b = new Float32Array(n);
      bodyResponse(a, SR, name, 1, 5);
      bodyResponse(b, SR, name, 1, 5);
      expect(a).toEqual(b);
      expect(energy(a)).toBeCloseTo(1, 4);
    }
    const zc = (x: Float32Array): number => {
      let k = 0;
      for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 !== x[i]! < 0) k++;
      return k;
    };
    const small = new Float32Array(bodySamples('guitar', SR));
    const large = new Float32Array(bodySamples('guitar', SR));
    bodyResponse(small, SR, 'guitar', 0.5, 1);
    bodyResponse(large, SR, 'guitar', 2, 1);
    expect(zc(large)).toBeLessThan(zc(small));
  });
  it('cabinet responses are unit energy and short', () => {
    for (const name of CABS.keys()) {
      const n = cabSamples(name, SR);
      expect(n).toBeLessThanOrEqual(0.05 * SR);
      const a = new Float32Array(n);
      cabResponse(a, SR, name, 2);
      expect(energy(a)).toBeCloseTo(1, 4);
      for (const v of a) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('space impulses accept a predelay override', () => {
    const a = new Float32Array(SR);
    spaceImpulse(a, SR, 'room', 3, { predelay: 0.08 });
    expect(a.slice(0, 3800).every((v) => v === 0)).toBe(true);
    expect(a.slice(3900, 6000).some((v) => v !== 0)).toBe(true);
  });
});
describe('response curves (TS-86 to TS-88)', () => {
  const rms = (x: ArrayLike<number>): number => {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += (x[i] ?? 0) ** 2;
    return Math.sqrt(s / x.length);
  };
  const named = CURVE_NAMES.filter((n) => n !== 'none');
  it('curve names match the registry', () => {
    for (const n of named) expect(curveName(n)).toBe(n);
    expect(curveName('none')).toBeUndefined();
    expect(curveName('nope')).toBeUndefined();
    expect(ENVCURVE_NAMES).toEqual(['lin', 'exp', 'log']);
  });
  it('tables stay within full scale, and symmetric curves are odd', () => {
    for (const n of named) {
      const { table } = curveTable(n, 12, 0);
      for (const v of table) expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-6);
      expect(curveTable(n, 12, 0).table).toEqual(table);
    }
    for (const n of ['soft', 'hard', 'tanh', 'fold', 'cheby3']) {
      const { table } = curveTable(n, 6, 0);
      for (let i = 0; i < table.length; i++) expect(table[i]).toBeCloseTo(-table[table.length - 1 - i]!, 5);
    }
  });
  it('cheby3 turns a full-scale sine into its third harmonic', () => {
    const { table } = curveTable('cheby3', 0, 0);
    const n = 1024;
    const y = Array.from({ length: n }, (_, k) => curveLookup(table, Math.sin((2 * Math.PI * k) / n)));
    const bin = (h: number): number => {
      let re = 0;
      let im = 0;
      y.forEach((v, k) => {
        re += v * Math.cos((2 * Math.PI * h * k) / n);
        im -= v * Math.sin((2 * Math.PI * h * k) / n);
      });
      return (2 * Math.hypot(re, im)) / n;
    };
    expect(bin(3)).toBeCloseTo(1, 2);
    expect(bin(1)).toBeLessThan(0.01);
  });
  it('makeup keeps the loudness of a reference sine', () => {
    const x = Array.from({ length: 997 }, (_, k) => CURVE_REF * Math.sin((2 * Math.PI * k) / 997));
    for (const n of named) {
      for (const drive of [0, 12, 24]) {
        const { table, makeup } = curveTable(n, drive, 0);
        if (makeup <= 0.25 || makeup >= 4) continue;
        const y = x.map((v) => curveLookup(table, v) * makeup);
        expect(rms(y) / rms(x)).toBeCloseTo(1, 2);
      }
    }
  });
  it('envelope shapes keep their breakpoints', () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.1, 1],
      [1, 0],
    ];
    expect(shapeEnvelope(pts, 'lin')).toEqual(pts);
    const exp = shapeEnvelope(pts, 'exp');
    expect(exp[0]).toEqual([0, 0]);
    expect(exp[exp.length - 1]![0]).toBeCloseTo(1, 9);
    expect(exp[exp.length - 1]![1]).toBeCloseTo(0, 9);
    const mid = exp.find(([t]) => Math.abs(t - 0.55) < 1e-9)!;
    expect(mid[1]).toBeLessThan(0.5);
    const log = shapeEnvelope(pts, 'log');
    expect(log.find(([t]) => Math.abs(t - 0.55) < 1e-9)![1]).toBeGreaterThan(0.5);
  });
  it('the gate passes loud sound and silences quiet sound', () => {
    const sr = 48000;
    const st = createGateState();
    const tone = (amp: number, len: number): Float32Array =>
      Float32Array.from({ length: len }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / sr));
    const loud = tone(0.5, 4800);
    const out = new Float32Array(4800);
    gateBlock(st, [loud], [out], -30, 0.05, sr);
    expect(Math.max(...out.slice(2400).map(Math.abs))).toBeGreaterThan(0.45);
    const quiet = tone(0.005, sr);
    const after = new Float32Array(sr);
    gateBlock(st, [quiet], [after], -30, 0.05, sr);
    expect(Math.max(...after.slice(36000).map(Math.abs))).toBeLessThan(1e-4);
  });
});
