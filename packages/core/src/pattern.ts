// The pattern algebra (idea.md §8). Patterns are pure queries over rational spans.
import {
  type Rational,
  type TimeSpan,
  ONE,
  ZERO,
  add,
  div,
  eq,
  floor,
  gte,
  isRational,
  isZero,
  lt,
  lte,
  mapSpan,
  min,
  mul,
  neg,
  rat,
  sect,
  spanCycles,
  sub,
  toNumber,
  toString,
} from '@tartlet/time';
import type { Provenance, QueryBudget } from '@tartlet/ir';
import { draw } from '@tartlet/random';

export interface Event<T> {
  readonly whole: TimeSpan | null;
  readonly part: TimeSpan;
  readonly value: T;
  readonly provenance: readonly Provenance[];
}
export type TartletEvent<T> = Event<T>;

export interface QueryState {
  readonly span: TimeSpan;
  /** The seed scope: the root seed, or the value set by `.seed()` (TS-28). */
  readonly seed: string;
  readonly controls: ReadonlyMap<string, unknown>;
  readonly provenance: boolean;
  readonly budget: QueryBudget;
}

export interface Pattern<T> {
  query(state: QueryState): Event<T>[];
}

export class BudgetExceeded extends Error {
  constructor(readonly which: 'steps' | 'events') {
    super(`query budget exceeded: ${which}`);
  }
}

const NO_PROV: readonly Provenance[] = Object.freeze([]);
const MAX_PLY = 1024;
const FALSY = new Set(['0', '~', 'f', 'false', '']);

export function pattern<T>(query: (st: QueryState) => Event<T>[]): Pattern<T> {
  return { query };
}

function tick(st: QueryState): void {
  if (--st.budget.steps < 0) throw new BudgetExceeded('steps');
}

function at(st: QueryState, s: TimeSpan): QueryState {
  return { ...st, span: s };
}

/** Truthiness for boolean-like pattern values (struct, mask). */
export function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return !FALSY.has(v);
  if (isRational(v)) return !isZero(v);
  return v !== null && v !== undefined;
}

export function mapEventTime<T>(ev: Event<T>, f: (t: Rational) => Rational): Event<T> {
  return {
    whole: ev.whole ? mapSpan(ev.whole, f) : null,
    part: mapSpan(ev.part, f),
    value: ev.value,
    provenance: ev.provenance,
  };
}

export function silence<T>(): Pattern<T> {
  return pattern(() => []);
}

/** One event per cycle carrying `value`. */
export function pure<T>(value: T, provenance: readonly Provenance[] = NO_PROV): Pattern<T> {
  return pattern((st) => {
    tick(st);
    return spanCycles(st.span).map((part) => {
      const c = floor(part.begin);
      return { whole: { begin: c, end: add(c, ONE) }, part, value, provenance: st.provenance ? provenance : NO_PROV };
    });
  });
}

/**
 * A continuous signal. It returns one event over the queried span, with no whole, valued at
 * the span's start. Receivers sample it at their onsets (TS-33).
 */
export function signal<T>(f: (t: Rational, st: QueryState) => T): Pattern<T> {
  return pattern((st) => {
    tick(st);
    return lt(st.span.begin, st.span.end)
      ? [{ whole: null, part: st.span, value: f(st.span.begin, st), provenance: NO_PROV }]
      : [];
  });
}

export function fmap<A, B>(pat: Pattern<A>, f: (a: A) => B): Pattern<B> {
  return pattern((st) => pat.query(st).map((ev) => ({ ...ev, value: f(ev.value) })));
}

export function stack<T>(pats: readonly Pattern<T>[]): Pattern<T> {
  return pattern((st) => {
    tick(st);
    return pats.flatMap((p) => p.query(st));
  });
}

