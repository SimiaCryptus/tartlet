// T2 L1 rows (idea.md §12.2). Expectations are hand-written from §7.2.
import { describe, expect, it } from 'vitest';
import { parseMini } from '@tartlet/mini';
import { eq, rat, toJson, toNumber } from '@tartlet/time';
import { compileMini, pure, type Event, type Pattern } from '../src';

const pat = (src: string): Pattern<string> => {
  const r = parseMini(src);
  expect(r.diagnostics).toEqual([]);
  return compileMini(r.ast, (a) => pure(a.text));
};
const onsets = (src: string, c = 0, seed = 't'): [string, [number | string, number | string]][] =>
  pat(src)
    .query({
      span: { begin: rat(c), end: rat(c + 1) },
      seed,
      controls: new Map(),
      provenance: false,
      budget: { steps: 1e7, events: 1e7 },
    })
    .filter((e: Event<string>) => e.whole !== null && eq(e.whole.begin, e.part.begin))
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin))
    .map((e) => [e.value, toJson(e.whole!.begin)]);

describe('L1 mini-notation, T2 rows', () => {
  it('M-21 patterned euclid', () => {
    expect([0, 1].map((c) => onsets('a(<3 5>,8)', c).length)).toEqual([3, 5]);
  });
  it('M-22 polymeter aligns layers by step', () => {
    const evs = onsets('{a b c, d e}');
    expect(evs.filter(([v]) => 'abc'.includes(v))).toEqual([
      ['a', [0, 1]],
      ['b', [1, 3]],
      ['c', [2, 3]],
    ]);
    expect(evs.filter(([v]) => 'de'.includes(v))).toEqual([
      ['d', [0, 1]],
      ['e', [1, 3]],
      ['d', [2, 3]],
    ]);
  });
  it('M-23 polymeter with explicit steps wraps', () => {
    expect(onsets('{a b c}%4')).toEqual([
      ['a', [0, 1]],
      ['b', [1, 4]],
      ['c', [1, 2]],
      ['a', [3, 4]],
    ]);
    expect(onsets('{a b c}%4', 1)[0]?.[0]).toBe('b');
  });
  it('M-25 random choice picks one per cycle, seeded', () => {
    const run = (seed: string) =>
      Array.from({ length: 30 }, (_, c) =>
        onsets('a | b | c', c, seed)
          .map(([v]) => v)
          .join(''),
      );
    const a = run('t');
    expect(a.every((x) => x.length === 1)).toBe(true);
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(run('t')).toEqual(a);
  });
  it('M-28 dot grouping', () => {
    expect(onsets('a b . c d e')).toEqual([
      ['a', [0, 1]],
      ['b', [1, 4]],
      ['c', [1, 2]],
      ['d', [2, 3]],
      ['e', [5, 6]],
    ]);
  });
});
