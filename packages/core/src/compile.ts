import {
  type Rational,
  type TimeSpan,
  floor,
  isRational,
  isZero,
  parseDecimal,
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
import { degreeToMidi, noteToMidi, parseScale } from '@tartlet/registry';
import { draw, hash64, rootSeed } from '@tartlet/random';
import {
  appLeft,
  appRight,
  bindWindow,
  BudgetExceeded,
  degradeBy,
  early,
  every,
  fast,
  fastcat,
  fmap,
  late,
  ply,
  pure,
  rev,
  signal,
  silence,
  slow,
  slowcat,
  stack,
  truthy,
  withSeed,
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
]);

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

/** Pitch arithmetic for add and transpose (X-21). `transpose` touches only notes. */
function addValue(v: unknown, x: unknown, noteOnly: boolean): unknown {
  if (typeof x !== 'number') return v;
  if (typeof v === 'number') return v + x;
  if (isRational(v)) return toNumber(v) + x;
  if (!isObj(v)) return v;
  const out = dict();
  Object.assign(out, v);
  const note = v.note as { kind?: string; value?: unknown } | undefined;
  if (note?.kind === 'midi' && typeof note.value === 'number') out.note = { kind: 'midi', value: note.value + x };
  else if (!noteOnly && typeof v.n === 'number') out.n = v.n + x;
  return out;
}

function constValue(c: ConstValue): unknown {
  return c.v;
}

function constNum(a: Arg | undefined): number | null {
  return a?.kind === 'const' && a.value.t === 'num' ? toNumber(a.value.v) : null;
}

export function compile(program: Program, opts: CompileOptions = {}): CompiledProgram {
  const locate = opts.locate ?? ((i: number): Offset => ({ line: 0, col: i, byte: i }));
  const bindings = new Map(program.bindings.map((b) => [b.id, b] as const));
  const refCache = new Map<string, Pattern<unknown>>();
  const inProgress = new Set<string>();
  const root = rootSeed(opts.documentId ?? '', opts.blobIndex ?? '', opts.seed ?? program.settings.seed);

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
      case 'every': {
        const n = constNum(a);
        const f = args[1];
        if (n === null || f?.kind !== 'function') return target;
        return every(Math.floor(n), (p) => applyFn(f.fn, p, env, fid), target);
      }
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
      case 'euclid': {
        const k = constNum(a);
        const n = constNum(args[1]);
        const r = constNum(args[2]) ?? 0;
        if (k === null || n === null) return target;
        return appRight(target, euclid(pure(true), Math.floor(k), Math.floor(n), Math.floor(r)), (v) => v); // TS-32
      }
      case 'add':
      case 'transpose': {
        if (!a) return target;
        const noteOnly = fn === 'transpose';
        if (a.kind === 'const') {
          const x = num(constValue(a.value));
          return fmap(target, (v) => addValue(v, x, noteOnly));
        }
        return appLeft(target, argPattern(a, NONE, env), (v, x) => addValue(v, num(x), noteOnly));
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
    outputs.set(o.id, node(o.expr, NO_ENV) as Pattern<ControlMap>);
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
