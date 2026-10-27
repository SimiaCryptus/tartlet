// T1 L2, D and R rows (idea.md §12.3, §12.4). Expectations are hand-written from the spec.
import { describe, expect, it } from 'vitest';
import { check, locator } from '@tartlet/check';
import { compile, type ControlMap, type Event } from '@tartlet/core';
import { decodeProgram, encodeProgram } from '@tartlet/ir';
import { eq, rat, toJson, toNumber } from '@tartlet/time';
import { canon, runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const onsets = (src: string, c = 0, seed?: string) =>
  runSource(src, cyc(c), seed)
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin));
const notes = (src: string, c = 0) => onsets(src, c).map((e) => (e.value.note as { value: number }).value);
const strip = (v: unknown): string =>
  JSON.stringify(v, (k, x: unknown) => (k === 'range' || k === 'textOffset' ? undefined : x));
const expr0 = (src: string) => check(src, opts).program.outputs[0]?.expr;

describe('L2 expressions, T1 rows', () => {
  it('X-08 seq', () => {
    expect(onsets('seq(s("a"), s("b"))').map((e) => e.value.s)).toEqual(['a', 'b']);
  });
  it('X-10 rev', () => {
    expect(notes('note("a b c").rev()')).toEqual([48, 59, 57]);
  });
  it('X-11 every with a lambda', () => {
    const src = 'note("a b c").every(4, x => x.rev())';
    expect([0, 1, 4].map((c) => notes(src, c))).toEqual([
      [48, 59, 57],
      [57, 59, 48],
      [48, 59, 57],
    ]);
  });
  it('X-12 function value with partial application', () => {
    expect([0, 1, 2, 3].map((c) => onsets('s("a b").every(3, fast(2))', c).length)).toEqual([4, 2, 2, 4]);
  });
  it('X-15 late', () => {
    expect(onsets('s("a").late(1/4)').map((e) => toJson(e.whole!.begin))).toEqual([[1, 4]]);
    expect(onsets('s("a b").early(1/2)').map((e) => e.value.s)).toEqual(['b', 'a']);
  });
  it('X-23 bindings', () => {
    expect(runSource('const d = s("bd*4"); stack(d, d.fast(2))', cyc(0))).toHaveLength(12);
  });
  it('X-24 $: outputs stack', () => {
    expect(runSource('$: s("bd*4")\n$: s("hh*2")', cyc(0))).toHaveLength(6);
  });
  it('X-26 effects controls canonicalised', () => {
    expect(onsets('s("a").room(.3).delay(.25).lpf(800)').map((e) => ({ ...e.value }))).toEqual([
      { s: 'a', room: 0.3, delay: 0.25, cutoff: 800 },
    ]);
  });
  it('X-29 constant arithmetic and constant bindings', () => {
    expect(onsets('s("a b").fast(3/2)')).toHaveLength(3);
    expect(onsets('const k = 2\n$: s("a").fast(k * 2)')).toHaveLength(4);
  });
  it('X-34 block-bodied lambda lowers to the same IR', () => {
    expect(strip(expr0('s("a b").every(4, x => { return x.rev(); })'))).toBe(
      strip(expr0('s("a b").every(4, x => x.rev())')),
    );
  });
  it('X-35 constant spread lowers to the same IR', () => {
    expect(strip(expr0('stack(...[s("a"), s("b")])'))).toBe(strip(expr0('stack(s("a"), s("b"))')));
  });
});

describe('determinism (D rows)', () => {
  const begins = (src: string, seed?: string) =>
    Array.from({ length: 12 }, (_, c) => onsets(src, c, seed).map((e) => toJson(e.whole!.begin).join('/'))).flat();
  it('X-36 appending a method leaves earlier draws unchanged', () => {
    const a = begins('$: s("bd*8").degradeBy(.5)');
    expect(a.length).toBeGreaterThan(10);
    expect(a.length).toBeLessThan(96);
    expect(begins('$: s("bd*8").degradeBy(.5).gain(.8)')).toEqual(a);
  });
  it('M-17 mini degrade is stable per seed and varies across seeds', () => {
    const a = begins('$: s("bd*8?")');
    expect(begins('$: s("bd*8?")')).toEqual(a);
    expect(begins('$: s("bd*8?")', 'other')).not.toEqual(a);
  });
  it("editing another output does not change this output's draws", () => {
    const only = (src: string) =>
      Array.from({ length: 8 }, (_, c) => {
        const r = check(src, opts);
        const p = compile(r.program, { locate: locator(src), ...opts });
        const id = r.program.outputs.find((o) => o.label === 'drums')!.id;
        return (p.query(cyc(c), { provenance: false }).byOutput.get(id) ?? []).filter(isOnset).length;
      });
    expect(only('drums: s("bd*8?")\nbass: note("c")')).toEqual(only('drums: s("bd*8?")\nbass: note("c e").fast(2)'));
  });
});

describe('limits and ingestion', () => {
  it('Z-09 binding bomb mutes only that output', () => {
    const lines = ['const a0 = s("bd*16")'];
    for (let i = 1; i <= 9; i++)
      lines.push(
        `const a${String(i)} = stack(a${String(i - 1)}, a${String(i - 1)}, a${String(i - 1)}, a${String(i - 1)})`,
      );
    lines.push('$: a9', '$: s("hh")');
    const src = lines.join('\n');
    const r = check(src, opts);
    const q = compile(r.program, { locate: locator(src), ...opts }).query(cyc(0), { provenance: false });
    expect([...q.muted.values()].map((d) => d.id)).toEqual(['E-LIMIT-DENSITY']);
    expect(q.events.map((e) => e.value.s)).toEqual(['hh']);
  });
  it('IR round-trips through the tartlet/1 encoding', () => {
    const src =
      'const d = s("bd*2 [~ bd]")\n$: d.every(2, x => x.rev()).gain(.8)\n$: n("<0 2>").scale("D:minor").late(1/8)';
    const r = check(src, opts);
    const back = decodeProgram(encodeProgram(r.program));
    const q = (p: typeof r.program) =>
      canon(
        compile(p, { locate: locator(src), ...opts })
          .query({ begin: rat(0), end: rat(4) }, { provenance: false })
          .events.map((e) => ({
            whole: e.whole && [toJson(e.whole.begin), toJson(e.whole.end)],
            part: [toJson(e.part.begin), toJson(e.part.end)],
            value: e.value,
          })),
      );
    expect(q(back)).toEqual(q(r.program));
  });
});
