// Generators and grammars of docs/symphonic.md. Expectations come from the definitions.
import { describe, expect, it } from 'vitest';
import {
  envAt,
  intAt,
  lsysAt,
  lsysPlan,
  parseEnvPoints,
  parseFormLayout,
  parseLsysAxiom,
  parseLsysRules,
  parseSieve,
  permutation,
  ringRow,
  sieveHas,
} from '../src';

const seq = (name: string, n: number, a?: number, b?: number) =>
  Array.from({ length: n }, (_, i) => intAt(name, i, a, b));

describe('integer sequences', () => {
  it('follow their definitions', () => {
    expect(seq('ruler', 8)).toEqual([0, 1, 0, 2, 0, 1, 0, 3]);
    expect(seq('thuemorse', 8)).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
    expect(seq('norgard', 8)).toEqual([0, 1, -1, 2, 1, 0, -2, 3]);
    expect(seq('fib', 16, 3)).toEqual([0, 1, 1, 2, 0, 2, 2, 1, 0, 1, 1, 2, 0, 2, 2, 1]);
    expect(seq('sturm', 13, 5, 13).reduce((s, x) => (s ?? 0) + (x ?? 0), 0)).toBe(5);
    expect(seq('vdc', 4)).toEqual([0, 0.5, 0.25, 0.75]);
    expect(seq('prime', 11)).toEqual([0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0]);
    expect(intAt('prime', 2147483647)).toBe(1);
    expect([0, 5, 26].map((i) => intAt('collatz', i))).toEqual([0, 8, 111]);
    expect(seq('digits', 15)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 0, 1, 1, 1]);
    expect(intAt('nope', 0)).toBeUndefined();
  });
});

describe('permutations and ringing', () => {
  it('permutations are lexicographic', () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => permutation(3, k).join(''))).toEqual([
      '012',
      '021',
      '102',
      '120',
      '201',
      '210',
    ]);
  });
  it('plain hunt on four bells', () => {
    expect(Array.from({ length: 9 }, (_, r) => ringRow('plainhunt', 4, r)?.join(''))).toEqual([
      '1234',
      '2143',
      '2413',
      '4231',
      '4321',
      '3412',
      '3142',
      '1324',
      '1234',
    ]);
  });
});

describe('grammars', () => {
  it('sieves', () => {
    const r = parseSieve('3@0 | 4@1');
    if ('error' in r) throw new Error(r.error.message);
    expect(Array.from({ length: 12 }, (_, i) => i).filter((i) => sieveHas(r.sieve, i))).toEqual([0, 1, 3, 5, 6, 9]);
    const odd = parseSieve('-2@0');
    if ('error' in odd) throw new Error(odd.error.message);
    expect([0, 1, 2, 3].map((i) => sieveHas(odd.sieve, i))).toEqual([false, true, false, true]);
    expect(parseSieve('3@')).toHaveProperty('error');
    expect(parseSieve('3@0 x')).toMatchObject({ error: { range: [4, 5] } });
  });
  it('form layouts', () => {
    const r = parseFormLayout("A@16 B'@8 C");
    if ('error' in r) throw new Error(r.error.message);
    expect(r.sections.map((s) => [s.part, s.primes, Number(s.len.n)])).toEqual([
      [0, 0, 16],
      [1, 1, 8],
      [2, 0, 1],
    ]);
    expect(parseFormLayout('A x')).toMatchObject({ error: { range: [2, 3] } });
    expect(parseFormLayout('A@0')).toHaveProperty('error');
  });
  it('envelopes', () => {
    const r = parseEnvPoints('0 1@3 0');
    if ('error' in r) throw new Error(r.error.message);
    expect([0, 0.25, 0.5, 0.75].map((x) => envAt(r.points, x))).toEqual([0, 1, 1 - 1 / 3, 1 - 2 / 3]);
  });
  it('rewriting systems', () => {
    const ax = parseLsysAxiom('a');
    const rules = parseLsysRules('a=a b, b=a');
    if ('error' in ax || 'error' in rules) throw new Error('bad');
    const plan = lsysPlan(ax.atoms, rules.rules, 4);
    expect(plan?.total).toBe(8);
    expect(Array.from({ length: 8 }, (_, j) => (plan ? lsysAt(plan, j) : '')).join('')).toBe('abaababa');
    const big = parseLsysRules('a=a a a');
    if ('error' in big) throw new Error('bad');
    expect(lsysPlan(ax.atoms, big.rules, 16)).toBeNull();
    expect(parseLsysRules('a b')).toHaveProperty('error');
    expect(parseLsysRules('a=a | b')).toHaveProperty('error');
  });
});
