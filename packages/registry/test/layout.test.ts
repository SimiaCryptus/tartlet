// Repeats, endings and tempo maps (docs/long_compositions.md P4, P5). Expectations are hand-written.
import { describe, expect, it } from 'vitest';
import { parseFormLayout, parseSongLayout, parseTempoMap } from '../src';

const parts = (t: string): number[] => {
  const r = parseFormLayout(t);
  if ('error' in r) throw new Error(r.error.message);
  return r.sections.map((s) => s.part);
};

describe('repeats and endings (P4)', () => {
  it('play out groups and endings', () => {
    expect(parts('A (B 1.C 2.D)*2')).toEqual([0, 1, 2, 1, 3]);
    expect(parts('(A (B)*2)*2')).toEqual([0, 1, 1, 0, 1, 1]);
    const s = parseSongLayout('intro (theme@8 1.half@2 2.full@2)*2 coda@4');
    if ('error' in s) throw new Error(s.error.message);
    expect(s.sections.map((x) => x.name)).toEqual(['intro', 'theme', 'half', 'theme', 'full', 'coda']);
    expect(Number(s.total.n)).toBe(25);
  });
  it('keep source offsets', () => {
    const r = parseFormLayout('A (B 1.C)*2');
    if ('error' in r) throw new Error(r.error.message);
    expect(r.sections.map((s) => s.range)).toEqual([
      [0, 1],
      [3, 4],
      [7, 8],
      [3, 4],
    ]);
  });
  it('reject malformed groups', () => {
    for (const bad of ['(A B', 'A)', '(A)', '(A)*1', '(A)*17', '(A 3.B)*2', '1.A', '()*2', '((A B)*16)*16']) {
      expect(parseFormLayout(bad)).toHaveProperty('error');
    }
    expect(parseFormLayout('A 1.B')).toMatchObject({ error: { range: [2, 5] } });
  });
});

describe('tempo maps (P5)', () => {
  it('parse points in order', () => {
    const r = parseTempoMap('0:25 92:25 100:15');
    if ('error' in r) throw new Error(r.error.message);
    expect(r.points.map((p) => [Number(p.cycle.n), Number(p.cpm.n)])).toEqual([
      [0, 25],
      [92, 25],
      [100, 15],
    ]);
    expect(parseTempoMap('0:25 32:25 32:30')).not.toHaveProperty('error');
  });
  it('reject bad points', () => {
    expect(parseTempoMap('4:30 0:60')).toMatchObject({ error: { range: [5, 9] } });
    for (const bad of ['', '0:x', '0', '-1:30', '0:0', '0:30:2']) expect(parseTempoMap(bad)).toHaveProperty('error');
  });
});
