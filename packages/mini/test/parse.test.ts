import { describe, expect, it } from 'vitest';
import { parseMini } from '../src';

describe('mini parser', () => {
  it('M-01 parses a flat sequence', () => {
    const r = parseMini('a b c d');
    expect(r.diagnostics).toEqual([]);
    expect(r.ast.t).toBe('seq');
  });
  it('M-24 parses sample indices', () => {
    const r = parseMini('bd:3');
    expect(r.ast).toMatchObject({ t: 'seq', steps: [{ body: { t: 'atom', text: 'bd', index: 3, range: [0, 4] } }] });
  });
  it('M-30 reports an unclosed bracket at the bracket', () => {
    const r = parseMini('[a b');
    expect(r.diagnostics).toEqual([expect.objectContaining({ id: 'E-MINI-UNCLOSED', range: [0, 1] })]);
  });
  it('TS-9: a bare `!` cannot start a sequence', () => {
    expect(parseMini('! a').diagnostics[0]?.id).toBe('E-MINI-REPLICATE');
  });
  it('caps multipliers', () => {
    expect(parseMini('a*100000').diagnostics[0]?.id).toBe('E-LIMIT-MULTIPLIER');
    expect(parseMini('a*1e9').diagnostics[0]?.id).toBe('E-LIMIT-MULTIPLIER');
    expect(parseMini('a(3,2000)').diagnostics[0]?.id).toBe('E-LIMIT-MULTIPLIER');
  });
  it('M-17 and M-18 parse degrade', () => {
    expect(parseMini('a?').ast).toMatchObject({ steps: [{ ops: [{ op: 'degrade', at: 1 }] }] });
    expect(parseMini('a?0.3').ast).toMatchObject({ steps: [{ ops: [{ op: 'degrade', amount: 0.3 }] }] });
  });
  it('M-19 and M-20 parse euclid', () => {
    const r = parseMini('a(3,8,2)');
    expect(r.diagnostics).toEqual([]);
    expect(r.ast).toMatchObject({ steps: [{ ops: [{ op: 'euclid' }] }] });
    expect(parseMini('a(3)').diagnostics[0]?.id).toBe('E-MINI-EUCLID');
  });
  it('Z-08 deep nesting is bounded with one diagnostic', () => {
    const r = parseMini('['.repeat(20000) + 'a' + ']'.repeat(20000));
    expect(r.diagnostics.map((d) => d.id)).toEqual(['E-LIMIT-DEPTH']);
  });
});
