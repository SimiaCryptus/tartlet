import {
  type Rational,
  type TimeSpan,
  ONE,
  ZERO,
  add,
  div,
  floor,
  isRational,
  isZero,
  lt,
  mul,
  parseDecimal,
  rat,
  sub,
  toNumber,
  toString as ratStr,
} from '@tartlet/time';
import type { MiniAtom } from '@tartlet/mini';
import type {
  Arg,
  ConstValue,
  Diagnostic,
  FunctionValue,
  LimitsConfig,
  Offset,
  PatternNode,
  Program,
  Provenance,
} from '@tartlet/ir';
import { DEFAULT_LIMITS } from '@tartlet/ir';
import { TEXTURE_SOUNDS, VOCAL_SOUNDS, degreeToMidi, noteToMidi, parseScale } from '@tartlet/registry';
import { draw, hash64, rootSeed } from '@tartlet/random';
import {
  appLeft,
  appRight,
  bindWindow,
  brak,
  BudgetExceeded,
  chunk,
  compress,
  degradeBy,
  early,
  every,
  fast,
  fastcat,
  fmap,
  late,
  iter,
  lastOf,
  linger,
  palindrome,
  pattern,
  ply,
  pressBy,
  pure,
  rev,
  sampleOnset,
  segment,
  shuffle,
  signal,
  silence,
  slow,
  slowcat,
  someCyclesBy,
  stack,
  swingBy,
  truthy,
  withSeed,
  within,
  zoom,
  type Event,
  type Pattern,
  type QueryState,
} from './pattern';
import { compileMini, euclid } from './mini';

export type ControlMap = Readonly<Record<string, unknown>>;

export interface CompileOptions {
  /** UTF-16 index in the source to Offset. Supplied by @tartlet/check's `locator`. */
  readonly locate?: (index: number) => Offset;
  readonly seed?: string;
  readonly documentId?: string;
  readonly blobIndex?: string;
}

export interface QueryResult {
  readonly events: readonly Event<ControlMap>[];
  readonly byOutput: ReadonlyMap<string, readonly Event<ControlMap>[]>;
  readonly muted: ReadonlyMap<string, Diagnostic>;
}

export interface CompiledProgram {
  readonly outputs: ReadonlyMap<string, Pattern<ControlMap>>;
  /** Output id to its label. */
  readonly labels: ReadonlyMap<string, string>;
  query(span: TimeSpan, opts: { provenance: boolean; limits?: Partial<LimitsConfig> }): QueryResult;
}

interface SampleValue {
  readonly s: string;
  readonly n?: number;
}

type Env = ReadonlyMap<string, Pattern<unknown>>;
const NO_ENV: Env = new Map();
const NONE: readonly Provenance[] = [];

const TAU = 2 * Math.PI;
const frac = (t: Rational): number => toNumber(sub(t, floor(t)));
/** Continuous signals with values in [0, 1] (X-28, TS-33). */
const SIGNALS = new Map<string, (t: Rational, st: QueryState, salt: string) => number>([
  ['sine', (t) => (Math.sin(TAU * toNumber(t)) + 1) / 2],
  ['cosine', (t) => (Math.cos(TAU * toNumber(t)) + 1) / 2],
  ['saw', (t) => frac(t)],
  ['isaw', (t) => 1 - frac(t)],
  [
    'tri',
    (t) => {
      const x = frac(t);
      return x < 0.5 ? 2 * x : 2 - 2 * x;
    },
  ],
  ['square', (t) => (frac(t) < 0.5 ? 0 : 1)],
  ['rand', (t, st, salt) => draw(st.seed, salt, 'rand', ratStr(t))],
  [
    // Smooth noise: one seeded value per cycle boundary, eased in between (TS-56).
    'perlin',
    (t, st, salt) => {
      const c = floor(t);
      const a = draw(st.seed, salt, 'perlin', ratStr(c));
      const b = draw(st.seed, salt, 'perlin', ratStr(add(c, ONE)));
      const x = frac(t);
      return a + (b - a) * x * x * (3 - 2 * x);
    },
  ],
]);
const VOCAL_SET: ReadonlySet<string> = new Set(VOCAL_SOUNDS);
const TEXTURE_SET: ReadonlySet<string> = new Set(TEXTURE_SOUNDS);
/** Shares used by the probability shorthands (TS-56). */
const SHARES: ReadonlyMap<string, number> = new Map([
  ['often', 0.75],
  ['rarely', 0.25],
  ['almostNever', 0.1],
  ['almostAlways', 0.9],
]);
/** Binary arithmetic for add, sub, mul, div and mod (TS-57). Division by zero leaves the value. */
const ARITH = new Map<string, (a: number, b: number) => number>([
  ['add', (a, b) => a + b],
  ['sub', (a, b) => a - b],
  ['mul', (a, b) => a * b],
  ['div', (a, b) => (b === 0 ? a : a / b)],
  ['mod', (a, b) => (b === 0 ? a : ((a % b) + b) % b)],
]);
const MAX_ECHO = 64;
/** Gain multiplier on accented events (TS-59). */
const ACCENT = 1.3;
/**
 * Adds `vseed`, a counter-based draw in [0, 1), to vocal events (TS-44), and `iseed` to events
 * with interaural correlation (TS-64), and `tseed` to texture sounds and granular events (TS-73,
 * TS-75), and `dseed` to events with a spectral effect (TS-80). The audio adapter derives every
 * variation from them, so
 * it never rolls its own dice. Draws are keyed by the output, the whole's start and the sound
 * (plus the note for voices), so fragments agree.
 */
