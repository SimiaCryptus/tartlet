// Normalisation, manifests, interpreters and host loading (docs/samples.md, TS-91 to TS-93).
// Expectations come from the interpreter rules and the standard, written by hand.
import { describe, expect, it } from 'vitest';
import type { ResourceDecl } from '@tartlet/ir';
import {
  GM_DRUMS,
  PEAK_TARGET,
  SILENCE,
  encodeWav,
  loadSamples,
  measure,
  normalize,
  parseManifestText,
  planImpulse,
  planNote,
  sha256Hex,
  standardIssues,
  type WavData,
} from '../src';

const R = { start: { line: 0, col: 0, byte: 0 }, end: { line: 0, col: 0, byte: 0 } };
const sine = (len: number, amp: number, offset = 0, lead = 0): WavData => ({
  sampleRate: 48000,
  channels: [
    Float32Array.from({ length: lead + len }, (_, i) =>
      i < lead ? 0 : amp * Math.sin((2 * Math.PI * (i - lead)) / 100) + offset,
    ),
  ],
});
const z = (root: number, lo = 0, hi = 127, vlo = 0, vhi = 1) => ({ root, lo, hi, vlo, vhi });

describe('sample standard', () => {
  it('normalises peak, DC and leading silence deterministically', () => {
    const w = normalize(sine(4800, 0.3, 0.1));
    const m = measure(w);
    expect(m.peak).toBeCloseTo(PEAK_TARGET, 5);
    expect(m.dc).toBeLessThan(1e-4);
    expect(standardIssues(sine(4800, 0.3, 0.1), 'impulse').length).toBeGreaterThan(0);
    expect(standardIssues(w, 'impulse')).toEqual([]);
    const trimmed = normalize(sine(4800, 0.5, 0, 2400));
    expect(Math.abs(trimmed.channels[1 - 1]?.[1] ?? 0)).toBeGreaterThan(SILENCE);
    expect(trimmed.channels[0]?.length).toBeLessThan(4800);
    expect(encodeWav(normalize(sine(4800, 0.4, 0.05)))).toEqual(encodeWav(normalize(sine(4800, 0.4, 0.05))));
  });
});

describe('manifests', () => {
  const take = { file: 'a.wav', sha256: 'a'.repeat(64) };
  const text = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: 1,
      bank: 'keys',
      entries: [{ name: 'rhodes', kind: 'note', takes: [take], loop: null, license: 'CC0-1.0', ...over }],
    });
  it('accepts a valid manifest with defaults', () => {
    const m = parseManifestText(text());
    expect(m.entries[0]?.takes[0]).toMatchObject({ root: 60, lo: 0, hi: 127, vlo: 0, vhi: 1 });
  });
  it('rejects hostile and malformed input', () => {
    expect(() => parseManifestText('{"v":1,"bank":"k","entries":[],"__proto__":{}}')).toThrow(/forbidden/);
    expect(() => parseManifestText(text({ takes: [{ ...take, file: '../x.wav' }] }))).toThrow();
    expect(() => parseManifestText(text({ takes: [{ ...take, lo: 80, hi: 20 }] }))).toThrow();
    expect(() => parseManifestText(text({ takes: [{ ...take, root: 200 }] }))).toThrow();
    expect(() => parseManifestText(text({ license: '' }))).toThrow();
    expect(() => parseManifestText(text({ kind: 'drum' }))).toThrow();
  });
});

describe('interpreters', () => {
  it('note: rate from the root, nearest root, low ties, cap', () => {
    expect(planNote([z(60)], { note: 69 })?.rate).toBeCloseTo(2 ** (9 / 12), 9);
    const zones = [z(48, 36, 54), z(60, 55, 72)];
    expect(planNote(zones, { note: 50 })?.take).toBe(0);
    expect(planNote(zones, { note: 80 })?.take).toBe(1);
    expect(planNote([z(48, 0, 0), z(52, 0, 0)], { note: 50 })?.take).toBe(0);
    expect(planNote([z(60)], { note: 100 })?.rate).toBe(4);
    expect(planNote([], { note: 60 })).toBeNull();
  });
  it('note: velocity layers and seeded round robin', () => {
    expect(planNote([z(60, 0, 127, 0, 0.5), z(60, 0, 127, 0.5, 1)], { note: 60, velocity: 0.8 })?.take).toBe(1);
    expect(planNote([z(60), z(60)], { note: 60, rseed: 0.2 })?.take).toBe(0);
    expect(planNote([z(60), z(60)], { note: 60, rseed: 0.7 })?.take).toBe(1);
  });
  it('impulse: n modulo takes, speed clamped', () => {
    expect(planImpulse(3, { n: 4 }).take).toBe(1);
    expect(planImpulse(3, { n: -1 }).take).toBe(2);
    expect(planImpulse(1, { speed: 2 }).rate).toBe(2);
    expect(planImpulse(1, { speed: 100 }).rate).toBe(8);
    expect(GM_DRUMS.get(38)).toBe('snare');
  });
});

describe('host loading', () => {
  it('hashes with SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('loads files and banks, and reports problems', async () => {
    const good = encodeWav(normalize(sine(4800, 0.5)));
    const files = new Map<string, Uint8Array>([
      ['drums/kick.wav', good],
      ['keys/c4.wav', good],
      ['keys/d4.wav', good],
    ]);
    files.set(
      'keys/manifest.json',
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          bank: 'keys',
          gm: true,
          entries: [
            {
              name: 'rhodes',
              kind: 'note',
              takes: [{ file: 'c4.wav', sha256: await sha256Hex(good) }],
              loop: null,
              license: 'CC0-1.0',
            },
            {
              name: 'snare',
              kind: 'impulse',
              takes: [{ file: 'd4.wav', sha256: '0'.repeat(64) }],
              loop: null,
              license: 'UNKNOWN',
            },
            {
              name: 'gone',
              kind: 'impulse',
              takes: [{ file: 'gone.wav', sha256: '0'.repeat(64) }],
              loop: null,
              license: 'CC0-1.0',
            },
          ],
        }),
      ),
    );
    const fetchBytes = (p: string) => Promise.resolve(files.get(p)?.slice().buffer ?? null);
    const resources: ResourceDecl[] = [
      { kind: 'wav', name: 'kick', spec: './drums/kick.wav', range: R },
      { kind: 'wav', name: 'miss', spec: 'nope.wav', range: R },
      { kind: 'bank', spec: 'keys/', range: R },
    ];
    const fixed: typeof resources = resources.map((r) => (r.name === 'kick' ? { ...r, spec: 'drums/kick.wav' } : r));
    const { library, diagnostics } = await loadSamples(fixed, fetchBytes);
    expect(library.names().sort()).toEqual(['kick', 'rhodes']);
    expect(library.get('kick')?.kind).toBe('impulse');
    expect(library.isPending('miss')).toBe(false);
    expect(diagnostics.map((d) => d.id).sort()).toEqual([
      'I-RES-LICENSE',
      'W-RES-HASH',
      'W-RES-MISSING',
      'W-RES-MISSING',
    ]);
    expect(library.gmName(38)).toBeUndefined();
  });
});
