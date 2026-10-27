// Pattern laws (idea.md §8.3): span splitting and containment over generated spans.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseMini } from "@tartlet/mini";
import { add, lte, rat, toJson, type Rational } from "@tartlet/time";
import { compileMini, pure, type Event } from "../src";

const SOURCES = ["a b c d", "<a b c>", "a/2", "[a b]*3", "a [b c]/3", "<a [b c]>*2", "a*<2 3>", "a(3,8)", "a*8?", "a(<3 5>,8,<0 2>)", "a@3 b!2"];
const q = (src: string, b: Rational, e: Rational): Event<string>[] =>
  compileMini(parseMini(src).ast, (a) => pure(a.text)).query({ span: { begin: b, end: e }, seed: "t", controls: new Map(), provenance: false, budget: { steps: 1e7, events: 1e7 } });

const key = (e: Event<string>): string => JSON.stringify([e.value, e.whole && [toJson(e.whole.begin), toJson(e.whole.end)]]);
/** Merges fragments sharing a whole and value with adjacent parts. */
const merged = (evs: Event<string>[]): string[] => {
  const groups = new Map<string, Event<string>[]>();
  for (const e of evs) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  const out: string[] = [];
  for (const [k, es] of groups) {
    es.sort((a, b) => (lte(a.part.begin, b.part.begin) ? -1 : 1));
    let cur = es[0]!.part;
    for (const e of es.slice(1)) {
      if (toJson(e.part.begin).join() === toJson(cur.end).join()) cur = { begin: cur.begin, end: e.part.end };
      else { out.push(k + JSON.stringify([toJson(cur.begin), toJson(cur.end)])); cur = e.part; }
    }
    out.push(k + JSON.stringify([toJson(cur.begin), toJson(cur.end)]));
  }
  return out.sort();
};

const arbPoint = fc.tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 12 })).map(([n, d]) => rat(n, d));

describe("pattern laws", () => {
  for (const src of SOURCES) {
    it(`span splitting and containment: ${src}`, () => {
      fc.assert(fc.property(arbPoint, arbPoint, arbPoint, (x, y, z) => {
        const [a, t, c] = [x, add(x, y), add(add(x, y), z)];
        if (!(lte(a, t) && lte(t, c)) || toJson(a).join() === toJson(c).join()) return;
        const whole = q(src, a, c);
        for (const e of whole) expect(lte(a, e.part.begin) && lte(e.part.end, c)).toBe(true);
        expect(merged(whole)).toEqual(merged([...q(src, a, t), ...q(src, t, c)]));
      }), { numRuns: 300 });
    });
  }
});