import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlNode, TransformNode } from '@tartlet/ir';
import { rat } from '@tartlet/time';

function checkDoc(source: string) {
  return check(source, { documentId: 'doc-params', blobIndex: '0' });
}

describe('check(): realtime param(...) lowering and diagnostics', () => {
  it('lowers param(...) inside a control without folding to a constant and records LiveParamDecl', () => {
    const { program, diagnostics } = checkDoc('s("bd").lpf(param("cutoff", 800, 100, 4000))');

    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(program.params).toEqual([{ name: 'cutoff', defaultValue: 800, min: 100, max: 4000 }]);
    expect(program.outputs).toHaveLength(1);
    expect(program.outputs[0]!.status).toBe('ok');

    const ctrl = program.outputs[0]!.expr as ControlNode;
    expect(ctrl.kind).toBe('control');
    // `lpf` is an alias of the canonical `cutoff` control.
    expect(ctrl.control).toBe('cutoff');
    expect(ctrl.value).toMatchObject({
      kind: 'pattern',
      node: {
        kind: 'param',
        name: 'cutoff',
        defaultValue: 800,
        min: 100,
        max: 4000,
        type: { kind: 'signal', of: 'number' },
      },
    });
  });

  it('supports optional defaultValue, min, max, and constant arithmetic in param arguments', () => {
    const { program, diagnostics } = checkDoc(`
      s("bd").gain(param("level"))
      s("sd").pan(param("pan", 0.5))
      s("hh").lpf(param("cut", 400 * 2, 50 + 50, 1000 * 4))
    `);

    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(program.params).toEqual([
      { name: 'level', defaultValue: 0 },
      { name: 'pan', defaultValue: 0.5 },
      { name: 'cut', defaultValue: 800, min: 100, max: 4000 },
    ]);
  });

  it('keeps param(...) live inside bindings and derived bindings without constant-folding away', () => {
    const { program, diagnostics } = checkDoc(`
      const cut = param("cutoff", 600, 100, 3000)
      const doubled = cut.mul(2)
      const rate = param("rate", 2, 1, 4)
      s("bd").lpf(doubled).fast(rate)
    `);

    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(program.params).toEqual([
      { name: 'cutoff', defaultValue: 600, min: 100, max: 3000 },
      { name: 'rate', defaultValue: 2, min: 1, max: 4 },
    ]);

    expect(program.bindings[0]!.expr).toMatchObject({
      kind: 'param',
      name: 'cutoff',
      defaultValue: 600,
      min: 100,
      max: 3000,
    });

    expect(program.bindings[1]!.expr).toMatchObject({
      kind: 'transform',
      fn: 'mul',
      target: { kind: 'ref', name: 'cut', binding: program.bindings[0]!.id },
      args: [{ kind: 'const', value: { t: 'num', v: rat(2) } }],
    });

    const out = program.outputs[0]!.expr as TransformNode;
    expect(out.kind).toBe('transform');
    expect(out.fn).toBe('fast');
    expect(out.args[0]).toMatchObject({
      kind: 'pattern',
      node: { kind: 'ref', name: 'rate', binding: program.bindings[2]!.id },
    });

    const lpf = out.target as ControlNode;
    expect(lpf.kind).toBe('control');
    expect(lpf.control).toBe('cutoff');
    expect(lpf.value).toMatchObject({
      kind: 'pattern',
      node: { kind: 'ref', name: 'doubled', binding: program.bindings[1]!.id },
    });
  });

  it('preserves inline arithmetic transforms over param(...) inside controls', () => {
    const { program, diagnostics } = checkDoc(
      's("bd").lpf(param("cutoff", 500, 100, 2000).add(300)).gain(param("g", 0.5, 0, 1).range(0.1, 0.9))',
    );

    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(program.params).toEqual([
      { name: 'cutoff', defaultValue: 500, min: 100, max: 2000 },
      { name: 'g', defaultValue: 0.5, min: 0, max: 1 },
    ]);

    const gainNode = program.outputs[0]!.expr as ControlNode;
    expect(gainNode.control).toBe('gain');
    expect(gainNode.value).toMatchObject({
      kind: 'pattern',
      node: {
        kind: 'transform',
        fn: 'range',
        target: { kind: 'param', name: 'g', defaultValue: 0.5, min: 0, max: 1 },
      },
    });

    const lpfNode = gainNode.target as ControlNode;
    expect(lpfNode.control).toBe('cutoff');
    expect(lpfNode.value).toMatchObject({
      kind: 'pattern',
      node: {
        kind: 'transform',
        fn: 'add',
        target: { kind: 'param', name: 'cutoff', defaultValue: 500, min: 100, max: 2000 },
        args: [{ kind: 'const', value: { t: 'num', v: rat(300) } }],
      },
    });
  });

  it('deduplicates and merges compatible param(...) declarations across outputs', () => {
    const { program, diagnostics } = checkDoc(`
      s("bd").lpf(param("cutoff", 800, 100, 4000))
      s("hh").lpf(param("cutoff"))
    `);

    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(program.params).toEqual([{ name: 'cutoff', defaultValue: 800, min: 100, max: 4000 }]);

    const secondCtrl = program.outputs[1]!.expr as ControlNode;
    expect(secondCtrl.value).toMatchObject({
      kind: 'pattern',
      node: { kind: 'param', name: 'cutoff', defaultValue: 800, min: 100, max: 4000 },
    });
  });

  it('records param(...) declared inside a user function only when invoked', () => {
    const { program, diagnostics } = checkDoc(`
      const filt = x => x.lpf(param("cutoff", 750, 100, 5000))
      s("bd").filt()
    `);

    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(program.params).toEqual([{ name: 'cutoff', defaultValue: 750, min: 100, max: 5000 }]);
  });

  it('emits diagnostics for missing, non-string, empty, non-numeric, inverted, out-of-range, extra, and conflicting args', () => {
    const bare = checkDoc('s("bd").lpf(param)');
    expect(bare.diagnostics.some((d) => d.id === 'E-ARG-MISSING' && d.severity === 'error')).toBe(true);

    const noArgs = checkDoc('s("bd").lpf(param())');
    expect(noArgs.diagnostics.some((d) => d.id === 'E-ARG-MISSING' && d.severity === 'error')).toBe(true);

    const numName = checkDoc('s("bd").lpf(param(42, 100))');
    expect(numName.diagnostics.some((d) => d.id === 'E-ARG-TYPE' && d.severity === 'error')).toBe(true);

    const emptyName = checkDoc('s("bd").lpf(param("   ", 100))');
    expect(emptyName.diagnostics.some((d) => d.id === 'E-ARG-TYPE' && d.severity === 'error')).toBe(true);

    const badDefault = checkDoc('s("bd").lpf(param("cut", "800"))');
    expect(badDefault.diagnostics.some((d) => d.id === 'E-ARG-TYPE' && d.severity === 'error')).toBe(true);

    const signalDefault = checkDoc('s("bd").lpf(param("cut", sine))');
    expect(signalDefault.diagnostics.some((d) => d.id === 'E-ARG-TYPE' && d.severity === 'error')).toBe(true);

    const badMin = checkDoc('s("bd").lpf(param("cut", 500, "low", 2000))');
    expect(badMin.diagnostics.some((d) => d.id === 'E-ARG-TYPE' && d.severity === 'error')).toBe(true);

    const badMax = checkDoc('s("bd").lpf(param("cut", 500, 100, sine))');
    expect(badMax.diagnostics.some((d) => d.id === 'E-ARG-TYPE' && d.severity === 'error')).toBe(true);

    const inverted = checkDoc('s("bd").lpf(param("cut", 500, 1000, 200))');
    expect(inverted.diagnostics.some((d) => d.id === 'E-ARG-TYPE' && d.severity === 'error')).toBe(true);

    const outOfRange = checkDoc('s("bd").lpf(param("cut", 50, 100, 400))');
    expect(outOfRange.diagnostics.some((d) => d.id === 'W-RANGE' && d.severity === 'warning')).toBe(true);
    expect(outOfRange.program.outputs[0]!.status).toBe('ok');

    const extraArg = checkDoc('s("bd").lpf(param("cut", 200, 100, 400, 999))');
    expect(extraArg.diagnostics.some((d) => d.id === 'W-ARG-EXTRA' && d.severity === 'warning')).toBe(true);
    expect(extraArg.program.outputs[0]!.status).toBe('ok');

    const conflictDefault = checkDoc(`
      s("bd").lpf(param("cut", 200, 100, 1000))
      s("sd").lpf(param("cut", 400, 100, 1000))
    `);
    expect(conflictDefault.diagnostics.some((d) => d.id === 'E-NAME-DUP' && d.severity === 'error')).toBe(true);

    const conflictBounds = checkDoc(`
      s("bd").lpf(param("cut", 300, 100, 1000))
      s("sd").lpf(param("cut", 300, 200, 1000))
    `);
    expect(conflictBounds.diagnostics.some((d) => d.id === 'E-NAME-DUP' && d.severity === 'error')).toBe(true);
  });
});
