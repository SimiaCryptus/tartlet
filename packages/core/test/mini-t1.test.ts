// T1 L1 rows (idea.md §12.2). Expectations are hand-written from §7.2.
import { describe, expect, it } from "vitest";
import { parseMini } from "@tartlet/mini";
import { eq, rat, toJson, type Rational } from "@tartlet/time";
import { bjorklund, compileMini, pure, type Event, type Pattern } from "../src";

const pat = (src: string): Pattern<string> => {
  const r = parseMini(src);
  expect(r.diagnostics).toEqual([]);
  return compileMini(r.ast, (a) => pure(a.text));
};
const q = (p: Pattern<string>, b: Rational, e: Rational, seed = "t"): Event<string>[] =>
  p.query({ span: { begin: b, end: e }, seed, controls: new Map(), provenance: false, budget: { steps: 1e8, events: 1e8 } });
const isOnset = (e: Event<string>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const begins = (src: string, cycle = 0, seed = "t") =>
  q(pat(src), rat(cycle), rat(cycle + 1), seed)
    .filter(isOnset)
    .map((e) => toJson(e.whole!.begin))
    .sort((a, b) => Number(a[0]) / Number(a[1]) - Number(b[0]) / Number(b[1]));

describe("L1 mini-notation, T1 rows", () => {
  it("M-13 patterned fast", () => {
    expect([0, 1].map((c) => begins("a*<2 3>", c).length)).toEqual([2, 3]);
  });
  it("M-14 replicate", () => {
    expect(begins("a!3 b")).toEqual([[0, 1], [1, 4], [1, 2], [3, 4]]);
  });
  it("M-15 bare replicate", () => {
    expect(begins("a ! b")).toEqual([[0, 1], [1, 3], [2, 3]]);
  });
  it("M-16 elongate", () => {
    const evs = q(pat("a@3 b"), rat(0), rat(1)).map((e) => [e.value, toJson(e.whole!.begin), toJson(e.whole!.end)]);
    expect(evs).toContainEqual(["a", [0, 1], [3, 4]]);
    expect(evs).toContainEqual(["b", [3, 4], [1, 1]]);
  });
  it("M-17 degrade is a stable, seeded subset", () => {
    const run = (seed: string) => Array.from({ length: 20 }, (_, c) => begins("a*8?", c, seed)).flat();
    const a = run("t");
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThan(160);
    expect(run("t")).toEqual(a);
    expect(run("u")).not.toEqual(a);
  });
  it("M-18 degrade amount gives mean density near 0.2", () => {
    const kept = q(pat("a*8?0.8"), rat(0), rat(1000)).filter(isOnset).length / 8000;
    expect(kept).toBeGreaterThan(0.17);
    expect(kept).toBeLessThan(0.23);
  });
  it("M-19 euclid", () => {
    expect(bjorklund(3, 8)).toEqual([true, false, false, true, false, false, true, false]);
    expect(begins("a(3,8)")).toEqual([[0, 1], [3, 8], [3, 4]]);
  });
  it("M-20 euclid rotation (TS-19: rotate left)", () => {
    expect(begins("a(3,8,2)")).toEqual([[1, 8], [1, 2], [3, 4]]);
  });
});