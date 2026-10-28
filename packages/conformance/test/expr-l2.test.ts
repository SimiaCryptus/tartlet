// Remaining L2 rows (idea.md §12.3): X-03, X-22, X-27 and X-31.
// Expectations are hand-written from the spec. X-22 is provisional (TS-39).
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
const sounds = (src: string, c = 0) => onsets(src, c).map((e) => String(e.value.s));
const notes = (src: string, c = 0) => onsets(src, c).map((e) => (e.value.note as { value: number }).value);

describe('L2 expressions, remaining rows', () => {
  it('X-03 n with scale gives C, Eb, G', () => {
    expect(notes('n("0 2 4").scale("C:minor")')).toEqual([48, 51, 55]);
  });

  it('X-22 iter rotates the start every cycle (TS-39)', () => {
    const src = 's("a b c d").iter(4)';
    expect([0, 1, 2, 3, 4].map((c) => sounds(src, c).join(''))).toEqual(['abcd', 'bcda', 'cdab', 'dabc', 'abcd']);
  });

  it('X-22 iterBack rotates the other way (TS-39)', () => {
    const src = 's("a b c d").iterBack(4)';
    expect([0, 1, 2].map((c) => sounds(src, c).join(''))).toEqual(['abcd', 'dabc', 'cdab']);
  });

  it('X-22 iter keeps equal step lengths inside each cycle', () => {
    const evs = onsets('s("a b c d").iter(4)', 1);
    expect(evs.map((e) => toNumber(e.whole!.begin))).toEqual([1, 1.25, 1.5, 1.75]);
    for (const e of evs) expect(toNumber(e.whole!.end) - toNumber(e.whole!.begin)).toBe(0.25);
  });

  it('X-22 palindrome alternates forwards and backwards (TS-39)', () => {
    const src = 's("a b c").palindrome()';
    expect([0, 1, 2, 3].map((c) => sounds(src, c).join(''))).toEqual(['abc', 'cba', 'abc', 'cba']);
  });

  it('X-22 iter works as a function value', () => {
    expect(sounds('s("a b").every(2, iter(2))', 0).join('')).toBe('ab');
    expect(sounds('s("a b").every(2, iter(2))', 1).join('')).toBe('ab');
    expect(sounds('s("a b").every(2, iter(2))', 2).join('')).toBe('ab');
  });

  it('X-27 envelope controls pass through', () => {
    expect(onsets('note("c").attack(.01).decay(.1).sustain(.5).release(.3)').map((e) => ({ ...e.value }))).toEqual([
      { note: { kind: 'midi', value: 48 }, attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 },
    ]);
  });

  it('X-31 samples() is declared, never fetched, and the track plays', () => {
    const r = check('samples("github:example/bank")\n$: s("bd")', opts);
    expect(r.program.resources.map((x) => x.spec)).toEqual(['github:example/bank']);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['I-RES-DECLARED']);
    expect(r.program.outputs.map((o) => o.status)).toEqual(['ok']);
  });

  it('iter needs a constant count', () => {
    const ids = check('$: s("a b").iter("<1 2>")', opts).diagnostics.map((d) => d.id);
    expect(ids).toContain('E-ARG-TYPE');
  });
});
