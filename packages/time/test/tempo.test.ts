// Tempo maps (docs/long_compositions.md P5). Expectations come from integrating 1 / cps by hand.
import { describe, expect, it } from 'vitest';
import { rat, tempoCurve } from '../src';

describe('tempo curves', () => {
  it('a constant tempo equals setcps', () => {
    const c = tempoCurve([], rat(1, 2));
    expect(c.seconds(4)).toBe(8);
    expect(c.cycle(8)).toBe(4);
    expect(c.seconds(-2)).toBe(-4);
  });
  it('a linear change integrates to a logarithm', () => {
    const c = tempoCurve(
      [
        { cycle: rat(0), cps: rat(1, 2) },
        { cycle: rat(4), cps: rat(1) },
      ],
      rat(1, 2),
    );
    expect(c.seconds(4)).toBeCloseTo(8 * Math.LN2, 9);
    expect(c.seconds(6)).toBeCloseTo(8 * Math.LN2 + 2, 9);
    expect(c.cps(2)).toBeCloseTo(0.75, 9);
    for (const x of [0.5, 3, 5]) expect(c.cycle(c.seconds(x))).toBeCloseTo(x, 9);
  });
  it('a repeated cycle is a step', () => {
    const c = tempoCurve(
      [
        { cycle: rat(0), cps: rat(1) },
        { cycle: rat(2), cps: rat(1) },
        { cycle: rat(2), cps: rat(2) },
      ],
      rat(1),
    );
    expect(c.seconds(4)).toBeCloseTo(3, 9);
    expect(c.cps(1.9)).toBe(1);
    expect(c.cps(2)).toBe(2);
  });
  it('the base tempo holds before the first point', () => {
    const c = tempoCurve([{ cycle: rat(2), cps: rat(1) }], rat(1, 2));
    expect(c.seconds(3)).toBeCloseTo(5, 9);
    expect(c.cycle(5)).toBeCloseTo(3, 9);
  });
  it('time only moves forward', () => {
    const c = tempoCurve(
      [
        { cycle: rat(0), cps: rat(1, 4) },
        { cycle: rat(8), cps: rat(3) },
        { cycle: rat(9), cps: rat(1, 10) },
      ],
      rat(1),
    );
    let prev = -Infinity;
    for (let x = 0; x <= 12; x += 0.25) {
      const t = c.seconds(x);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});
