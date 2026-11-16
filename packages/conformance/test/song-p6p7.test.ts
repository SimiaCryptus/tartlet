// Duration reporting (P6) and the smaller changes (P7) of docs/long_compositions.md.
// Expectations are hand-written from the proposal and musical reasoning.
import { describe, expect, it } from 'vitest';
import { check, pieceLength, repairPayload } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { decodeProgram, encodeProgram } from '@tartlet/ir';
import { partIndex, partName } from '@tartlet/registry';
import { eq, rat, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const sounds = (src: string, c = 0) =>
  runSource(src, cyc(c))
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin))
    .map((e) => String(e.value.s))
    .join('');
const ids = (src: string, extra = {}) => check(src, { ...opts, ...extra }).diagnostics.map((d) => d.id);

describe('arrange (P7)', () => {
  it('plays parts for their cycle counts, then repeats', () => {
    const src = 'arrange(2, s("a"), 1, s("b"))';
    expect([0, 1, 2, 3].map((c) => sounds(src, c))).toEqual(['a', 'a', 'b', 'a']);
    expect(ids(`$: ${src}`)).toEqual(['I-FORM-LENGTH']);
  });
  it('accepts fractional cycle counts and restarts each part', () => {
    // Half a cycle of a, then half a cycle of b*2: only the first b fits.
    expect(sounds('arrange(1/2, s("a"), 1/2, s("b*2"))')).toBe('ab');
  });
  it('can be played once', () => {
    const src = 'arrange(1, s("a"), 1, s("b")).once()';
    expect([0, 1, 2, 3].map((c) => sounds(src, c))).toEqual(['a', 'b', '', '']);
  });
  it('diagnostics', () => {
    expect(ids('$: arrange(2, s("a"), 1)')).toContain('E-ARG-MISSING');
    expect(ids('$: arrange(s("a"), 2)')).toContain('E-ARG-TYPE');
    expect(ids('$: arrange(0, s("a"))')).toContain('E-ARG-TYPE');
    expect(check('$: arrange(0, s("a"))\n$: s("b")', opts).program.outputs.map((o) => o.status)).toEqual([
      'muted-error',
      'ok',
    ]);
  });
});

describe('more than 26 form parts (P7)', () => {
  it('names parts A to Z, then AA, AB, …', () => {
    expect([0, 25, 26, 27, 52].map(partName)).toEqual(['A', 'Z', 'AA', 'AB', 'BA']);
    expect(['A', 'Z', 'AA', 'AB', 'BA'].map(partIndex)).toEqual([0, 25, 26, 27, 52]);
  });
  it('plays parts past Z', () => {
    const parts = Array.from({ length: 28 }, (_, i) => `s("p${String(i)}")`).join(', ');
    const src = `form("A Z AA AB", ${parts})`;
    expect([0, 1, 2, 3].map((c) => sounds(src, c))).toEqual(['p0', 'p25', 'p26', 'p27']);
    expect(ids('$: form("AC", s("a"))')).toContain('E-ARG-MISSING');
  });
});

describe('once on any pattern (P7)', () => {
  it('plays the first cycle by default', () => {
    expect([0, 1].map((c) => sounds('s("a b").once()', c))).toEqual(['ab', '']);
    expect(ids('$: s("a b").once()')).toEqual([]);
  });
  it('plays a given number of cycles', () => {
    expect([0, 1, 2].map((c) => sounds('s("<a b c>").once(2)', c))).toEqual(['a', 'b', '']);
  });
  it('plays the whole song when there is one', () => {
    const src = 'song("x@2 y")\n$: s("a").once()';
    expect([0, 1, 2, 3].map((c) => sounds(src, c))).toEqual(['a', 'a', 'a', '']);
  });
});

describe('duration reporting (P6)', () => {
  it('the program carries the song, through the encoding', () => {
    const p = check('song("a@4 b", "once")\n$: s("x")', opts).program;
    expect(p.settings.song && toNumber(p.settings.song.cycles)).toBe(5);
    expect(p.settings.song?.once).toBe(true);
    expect(decodeProgram(encodeProgram(p)).settings.song).toEqual(p.settings.song);
    expect(check('$: s("x")', opts).program.settings.song).toBeUndefined();
  });
  it('pieceLength uses the song, or else the longest period', () => {
    // Default tempo is half a cycle per second.
    expect(pieceLength(check('song("a@4 b")\n$: s("x")', opts).program)).toEqual({ cycles: 5, seconds: 10 });
    const loop = check('$: s("x")', opts).program;
    expect(pieceLength(loop, { x: 3, y: null })).toEqual({ cycles: 3, seconds: 6 });
    expect(pieceLength(loop)).toBeNull();
  });
  it('W-SONG-SHORT only when the host sets a target', () => {
    const song = 'setcpm(30)\nsong("a@4")\n$: s("x")'; // 4 cycles at 1/2 cps: 8 s
    expect(ids(song)).not.toContain('W-SONG-SHORT');
    expect(ids(song, { minSeconds: 60 })).toContain('W-SONG-SHORT');
    expect(ids(song, { minSeconds: 5 })).not.toContain('W-SONG-SHORT');
    expect(ids('$: s("x")', { minSeconds: 10 })).toContain('W-SONG-SHORT');
    // 100 cycles at one cycle per second.
    expect(ids('setcpm(60)\n$: form("A@100", s("a"))', { minSeconds: 90 })).not.toContain('W-SONG-SHORT');
  });
  it('is benign unless the host asks to show it', () => {
    const r = check('setcpm(30)\nsong("a@4")\n$: s("x")', { ...opts, minSeconds: 60 });
    expect(repairPayload(r)).not.toContain('W-SONG-SHORT');
    expect(repairPayload(r, { show: ['W-SONG-SHORT'] })).toContain('W-SONG-SHORT');
  });
});
