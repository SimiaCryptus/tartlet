import { describe, expect, it } from 'vitest';
import { parse, LineIndex } from '../src';

const ids = (src: string) => parse(src).diagnostics.map((d) => d.id);

describe('expression parser', () => {
  it('parses labelled outputs with chains across lines', () => {
    const t = parse('$: s("bd")\n  .gain(.8)\nlead: note("c")');
    expect(t.diagnostics).toEqual([]);
    expect(t.statements.map((s) => s.k)).toEqual(['output', 'output']);
  });
  it('X-30 keeps comments', () => {
    const t = parse('// hi\n/* there */ s("bd")');
    expect(t.comments).toHaveLength(2);
    expect(t.statements).toHaveLength(1);
  });
  it('recovers at statement boundaries', () => {
    const t = parse('$: s("bd" ))\n$: note("c")');
    expect(t.diagnostics.length).toBeGreaterThan(0);
    expect(t.statements.filter((s) => s.k === 'output')).toHaveLength(1);
  });
  it('maps lines, columns and UTF-8 bytes', () => {
    const li = new LineIndex('é\nab');
    expect(li.position(3)).toEqual({ line: 1, col: 1, byte: 4 });
  });
  it('Z-04 flags interpolation', () => {
    expect(parse('note(`c ${x}`)').diagnostics[0]?.id).toBe('E-LX-INTERP');
  });
  it('parses lambdas and desugars block bodies (X-34)', () => {
    const a = parse('s("a").every(4, x => x.rev())');
    const b = parse('s("a").every(4, x => { return x.rev(); })');
    const c = parse('s("a").every(4, (x) => x.rev())');
    for (const t of [a, b, c]) expect(t.diagnostics).toEqual([]);
  });
  it('parses multi-parameter lambdas with defaults (TS-48)', () => {
    const t = parse('const f = (x, n = 2) => x.ply(n)\nconst g = () => s("a")');
    expect(t.diagnostics).toEqual([]);
    const st = t.statements[0];
    expect(st?.k === 'binding' && st.expr.k === 'lambda' && st.expr.params.map((p) => p.name)).toEqual(['x', 'n']);
    expect(st?.k === 'binding' && st.expr.k === 'lambda' && st.expr.params[1]?.default?.k).toBe('num');
    expect(parse('(a, b)').diagnostics.length).toBeGreaterThan(0);
  });
  it('parses constant spreads (X-35)', () => {
    expect(parse('stack(...[s("a"), s("b")])').diagnostics).toEqual([]);
  });
  it('Z-01, Z-05, Z-06 reject keywords and lambda escapes', () => {
    expect(ids('import x from "y"')).toEqual(['E-LX-IMPORT']);
    expect(ids('for (let i = 0; i < 4; i++) {\n  s("a")\n}')).toEqual(['E-LX-CONTROL']);
    expect(ids('s("a").every(2, x => { y(); return x; })')).toEqual(['E-LX-LAMBDA']);
    expect(ids('new Thing()')).toEqual(['E-LX-KEYWORD']);
  });
  it('Z-03 rejects computed members, ternaries and assignment', () => {
    expect(ids('note("c")["constructor"]')).toEqual(['E-LX-MEMBER']);
    expect(ids('a ? b : c')).toEqual(['E-LX-CONTROL']);
    expect(ids('x = 2')).toEqual(['E-LX-ASSIGN']);
  });
  it('a for block is skipped as one unit', () => {
    const t = parse('for (;;) {\n  s("a")\n}\n$: s("b")');
    expect(t.statements.filter((s) => s.k === 'output')).toHaveLength(1);
  });
});
