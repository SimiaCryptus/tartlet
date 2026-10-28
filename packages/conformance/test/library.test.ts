// Standard library (docs/language_extensions.md Part 2, TS-53 to TS-60).
// Expectations are hand-written from the proposal and musical reasoning.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { eq, rat, toJson, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const sortOnsets = (evs: Event<ControlMap>[]) =>
  evs.filter(isOnset).sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin));
const onsets = (src: string, c = 0) => sortOnsets(runSource(src, cyc(c)));
const soundList = (src: string, c = 0) => onsets(src, c).map((e) => String(e.value.s));
const sounds = (src: string, c = 0) => soundList(src, c).join('');
const begins = (src: string, c = 0) => onsets(src, c).map((e) => toJson(e.whole!.begin));
const field = (src: string, key: string, c = 0) => onsets(src, c).map((e) => e.value[key]);
const notes = (src: string, c = 0) => onsets(src, c).map((e) => (e.value.note as { value: number }).value);
const across = (src: string, key: string, cycles: number) =>
  Array.from({ length: cycles }, (_, c) => field(src, key, c)).flat();
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('time and structure (TS-54, TS-55)', () => {
  it('within applies a function to part of each cycle', () => {
    const src = 's("a b c d").within(0, .5, x => x.fast(2))';
    expect(sounds(src)).toBe('abcdcd');
    expect(begins(src)).toEqual([
      [0, 1],
      [1, 8],
      [1, 4],
      [3, 8],
      [1, 2],
      [3, 4],
    ]);
  });
  it('chunk moves the transformed part each cycle', () => {
    const src = 's("a b c d").chunk(4, x => x.speed(2))';
    expect([0, 1, 2].map((c) => field(src, 'speed', c).map((v) => v ?? 1))).toEqual([
      [2, 1, 1, 1],
      [1, 2, 1, 1],
      [1, 1, 2, 1],
    ]);
    expect(field('s("a b c d").chunkBack(4, x => x.speed(2))', 'speed', 1).map((v) => v ?? 1)).toEqual([1, 1, 1, 2]);
  });
  it('lastOf applies on the last cycle of each group', () => {
    const src = 's("a b c").lastOf(3, rev)';
    expect([0, 1, 2, 3].map((c) => sounds(src, c))).toEqual(['abc', 'abc', 'cba', 'abc']);
  });
  it('zoom, compress and fastGap', () => {
    expect(sounds('s("a b c d").zoom(.25, .75)')).toBe('bc');
    expect(begins('s("a b c d").zoom(.25, .75)')).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(begins('s("a b").compress(.25, .75)')).toEqual([
      [1, 4],
      [1, 2],
    ]);
    expect(begins('s("a b").fastGap(2)')).toEqual([
      [0, 1],
      [1, 4],
    ]);
  });
  it('linger repeats the opening of each cycle', () => {
    expect(sounds('s("a b c d").linger(.25)')).toBe('aaaa');
    expect(sounds('s("a b c d").linger(.5)')).toBe('abab');
  });
  it('segment samples a signal into steps', () => {
    expect(field('n(saw.segment(4))', 'n')).toEqual([0, 0.25, 0.5, 0.75]);
  });
  it('hurry speeds up time and playback', () => {
    expect(field('s("a b").hurry(2)', 'speed')).toEqual([2, 2, 2, 2]);
  });
  it('swing delays every second eighth by a third of a quarter', () => {
    expect(begins('s("a*8").swing(4)')).toEqual([
      [0, 1],
      [5, 24],
      [1, 4],
      [11, 24],
      [1, 2],
      [17, 24],
      [3, 4],
      [23, 24],
    ]);
  });
  it('brak squeezes odd cycles into their middle half', () => {
    expect(begins('s("a b").brak()', 0)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(begins('s("a b").brak()', 1)).toEqual([
      [5, 4],
      [3, 2],
    ]);
  });
  it('press and pressBy start events later within their duration', () => {
    expect(begins('s("a b").press()')).toEqual([
      [1, 4],
      [3, 4],
    ]);
    expect(begins('s("a b").pressBy(.25)')).toEqual([
      [1, 8],
      [5, 8],
    ]);
  });
  it('superimpose and echo', () => {
    expect(notes('note("c").superimpose(x => x.add(7))').sort((a, b) => a - b)).toEqual([48, 55]);
    const src = 's("a").echo(3, 1/8, .5)';
    expect(begins(src)).toEqual([
      [0, 1],
      [1, 8],
      [1, 4],
    ]);
    expect(field(src, 'gain')).toEqual([undefined, 0.5, 0.25]);
  });
  it('run counts up', () => {
    expect(field('n(run(4))', 'n')).toEqual([0, 1, 2, 3]);
    expect(notes('n(run(4)).scale("C:major")')).toEqual([48, 50, 52, 53]);
  });
});

describe('randomness (TS-56)', () => {
  it('probability shorthands keep every event and are seeded', () => {
    const often = across('s("a*8").often(x => x.speed(2))', 'speed', 8);
    expect(often).toHaveLength(64);
    const twos = often.filter((v) => v === 2).length;
    expect(twos).toBeGreaterThan(36);
    expect(twos).toBeLessThan(60);
    expect(across('s("a*8").often(x => x.speed(2))', 'speed', 8)).toEqual(often);
    const rare = across('s("a*8").rarely(x => x.speed(2))', 'speed', 8).filter((v) => v === 2).length;
    expect(rare).toBeGreaterThan(4);
    expect(rare).toBeLessThan(28);
    expect(across('s("a*4").always(x => x.speed(2))', 'speed', 2)).toEqual(Array(8).fill(2));
    expect(across('s("a*4").never(x => x.speed(2))', 'speed', 2)).toEqual(Array(8).fill(undefined));
  });
  it('appending a method leaves the draws unchanged', () => {
    const a = across('$: s("a*8").often(x => x.speed(2))', 'speed', 6);
    expect(across('$: s("a*8").often(x => x.speed(2)).gain(.8)', 'speed', 6)).toEqual(a);
  });
  it('someCyclesBy decides once per cycle', () => {
    const src = 's("a*4").someCyclesBy(.5, x => x.speed(2))';
    const perCycle = Array.from({ length: 20 }, (_, c) => field(src, 'speed', c).map((v) => v ?? 1));
    for (const cy of perCycle) expect(new Set(cy).size).toBe(1);
    expect(new Set(perCycle.map((cy) => cy[0])).size).toBe(2);
  });
  it('shuffle permutes slices; scramble may repeat them', () => {
    const sh = Array.from({ length: 16 }, (_, c) => soundList('s("a b c d").shuffle(4)', c));
    for (const s of sh) expect([...s].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(sh.some((s) => s.join('') !== 'abcd')).toBe(true);
    const sc = Array.from({ length: 16 }, (_, c) => sounds('s("a b c d").scramble(4)', c));
    for (const s of sc) expect(s).toMatch(/^[abcd]{4}$/);
    expect(sc.some((s) => new Set(s).size < 4)).toBe(true);
    expect(Array.from({ length: 16 }, (_, c) => soundList('s("a b c d").shuffle(4)', c))).toEqual(sh);
  });
  it('undegradeBy keeps about the given share', () => {
    const kept = sortOnsets(runSource('s("a*8").undegradeBy(.25)', { begin: rat(0), end: rat(200) })).length / 1600;
    expect(kept).toBeGreaterThan(0.2);
    expect(kept).toBeLessThan(0.3);
  });
  it('irand gives seeded whole numbers', () => {
    const src = 'n(irand(8).segment(4))';
    const v = across(src, 'n', 10) as number[];
    expect(v).toHaveLength(40);
    for (const x of v) expect(Number.isInteger(x) && x >= 0 && x < 8).toBe(true);
    expect(new Set(v).size).toBeGreaterThan(2);
    expect(across(src, 'n', 10)).toEqual(v);
  });
  it('perlin drifts smoothly between zero and one', () => {
    const v = across('s("a*8").pan(perlin)', 'pan', 4) as number[];
    for (const x of v) expect(x >= 0 && x <= 1).toBe(true);
    for (let i = 1; i < v.length; i++) expect(Math.abs(v[i]! - v[i - 1]!)).toBeLessThan(0.25);
    expect(new Set(v).size).toBeGreaterThan(1);
  });
});

describe('arithmetic and tonal (TS-57)', () => {
  it('binary arithmetic on degrees and notes', () => {
    expect(field('n("0 2 4").sub(1)', 'n')).toEqual([-1, 1, 3]);
    expect(field('n("1 2 3").mul(2)', 'n')).toEqual([2, 4, 6]);
    expect(field('n("4 6").div(2)', 'n')).toEqual([2, 3]);
    expect(field('n("4 6").div(0)', 'n')).toEqual([4, 6]);
    expect(field('n("5 -1").mod(4)', 'n')).toEqual([1, 3]);
    expect(notes('note("c").sub(12)')).toEqual([36]);
  });
  it('rounding', () => {
    expect(field('n("0.4 1.6").round()', 'n')).toEqual([0, 2]);
    expect(field('n("0.4 1.6").floor()', 'n')).toEqual([0, 1]);
    expect(field('n("0.4 1.6").ceil()', 'n')).toEqual([1, 2]);
  });
  it('bipolar mappings', () => {
    expect(field('s("a*2").pan(saw.toBipolar())', 'pan')).toEqual([-1, 0]);
    expect(field('s("a*2").pan(saw.fromBipolar())', 'pan')).toEqual([0.5, 0.75]);
  });
  it('octave moves notes by octaves, including patterned', () => {
    expect(notes('note("c").octave(1)')).toEqual([60]);
    expect([0, 1].map((c) => notes('note("c").octave("<0 -1>")', c))).toEqual([[48], [36]]);
    expect(ids('$: s("bd").octave(1)')).toContain('E-CAP-PITCHED');
  });
  it('more scales (TS-60)', () => {
    expect(notes('n("0 1 2").scale("C:whole tone")')).toEqual([48, 50, 52]);
    expect(notes('n("0 1 2 3 4").scale("C:hirajoshi")')).toEqual([48, 50, 51, 55, 56]);
    expect(notes('n("1").scale("C:phrygian-dominant")')).toEqual([49]);
  });
});

describe('controls (TS-59)', () => {
  it('accent boosts gain on true steps without dropping events', () => {
    const g = field('s("a*4").gain(.5).accent("x ~ x ~")', 'gain') as number[];
    expect(g).toHaveLength(4);
    [0.65, 0.5, 0.65, 0.5].forEach((v, i) => {
      expect(g[i]).toBeCloseTo(v, 9);
    });
  });
  it('legato and nudge pass through; clip is legato', () => {
    expect(onsets('s("a").legato(.5).nudge(.01)').map((e) => ({ ...e.value }))).toEqual([
      { s: 'a', legato: 0.5, nudge: 0.01 },
    ]);
    expect(field('s("a").clip(2)', 'legato')).toEqual([2]);
    expect(ids('$: s("a").clip(2)')).toEqual([]);
  });
});

describe('library diagnostics', () => {
  it('reports bad counts and reserved names', () => {
    expect(ids('$: n(run(0))')).toContain('E-ARG-TYPE');
    expect(ids('$: n(irand)')).toContain('E-ARG-MISSING');
    expect(ids('$: s("a").chunk("<2 4>", rev)')).toContain('E-ARG-TYPE');
    expect(ids('$: s("a").within(0, 2, rev)')).toEqual(['W-RANGE']);
    expect(ids('const swing = 1\n$: s("a")')).toEqual(['E-NAME-SHADOW']);
  });
  it('library functions work as function values', () => {
    expect([0, 1].map((c) => sounds('s("a b").every(2, superimpose(rev))', c).length)).toEqual([4, 2]);
  });
});