/** Squeezes each cycle of `pat` into [c+b, c+e) of cycle c, where 0 ≤ b < e ≤ 1. */
export function compress<T>(pat: Pattern<T>, b: Rational, e: Rational): Pattern<T> {
  if (lte(e, b)) return silence();
  const w = sub(e, b);
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = floor(piece.begin);
      const start = add(c, b);
      const win = sect(piece, { begin: start, end: add(c, e) });
      if (!win) continue;
      const toInner = (t: Rational): Rational => add(c, div(sub(t, start), w));
      const toOuter = (t: Rational): Rational => add(start, mul(sub(t, c), w));
      for (const ev of pat.query(at(st, mapSpan(win, toInner)))) out.push(mapEventTime(ev, toOuter));
    }
    return out;
  });
}

/** Weighted sequence: each part gets a share of the cycle proportional to its weight. */
export function timecat<T>(parts: readonly (readonly [Pattern<T>, Rational])[]): Pattern<T> {
  const total = parts.reduce((acc, [, w]) => add(acc, w), ZERO);
  if (lte(total, ZERO)) return silence();
  let pos = ZERO;
  const layers: Pattern<T>[] = [];
  for (const [p, w] of parts) {
    const b = div(pos, total);
    pos = add(pos, w);
    layers.push(compress(p, b, div(pos, total)));
  }
  return stack(layers);
}

export function fastcat<T>(pats: readonly Pattern<T>[]): Pattern<T> {
  return timecat(pats.map((p) => [p, ONE] as const));
}

/**
 * One child per cycle, in turn. In cycle k, child k mod n plays its own cycle floor(k/n),
 * so nested alternations advance (TS-14).
 */
export function slowcat<T>(pats: readonly Pattern<T>[]): Pattern<T> {
  const n = pats.length;
  if (n === 0) return silence();
  const nR = rat(n);
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = floor(piece.begin);
      const k = floor(div(c, nR));
      const idx = toNumber(sub(c, mul(k, nR)));
      const child = pats[idx];
      if (!child) continue;
      const offset = sub(c, k);
      for (const ev of child.query(
        at(
          st,
          mapSpan(piece, (t) => sub(t, offset)),
        ),
      )) {
        out.push(mapEventTime(ev, (t) => add(t, offset)));
      }
    }
    return out;
  });
}

/** One child per cycle, picked by a seeded draw keyed by (scope seed, salt, cycle) (M-25, TS-30). */
export function chooseCycle<T>(pats: readonly Pattern<T>[], salt: string): Pattern<T> {
  const n = pats.length;
  if (n === 0) return silence();
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = floor(piece.begin);
      const idx = Math.min(n - 1, Math.floor(draw(st.seed, salt, toString(c)) * n));
      const child = pats[idx];
      if (child) for (const ev of child.query(at(st, piece))) out.push(ev);
    }
    return out;
  });
}

export function fast<T>(factor: Rational, pat: Pattern<T>): Pattern<T> {
  if (lte(factor, ZERO)) return silence();
  if (eq(factor, ONE)) return pat;
  return pattern((st) => {
    tick(st);
    return pat
      .query(
        at(
          st,
          mapSpan(st.span, (t) => mul(t, factor)),
        ),
      )
      .map((ev) => mapEventTime(ev, (t) => div(t, factor)));
  });
}

export function slow<T>(factor: Rational, pat: Pattern<T>): Pattern<T> {
  return lte(factor, ZERO) ? silence() : fast(div(ONE, factor), pat);
}

/** Shifts the pattern later by `t` cycles. A negative `t` shifts earlier. */
export function late<T>(t: Rational, pat: Pattern<T>): Pattern<T> {
  if (isZero(t)) return pat;
  return pattern((st) => {
    tick(st);
    return pat
      .query(
        at(
          st,
          mapSpan(st.span, (x) => sub(x, t)),
        ),
      )
      .map((ev) => mapEventTime(ev, (x) => add(x, t)));
  });
}

export function early<T>(t: Rational, pat: Pattern<T>): Pattern<T> {
  return late(neg(t), pat);
}

