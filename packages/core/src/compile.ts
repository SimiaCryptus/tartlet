import { type Rational, type TimeSpan, isRational, isZero, parseDecimal, toNumber } from "@tartlet/time";
import type { MiniAtom } from "@tartlet/mini";
import type { Arg, ConstValue, Diagnostic, FunctionValue, LimitsConfig, Offset, PatternNode, Program, Provenance } from "@tartlet/ir";
import { DEFAULT_LIMITS } from "@tartlet/ir";
import { degreeToMidi, noteToMidi, parseScale } from "@tartlet/registry";
import { hash64, rootSeed } from "@tartlet/random";
import {
  appLeft, bindWindow, BudgetExceeded, degradeBy, early, every, fast, fastcat, fmap, late, pure, rev, silence, slow, slowcat, stack,
  withSeed, type Event, type Pattern,
} from "./pattern";
import { compileMini } from "./mini";

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
/** Registry ids whose nodes own a seed (idea.md §8.4). */
const SEEDED = new Set(["degradeBy"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !isRational(v);
}

function dict(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function num(v: unknown): unknown {
  return isRational(v) ? toNumber(v) : v;
}

function controlsFor(control: string, v: unknown): ControlMap {
  const out = dict();
  if (control === "s") {
    if (isObj(v) && typeof v.s === "string") {
      out.s = v.s;
      if (typeof v.n === "number") out.n = v.n;
    } else if (typeof v === "string") {
      out.s = v;
    }
  } else if (control === "note") {
    const m = typeof v === "string" ? noteToMidi(v) : num(v);
    if (typeof m === "number" && Number.isFinite(m)) out.note = { kind: "midi", value: m };
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

function constValue(c: ConstValue): unknown {
  return c.v;
}

function constNum(a: Arg | undefined): number | null {
  return a?.kind === "const" && a.value.t === "num" ? toNumber(a.value.v) : null;
}

export function compile(program: Program, opts: CompileOptions = {}): CompiledProgram {
  const locate = opts.locate ?? ((i: number): Offset => ({ line: 0, col: i, byte: i }));
  const bindings = new Map(program.bindings.map((b) => [b.id, b] as const));
  const refCache = new Map<string, Pattern<unknown>>();
  const inProgress = new Set<string>();
  const root = rootSeed(opts.documentId ?? "", opts.blobIndex ?? "", opts.seed ?? program.settings.seed);
  const nodeSeed = (id: string): string => hash64(root, id);

  const atomValue = (atom: MiniAtom, kind: string): unknown => {
    switch (kind) {
      case "note":
        return noteToMidi(atom.text) ?? undefined;
      case "sample":
        return atom.index === undefined ? { s: atom.text } : ({ s: atom.text, n: atom.index } satisfies SampleValue);
      case "number":
        return parseDecimal(atom.text) ?? undefined;
      default:
        return atom.text;
    }
  };

  const argPattern = (a: Arg, prov: readonly Provenance[], env: Env): Pattern<unknown> =>
    a.kind === "const" ? pure(constValue(a.value), prov) : a.kind === "pattern" ? node(a.node, env) : silence();

  function node(n: PatternNode, env: Env): Pattern<unknown> {
    switch (n.kind) {
      case "mini": {
        const p = compileMini<unknown>(n.ast, (atom) => {
          const v = atomValue(atom, n.valueKind);
          if (v === undefined) return silence();
          const prov: Provenance[] = [{
            node: n.id,
            range: { start: locate(n.textOffset + atom.range[0]), end: locate(n.textOffset + atom.range[1]) },
            role: "origin",
          }];
          return pure(v, prov);
        });
        return n.text.includes("?") ? withSeed(nodeSeed(n.id), p) : p;
      }
      case "pure":
        return pure(constValue(n.value), [{ node: n.id, range: n.range, role: "origin" }]);
      case "silence":
      case "signal": // T2
      case "error":
        return silence();
      case "ref": {
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
      case "combine": {
        const kids = n.children.map((c) => node(c, env));
        if (n.op === "stack") return stack(kids);
        if (n.op === "slowcat") return slowcat(kids);
        if (n.op === "fastcat") return fastcat(kids);
        return silence();
      }
      case "transform": {
        const p = transform(n.fn, node(n.target, env), n.args, env);
        return SEEDED.has(n.fn) ? withSeed(nodeSeed(n.id), p) : p;
      }
      case "control": {
        const ctl = fmap(argPattern(n.value, [{ node: n.id, range: n.range, role: "control" }], env), (v) => controlsFor(n.control, v));
        return n.target === null ? ctl : appLeft(node(n.target, env), ctl, merge);
      }
    }
  }

  function applyFn(fv: FunctionValue, target: Pattern<unknown>, env: Env): Pattern<unknown> {
    if (fv.kind === "ref") return transform(fv.fn, target, fv.args, env);
    const inner = new Map(env);
    inner.set(`param:${fv.param}`, target);
    return node(fv.body, inner);
  }

  function numArg(a: Arg | undefined, env: Env, apply: (r: Rational) => Pattern<unknown>): Pattern<unknown> | null {
    if (!a) return null;
    if (a.kind === "const") return a.value.t === "num" ? apply(a.value.v) : null;
    if (a.kind === "pattern") return bindWindow(node(a.node, env), (v) => (isRational(v) ? apply(v) : silence()));
    return null;
  }

  function transform(fn: string, target: Pattern<unknown>, args: readonly Arg[], env: Env): Pattern<unknown> {
    const a = args[0];
    switch (fn) {
      case "fast":
        return numArg(a, env, (r) => fast(r, target)) ?? target;
      case "slow":
        return numArg(a, env, (r) => (isZero(r) ? silence() : slow(r, target))) ?? target;
      case "late":
        return numArg(a, env, (r) => late(r, target)) ?? target;
      case "early":
        return numArg(a, env, (r) => early(r, target)) ?? target;
      case "rev":
        return rev(target);
      case "degradeBy":
        return numArg(a, env, (r) => degradeBy(toNumber(r), target)) ?? target;
      case "every": {
        const n = constNum(a);
        const f = args[1];
        if (n === null || f?.kind !== "function") return target;
        return every(Math.floor(n), (p) => applyFn(f.fn, p, env), target);
      }
      case "scale": {
        if (a?.kind !== "const" || a.value.t !== "str") return target;
        const sc = parseScale(a.value.v);
        if (!sc) return target;
        return fmap(target, (v) => {
          if (!isObj(v) || typeof v.n !== "number") return v;
          const out = dict();
          Object.assign(out, v);
          delete out.n;
          out.note = { kind: "midi", value: degreeToMidi(v.n, sc) };
          return out;
        });
      }
      default:
        return target;
    }
  }

  const outputs = new Map<string, Pattern<ControlMap>>();
  const labels = new Map<string, string>();
  const ranges = new Map<string, PatternNode["range"]>();
  for (const o of program.outputs) {
    if (o.status !== "ok") continue;
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
          muted.set(id, { id: "E-LIMIT-DENSITY", severity: "error", message: msg, range, effect: "output-muted", output: labels.get(id) ?? id });
        };
        try {
          const evs = pat.query({ span, seed: root, controls: new Map(), provenance: q.provenance, budget: { steps: limits.maxEvalSteps, events: limits.maxEventsPerWindow } });
          if (evs.length > limits.maxEventsPerWindow) {
            mute(`More than ${String(limits.maxEventsPerWindow)} events in one window. Track muted.`);
            continue;
          }
          byOutput.set(id, evs);
          events.push(...evs);
        } catch (e) {
          if (!(e instanceof BudgetExceeded)) throw e;
          mute("This track needs too much work per window. Track muted.");
        }
      }
      return { events, byOutput, muted };
    },
  };
}