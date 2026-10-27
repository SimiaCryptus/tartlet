import { describe, expect, it } from "vitest";
import { draw, hash64 } from "../src";

describe("random", () => {
  it("is deterministic and length-prefixed", () => {
    expect(hash64("ab", "c")).toBe(hash64("ab", "c"));
    expect(hash64("ab", "c")).not.toBe(hash64("a", "bc"));
  });
  it("draws are in [0, 1) and roughly uniform", () => {
    let sum = 0;
    for (let i = 0; i < 4000; i++) {
      const x = draw("seed", String(i));
      expect(x >= 0 && x < 1).toBe(true);
      sum += x;
    }
    expect(Math.abs(sum / 4000 - 0.5)).toBeLessThan(0.03);
  });
});