function withEventSeeds(pat: Pattern<ControlMap>, id: string): Pattern<ControlMap> {
  return pattern((st) =>
    pat.query(st).map((ev) => {
      const v = ev.value;
      const s = typeof v.s === 'string' ? v.s : '';
      const vocal = VOCAL_SET.has(s) || typeof v.syl === 'string';
      const ears = typeof v.icorr === 'number';
      const textured = TEXTURE_SET.has(s) || typeof v.grain === 'number';
      const spectral = typeof v.spectral === 'string' && v.spectral !== 'none';
      if (!vocal && !ears && !textured && !spectral) return ev;
      const at = ratStr((ev.whole ?? ev.part).begin);
      const out = dict();
      Object.assign(out, v);
      if (vocal) {
        const note = v.note as { value?: unknown } | undefined;
        const pitch = typeof note?.value === 'number' ? String(note.value) : '';
        out.vseed = draw(st.seed, id, 'vseed', at, pitch, s);
      }
      if (ears) out.iseed = draw(st.seed, id, 'iseed', at, s);
      if (textured) out.tseed = draw(st.seed, id, 'tseed', at, s);
      if (spectral) out.dseed = draw(st.seed, id, 'dseed', at, s);
      return { ...ev, value: out };
    }),
  );
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !isRational(v);
}

