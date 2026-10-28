// User-defined functions (docs/language_extensions.md Part 1, TS-48 to TS-52).
// Expectations are hand-written from the proposal and musical reasoning.
import { describe, expect, it } from 'vitest';
import { check, repairPayload } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { eq, rat, toJson, toNumber } from '@tartlet/time';
import { canon, runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const onsets = (src: string, c = 0) =>
  runSource(src, cyc(c))
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin));
const count = (src: string, c = 0) => onsets(src, c).length;
const sounds = (src: string, c = 0) =>
  onsets(src, c)
    .map((e) => String(e.value.s))
    .join('');
const begins = (src: string, c = 0) => onsets(src, c).map((e) => toJson(e.whole!.begin));
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);
const events = (src: string) =>
  canon(
    runSource(src, { begin: rat(0), end: rat(4) }).map((e) => ({
      whole: e.whole && [toJson(e.whole.begin), toJson(e.whole.end)],
      part: [toJson(e.part.begin), toJson(e.part.end)],
      value: e.value,
    })),
  );

describe('function bindings (TS-48)', () => {
  it('are usable as function values', () => {
    const src = 'const wob = x => x.fast(2)\n$: s("a b").every(2, wob)';
    expect(ids(src)).toEqual([]);
    expect([0, 1, 2].map((c) => count(src, c))).toEqual([4, 2, 4]);
  });
  it('accept partial application after the pattern', () => {
    const src = 'const chop = (x, n) => x.ply(n)\n$: s("a b").every(2, chop(3))';
    expect(ids(src)).toEqual([]);
    expect([0, 1].map((c) => count(src, c))).toEqual([6, 2]);
  });
  it('can be called through apply', () => {
    const def = 'const chop = (x, n) => x.ply(n)\n';
    expect(count(`${def}$: s("a b").apply(chop, 2)`)).toBe(4);
    expect(count(`${def}$: s("a b").apply(chop(3))`)).toBe(6);
    expect(sounds('$: s("a b").apply(rev)')).toBe('ba');
    expect(count('$: s("a b").apply(fast, 2)')).toBe(4);
    expect(count('$: s("a b").apply(x => x.fast(2))')).toBe(4);
  });
  it('can be called as methods', () => {
    expect(count('const chop = (x, n) => x.ply(n)\n$: s("a b").chop(2)')).toBe(4);
  });
  it('build patterns', () => {
    expect(begins('const beat = k => s("bd").euclid(k, 8)\n$: beat(3)')).toEqual([
      [0, 1],
      [3, 8],
      [3, 4],
    ]);
    const g = 'const groove = (a, b) => stack(s(a), s(b).gain(.6))\n$: groove("bd*2", "hh*4")';
    expect(ids(g)).toEqual([]);
    expect(count(g)).toBe(6);
  });
  it('use defaults', () => {
    const def = 'const p = (x, n = 2) => x.ply(n)\n';
    expect(count(`${def}$: s("a").p()`)).toBe(2);
    expect(count(`${def}$: s("a").p(3)`)).toBe(3);
  });
  it('take function parameters', () => {
    const def = 'const twice = (x, f) => stack(x, x.apply(f))\n';
    expect(begins(`${def}$: s("a").twice(y => y.late(1/2))`)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(count(`${def}$: s("a b").twice(rev)`)).toBe(4);
  });
  it('expand transparently', () => {
    expect(events('const w = x => x.fast(2).rev()\n$: s("a b c").w()')).toEqual(events('$: s("a b c").fast(2).rev()'));
  });
  it('do not capture the caller lambda parameters', () => {
    // `y.s("b")` refers to the outer y (one event), not the body's own y (two events).
    const src = 'const f = (x, p) => x.every(2, y => stack(y, p))\n$: s("a").every(1, y => y.fast(2).f(y.s("b")))';
    expect(ids(src)).toEqual([]);
    expect(sounds(src)).toBe('aba');
  });
});

describe('function diagnostics (TS-50, TS-51)', () => {
  it('report body errors once, at the definition', () => {
    const r = check('const bad = x => x.wobble(2)\n$: s("a").bad()\n$: s("a").bad()\n$: s("b")', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['E-REG-UNKNOWN', 'E-NAME-ERRORED', 'E-NAME-ERRORED']);
    expect(r.diagnostics[0]?.definition).toBe('bad');
    expect(r.program.outputs.map((o) => o.status)).toEqual(['muted-error', 'muted-error', 'ok']);
    const p = repairPayload(r);
    expect(p).toContain('tartlet: 1 issue to fix');
    expect(p).toContain('function "bad", line 1');
    expect(p).toContain('Rewrite ONLY the definition on line 1');
  });
  it('report kind errors at the call site', () => {
    const r = check('const e = (x, n) => x.every(n, rev)\n$: s("a").e("<2 3>")', opts);
    const d = r.diagnostics.find((x) => x.id === 'E-ARG-TYPE');
    expect(d?.range.start.line).toBe(1);
    expect(r.program.outputs[0]?.status).toBe('muted-error');
  });
  it('move errors that come from the body to the call', () => {
    const r = check('const sc = x => x.scale("C:major")\n$: s("bd").sc()\n$: n("0").sc()', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['E-CAP-PITCHED']);
    const d = r.diagnostics[0]!;
    expect(d.range.start.line).toBe(1);
    expect(d.message.startsWith('In `sc`:')).toBe(true);
    expect(d.related?.[0]?.range.start.line).toBe(0);
    expect(r.program.outputs.map((o) => o.status)).toEqual(['muted-error', 'ok']);
  });
  it('check arity', () => {
    const def = 'const c = (x, n) => x.ply(n)\n';
    expect(ids(`${def}$: s("a").c()`)).toContain('E-ARG-MISSING');
    expect(ids(`${def}$: s("a").c(2, 3)`)).toEqual(['W-ARG-EXTRA']);
  });
  it('warn about unused parameters', () => {
    expect(ids('const u = (x, n) => x.fast(2)\n$: s("a").u(3)')).toEqual(['W-FN-UNUSED']);
  });
  it('reject shadowing and calls on non-functions', () => {
    expect(ids('const fast = x => x\n$: s("a")')).toEqual(['E-NAME-SHADOW']);
    expect(ids('const k = s("a")\n$: k(2)')).toContain('E-LX-CALL');
    expect(ids('const f = (x, g) => g(x)\n$: s("a")')).toContain('E-LX-CALL');
    expect(ids('$: s("a").every(2, (x, y) => x)')).toContain('E-LX-LAMBDA');
  });
  it('limit expansion and mute only that output (TS-52)', () => {
    const r = check('const d = y => stack(y, y, y, y)\n$: d(d(d(d(d(d(d(s("a"))))))))\n$: s("hh")', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['E-LIMIT-EXPAND']);
    expect(r.program.outputs.map((o) => o.status)).toEqual(['muted-error', 'ok']);
  });
});

describe('function seeds (TS-49)', () => {
  const draws = (src: string) =>
    Array.from({ length: 12 }, (_, c) => onsets(src, c).map((e) => toJson(e.whole!.begin).join('/'))).flat();
  it('follow the call, not the layout of the definition', () => {
    const a = draws('const dg = x => x.degradeBy(.5)\n$: s("a*8").dg()');
    expect(a.length).toBeGreaterThan(10);
    expect(a.length).toBeLessThan(96);
    expect(draws('const dg = x => x.degradeBy(.5)\n$: s("a*8").dg().gain(.8)')).toEqual(a);
    expect(draws('// moved\n\nconst dg = x =>\n  x.degradeBy(.5)\n$: s("a*8").dg()')).toEqual(a);
    expect(draws('const dh = x => x.degradeBy(.5)\n$: s("a*8").dh()')).not.toEqual(a);
  });
});