/** Reflects each cycle about its midpoint. */
export function rev<T>(pat: Pattern<T>): Pattern<T> {
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = floor(piece.begin);
      const mirror = add(c, add(c, ONE));
      const refl = (s: TimeSpan): TimeSpan => ({ begin: sub(mirror, s.end), end: sub(mirror, s.begin) });
      for (const ev of pat.query(at(st, refl(piece)))) {
        out.push({
          whole: ev.whole ? refl(ev.whole) : null,
          part: refl(ev.part),
          value: ev.value,
          provenance: ev.provenance,
        });
      }
    }
    return out;
  });
}

/** Applies `f` on cycles 0, n, 2n… and plays `pat` unchanged otherwise. */
export function every<T>(n: number, f: (p: Pattern<T>) => Pattern<T>, pat: Pattern<T>): Pattern<T> {
  if (!(n >= 1)) return pat;
  const alt = f(pat);
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = toNumber(floor(piece.begin));
      const p = ((c % n) + n) % n === 0 ? alt : pat;
      for (const ev of p.query(at(st, piece))) out.push(ev);
    }
    return out;
  });
}
/**
 * Rotates where each cycle starts (X-22, TS-39). Cycle c plays the pattern shifted earlier by
 * (c mod n)/n of a cycle. With `back`, the shift goes later instead. Each cycle is queried on
 * its own, so the result stays inside the queried span.
 */
export function iter<T>(n: number, pat: Pattern<T>, back = false): Pattern<T> {
  if (!Number.isInteger(n) || n <= 1 || n > MAX_PLY) return pat;
  const nR = rat(n);
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = toNumber(floor(piece.begin));
      const i = ((c % n) + n) % n;
      const s = div(rat(i), nR);
      const shift = back ? neg(s) : s;
      if (isZero(shift)) {
        for (const ev of pat.query(at(st, piece))) out.push(ev);
        continue;
      }
      for (const ev of pat.query(
        at(
          st,
          mapSpan(piece, (t) => add(t, shift)),
        ),
      )) {
        out.push(mapEventTime(ev, (t) => sub(t, shift)));
      }
    }
    return out;
  });
}
/** Plays the pattern forwards on even cycles and mirrored on odd cycles (X-22, TS-39). */
export function palindrome<T>(pat: Pattern<T>): Pattern<T> {
  const backwards = rev(pat);
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = toNumber(floor(piece.begin));
      const p = ((c % 2) + 2) % 2 === 1 ? backwards : pat;
      for (const ev of p.query(at(st, piece))) out.push(ev);
    }
    return out;
  });
}

/** Repeats each event `factor` times within its own whole (X-16). Fragments stay consistent. */
export function ply<T>(factor: Rational, pat: Pattern<T>): Pattern<T> {
  const n = Math.floor(toNumber(factor));
  if (n <= 0 || n > MAX_PLY) return silence();
  if (n === 1) return pat;
  const nR = rat(n);
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const ev of pat.query(st)) {
      if (!ev.whole) {
        out.push(ev);
        continue;
      }
      const w = ev.whole;
      const step = div(sub(w.end, w.begin), nR);
      for (let i = 0; i < n; i++) {
        const b = add(w.begin, mul(step, rat(i)));
        const piece = { begin: b, end: add(b, step) };
        const part = sect(piece, ev.part);
        if (part) out.push({ ...ev, whole: piece, part });
      }
    }
    return out;
  });
}

/**
 * Drops each event whose seeded draw falls below `amount`. With `invert`, it keeps exactly
 * those events instead. The draw is keyed by the event's whole, so every fragment gets the
 * same decision (idea.md §8.3 law 4, §8.4). The salt carries the node id (TS-28).
 */
export function degradeBy<T>(amount: number, pat: Pattern<T>, salt = '', invert = false): Pattern<T> {
  if (amount <= 0) return invert ? silence() : pat;
  return pattern((st) =>
    pat.query(st).filter((ev) => {
      const b = (ev.whole ?? ev.part).begin;
      const kept = draw(st.seed, salt, toString(floor(b)), toString(b), '0') >= amount;
      return invert ? !kept : kept;
    }),
  );
}

