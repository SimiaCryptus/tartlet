// Tempo maps (docs/long_compositions.md P5). Patterns stay functions of cycles; only hosts that
// turn cycles into seconds use these. Between two points the tempo changes linearly in cycles.
import { type Rational, toNumber } from './rational';

/** From `cycle` on, the tempo moves linearly towards the next point. */
export interface TempoPoint {
  readonly cycle: Rational;
  readonly cps: Rational;
}

export interface TempoCurve {
  /** Seconds from cycle 0 to `cycle` (negative before cycle 0). */
  seconds(cycle: number): number;
  /** The cycle reached `seconds` after cycle 0. */
  cycle(seconds: number): number;
  /** Cycles per second at `cycle`. */
  cps(cycle: number): number;
}

interface Seg {
  readonly c0: number;
  readonly c1: number;
  readonly a: number;
  readonly b: number;
}

function rate(s: Seg, c: number): number {
  return s.a === s.b ? s.a : s.a + ((s.b - s.a) * (c - s.c0)) / (s.c1 - s.c0);
}

/** Seconds spent between cycles x ≤ y inside one segment: the integral of 1 / cps. */
function span(s: Seg, x: number, y: number): number {
  if (s.a === s.b) return (y - x) / s.a;
  const k = (s.b - s.a) / (s.c1 - s.c0);
  return Math.log(rate(s, y) / rate(s, x)) / k;
}

/**
 * A curve from a map whose cycles are non-negative and in order. Before the first point the
 * tempo is `base`; after the last it stays at the last point's tempo.
 */
export function tempoCurve(map: readonly TempoPoint[], base: Rational): TempoCurve {
  const b0 = toNumber(base);
  const segs: Seg[] = [];
  const first = map[0];
  if (!first) {
    segs.push({ c0: -Infinity, c1: Infinity, a: b0, b: b0 });
  } else {
    segs.push({ c0: -Infinity, c1: toNumber(first.cycle), a: b0, b: b0 });
    for (let i = 0; i + 1 < map.length; i++) {
      const p = map[i];
      const q = map[i + 1];
      if (!p || !q) continue;
      const c0 = toNumber(p.cycle);
      const c1 = toNumber(q.cycle);
      if (c1 > c0) segs.push({ c0, c1, a: toNumber(p.cps), b: toNumber(q.cps) });
    }
    const last = map[map.length - 1] ?? first;
    const l = toNumber(last.cps);
    segs.push({ c0: toNumber(last.cycle), c1: Infinity, a: l, b: l });
  }
  const between = (x: number, y: number): number => {
    let t = 0;
    for (const s of segs) {
      const lo = Math.max(x, s.c0);
      const hi = Math.min(y, s.c1);
      if (hi > lo) t += span(s, lo, hi);
    }
    return t;
  };
  return {
    seconds: (c) => (c >= 0 ? between(0, c) : -between(c, 0)),
    cycle: (t) => {
      const s0 = segs[0];
      if (t <= 0 || !s0) return t * (s0?.a ?? b0);
      let rem = t;
      let x = 0;
      for (const s of segs) {
        if (s.c1 <= x) continue;
        const lo = Math.max(x, s.c0);
        const dt = Number.isFinite(s.c1) ? span(s, lo, s.c1) : Infinity;
        if (rem <= dt) {
          const r = rate(s, lo);
          if (s.a === s.b) return lo + rem * r;
          const k = (s.b - s.a) / (s.c1 - s.c0);
          return lo + (r * Math.exp(k * rem) - r) / k;
        }
        rem -= dt;
        x = s.c1;
      }
      return x;
    },
    cps: (c) => {
      for (const s of segs) if (c >= s.c0 && c < s.c1) return rate(s, c);
      return segs[segs.length - 1]?.a ?? b0;
    },
  };
}
