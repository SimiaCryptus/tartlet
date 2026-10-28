// Pattern laws (idea.md §8.3): span splitting and containment over generated spans.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseMini } from '@tartlet/mini';
import { add, lte, rat, toJson, type Rational } from '@tartlet/time';
import { compileMini, every, iter, palindrome, ply, pure, rev, type Event, type Pattern } from '../src';

const SOURCES = [
  'a b c d',
  '<a b c>',
  'a/2',
  '[a b]*3',
  'a [b c]/3',
  '<a [b c]>*2',
  'a*<2 3>',
  'a(3,8)',
  'a*8?',
  'a(<3 5>,8,<0 2>)',
  'a@3 b!2',
  '{a b c, d e}',
  '{a b c}%2',
  'a | b c',
  'a b . c d e',
];
const mini = (src: string): Pattern<string> => compileMini(parseMini(src).ast, (a) => pure(a.text));
const qp = (p: Pattern<string>, b: Rational, e: Rational): Event<string>[] =>
  p.query({
    span: { begin: b, end: e },
    seed: 't',
    controls: new Map(),
    provenance: false,
    budget: { steps: 1e7, events: 1e7 },
  });
const q = (src: string, b: Rational, e: Rational): Event<string>[] => qp(mini(src), b, e);
/** Transforms built from the algebra directly, so their laws are checked too. */
const BUILT: readonly (readonly [string, Pattern<string>])[] = [
  ['iter(4)', iter(4, mini('a b c d'))],
  ['iterBack(3)', iter(3, mini('a [b c]/2'), true)],
  ['palindrome', palindrome(mini('a b/2 c'))],
  ['rev', rev(mini('a [b c]'))],
  ['ply(3)', ply(rat(3), mini('a b/3'))],
  ['every(3, rev)', every(3, rev, mini('a b c'))],
];

const key = (e: Event<string>): string =>
  JSON.stringify([e.value, e.whole && [toJson(e.whole.begin), toJson(e.whole.end)]]);
/** Merges fragments sharing a whole and value with adjacent parts. */
const merged = (evs: Event<string>[]): string[] => {
  const groups = new Map<string, Event<string>[]>();
  for (const e of evs) {
    const k = key(e);
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  const out: string[] = [];
  for (const [k, es] of groups) {
    es.sort((a, b) => (lte(a.part.begin, b.part.begin) ? -1 : 1));
    const first = es[0];
    if (!first) continue;
    let cur = first.part;
    for (const e of es.slice(1)) {
      if (toJson(e.part.begin).join() === toJson(cur.end).join()) cur = { begin: cur.begin, end: e.part.end };
      else {
        out.push(k + JSON.stringify([toJson(cur.begin), toJson(cur.end)]));
        cur = e.part;
      }
    }
    out.push(k + JSON.stringify([toJson(cur.begin), toJson(cur.end)]));
  }
  return out.sort();
};

// Spans stay within a few cycles: the laws are local, and long spans make dense patterns
// (a*8?, euclid, polymeter) so slow that the property test appears to hang.
const arbStart = fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 1, max: 12 })).map(([n, d]) => rat(n, d));
const arbLen = fc.tuple(fc.integer({ min: 0, max: 48 }), fc.integer({ min: 1, max: 12 })).map(([n, d]) => rat(n, d));

describe('pattern laws', () => {
  for (const src of SOURCES) {
    it(`span splitting and containment: ${src}`, () => {
      fc.assert(
        fc.property(arbStart, arbLen, arbLen, (x, y, z) => {
          const [a, t, c] = [x, add(x, y), add(add(x, y), z)];
          if (!(lte(a, t) && lte(t, c)) || toJson(a).join() === toJson(c).join()) return;
          const whole = q(src, a, c);
          for (const e of whole) expect(lte(a, e.part.begin) && lte(e.part.end, c)).toBe(true);
          expect(merged(whole)).toEqual(merged([...q(src, a, t), ...q(src, t, c)]));
        }),
        { numRuns: 300 },
      );
    }, 30_000);
  }
  for (const [name, p] of BUILT) {
    it(`span splitting and containment: ${name}`, () => {
      fc.assert(
        fc.property(arbStart, arbLen, arbLen, (x, y, z) => {
          const [a, t, c] = [x, add(x, y), add(add(x, y), z)];
          if (toJson(a).join() === toJson(c).join()) return;
          const whole = qp(p, a, c);
          for (const e of whole) expect(lte(a, e.part.begin) && lte(e.part.end, c)).toBe(true);
          expect(merged(whole)).toEqual(merged([...qp(p, a, t), ...qp(p, t, c)]));
        }),
        { numRuns: 300 },
      );
    }, 30_000);
  }
});
