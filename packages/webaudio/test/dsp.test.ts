// Pure DSP helpers behind Tier 0 and Tier 1 (TS-41, TS-42). Expectations come from the maths.
import { describe, expect, it } from 'vitest';
import { CONSONANTS, VOWELS } from '@tartlet/registry';
import {
  CONSONANT_SPECS,
  FORMANTS,
  TIMBRES,
  crushCurve,
  envelope,
  fillNoise,
  formantBank,
  glottalWave,
  nasalBank,
  partialTable,
  pulseWave,
  seededRandom,
  shapeCurve,
  softSquareWave,
  splitWaves,
  timbreWave,
  unisonOffsets,
} from '../src/dsp';

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
