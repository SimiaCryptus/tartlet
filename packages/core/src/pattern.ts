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
  isRational,
  isZero,
  lt,
  lte,
  mapSpan,
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
