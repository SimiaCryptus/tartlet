// Song timelines: the rest of P2, P4 and P5 (docs/long_compositions.md). Expectations are
// hand-written from the proposal and musical reasoning.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { decodeProgram, encodeProgram } from '@tartlet/ir';
import { eq, rat, toJson, toNumber } from '@tartlet/time';
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
const notes = (src: string, c = 0) => onsets(src, c).map((e) => (e.value.note as { value: number }).value);
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('section and song envelopes (P2)', () => {
  it('env over each section restarts in every section', () => {
    const src = 'song("a@2 b@4")\n$: s("x").gain(env("0 1", "section"))';
    const g = [0, 1, 2, 3, 4, 5, 6].map((c) => first(src, 'gain', c) as number);
    [0, 0.5, 0, 0.25, 0.5, 0.75, 0].forEach((v, i) => {
      expect(g[i]).toBeCloseTo(v, 9);
    });
  });
  it('env over the song makes one arc', () => {
    const src = 'song("a@2 b@2")\n$: s("x").gain(env("0 1", "song"))';
    const g = [0, 1, 2, 3, 4].map((c) => first(src, 'gain', c) as number);
    [0, 0.25, 0.5, 0.75, 0].forEach((v, i) => {
      expect(g[i]).toBeCloseTo(v, 9);
    });
  });
  it('diagnostics', () => {
    expect(ids('$: s("x").gain(env("0 1", "section"))')).toContain('E-ARG-MISSING');
    expect(ids('song("a")\n$: s("x").gain(env("0 1", "verse"))')).toContain('E-ARG-TYPE');
    expect(ids('song("a")\n$: s("x").gain(env("0 x", "song"))')).toContain('E-ARG-GRAMMAR');
  });
});

describe('patterned scales (P2)', () => {
  it('read the scale at each onset', () => {
    const src = 'n("2").scale("<C:major C:minor>")';
    expect([0, 1].map((c) => notes(src, c))).toEqual([[52], [51]]);
    expect(ids(`$: ${src}`)).toEqual([]);
  });
  it('accept bindings and section values', () => {
    expect(notes('const key = "D:minor"\n$: n("0 2").scale(key)')).toEqual([50, 53]);
    const src = 'song("a b")\n$: n("2").scale(bysec("a:C:major *:C:minor"))';
    expect([0, 1].map((c) => notes(src, c))).toEqual([[52], [51]]);
  });
  it('reject unknown scales', () => {
    expect(ids('$: n("0").scale("<C:major X:nope>")')).toContain('E-ARG-SCALE');
    expect(ids('$: n("0").scale(3)')).toContain('E-ARG-SCALE');
    expect(ids('$: s("bd:x")')).toContain('E-MINI-INDEX');
  });
});

describe('repeats and endings (P4)', () => {
  it('form plays groups out, with endings', () => {
    const src = 'form("A (B 1.C 2.D)*2", s("a"), s("b"), s("c"), s("d"))';
    expect([0, 1, 2, 3, 4, 5].map((c) => sounds(src, c))).toEqual(['a', 'b', 'c', 'b', 'd', 'a']);
    expect(ids(`$: ${src}`)).toEqual(['I-FORM-LENGTH']);
  });
  it('song sections follow the played-out layout', () => {
    const src = 'song("i (t 1.h 2.f)*2 c")\n$: s("x").sections("h f")';
    expect([0, 1, 2, 3, 4, 5].map((c) => sounds(src, c))).toEqual(['', '', 'x', '', 'x', '']);
  });
  it('malformed groups are grammar errors', () => {
    expect(ids('song("a 1.b")\n$: s("x")')).toContain('E-ARG-GRAMMAR');
    expect(ids('$: form("(A B", s("a"), s("b"))')).toContain('E-ARG-GRAMMAR');
    expect(ids('$: form("(A)*1", s("a"))')).toContain('E-ARG-GRAMMAR');
  });
});

describe('tempo maps (P5)', () => {
  it('are carried by the program and survive the encoding', () => {
    const p = check('tempomap("0:30 4:60")\n$: s("x")', opts).program;
    expect(check('tempomap("0:30 4:60")\n$: s("x")', opts).diagnostics).toEqual([]);
    expect(p.settings.tempoMap?.map((x) => [toJson(x.cycle), toJson(x.cps)])).toEqual([
      [
        [0, 1],
        [1, 2],
      ],
      [
        [4, 1],
        [1, 1],
      ],
    ]);
    expect(decodeProgram(encodeProgram(p)).settings.tempoMap).toEqual(p.settings.tempoMap);
  });
  it('diagnostics', () => {
    expect(ids('setcpm(30)\ntempomap("0:30")\n$: s("x")')).toEqual(['I-TEMPO-OVERRIDE']);
    expect(ids('tempomap("0:30")\ntempomap("0:60")\n$: s("x")')).toEqual(['E-NAME-DUP']);
    expect(ids('tempomap("4:30 0:60")\n$: s("x")')).toEqual(['E-ARG-GRAMMAR']);
    expect(ids('tempomap("0:10000")\n$: s("x")')).toEqual(['W-RANGE']);
  });
  it('song length follows the map', () => {
    const constant = check('song("a@4")\ntempomap("0:30")\n$: s("x")', opts).diagnostics[0];
    expect(constant?.message).toContain('8 s');
    // 30 to 60 cycles per minute over 4 cycles: 8 ln 2 ≈ 5.5 s.
    const rit = check('song("a@4")\ntempomap("0:30 4:60")\n$: s("x")', opts).diagnostics[0];
    expect(rit?.id).toBe('I-SONG-LENGTH');
    expect(rit?.message).toContain('6 s with the tempo map');
  });
});
