import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { add, cmp, div, floor, fromFloat, fromJson, mul, parseDecimal, rat, sub, toJson, type Rational } from "../src";

// Naive bigint reference (ADR-002 differential test).
type Ref = [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a;
};
const norm = ([n, d]: Ref): Ref => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return [n / g, d / g];
};
const asRef = (r: Rational): Ref => [BigInt(r.n), BigInt(r.d)];
const same = (r: Rational, ref: Ref): void => {
  expect(asRef(r)).toEqual(norm(ref));
};

const arbInt = fc.oneof(fc.integer({ min: -1000, max: 1000 }), fc.bigInt({ min: -(2n ** 70n), max: 2n ** 70n }));
const arbDen = fc.oneof(fc.integer({ min: 1, max: 1000 }), fc.bigInt({ min: 1n, max: 2n ** 70n }));
const arbRat = fc.tuple(arbInt, arbDen).map(([n, d]) => rat(BigInt(n), BigInt(d)));

describe("Rational", () => {
  it("normalises", () => {
    expect(toJson(rat(2, -4))).toEqual([-1, 2]);
    expect(toJson(rat(0, 7))).toEqual([0, 1]);
  });
  it("matches the bigint reference on every operation", () => {
    fc.assert(fc.property(arbRat, arbRat, (a, b) => {
      const [an, ad] = asRef(a);
      const [bn, bd] = asRef(b);
      same(add(a, b), [an * bd + bn * ad, ad * bd]);
      same(sub(a, b), [an * bd - bn * ad, ad * bd]);
      same(mul(a, b), [an * bn, ad * bd]);
      if (bn !== 0n) same(div(a, b), [an * bd, ad * bn]);
      const x = an * bd;
      const y = bn * ad;
      expect(cmp(a, b)).toBe(x < y ? -1 : x > y ? 1 : 0);
      let q = an / ad;
      if (an % ad !== 0n && an < 0n) q -= 1n;
      same(floor(a), [q, 1n]);
    }), { numRuns: 2000 });
  });
  it("demotes back to the fast path", () => {
    const big = rat(2n ** 40n, 2n ** 40n);
    expect(typeof big.n).toBe("number");
  });
  it("parses decimals exactly", () => {
    expect(toJson(parseDecimal(".5")!)).toEqual([1, 2]);
    expect(toJson(parseDecimal("-2.25")!)).toEqual([-9, 4]);
    expect(parseDecimal("abc")).toBeNull();
  });
  it("approximates floats with bounded denominators", () => {
    expect(toJson(fromFloat(0.333333333, 100))).toEqual([1, 3]);
  });
  it("round-trips JSON and rejects d = 0", () => {
    const r = rat(2n ** 80n, 3n);
    expect(cmp(fromJson(toJson(r)), r)).toBe(0);
    expect(() => fromJson([1, 0])).toThrow();
  });
});