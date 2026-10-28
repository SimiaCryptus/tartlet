// Headphone extensions (TS-40): binaural, azimuth, elevation and distance controls.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { eq, rat, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const onsets = (src: string, c = 0) =>
  runSource(src, cyc(c))
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin));

describe('binaural and spatial controls (TS-40)', () => {
  it('pass through as canonical controls', () => {
    const src = 'note("a2").s("sine").binaural(6).azimuth(90).elevation(10).distance(2)';
    expect(onsets(src).map((e) => ({ ...e.value }))).toEqual([
      { note: { kind: 'midi', value: 45 }, s: 'sine', binaural: 6, azimuth: 90, elevation: 10, distance: 2 },
    ]);
  });
  it('accept patterns and signals', () => {
    expect([0, 1].map((c) => onsets('s("a*2").azimuth("<-90 90>")', c).map((e) => e.value.azimuth))).toEqual([
      [-90, -90],
      [90, 90],
    ]);
    const az = onsets('s("a*4").azimuth(saw.range(-180, 180))').map((e) => e.value.azimuth as number);
    [-180, -90, 0, 90].forEach((v, i) => {
      expect(az[i]).toBeCloseTo(v, 6);
    });
  });
  it('warn outside their ranges and keep the authored value', () => {
    const r = check('$: note("a").s("sine").binaural(100)', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['W-RANGE']);
    expect(r.program.outputs[0]?.status).toBe('ok');
    expect(check('$: s("a").azimuth(270)', opts).diagnostics.map((d) => d.id)).toEqual(['W-RANGE']);
  });
});
