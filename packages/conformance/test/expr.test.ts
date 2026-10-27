// T0 L2 rows and the §13.1 exit example.
import { describe, expect, it } from 'vitest';
import { check, applyFix, locator } from '@tartlet/check';
import { compile } from '@tartlet/core';
import { rat, toJson } from '@tartlet/time';
import { runSource } from '../src/run';

const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const vals = (src: string, c = 0) => runSource(src, cyc(c)).map((e) => ({ ...e.value }));
const opts = { documentId: 'd', blobIndex: '0' };

export const EXAMPLE = `setcpm(92/4)

$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
`;

describe('L2 expressions, T0 rows', () => {
  it('X-01 s and its alias sound', () => {
    expect(vals('s("bd sd")')).toEqual([{ s: 'bd' }, { s: 'sd' }]);
    const p = check('sound("bd")', opts).program.outputs[0]?.expr;
    expect(p).toMatchObject({ kind: 'control', control: 's', alias: 'sound' });
  });
  it('X-02 note', () => {
    expect(vals('note("c e g")').map((v) => v.note)).toEqual([48, 52, 55].map((value) => ({ kind: 'midi', value })));
  });
  it('X-04 chained controls merge', () => {
    expect(vals('note("c").s("sawtooth").gain(.8)')).toEqual([
      { note: { kind: 'midi', value: 48 }, s: 'sawtooth', gain: 0.8 },
    ]);
  });
  it('X-06 stack', () => {
    expect(vals('stack(s("bd*4"), note("c2"))')).toHaveLength(5);
  });
  it('X-07 cat', () => {
    // A combinator of mini strings is a valid control argument; cat plays one per cycle.
    expect([0, 1].map((c) => vals('s(cat("a","b"))', c).map((v) => v.s))).toEqual([['a'], ['b']]);
    expect([0, 1].map((c) => runSource('cat(s("a"), s("b"))', cyc(c)).map((e) => e.value.s))).toEqual([['a'], ['b']]);
  });
  it('X-09 fast, slow and patterned slow', () => {
    expect(vals('s("a b").fast(2)')).toHaveLength(4);
    expect(vals('s("a b").slow(2)')).toEqual([{ s: 'a' }]);
    const evs = [0, 1].map(
      (c) =>
        runSource('s("a b").slow("<1 2>")', cyc(c)).filter(
          (e) => toJson(e.whole!.begin).join() === toJson(e.part.begin).join(),
        ).length,
    );
    // Cycle 1 runs at slow(2): its window [1, 2) holds the onset of "b" (whole [1, 2)).
    expect(evs).toEqual([2, 1]);
  });
  it('X-25 tempo is exact', () => {
    expect(toJson(check('setcps(.6)', opts).program.settings.cps)).toEqual([3, 5]);
    expect(toJson(check('setcpm(120/4)', opts).program.settings.cps)).toEqual([1, 2]);
  });
  it('X-30 comments are ignored', () => {
    expect(vals('// drums\ns("bd") /* kick */')).toEqual([{ s: 'bd' }]);
  });
  it('Q-01 typo gives a warning with a safe fix, and the track plays', () => {
    const src = 's("bd").romm(.4)';
    const r = check(src, opts);
    const d = r.diagnostics.find((x) => x.id === 'W-REG-UNKNOWN');
    expect(d?.fixes?.[0]?.safe).toBe(true);
    expect(r.program.outputs[0]?.status).toBe('ok');
    expect(applyFix(src, d!.fixes![0]!)).toBe('s("bd").room(.4)');
  });
  it('Q-07 compat alias', () => {
    expect(check('s("bd").reverb(.4)', opts).diagnostics[0]?.id).toBe('I-REG-ALIAS');
    expect(vals('s("bd").reverb(.4)')).toEqual([{ s: 'bd', room: 0.4 }]);
  });
  it('M-30 a malformed track never kills the drums', () => {
    const r = check('$: s("bd*4")\n$: note("[a b")', opts);
    expect(r.program.outputs.map((o) => o.status)).toEqual(['ok', 'muted-error']);
    expect(r.diagnostics[0]).toMatchObject({ id: 'E-MINI-UNCLOSED', range: { start: { line: 1, col: 9 } } });
  });
  it('ids are stable when a method is appended (X-36 precondition)', () => {
    const a = check('$: s("bd*8")', opts).program.outputs[0]!.expr;
    const b = check('$: s("bd*8").gain(.8)', opts).program.outputs[0]!.expr;
    expect(b.kind === 'control' && b.target?.id).toBe(a.id);
  });
  it('§13.1 example: three outputs with events and origin provenance', () => {
    const r = check(EXAMPLE, opts);
    expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(toJson(r.program.settings.cps)).toEqual([23, 60]);
    const p = compile(r.program, { locate: locator(EXAMPLE) });
    const q = p.query(cyc(0), { provenance: true });
    expect([...q.byOutput.values()].every((evs) => evs.length > 0)).toBe(true);
    const pad = [...q.byOutput.values()][2]![0]!;
    expect(pad.value.note).toEqual({ kind: 'midi', value: 50 }); // D3, TS-11
    for (const e of q.events) expect(e.provenance.some((pr) => pr.role === 'origin')).toBe(true);
  });
});
