// Long-form and generative composition (docs/symphonic.md). Expectations are hand-written from
// the definitions and musical reasoning.
import { describe, expect, it } from 'vitest';
import { check, locator } from '@tartlet/check';
import { compile, sanity, type ControlMap, type Event } from '@tartlet/core';
import { eq, rat, toJson, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const onsets = (src: string, c = 0) =>
  runSource(src, cyc(c))
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin));
const soundList = (src: string, c = 0) => onsets(src, c).map((e) => String(e.value.s));
const sounds = (src: string, c = 0) => soundList(src, c).join('');
const begins = (src: string, c = 0) => onsets(src, c).map((e) => toJson(e.whole!.begin));
const field = (src: string, key: string, c = 0) => onsets(src, c).map((e) => e.value[key]);
const notes = (src: string, c = 0) => onsets(src, c).map((e) => (e.value.note as { value: number }).value);
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('form', () => {
  it('plays sections in order and loops', () => {
    const src = 'form("A@2 B", s("a"), s("b"))';
    expect([0, 1, 2, 3, 4].map((c) => sounds(src, c))).toEqual(['a', 'a', 'b', 'a', 'a']);
  });
  it('starts each section from its own beginning', () => {
    const src = 'form("A B@2", s("x"), s("<p q>"))';
    expect([0, 1, 2, 3, 4].map((c) => sounds(src, c))).toEqual(['x', 'p', 'q', 'x', 'p']);
  });
  it('once plays the form once', () => {
    const src = 'form("A B", s("a"), s("b")).once()';
    expect([0, 1, 2, 3].map((c) => sounds(src, c))).toEqual(['a', 'b', '', '']);
    expect([0, 2].map((c) => sounds('const p = form("A B", s("a"), s("b"))\n$: p.once()', c))).toEqual(['a', '']);
  });
  it('variants change only the draws', () => {
    expect([0, 1].map((c) => sounds('form("A A\'", s("a b"))', c))).toEqual(['ab', 'ab']);
    const rel = (c: number) => onsets('form("A A\'", s("a*32?"))', c).map((e) => toNumber(e.whole!.begin) - c);
    expect(rel(2)).toEqual(rel(0));
    expect(rel(1)).not.toEqual(rel(0));
  });
  it('diagnostics', () => {
    expect(ids('$: form("A@2 B", s("a"), s("b"))')).toEqual(['I-FORM-LENGTH']);
    expect(ids('$: form("A B", s("a"))')).toContain('E-ARG-MISSING');
    expect(check('$: form("A B", s("a"))\n$: s("b")', opts).program.outputs.map((o) => o.status)).toEqual([
      'muted-error',
      'ok',
    ]);
    expect(ids('$: form("A", s("a"), s("b"))')).toEqual(['W-FORM-UNUSED', 'I-FORM-LENGTH']);
    const d = check('$: form("A@x", s("a"))', opts).diagnostics[0];
    expect(d).toMatchObject({ id: 'E-ARG-GRAMMAR', range: { start: { line: 0, col: 9 } } });
    expect(ids('$: s("a").once()')).toEqual(['W-ARG-UNSUPPORTED']);
  });
});

describe('shape over time', () => {
  it('env is a breakpoint signal', () => {
    const pan = field('s("a*4").pan(env("0 1", 1))', 'pan') as number[];
    [0, 0.25, 0.5, 0.75].forEach((v, i) => {
      expect(pan[i]).toBeCloseTo(v, 9);
    });
    const g = [0, 1, 2, 3].map((c) => field('s("a").gain(env("0 1@3 0", 4))', 'gain', c)[0] as number);
    [0, 1, 2 / 3, 1 / 3].forEach((v, i) => {
      expect(g[i]).toBeCloseTo(v, 9);
    });
    expect(ids('$: s("a").gain(env("0 x", 4))')).toContain('E-ARG-GRAMMAR');
  });
  it('enter, exit and during', () => {
    expect([0, 1, 2, 3].map((c) => onsets('s("a").enter(2)', c).length)).toEqual([0, 0, 1, 1]);
    expect([0, 1, 2, 3].map((c) => onsets('s("a").exit(2)', c).length)).toEqual([1, 1, 0, 0]);
    const src = 's("a").during(2, 4, x => x.speed(2), 8)';
    expect([1, 2, 3, 4, 10].map((c) => field(src, 'speed', c)[0])).toEqual([undefined, 2, 2, undefined, 2]);
  });
  it('fades', () => {
    expect([0, 1, 2, 5].map((c) => field('s("a").fadein(4)', 'gain', c)[0])).toEqual([0, 0.25, 0.5, 1]);
    expect([3, 4, 5, 6].map((c) => field('s("a").fadeout(2, 4)', 'gain', c)[0])).toEqual([1, 1, 0.5, 0]);
  });
});

