// T0 L1 rows (idea.md §12.2). Expectations are hand-written from §7.2.
import { describe, expect, it } from "vitest";
import { parseMini } from "@tartlet/mini";
import { rat, toJson, type Rational } from "@tartlet/time";
import { compileMini, pure, type Pattern } from "../src";

const leaf = (a: { text: string; index?: number }) => pure(a.index === undefined ? a.text : `${a.text}:${String(a.index)}`);
const pat = (src: string): Pattern<string> => {
  const r = parseMini(src);
  expect(r.diagnostics).toEqual([]);
  return compileMini(r.ast, leaf);
};
const q = (p: Pattern<string>, b: Rational, e: Rational) =>
  p.query({ span: { begin: b, end: e }, seed: "t", controls: new Map(), provenance: false, budget: { steps: 1e6, events: 1e6 } });
/** [value, wholeBegin, wholeEnd] for onset events, sorted. */
const onsets = (src: string, cycle = 0) =>
  q(pat(src), rat(cycle), rat(cycle + 1))
    .filter((e) => e.whole && toJson(e.whole.begin).join() === toJson(e.part.begin).join())
    .map((e) => [e.value, toJson(e.whole!.begin), toJson(e.whole!.end)])
    .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));

describe("L1 mini-notation, T0 rows", () => {
  it("M-01 sequence", () => {
    expect(onsets("a b c d")).toEqual([
      ["a", [0, 1], [1, 4]], ["b", [1, 4], [1, 2]], ["c", [1, 2], [3, 4]], ["d", [3, 4], [1, 1]],
    ]);
  });
  it("M-02 rests", () => {
    expect(onsets("a ~ b ~").map((o) => o[1])).toEqual([[0, 1], [1, 2]]);
  });
  it("M-03 subdivision", () => {
    expect(onsets("a [b c]")).toContainEqual(["b", [1, 2], [3, 4]]);
    expect(onsets("a [b c]")).toContainEqual(["c", [3, 4], [1, 1]]);
  });
  it("M-04 nested subdivision", () => {
    expect(onsets("[a [b [c d]]]")).toContainEqual(["d", [7, 8], [1, 1]]);
  });
  it("M-05 alternation", () => {
    expect([0, 1, 2, 3].map((c) => onsets("<a b c>", c)[0]?.[0])).toEqual(["a", "b", "c", "a"]);
  });
  it("M-06 alternation in sequence", () => {
    expect([0, 1].map((c) => onsets("x <a b>", c)[1]?.[0])).toEqual(["a", "b"]);
  });
  it("TS-14 nested alternation advances", () => {
    expect([0, 1, 2, 3].map((c) => onsets("<a <b c>>", c)[0]?.[0])).toEqual(["a", "b", "a", "c"]);
  });
  it("M-07 polyphony", () => {
    expect(onsets("[a, b c]")).toEqual([["a", [0, 1], [1, 1]], ["b", [0, 1], [1, 2]], ["c", [1, 2], [1, 1]]]);
  });
  it("M-08 top-level comma equals M-07", () => {
    expect(onsets("a, b c")).toEqual(onsets("[a, b c]"));
  });
  it("M-09 fast", () => {
    expect(onsets("a*4").map((o) => o[1])).toEqual([[0, 1], [1, 4], [1, 2], [3, 4]]);
  });
  it("M-10 fast on group", () => {
    expect(onsets("[a b]*2").map((o) => o[0]).sort()).toEqual(["a", "a", "b", "b"]);
  });
  it("M-11 slow: whole spans 0–2, clipped per cycle", () => {
    const evs = q(pat("a/2"), rat(0), rat(2));
    expect(evs.map((e) => [toJson(e.whole!.begin), toJson(e.whole!.end), toJson(e.part.begin), toJson(e.part.end)])).toEqual([
      [[0, 1], [2, 1], [0, 1], [1, 1]],
      [[0, 1], [2, 1], [1, 1], [2, 1]],
    ]);
  });
  it("M-12 slow sequence", () => {
    expect([0, 1, 2].map((c) => onsets("[a b c]/3", c).map((o) => o[0]))).toEqual([["a"], ["b"], ["c"]]);
  });
  it("M-24 sample index", () => {
    expect(onsets("bd:3 sd:1").map((o) => o[0])).toEqual(["bd:3", "sd:1"]);
  });
  it("M-29 whitespace and newlines", () => {
    expect(onsets("a\n  b\tc")).toEqual(onsets("a b c"));
  });
});