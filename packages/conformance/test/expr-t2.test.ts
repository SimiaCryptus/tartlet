// T2 L2, D and Q rows (idea.md §12.3, §12.4). Expectations are hand-written from the spec.
// Rows citing TS-37 are provisional until their oracle specifications land.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { createCatalog } from '@tartlet/resources';
import { eq, rat, toJson, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const onsets = (src: string, c = 0) =>
  runSource(src, cyc(c))
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin));
const begins = (src: string, c = 0) => onsets(src, c).map((e) => toJson(e.whole!.begin));
const notes = (src: string, c = 0) => onsets(src, c).map((e) => (e.value.note as { value: number }).value);
const ids = (src: string, extra = {}) => check(src, { ...opts, ...extra }).diagnostics.map((d) => d.id);

describe('L2 expressions, T2 rows', () => {
  it('X-13 off layers a shifted, transformed copy (TS-37)', () => {
    expect(notes('note("c").off(1/8, x => x.add(12))')).toEqual([48, 60]);
    expect(begins('note("c").off(1/8, x => x.add(12))')).toEqual([
      [0, 1],
      [1, 8],
    ]);
  });
  it('X-14 jux splits left and right (TS-37)', () => {
    const evs = onsets('s("a b").jux(rev)')
      .map((e) => `${String(e.value.s)}${String(e.value.pan)}`)
      .sort();
    expect(evs).toEqual(['a0', 'a1', 'b0', 'b1']);
  });
  it('X-16 ply doubles each event in place (TS-37)', () => {
    expect(begins('s("a b").ply(2)')).toEqual([
      [0, 1],
      [1, 4],
      [1, 2],
      [3, 4],
    ]);
  });
  it('X-17 struct takes the rhythm (TS-37)', () => {
    expect(begins('note("c").struct("x ~ x x")')).toEqual([
      [0, 1],
      [1, 2],
      [3, 4],
    ]);
  });
  it('X-18 mask silences every other cycle (TS-37)', () => {
    expect([0, 1].map((c) => onsets('s("a*2").mask("<1 0>")', c).length)).toEqual([2, 0]);
  });
  it('X-19 euclid method matches M-19', () => {
    expect(begins('s("a").euclid(3,8)')).toEqual([
      [0, 1],
      [3, 8],
      [3, 4],
    ]);
  });
  it('X-20 sometimesBy is seeded and keeps every event', () => {
    const run = () =>
      Array.from({ length: 4 }, (_, c) =>
        onsets('s("a*8").sometimesBy(.5, x => x.speed(2))', c).map((e) => e.value.speed ?? 1),
      ).flat();
    const a = run();
    expect(a).toHaveLength(32);
    expect(a).toContain(2);
    expect(a).toContain(1);
    expect(run()).toEqual(a);
  });
  it('X-21 add and transpose', () => {
    expect(notes('note("c e").add(7)')).toEqual([55, 59]);
    expect(notes('note("c e").transpose(12)')).toEqual([60, 64]);
    expect(notes('n("0 2").add(1).scale("C:major")')).toEqual([50, 53]);
    expect([0, 1].map((c) => notes('note("c").add("<0 7>")', c))).toEqual([[48], [55]]);
  });
  it('X-28 signals are sampled at onsets', () => {
    const cut = onsets('s("a*4").lpf(sine.range(200, 2000))').map((e) => e.value.cutoff as number);
    [1100, 2000, 1100, 200].forEach((v, i) => {
      expect(cut[i]).toBeCloseTo(v, 6);
    });
  });
  it('X-32 seed pins a variation', () => {
    const draws = (s: string) =>
      Array.from({ length: 12 }, (_, c) =>
        onsets(`s("a*8").sometimesBy(.5, x => x.speed(2)).seed("${s}")`, c)
          .map((e) => String(e.value.speed ?? 1))
          .join(''),
      ).join('|');
    expect(draws('v2')).toBe(draws('v2'));
    expect(draws('v2')).not.toBe(draws('v3'));
  });
  it('X-33 label gives a stable output id', () => {
    const a = check('$: s("a").label("lead")', opts).program.outputs[0];
    const b = check('lead: s("a")', opts).program.outputs[0];
    expect(a?.label).toBe('lead');
    expect(a?.id).toBe(b?.id);
    expect(ids('$: s("a").label("x")\n$: s("b").label("x")')).toContain('E-NAME-DUP');
  });
});

describe('T2 diagnostic rows', () => {
  it('Q-03 pitch operations on samples mute the subtree', () => {
    expect(ids('$: s("bd").scale("C:major")')).toContain('E-CAP-PITCHED');
    expect(ids('$: n("0 2").scale("C:major").s("triangle")')).toEqual([]);
  });
  it('Q-05 a missing sample warns before playback', () => {
    expect(ids('$: s("zzq")', { catalog: createCatalog({ fallback: false }) })).toEqual(['W-RES-MISSING']);
  });
  it('Q-08 common names fall back to the general kit', () => {
    expect(ids('$: s("808bd arpy")', { catalog: createCatalog() })).toEqual(['I-RES-FALLBACK', 'I-RES-FALLBACK']);
  });
});