/** Replaces the seed scope for a subtree (`.seed()`, TS-28). */
export function withSeed<T>(seed: string, pat: Pattern<T>): Pattern<T> {
  return pattern((st) => pat.query({ ...st, seed }));
}
// ---- Library transforms (docs/language_extensions.md Part 2, TS-53 to TS-59)
/** The position of `t` within its cycle, in [0, 1). */
function cyclePos(t: Rational): Rational {
  return sub(t, floor(t));
}
/** Keeps the events whose onset satisfies `keep`. The onset is the whole's start, so fragments agree. */
export function filterOnsets<T>(pat: Pattern<T>, keep: (t: Rational) => boolean): Pattern<T> {
  return pattern((st) => pat.query(st).filter((ev) => keep((ev.whole ?? ev.part).begin)));
}
/**
 * Plays `f(pat)` where events start in [b, e) of their cycle, and `pat` elsewhere. The filter
 * applies to what `f` plays, so `within(0, 1/2, fast(2))` fits a whole fast cycle in the first
 * half (TS-54).
 */
export function within<T>(b: Rational, e: Rational, f: (p: Pattern<T>) => Pattern<T>, pat: Pattern<T>): Pattern<T> {
  if (!lt(b, e)) return pat;
  const inside = (t: Rational): boolean => {
    const x = cyclePos(t);
    return lte(b, x) && lt(x, e);
  };
  return stack([filterOnsets(f(pat), inside), filterOnsets(pat, (t) => !inside(t))]);
}
/** Applies `f` to slot (c mod n) of the n slots of cycle c. With `back`, the slot moves backwards (TS-54). */
export function chunk<T>(n: number, f: (p: Pattern<T>) => Pattern<T>, pat: Pattern<T>, back = false): Pattern<T> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PLY) return pat;
  const nR = rat(n);
  const inside = (t: Rational): boolean => {
    const c = floor(t);
    const k = toNumber(c);
    const i = ((k % n) + n) % n;
    const slot = back ? (n - i) % n : i;
    return toNumber(floor(mul(sub(t, c), nR))) === slot;
  };
  return stack([filterOnsets(f(pat), inside), filterOnsets(pat, (t) => !inside(t))]);
}
/** Plays `f(pat)` in the cycles where `pred` holds, and `pat` in the others. */
export function whenCycle<T>(
  pred: (c: Rational, st: QueryState) => boolean,
  f: (p: Pattern<T>) => Pattern<T>,
  pat: Pattern<T>,
): Pattern<T> {
  const alt = f(pat);
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const p = pred(floor(piece.begin), st) ? alt : pat;
      for (const ev of p.query(at(st, piece))) out.push(ev);
    }
    return out;
  });
}
/** Applies `f` on the last cycle of each group of n cycles. */
export function lastOf<T>(n: number, f: (p: Pattern<T>) => Pattern<T>, pat: Pattern<T>): Pattern<T> {
  if (!(n >= 1)) return pat;
  return whenCycle(
    (c) => {
      const k = toNumber(c);
      return ((k % n) + n) % n === n - 1;
    },
    f,
    pat,
  );
}
/** On odd cycles, squeezes the cycle into its middle half [1/4, 3/4) (TS-55). */
export function brak<T>(pat: Pattern<T>): Pattern<T> {
  return whenCycle(
    (c) => {
      const k = toNumber(c);
      return ((k % 2) + 2) % 2 === 1;
    },
    (p) => late(rat(1, 4), compress(p, ZERO, rat(1, 2))),
    pat,
  );
}
/** Applies `f` to whole cycles chosen by a draw keyed by (scope seed, salt, cycle) (TS-56). */
export function someCyclesBy<T>(
  amount: number,
  f: (p: Pattern<T>) => Pattern<T>,
  pat: Pattern<T>,
  salt: string,
): Pattern<T> {
  if (amount <= 0) return pat;
  return whenCycle((c, st) => draw(st.seed, salt, toString(c)) < amount, f, pat);
}
/** Plays only [b, e) of each cycle, stretched over the whole cycle (TS-55). */
export function zoom<T>(b: Rational, e: Rational, pat: Pattern<T>): Pattern<T> {
  if (!lt(b, e)) return silence();
  const w = sub(e, b);
  if (isZero(b) && eq(w, ONE)) return pat;
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = floor(piece.begin);
      const toInner = (t: Rational): Rational => add(add(c, b), mul(sub(t, c), w));
      const toOuter = (t: Rational): Rational => add(c, div(sub(sub(t, c), b), w));
      for (const ev of pat.query(at(st, mapSpan(piece, toInner)))) out.push(mapEventTime(ev, toOuter));
    }
    return out;
  });
}
/** Repeats the opening fraction `f` of each cycle until the cycle is full (TS-55). */
export function linger<T>(f: Rational, pat: Pattern<T>): Pattern<T> {
  if (lte(f, ZERO) || gte(f, ONE)) return pat;
  if (lt(mul(f, rat(MAX_PLY)), ONE)) return silence();
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = floor(piece.begin);
      const next = add(c, ONE);
      for (let k = 0; ; k++) {
        const shift = mul(f, rat(k));
        const start = add(c, shift);
        if (!lt(start, piece.end)) break;
        const win = sect(piece, { begin: start, end: min(add(start, f), next) });
        if (!win) continue;
        for (const ev of pat.query(
          at(
            st,
            mapSpan(win, (t) => sub(t, shift)),
          ),
        )) {
          out.push(mapEventTime(ev, (t) => add(t, shift)));
        }
      }
    }
    return out;
  });
}
/** Samples `pat` on a grid of n steps per cycle: the grid's wholes, the pattern's values (TS-55). */
export function segment<T>(n: number, pat: Pattern<T>): Pattern<T> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PLY) return pat;
  return appLeft(fast(rat(n), pure(true)), pat, (_g, v) => v);
}
/** Starts every event later by `r` of its own duration and keeps its end (TS-55). */
export function pressBy<T>(r: Rational, pat: Pattern<T>): Pattern<T> {
  if (lte(r, ZERO)) return pat;
  if (gte(r, ONE)) return silence();
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const ev of pat.query(st)) {
      if (!ev.whole) {
        out.push(ev);
        continue;
      }
      const w = ev.whole;
      const whole = { begin: add(w.begin, mul(r, sub(w.end, w.begin))), end: w.end };
      const part = sect(whole, ev.part);
      if (part) out.push({ ...ev, whole, part });
    }
    return out;
  });
}
/**
 * Cuts each cycle into n slices and delays the events starting in the second half of each slice
 * by `amount` of a slice. Events are chosen before they move (TS-54). Each slice is one cycle of
 * the inner pattern, so the work happens on `slow(n)` and is squeezed back with `fast(n)` (TS-63).
 */
