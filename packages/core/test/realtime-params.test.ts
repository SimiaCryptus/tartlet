import { describe, expect, it } from 'vitest';
import { check, locator } from '@tartlet/check';
import { compile, type ControlMap, type Event } from '@tartlet/core';
import { ONE, ZERO, rat, toNumber, type TimeSpan } from '@tartlet/time';

const CYCLE_0: TimeSpan = { begin: ZERO, end: ONE };

/** Events in onset order, so tests do not depend on how layers are stacked. */
const inOrder = (evs: readonly Event<ControlMap>[]): Event<ControlMap>[] =>
  [...evs].sort((a, b) => toNumber((a.whole ?? a.part).begin) - toNumber((b.whole ?? b.part).begin));

function compileSource(source: string) {
  const { program, diagnostics } = check(source, { documentId: 'doc-core-params', blobIndex: '0' });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  expect(errors).toEqual([]);
  return compile(program, { locate: locator(source) });
}

describe('CompiledProgram.query(): realtime param(...) evaluation', () => {
  it('uses defaultValue when controls are omitted and reflects updated controls across repeated queries without re-compiling', () => {
    // `lpf` is an alias of the canonical `cutoff` control.
    const compiled = compileSource('s("bd sd").lpf(param("cutoff", 800, 100, 4000))');

    const resDefault = compiled.query(CYCLE_0, { provenance: true });
    expect(resDefault.events).toHaveLength(2);
    expect(resDefault.events.map((e) => e.value.cutoff)).toEqual([800, 800]);

    const q1 = { provenance: true, controls: new Map<string, unknown>([['cutoff', 350]]) };
    const res1 = compiled.query(CYCLE_0, q1);
    expect(res1.events.map((e) => e.value.cutoff)).toEqual([350, 350]);

    const q2 = { provenance: true, controls: new Map<string, unknown>([['cutoff', 2200]]) };
    const res2 = compiled.query(CYCLE_0, q2);
    expect(res2.events.map((e) => e.value.cutoff)).toEqual([2200, 2200]);

    const qReset = { provenance: true, controls: new Map<string, unknown>([['other', 999]]) };
    const resReset = compiled.query(CYCLE_0, qReset);
    expect(resReset.events.map((e) => e.value.cutoff)).toEqual([800, 800]);
  });

  it('clamps out-of-range control values and falls back to defaultValue for non-finite or unparseable inputs', () => {
    const compiled = compileSource('s("bd").lpf(param("cutoff", 800, 100, 4000))');

    const low = compiled.query(CYCLE_0, {
      provenance: false,
      controls: new Map<string, unknown>([['cutoff', 25]]),
    });
    expect(low.events[0]!.value.cutoff).toBe(100);

    const high = compiled.query(CYCLE_0, {
      provenance: false,
      controls: new Map<string, unknown>([['cutoff', 9000]]),
    });
    expect(high.events[0]!.value.cutoff).toBe(4000);

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'not-a-number', '', null]) {
      const qBad = { provenance: false, controls: new Map<string, unknown>([['cutoff', bad]]) };
      const res = compiled.query(CYCLE_0, qBad);
      expect(res.events[0]!.value.cutoff).toBe(800);
    }

    const qStr = { provenance: false, controls: new Map<string, unknown>([['cutoff', '1250']]) };
    expect(compiled.query(CYCLE_0, qStr).events[0]!.value.cutoff).toBe(1250);

    const qRat = { provenance: false, controls: new Map<string, unknown>([['cutoff', rat(3000, 2)]]) };
    expect(compiled.query(CYCLE_0, qRat).events[0]!.value.cutoff).toBe(1500);
  });

  it('dynamically evaluates bindings and arithmetic transforms derived from param(...)', () => {
    const compiled = compileSource(`
      const base = param("base", 200, 50, 1000)
      s("bd").lpf(base.mul(2).add(100))
    `);

    expect(compiled.query(CYCLE_0, { provenance: true }).events[0]!.value.cutoff).toBe(500);

    const qUpdated = { provenance: true, controls: new Map<string, unknown>([['base', 400]]) };
    expect(compiled.query(CYCLE_0, qUpdated).events[0]!.value.cutoff).toBe(900);

    const qClamped = { provenance: true, controls: new Map<string, unknown>([['base', 10]]) };
    expect(compiled.query(CYCLE_0, qClamped).events[0]!.value.cutoff).toBe(200);
  });

  it('dynamically updates time transforms and multiple live parameters across queries', () => {
    const compiled = compileSource('s("bd sd").fast(param("rate", 1, 1, 4)).gain(param("g", 0.5, 0, 1))');

    const resDefault = compiled.query(CYCLE_0, { provenance: true });
    expect(resDefault.events).toHaveLength(2);
    expect(inOrder(resDefault.events).map((e) => [e.value.s, e.value.gain])).toEqual([
      ['bd', 0.5],
      ['sd', 0.5],
    ]);

    const qFast = {
      provenance: true,
      controls: new Map<string, unknown>([
        ['rate', 2],
        ['g', 0.85],
      ]),
    };
    const resFast = compiled.query(CYCLE_0, qFast);
    expect(resFast.events).toHaveLength(4);
    expect(inOrder(resFast.events).map((e) => [e.value.s, e.value.gain])).toEqual([
      ['bd', 0.85],
      ['sd', 0.85],
      ['bd', 0.85],
      ['sd', 0.85],
    ]);

    const qSlow = {
      provenance: false,
      controls: new Map<string, unknown>([
        ['rate', 1],
        ['g', 0.2],
      ]),
    };
    const resSlow = compiled.query(CYCLE_0, qSlow);
    expect(resSlow.events).toHaveLength(2);
    expect(inOrder(resSlow.events).map((e) => [e.value.s, e.value.gain])).toEqual([
      ['bd', 0.2],
      ['sd', 0.2],
    ]);
  });
});
