import { type Rational, ONE, add, eq, floor, lt, max, min } from "./rational";

/** Half-open [begin, end) in cycles. */
export interface TimeSpan {
  readonly begin: Rational;
  readonly end: Rational;
}

export function span(begin: Rational, end: Rational): TimeSpan {
  if (lt(end, begin)) throw new RangeError("span: end before begin");
  return { begin, end };
}

/** Splits a span at cycle boundaries. Empty spans yield no pieces. */
export function spanCycles(s: TimeSpan): TimeSpan[] {
  const out: TimeSpan[] = [];
  let b = s.begin;
  while (lt(b, s.end)) {
    const e = min(add(floor(b), ONE), s.end);
    out.push({ begin: b, end: e });
    b = e;
  }
  return out;
}

/** Intersection, or null when it is empty. */
export function sect(a: TimeSpan, b: TimeSpan): TimeSpan | null {
  const begin = max(a.begin, b.begin);
  const end = min(a.end, b.end);
  return lt(begin, end) ? { begin, end } : null;
}

export function spanEquals(a: TimeSpan, b: TimeSpan): boolean {
  return eq(a.begin, b.begin) && eq(a.end, b.end);
}

/** Applies a monotone increasing time map to both ends. */
export function mapSpan(s: TimeSpan, f: (t: Rational) => Rational): TimeSpan {
  return { begin: f(s.begin), end: f(s.end) };
}