describe('motifs and imitation', () => {
  it('invert mirrors degrees and notes', () => {
    expect(field('n("0 2 4").invert()', 'n')).toEqual([0, -2, -4]);
    expect(field('n("0 2 4").invert(2)', 'n')).toEqual([4, 2, 0]);
    expect(notes('n("0 2 4").invert().scale("C:minor")')).toEqual([48, 44, 41]);
    expect(notes('note("c4 e4").invert()')).toEqual([60, 56]);
    expect(ids('$: s("bd").invert()')).toContain('E-CAP-PITCHED');
  });
  it('retro plays windows backwards', () => {
    expect(sounds('s("a b").retro()')).toBe('ba');
    expect([0, 1].map((c) => sounds('s("<[a b] [c d]>").retro(2)', c))).toEqual(['dc', 'ba']);
  });
  it('sequence climbs in groups', () => {
    expect([0, 1, 2, 3].map((c) => field('n("0 2").sequence(1, 3)', 'n', c))).toEqual([
      [0, 2],
      [1, 3],
      [2, 4],
      [0, 2],
    ]);
  });
  it('canon and prolation', () => {
    const src = 'n("0").canon(2, 1/4, 7)';
    expect(begins(src)).toEqual([
      [0, 1],
      [1, 4],
    ]);
    expect(field(src, 'n')).toEqual([0, 7]);
    expect(onsets('s("a").prolation(1, 2)')).toHaveLength(3);
  });
});

describe('generators', () => {
  it('integer sequences count from the start of the piece', () => {
    expect(field('n(ints("thuemorse", 8))', 'n')).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
    expect(field('n(ints("norgard", 8))', 'n')).toEqual([0, 1, -1, 2, 1, 0, -2, 3]);
    expect(field('n(ints("ruler", 4))', 'n', 1)).toEqual([0, 1, 0, 3]);
    expect(field('n(ints("fib", 8, 3))', 'n', 1)).toEqual([0, 1, 1, 2, 0, 2, 2, 1]);
    expect(ids('$: n(ints("nope"))')).toEqual(['W-ARG-MODE']);
  });
  it('sieves give rhythms', () => {
    expect(begins('s("a").struct(sieve("3@0 | 4@1", 12))')).toEqual([
      [0, 1],
      [1, 12],
      [1, 4],
      [5, 12],
      [1, 2],
      [3, 4],
    ]);
    expect(ids('$: s("a").struct(sieve("3@", 8))')).toContain('E-ARG-GRAMMAR');
  });
  it('rewriting systems', () => {
    expect(sounds('s(lsys("a", "a=a b, b=a", 4, 1))')).toBe('abaababa');
    expect(field('n(lsys("0", "0=0 2, 2=4, 4=0 4", 2))', 'n')).toEqual([0, 2, 4]);
    expect(ids('$: s(lsys("a", "a=a a a", 16))')).toContain('E-LIMIT-GROWTH');
    expect(ids('$: s(lsys("a", "a b", 2))')).toContain('E-ARG-GRAMMAR');
  });
  it('permutations and change ringing', () => {
    expect(sounds('s("a b c").permute(3, 1)')).toBe('acb');
    expect(sounds('s("a b c").permute(3, "<0 1>")', 1)).toBe('acb');
    const src = 's("a b c d").ring("plainhunt", 4)';
    expect(Array.from({ length: 9 }, (_, c) => sounds(src, c))).toEqual([
      'abcd',
      'badc',
      'bdac',
      'dbca',
      'dcba',
      'cdab',
      'cadb',
      'acbd',
      'abcd',
    ]);
    expect(ids('$: s("a b c").ring("grandsire", 3)')).toEqual(['W-ARG-MODE']);
  });
  it('twelve-tone rows', () => {
    const row = 'row("0 11 3 4 8 7 9 5 6 1 2 10")';
    expect(ids(`$: ${row}.scale("C:chromatic").s("sine")`)).toEqual([]);
    expect(notes(`${row}.scale("C:chromatic")`).slice(0, 3)).toEqual([48, 59, 51]);
    expect(ids('$: row("0 1 2").scale("C:chromatic")')).toEqual(['W-ARG-ROW']);
    const forms = 'row("0 4 7").rowform("<P0 I0 R2>")';
    expect([0, 1, 2].map((c) => field(forms, 'n', c))).toEqual([
      [0, 4, 7],
      [0, 8, 5],
      [9, 6, 2],
    ]);
    expect(ids('$: row("0 4 7").rowform("X1")')).toContain('W-ARG-MODE');
  });
});

describe('processes', () => {
  it('phase drifts by a step each cycle', () => {
    expect(begins('s("a").phase(1/4)', 0)).toEqual([[0, 1]]);
    expect(begins('s("a").phase(1/4)', 1)).toEqual([[5, 4]]);
    expect(begins('s("a").phase(1/4)', 2)).toEqual([[5, 2]]);
  });
  it('additive and subtractive', () => {
    expect([0, 1, 2, 3, 4].map((c) => sounds('s("a b c d").additive(4)', c))).toEqual(['a', 'ab', 'abc', 'abcd', 'a']);
    expect([0, 1, 2, 3].map((c) => sounds('s("a b c d").subtractive(4)', c))).toEqual(['abcd', 'abc', 'ab', 'a']);
  });
  it('converge lines layers up at the given cycle', () => {
    expect(soundList('s("<a b c d e f g>").converge(4, 1, 2)', 4).sort()).toEqual(['e', 'e', 'f']);
  });
});

describe('long sanity', () => {
  it('reports how often each output repeats', () => {
    const src = 'loop: s("a b")\npiece: form("A B@2", s("a"), s("b"))';
    const r = check(src, opts);
    const report = sanity(compile(r.program, { locate: locator(src), ...opts }), 12);
    expect(report.periods).toEqual({ loop: 1, piece: 3 });
  });
});
