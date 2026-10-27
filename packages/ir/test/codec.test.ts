// Z-10: hostile IR is rejected by ingestion validation.
import { describe, expect, it } from 'vitest';
import { decodeProgram } from '../src';

const R = { start: { line: 0, col: 0, byte: 0 }, end: { line: 0, col: 0, byte: 0 } };
const T = { kind: 'pattern', of: 'controls' };
const base = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    irVersion: 'tartlet/1',
    settings: { cps: [1, 2], meta: {} },
    bindings: [],
    outputs: [],
    resources: [],
    diagnostics: [],
    ...over,
  });
const ref = (id: string, binding: string) => ({ kind: 'ref', id, range: R, type: T, name: binding, binding });

describe('IR ingestion (Z-10)', () => {
  it('accepts a minimal program', () => {
    expect(decodeProgram(base()).settings.cps).toEqual({ n: 1, d: 2 });
  });
  it('rejects d = 0 and the denominator ceiling', () => {
    expect(() => decodeProgram(base({ settings: { cps: [1, 0], meta: {} } }))).toThrow();
    expect(() => decodeProgram(base({ settings: { cps: [1, 10_000_000_000], meta: {} } }))).toThrow(/ceiling/);
  });
  it('rejects prototype keys', () => {
    expect(() =>
      decodeProgram(
        '{"irVersion":"tartlet/1","settings":{"cps":[1,2],"meta":{"__proto__":{"x":"y"}}},"bindings":[],"outputs":[],"resources":[],"diagnostics":[]}',
      ),
    ).toThrow(/forbidden/);
  });
  it('rejects binding reference cycles and dangling references', () => {
    const cyc = base({
      bindings: [
        { id: 'A', name: 'a', expr: ref('r1', 'B') },
        { id: 'B', name: 'b', expr: ref('r2', 'A') },
      ],
    });
    expect(() => decodeProgram(cyc)).toThrow(/cycle/);
    const dangling = base({ outputs: [{ id: 'o', expr: ref('r', 'Z'), status: 'ok' }] });
    expect(() => decodeProgram(dangling)).toThrow(/unknown binding/);
  });
  it('rejects unknown node kinds and runaway nesting', () => {
    expect(() =>
      decodeProgram(base({ outputs: [{ id: 'o', expr: { kind: 'eval', id: 'x', range: R, type: T }, status: 'ok' }] })),
    ).toThrow();
    let deep: unknown = { kind: 'silence', id: 's', range: R, type: T };
    for (let i = 0; i < 400; i++)
      deep = { kind: 'combine', id: `c${String(i)}`, range: R, type: T, op: 'stack', children: [deep] };
    expect(() => decodeProgram(base({ outputs: [{ id: 'o', expr: deep, status: 'ok' }] }))).toThrow(/too deep/);
  });
});