export function swingBy<T>(amount: Rational, n: number, pat: Pattern<T>): Pattern<T> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PLY || isZero(amount)) return pat;
  const nR = rat(n);
  const half = rat(1, 2);
  const second = (t: Rational): boolean => !lt(cyclePos(t), half);
  const inner = slow(nR, pat);
  return fast(nR, stack([late(amount, filterOnsets(inner, second)), filterOnsets(inner, (t) => !second(t))]));
}
/**
 * Plays the n slices of each cycle in a seeded order: a permutation, or with `replace` an
 * independent pick per slot. Draws are keyed by (scope seed, salt, cycle, …) (TS-56).
 */
export function shuffle<T>(n: number, pat: Pattern<T>, salt: string, replace = false): Pattern<T> {
  if (!Number.isInteger(n) || n <= 1 || n > MAX_PLY) return pat;
  const nR = rat(n);
  const order = (seed: string, cs: string): number[] => {
    if (replace) {
      return Array.from({ length: n }, (_, j) => Math.min(n - 1, Math.floor(draw(seed, salt, cs, String(j)) * n)));
    }
    const out = Array.from({ length: n }, (_, j) => j);
    for (let k = n - 1; k > 0; k--) {
      const r = Math.min(k, Math.floor(draw(seed, salt, cs, 'p', String(k)) * (k + 1)));
      const tmp = out[k] ?? k;
      out[k] = out[r] ?? r;
      out[r] = tmp;
    }
    return out;
  };
  return pattern((st) => {
    tick(st);
    const res: Event<T>[] = [];
    for (const piece of spanCycles(st.span)) {
      const c = floor(piece.begin);
      const ord = order(st.seed, toString(c));
      for (let j = 0; j < n; j++) {
        const win = sect(piece, { begin: add(c, div(rat(j), nR)), end: add(c, div(rat(j + 1), nR)) });
        if (!win) continue;
        const shift = div(rat((ord[j] ?? j) - j), nR);
        for (const ev of pat.query(
          at(
            st,
            mapSpan(win, (t) => add(t, shift)),
          ),
        )) {
          res.push(mapEventTime(ev, (t) => sub(t, shift)));
        }
      }
    }
    return res;
  });
}
/**
 * Keeps every receiver event whole and combines its value with the argument value sounding at
 * its onset, or `undefined` when none does (accent, TS-59).
 */