function dict(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function num(v: unknown): unknown {
  return isRational(v) ? toNumber(v) : v;
}

function controlsFor(control: string, v: unknown): ControlMap {
  const out = dict();
  if (control === 's') {
    if (isObj(v) && typeof v.s === 'string') {
      out.s = v.s;
      if (typeof v.n === 'number') out.n = v.n;
    } else if (typeof v === 'string') {
      out.s = v;
    }
  } else if (control === 'note') {
    const m = typeof v === 'string' ? noteToMidi(v) : num(v);
    if (typeof m === 'number' && Number.isFinite(m)) out.note = { kind: 'midi', value: m };
  } else {
    out[control] = num(v);
  }
  return out;
}

function merge(a: unknown, b: ControlMap): ControlMap {
  const out = dict();
  if (isObj(a)) Object.assign(out, a);
  Object.assign(out, b);
  return out;
}

/**
 * Applies `g` to a plain number, to the MIDI value of a note, or else to `n` (X-21, TS-57).
 * With `noteOnly`, only notes are touched.
 */
function mapNumeric(v: unknown, g: (x: number) => number, noteOnly = false): unknown {
  if (typeof v === 'number') return g(v);
  if (isRational(v)) return g(toNumber(v));
  if (!isObj(v)) return v;
  const out = dict();
  Object.assign(out, v);
  const note = v.note as { kind?: string; value?: unknown } | undefined;
  if (note?.kind === 'midi' && typeof note.value === 'number') out.note = { kind: 'midi', value: g(note.value) };
  else if (!noteOnly && typeof v.n === 'number') out.n = g(v.n);
  return out;
}

function arith(v: unknown, x: unknown, op: (a: number, b: number) => number, noteOnly: boolean): unknown {
  return typeof x === 'number' ? mapNumeric(v, (p) => op(p, x), noteOnly) : v;
}

/** Multiplies a control (default 1) on a control map. */
function scaleControl(v: unknown, key: string, k: number): unknown {
  if (!isObj(v)) return v;
  const out = dict();
  Object.assign(out, v);
  const cur = v[key];
  out[key] = (typeof cur === 'number' ? cur : 1) * k;
  return out;
}

function constValue(c: ConstValue): unknown {
  return c.v;
}

function constNum(a: Arg | undefined): number | null {
  return a?.kind === 'const' && a.value.t === 'num' ? toNumber(a.value.v) : null;
}

function constRat(a: Arg | undefined): Rational | null {
  return a?.kind === 'const' && a.value.t === 'num' ? a.value.v : null;
}

export function compile(program: Program, opts?: CompileOptions): CompiledProgram {
  const locate = opts?.locate ?? ((i: number): Offset => ({ line: 0, col: i, byte: i }));
  const bindings = new Map(program.bindings.map((b) => [b.id, b] as const));
  const refCache = new Map<string, Pattern<unknown>>();
  const inProgress = new Set<string>();
  const root = rootSeed(opts?.documentId ?? '', opts?.blobIndex ?? '', opts?.seed ?? program.settings.seed);

  const atomValue = (atom: MiniAtom, kind: string): unknown => {
    switch (kind) {
      case 'note':
        return noteToMidi(atom.text) ?? undefined;
      case 'sample':
        return atom.index === undefined ? { s: atom.text } : ({ s: atom.text, n: atom.index } satisfies SampleValue);
      case 'number':
        return parseDecimal(atom.text) ?? undefined;
      default:
        return atom.text;
    }
  };

  const argPattern = (a: Arg, prov: readonly Provenance[], env: Env): Pattern<unknown> =>
    a.kind === 'const' ? pure(constValue(a.value), prov) : a.kind === 'pattern' ? node(a.node, env) : silence();

  function node(n: PatternNode, env: Env): Pattern<unknown> {
    switch (n.kind) {
      case 'mini':
        return compileMini<unknown>(
          n.ast,
          (atom) => {
            const v = atomValue(atom, n.valueKind);
            if (v === undefined) return silence();
            const prov: Provenance[] = [
              {
                node: n.id,
                range: { start: locate(n.textOffset + atom.range[0]), end: locate(n.textOffset + atom.range[1]) },
                role: 'origin',
              },
            ];
            return pure(v, prov);
          },
          n.id,
        );
      case 'pure':
        return pure(constValue(n.value), [{ node: n.id, range: n.range, role: 'origin' }]);
      case 'signal': {
        const f = SIGNALS.get(n.fn);
        return f ? signal((t, st) => f(t, st, n.id)) : silence();
      }
      case 'silence':
      case 'error':
        return silence();
      case 'ref': {
        const bound = env.get(n.binding);
        if (bound) return bound;
        const cached = refCache.get(n.binding);
        if (cached) return cached;
        const b = bindings.get(n.binding);
        if (!b || inProgress.has(n.binding)) return silence();
        inProgress.add(n.binding);
        const p = node(b.expr, NO_ENV);
        inProgress.delete(n.binding);
        refCache.set(n.binding, p);
        return p;
      }
      case 'combine': {
        const kids = n.children.map((c) => node(c, env));
        if (n.op === 'stack') return stack(kids);
        if (n.op === 'slowcat') return slowcat(kids);
        if (n.op === 'fastcat') return fastcat(kids);
        return silence();
      }
      case 'transform':
        return transform(n.fn, node(n.target, env), n.args, env, n.id);
      case 'control': {
        if (n.value.kind === 'const') {
          // A constant never splits receiver events (TS-34).
          const c = controlsFor(n.control, constValue(n.value.value));
          return n.target === null
            ? pure(c, [{ node: n.id, range: n.range, role: 'control' }])
            : fmap(node(n.target, env), (v) => merge(v, c));
        }
        const ctl = fmap(argPattern(n.value, [{ node: n.id, range: n.range, role: 'control' }], env), (v) =>
          controlsFor(n.control, v),
        );
        return n.target === null ? ctl : appLeft(node(n.target, env), ctl, merge);
      }
    }
  }

  function applyFn(fv: FunctionValue, target: Pattern<unknown>, env: Env, id: string): Pattern<unknown> {
    if (fv.kind === 'ref') return transform(fv.fn, target, fv.args, env, id);
    const inner = new Map(env);
    inner.set(`param:${fv.param}`, target);
    return node(fv.body, inner);
  }

  function numArg(a: Arg | undefined, env: Env, apply: (r: Rational) => Pattern<unknown>): Pattern<unknown> | null {
    if (!a) return null;
    if (a.kind === 'const') return a.value.t === 'num' ? apply(a.value.v) : null;
    if (a.kind === 'pattern') return bindWindow(node(a.node, env), (v) => (isRational(v) ? apply(v) : silence()));
    return null;
  }

  function transform(
    fn: string,
    target: Pattern<unknown>,
    args: readonly Arg[],
    env: Env,
    id: string,
  ): Pattern<unknown> {
    const a = args[0];
    const fid = `${id}:f`;
    const sometimes = (amount: number, f: FunctionValue): Pattern<unknown> =>
      stack([degradeBy(amount, target, id), applyFn(f, degradeBy(amount, target, id, true), env, fid)]);
    switch (fn) {
      case 'fast':
        return numArg(a, env, (r) => fast(r, target)) ?? target;
      case 'slow':
        return numArg(a, env, (r) => (isZero(r) ? silence() : slow(r, target))) ?? target;
      case 'late':
        return numArg(a, env, (r) => late(r, target)) ?? target;
      case 'early':
        return numArg(a, env, (r) => early(r, target)) ?? target;
      case 'rev':
        return rev(target);
      case 'degradeBy':
        return numArg(a, env, (r) => degradeBy(toNumber(r), target, id)) ?? target;
      case 'undegradeBy':
        return numArg(a, env, (r) => degradeBy(toNumber(r), target, id, true)) ?? target;
      case 'degrade':
        return degradeBy(0.5, target, id);
      case 'sometimesBy': {
        const amount = constNum(a);
        const f = args[1];
        if (amount === null || f?.kind !== 'function') return target;
        return sometimes(amount, f.fn);
      }
      case 'sometimes':
        return a?.kind === 'function' ? sometimes(0.5, a.fn) : target;
      case 'often':
      case 'rarely':
      case 'almostNever':
      case 'almostAlways':
        return a?.kind === 'function' ? sometimes(SHARES.get(fn) ?? 0.5, a.fn) : target;
      case 'always':
        return a?.kind === 'function' ? applyFn(a.fn, target, env, fid) : target;
      case 'never':
        return target;
      case 'someCyclesBy':
      case 'someCycles': {
        const amount = fn === 'someCycles' ? 0.5 : constNum(a);
        const f = fn === 'someCycles' ? a : args[1];
        if (amount === null || f?.kind !== 'function') return target;
        return someCyclesBy(amount, (p) => applyFn(f.fn, p, env, fid), target, id);
      }
      case 'shuffle':
      case 'scramble': {
        const n = constNum(a);
        return n === null ? target : shuffle(Math.floor(n), target, id, fn === 'scramble');
      }
      case 'every': {
        const n = constNum(a);
        const f = args[1];
        if (n === null || f?.kind !== 'function') return target;
        return every(Math.floor(n), (p) => applyFn(f.fn, p, env, fid), target);
      }
      case 'lastOf': {
        const n = constNum(a);
        const f = args[1];
        if (n === null || f?.kind !== 'function') return target;
        return lastOf(Math.floor(n), (p) => applyFn(f.fn, p, env, fid), target);
      }
      case 'within': {
        const b = constRat(a);
        const e = constRat(args[1]);
        const f = args[2];
        if (b === null || e === null || f?.kind !== 'function') return target;
        return within(b, e, (p) => applyFn(f.fn, p, env, fid), target);
      }
      case 'chunk':
      case 'chunkBack': {
        const n = constNum(a);
        const f = args[1];
        if (n === null || f?.kind !== 'function') return target;
        return chunk(Math.floor(n), (p) => applyFn(f.fn, p, env, fid), target, fn === 'chunkBack');
      }
      case 'superimpose':
        return a?.kind === 'function' ? stack([target, applyFn(a.fn, target, env, fid)]) : target;
      case 'echo': {
        const times = constNum(a);
        const time = constRat(args[1]);
        const fb = constNum(args[2]);
        if (times === null || time === null || fb === null) return target;
        const k = Math.min(Math.floor(times), MAX_ECHO);
        if (k < 1) return target;
        const copies: Pattern<unknown>[] = [target];
        for (let i = 1; i < k; i++) {
          const g = fb ** i;
          copies.push(fmap(late(mul(time, rat(i)), target), (v) => scaleControl(v, 'gain', g)));
        }
        return stack(copies);
      }
      case 'zoom': {
        const b = constRat(a);
        const e = constRat(args[1]);
        return b === null || e === null ? target : zoom(b, e, target);
      }
      case 'compress': {
        const b = constRat(a);
        const e = constRat(args[1]);
        if (b === null || e === null || lt(b, ZERO) || lt(ONE, e) || !lt(b, e)) return target;
        return compress(target, b, e);
      }
      case 'fastGap': {
        const r = constRat(a);
        if (r === null || lt(r, ONE)) return target;
        return compress(target, ZERO, div(ONE, r));
      }
      case 'linger': {
        const r = constRat(a);
        return r === null ? target : linger(r, target);
      }
      case 'segment': {
        const n = constNum(a);
        return n === null ? target : segment(Math.floor(n), target);
      }
      case 'hurry':
        return (
          numArg(a, env, (r) => {
            const k = toNumber(r);
            return fmap(fast(r, target), (v) => scaleControl(v, 'speed', k));
          }) ?? target
        );
      case 'swingBy': {
        const amount = constRat(a);
        const n = constNum(args[1]);
        return amount === null || n === null ? target : swingBy(amount, Math.floor(n), target);
      }
      case 'swing': {
        const n = constNum(a);
        return n === null ? target : swingBy(rat(1, 3), Math.floor(n), target);
      }
      case 'brak':
        return brak(target);
      case 'press':
        return pressBy(rat(1, 2), target);
      case 'pressBy':
        return numArg(a, env, (r) => pressBy(r, target)) ?? target;
      case 'iter':
      case 'iterBack': {
        // TS-39: n is a constant, like every (TS-20).
        const n = constNum(a);
        if (n === null) return target;
        return iter(Math.floor(n), target, fn === 'iterBack');
      }
      case 'palindrome':
        return palindrome(target);
      case 'off': {
        // TS-37: provisional until the oracle spec for off lands.
        const f = args[1];
        if (f?.kind !== 'function') return target;
        return numArg(a, env, (r) => stack([target, applyFn(f.fn, late(r, target), env, fid)])) ?? target;
      }
      case 'jux': {
        if (a?.kind !== 'function') return target;
        const panned = (p: Pattern<unknown>, v: number): Pattern<unknown> =>
          fmap(p, (x) => merge(x, controlsFor('pan', v)));
        return stack([panned(target, 0), panned(applyFn(a.fn, target, env, fid), 1)]);
      }
      case 'ply':
        return numArg(a, env, (r) => ply(r, target)) ?? target;
      case 'struct':
        return a ? appRight(target, argPattern(a, NONE, env), (v) => v, truthy) : target;
      case 'mask':
        return a ? appLeft(target, argPattern(a, NONE, env), (v) => v, truthy) : target;
      case 'accent':
        // TS-59: sampled at each event's onset, so rests in the rhythm never drop events.
        return a
          ? sampleOnset(target, argPattern(a, NONE, env), (v, x) =>
              x !== undefined && truthy(x) ? scaleControl(v, 'gain', ACCENT) : v,
            )
          : target;
      case 'euclid': {
        const k = constNum(a);
        const n = constNum(args[1]);
        const r = constNum(args[2]) ?? 0;
        if (k === null || n === null) return target;
        return appRight(target, euclid(pure(true), Math.floor(k), Math.floor(n), Math.floor(r)), (v) => v); // TS-32
      }
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
      case 'mod':
      case 'transpose':
      case 'octave': {
        if (!a) return target;
        const noteOnly = fn === 'transpose' || fn === 'octave';
        const op = ARITH.get(noteOnly ? 'add' : fn);
        if (!op) return target;
        const k = fn === 'octave' ? 12 : 1;
        const by = (x: unknown): unknown => {
          const y = num(x);
          return typeof y === 'number' ? y * k : y;
        };
        if (a.kind === 'const') {
          const x = by(constValue(a.value));
          return fmap(target, (v) => arith(v, x, op, noteOnly));
        }
        return appLeft(target, argPattern(a, NONE, env), (v, x) => arith(v, by(x), op, noteOnly));
      }
      case 'round':
        return fmap(target, (v) => mapNumeric(v, (x) => Math.round(x)));
      case 'floor':
        return fmap(target, (v) => mapNumeric(v, (x) => Math.floor(x)));
      case 'ceil':
        return fmap(target, (v) => mapNumeric(v, (x) => Math.ceil(x)));
      case 'toBipolar':
      case 'fromBipolar':
        return fmap(target, (v) => {
          const x = num(v);
          if (typeof x !== 'number') return v;
          return fn === 'toBipolar' ? x * 2 - 1 : (x + 1) / 2;
        });
      case 'irand': {
        // TS-58: irand(n) is lowered onto the rand signal.
        const n = constNum(a);
        if (n === null || n < 1) return target;
        const m = Math.floor(n);
        return fmap(target, (v) => {
          const x = num(v);
          return typeof x === 'number' ? Math.min(m - 1, Math.floor(x * m)) : v;
        });
      }
      case 'range': {
        const lo = constNum(a);
        const hi = constNum(args[1]);
        if (lo === null || hi === null) return target;
        return fmap(target, (v) => {
          const x = num(v);
          return typeof x === 'number' ? lo + x * (hi - lo) : v;
        });
      }
      case 'seed': {
        if (a?.kind !== 'const') return target;
        const v = a.value;
        const s = v.t === 'num' ? ratStr(v.v) : String(v.v);
        return withSeed(hash64(root, 'seed', s), target); // TS-28
      }
      case 'label':
        return target;
      case 'scale': {
        if (a?.kind !== 'const' || a.value.t !== 'str') return target;
        const sc = parseScale(a.value.v);
        if (!sc) return target;
        return fmap(target, (v) => {
          if (!isObj(v) || typeof v.n !== 'number') return v;
          const out = dict();
          Object.assign(out, v);
          delete out.n;
          out.note = { kind: 'midi', value: degreeToMidi(v.n, sc) };
          return out;
        });
      }
      default:
        return target;
    }
  }

  const outputs = new Map<string, Pattern<ControlMap>>();
  const labels = new Map<string, string>();
  const ranges = new Map<string, PatternNode['range']>();
  for (const o of program.outputs) {
    if (o.status !== 'ok') continue;
    outputs.set(o.id, withEventSeeds(node(o.expr, NO_ENV) as Pattern<ControlMap>, o.id));
    labels.set(o.id, o.label ?? o.id);
    ranges.set(o.id, o.expr.range);
  }

  return {
    outputs,
    labels,
    query(span, q) {
      const limits = { ...DEFAULT_LIMITS, ...q.limits };
      const events: Event<ControlMap>[] = [];
      const byOutput = new Map<string, readonly Event<ControlMap>[]>();
      const muted = new Map<string, Diagnostic>();
      for (const [id, pat] of outputs) {
        const mute = (msg: string): void => {
          const range = ranges.get(id) ?? { start: locate(0), end: locate(0) };
          muted.set(id, {
            id: 'E-LIMIT-DENSITY',
            severity: 'error',
            message: msg,
            range,
            effect: 'output-muted',
            output: labels.get(id) ?? id,
          });
        };
        try {
          const evs = pat.query({
            span,
            seed: root,
            controls: new Map(),
            provenance: q.provenance,
            budget: { steps: limits.maxEvalSteps, events: limits.maxEventsPerWindow },
          });
          if (evs.length > limits.maxEventsPerWindow) {
            mute(`More than ${String(limits.maxEventsPerWindow)} events in one window. Track muted.`);
            continue;
          }
          byOutput.set(id, evs);
          events.push(...evs);
        } catch (e) {
          if (!(e instanceof BudgetExceeded)) throw e;
          mute('This track needs too much work per window. Track muted.');
        }
      }
      return { events, byOutput, muted };
    },
  };
}
