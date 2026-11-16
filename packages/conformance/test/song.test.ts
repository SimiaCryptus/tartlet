// Song timelines (docs/long_compositions.md, P1 to P3). Expectations are hand-written from the
// proposal and musical reasoning.
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
const sounds = (src: string, c = 0) =>
  onsets(src, c)
    .map((e) => String(e.value.s))
    .join('');
const first = (src: string, key: string, c = 0) => onsets(src, c)[0]?.value[key];
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('song and sections (P1)', () => {
  it('plays only in the named sections, and loops', () => {
    const src = 'song("a@2 b")\n$: s("x").sections("b")';
    expect([0, 1, 2, 3, 5].map((c) => sounds(src, c))).toEqual(['', '', 'x', '', 'x']);
    const ex = 'song("a@2 b")\n$: s("x").exceptSections("b")';
    expect([0, 1, 2, 3].map((c) => sounds(ex, c))).toEqual(['x', 'x', '', 'x']);
  });
  it('restarts the track in each section', () => {
    const src = 'song("a b@2")\n$: s("<p q>").sections("b")';
    expect([1, 2, 4].map((c) => sounds(src, c))).toEqual(['p', 'q', 'p']);
  });
  it('matches primes by base name', () => {
    const src = 'song("v v\' c")\n$: s("x").sections("v")';
    expect([0, 1, 2].map((c) => sounds(src, c))).toEqual(['x', 'x', '']);
    const only = 'song("v v\' c")\n$: s("x").sections("v\'")';
    expect([0, 1, 2].map((c) => sounds(only, c))).toEqual(['', 'x', '']);
  });
  it('once ends every track', () => {
    const src = 'song("a b", "once")\n$: s("x")';
    expect([0, 1, 2, 3].map((c) => sounds(src, c))).toEqual(['x', 'x', '', '']);
  });
  it('reports the length and unused sections', () => {
    const r = check('setcpm(30)\nsong("a@4 b@4")\n$: s("x")', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['I-SONG-LENGTH']);
    expect(r.diagnostics[0]?.message).toContain('8 cycles');
    expect(r.diagnostics[0]?.message).toContain('16 s');
    expect(ids('song("a b")\n$: s("x").sections("a")')).toEqual(['I-SONG-LENGTH', 'W-SONG-UNUSED']);
  });
  it('diagnostics', () => {
    expect(ids('song("a b")\n$: s("x").sections("z")')).toContain('E-ARG-MISSING');
    expect(ids('$: s("x").sections("a")')).toContain('E-ARG-MISSING');
    expect(ids('song("A@2")\n$: s("x")')).toContain('E-ARG-GRAMMAR');
    expect(ids('song("a")\nsong("b")\n$: s("x")')).toContain('E-NAME-DUP');
    expect(ids('$: form("#0", s("a"))')).toContain('E-ARG-GRAMMAR');
    expect(check('song("a b")\n$: s("x").sections("z")\n$: s("y")', opts).program.outputs.map((o) => o.status)).toEqual(
      ['muted-error', 'ok'],
    );
  });
});

describe('section values (P2)', () => {
  it('bysec gives one value per section, with a default', () => {
    const src = 'song("a b c")\n$: s("x").gain(bysec("a:.5 *:1"))';
    expect([0, 1, 2].map((c) => first(src, 'gain', c))).toEqual([0.5, 1, 1]);
  });
  it('leaves the control unset without a default', () => {
    const src = 'song("a b")\n$: s("x").gain(bysec("b:.5"))';
    expect([0, 1].map((c) => onsets(src, c).length)).toEqual([1, 1]);
    expect([0, 1].map((c) => first(src, 'gain', c))).toEqual([undefined, 0.5]);
  });
  it('prefers the exact primed entry and accepts strings', () => {
    expect([0, 1].map((c) => first('song("c c\'")\n$: s("x").gain(bysec("c:0 c\':2"))', 'gain', c))).toEqual([0, 2]);
    expect([0, 1].map((c) => sounds('song("a b")\n$: s(bysec("a:bd *:sd"))', c))).toEqual(['bd', 'sd']);
  });
  it('unknown sections are errors', () => {
    expect(ids('song("a b")\n$: s("x").gain(bysec("z:1"))')).toContain('E-ARG-MISSING');
  });
});

describe('section edges and variants (P3)', () => {
  it('atEnd and atStart apply a function at the edges of every section', () => {
    const end = 'song("a@2 b@2")\n$: s("x").atEnd(1, y => y.speed(2))';
    expect([0, 1, 2, 3, 5].map((c) => first(end, 'speed', c))).toEqual([undefined, 2, undefined, 2, 2]);
    const start = 'song("a@2 b@2")\n$: s("x").atStart(1, y => y.speed(2))';
    expect([0, 1, 2, 3].map((c) => first(start, 'speed', c))).toEqual([2, undefined, 2, undefined]);
    expect(ids(end)).toEqual(['I-SONG-LENGTH']);
  });
  it('variant picks a function by the number of primes', () => {
    const src = `song("v v' v''")\n$: s("x").variant(y => y.speed(2), y => y.speed(3))`;
    expect([0, 1, 2].map((c) => first(src, 'speed', c))).toEqual([undefined, 2, 3]);
  });
  it('do nothing without a song', () => {
    expect(ids('$: s("x").atEnd(1, rev)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(sounds('s("x").atEnd(1, rev)')).toBe('x');
  });
});