export function sampleOnset<A, B, C>(recv: Pattern<A>, arg: Pattern<B>, f: (a: A, b: B | undefined) => C): Pattern<C> {
  return pattern((st) => {
    tick(st);
    return recv.query(st).map((r) => {
      const span = r.whole ?? r.part;
      let hit: B | undefined;
      for (const x of arg.query(at(st, span))) {
        if (lte(x.part.begin, span.begin) && lt(span.begin, x.part.end)) {
          hit = x.value;
          break;
        }
      }
      return { whole: r.whole, part: r.part, value: f(r.value, hit), provenance: r.provenance };
    });
  });
}

/**
 * Patterned transform arguments (idea.md §8.6): the argument is queried first. Each argument
 * event's part becomes a window in which f(value) is queried. Results are clipped to the
 * window by containment.
 */
export function bindWindow<A, T>(arg: Pattern<A>, f: (a: A) => Pattern<T>): Pattern<T> {
  return pattern((st) => {
    tick(st);
    const out: Event<T>[] = [];
    for (const a of arg.query(st)) for (const ev of f(a.value).query(at(st, a.part))) out.push(ev);
    return out;
  });
}

/**
 * Structure from the receiver (idea.md §8.6). Each receiver event keeps its whole and combines
 * with each argument event active within it. Part = intersection of parts (see TS-12).
 * When `keep` is given, argument events failing it contribute nothing (mask).
 */
export function appLeft<A, B, C>(
  recv: Pattern<A>,
  arg: Pattern<B>,
  f: (a: A, b: B) => C,
  keep?: (b: B) => boolean,
): Pattern<C> {
  return pattern((st) => {
    tick(st);
    const out: Event<C>[] = [];
    for (const r of recv.query(st)) {
      for (const x of arg.query(at(st, r.whole ?? r.part))) {
        if (keep && !keep(x.value)) continue;
        const part = sect(r.part, x.part);
        if (!part) continue;
        out.push({
          whole: r.whole,
          part,
          value: f(r.value, x.value),
          provenance: st.provenance ? [...r.provenance, ...x.provenance] : NO_PROV,
        });
      }
    }
    return out;
  });
}

/** Structure from the argument (idea.md §8.6): the argument's wholes survive (struct, euclid). */
export function appRight<A, B, C>(
  recv: Pattern<A>,
  arg: Pattern<B>,
  f: (a: A, b: B) => C,
  keep?: (b: B) => boolean,
): Pattern<C> {
  return pattern((st) => {
    tick(st);
    const out: Event<C>[] = [];
    for (const x of arg.query(st)) {
      if (keep && !keep(x.value)) continue;
      for (const r of recv.query(at(st, x.whole ?? x.part))) {
        const part = sect(x.part, r.part);
        if (!part) continue;
        out.push({
          whole: x.whole,
          part,
          value: f(r.value, x.value),
          provenance: st.provenance ? [...r.provenance, ...x.provenance] : NO_PROV,
        });
      }
    }
    return out;
  });
}
