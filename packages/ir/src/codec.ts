// tartlet/1 JSON encoding and ingestion validation (idea.md §8.1, §9.7). IR from outside
// the checker gets no more trust than source does.
import { type Rational, fromJson, isRational, toJson } from '@tartlet/time';
import type { MiniAst, MiniOp, MiniStep } from '@tartlet/mini';
import type {
  Advisory,
  Arg,
  Binding,
  ConstValue,
  Diagnostic,
  FunctionValue,
  Offset,
  Output,
  PatternNode,
  PatternType,
  Program,
  ResourceDecl,
  SourceRange,
  SourceRef,
  ValueKind,
} from './index';
import { isBankPath, isSoundName, isWavPath } from './paths';

type Obj = Readonly<Record<string, unknown>>;

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 256;
const BIG = 1e12;
const VALUE_KINDS: readonly ValueKind[] = ['note', 'sample', 'number', 'string', 'bool', 'controls'];

export class IngestError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

function fail(path: string, msg: string): never {
  throw new IngestError(path, msg);
}

/** Serialises a Program. Rationals become [n, d] tuples. */
export function encodeProgram(p: Program): string {
  return JSON.stringify(p, (_k, v: unknown) => (isRational(v) ? toJson(v) : typeof v === 'bigint' ? v.toString() : v));
}

/** Parses and validates untrusted tartlet/1 JSON. Throws IngestError on any violation. */
export function decodeProgram(
  text: string,
  opts: { maxDenominator?: bigint } = Object.create(null) as object,
): Program {
  const raw: unknown = JSON.parse(text, (k, v: unknown) => {
    if (FORBIDDEN.has(k)) fail(k, 'forbidden key');
    return v;
  });
  return validateProgram(raw, opts);
}

/** Validates an already-parsed value and rebuilds it as a Program. */
export function validateProgram(
  raw: unknown,
  opts: { maxDenominator?: bigint } = Object.create(null) as object,
): Program {
  return new Decoder(opts.maxDenominator ?? 10n ** 9n).program(raw);
}

class Decoder {
  private readonly refs = new Map<string, Set<string>>();
  private current: Set<string> = new Set();
  constructor(private readonly maxDen: bigint) {}

  obj(v: unknown, p: string): Obj {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(p, 'expected an object');
    for (const k of Object.keys(v)) if (FORBIDDEN.has(k)) fail(`${p}.${k}`, 'forbidden key');
    return v as Obj;
  }
  arr(v: unknown, p: string): readonly unknown[] {
    if (!Array.isArray(v)) fail(p, 'expected an array');
    return v as readonly unknown[];
  }
  str(v: unknown, p: string): string {
    if (typeof v !== 'string') fail(p, 'expected a string');
    return v;
  }
  int(v: unknown, p: string, lo: number, hi: number): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi)
      fail(p, `expected an integer in [${String(lo)}, ${String(hi)}]`);
    return v;
  }
  pick<T extends string>(v: unknown, p: string, allowed: readonly T[]): T {
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
      fail(p, `expected one of ${allowed.join(', ')}`);
    return v as T;
  }
  rational(v: unknown, p: string): Rational {
    let r: Rational;
    try {
      r = fromJson(v);
    } catch (e) {
      fail(p, e instanceof Error ? e.message : 'invalid rational');
    }
    if (BigInt(r.d) > this.maxDen) fail(p, 'denominator exceeds the ceiling');
    return r;
  }
  offset(v: unknown, p: string): Offset {
    const o = this.obj(v, p);
    return {
      line: this.int(o.line, `${p}.line`, 0, BIG),
      col: this.int(o.col, `${p}.col`, 0, BIG),
      byte: this.int(o.byte, `${p}.byte`, 0, BIG),
    };
  }
  range(v: unknown, p: string): SourceRange {
    const o = this.obj(v, p);
    return { start: this.offset(o.start, `${p}.start`), end: this.offset(o.end, `${p}.end`) };
  }
  type(v: unknown, p: string): PatternType {
    const o = this.obj(v, p);
    const kind = this.pick(o.kind, `${p}.kind`, ['pattern', 'signal', 'function', 'error'] as const);
    switch (kind) {
      case 'pattern':
        return { kind, of: this.pick(o.of, `${p}.of`, VALUE_KINDS) };
      case 'signal':
        return { kind, of: this.pick(o.of, `${p}.of`, ['number'] as const) };
      case 'function':
        return { kind };
      case 'error':
        return { kind };
    }
  }
  constValue(v: unknown, p: string): ConstValue {
    const o = this.obj(v, p);
    const t = this.pick(o.t, `${p}.t`, ['num', 'str', 'bool'] as const);
    if (t === 'num') return { t, v: this.rational(o.v, `${p}.v`) };
    if (t === 'str') return { t, v: this.str(o.v, `${p}.v`) };
    if (typeof o.v !== 'boolean') fail(`${p}.v`, 'expected a boolean');
    return { t, v: o.v };
  }
  arg(v: unknown, p: string, d: number): Arg {
    const o = this.obj(v, p);
    const kind = this.pick(o.kind, `${p}.kind`, ['pattern', 'const', 'function'] as const);
    if (kind === 'pattern') return { kind, node: this.node(o.node, `${p}.node`, d + 1) };
    if (kind === 'const') return { kind, value: this.constValue(o.value, `${p}.value`) };
    return { kind, fn: this.fn(o.fn, `${p}.fn`, d + 1) };
  }
  fn(v: unknown, p: string, d: number): FunctionValue {
    const o = this.obj(v, p);
    const kind = this.pick(o.kind, `${p}.kind`, ['ref', 'lambda'] as const);
    if (kind === 'ref')
      return {
        kind,
        fn: this.str(o.fn, `${p}.fn`),
        args: this.arr(o.args, `${p}.args`).map((a, i) => this.arg(a, `${p}.args[${String(i)}]`, d + 1)),
      };
    return { kind, param: this.str(o.param, `${p}.param`), body: this.node(o.body, `${p}.body`, d + 1) };
  }
  node(v: unknown, p: string, d: number): PatternNode {
    if (d > MAX_DEPTH) fail(p, 'nesting too deep');
    const o = this.obj(v, p);
    const kind = this.pick(o.kind, `${p}.kind`, [
      'mini',
      'pure',
      'silence',
      'ref',
      'combine',
      'transform',
      'control',
      'signal',
      'error',
    ] as const);
    const base = {
      id: this.str(o.id, `${p}.id`),
      range: this.range(o.range, `${p}.range`),
      type: this.type(o.type, `${p}.type`),
    };
    switch (kind) {
      case 'mini':
        return {
          ...base,
          kind,
          text: this.str(o.text, `${p}.text`),
          textOffset: this.int(o.textOffset, `${p}.textOffset`, 0, BIG),
          ast: this.mini(o.ast, `${p}.ast`, d + 1),
          valueKind: this.pick(o.valueKind, `${p}.valueKind`, ['note', 'sample', 'number', 'string'] as const),
        };
      case 'pure':
        return { ...base, kind, value: this.constValue(o.value, `${p}.value`) };
      case 'silence':
        return { ...base, kind };
      case 'ref': {
        const binding = this.str(o.binding, `${p}.binding`);
        if (!binding.startsWith('param:')) this.current.add(binding);
        return { ...base, kind, name: this.str(o.name, `${p}.name`), binding };
      }
      case 'combine':
        return {
          ...base,
          kind,
          op: this.pick(o.op, `${p}.op`, ['stack', 'slowcat', 'fastcat', 'timecat', 'polymeter', 'arrange'] as const),
          children: this.arr(o.children, `${p}.children`).map((c, i) =>
            this.node(c, `${p}.children[${String(i)}]`, d + 1),
          ),
          ...(o.weights !== undefined
            ? {
                weights: this.arr(o.weights, `${p}.weights`).map((w, i) =>
                  this.rational(w, `${p}.weights[${String(i)}]`),
                ),
              }
            : undefined),
        };
      case 'transform':
        return {
          ...base,
          kind,
          fn: this.str(o.fn, `${p}.fn`),
          target: this.node(o.target, `${p}.target`, d + 1),
          args: this.arr(o.args, `${p}.args`).map((a, i) => this.arg(a, `${p}.args[${String(i)}]`, d + 1)),
        };
      case 'control':
        return {
          ...base,
          kind,
          control: this.str(o.control, `${p}.control`),
          ...(o.alias !== undefined ? { alias: this.str(o.alias, `${p}.alias`) } : undefined),
          target: o.target === null ? null : this.node(o.target, `${p}.target`, d + 1),
          value: this.arg(o.value, `${p}.value`, d + 1),
          ...(o.structure !== undefined
            ? { structure: this.pick(o.structure, `${p}.structure`, ['receiver', 'argument', 'both'] as const) }
            : undefined),
        };
      case 'signal':
        return { ...base, kind, fn: this.str(o.fn, `${p}.fn`) };
      case 'error':
        return {
          ...base,
          kind,
          diagnostic: this.str(o.diagnostic, `${p}.diagnostic`),
          ...(o.recovered !== undefined ? { recovered: this.node(o.recovered, `${p}.recovered`, d + 1) } : undefined),
        };
    }
  }
  miniRange(v: unknown, p: string): readonly [number, number] {
    const a = this.arr(v, p);
    if (a.length !== 2) fail(p, 'expected [start, end]');
    return [this.int(a[0], `${p}[0]`, 0, BIG), this.int(a[1], `${p}[1]`, 0, BIG)];
  }
  mini(v: unknown, p: string, d: number): MiniAst {
    if (d > MAX_DEPTH) fail(p, 'nesting too deep');
    const o = this.obj(v, p);
    const t = this.pick(o.t, `${p}.t`, ['seq', 'stack', 'alt', 'poly', 'choice', 'atom', 'rest'] as const);
    const list = (key: string): MiniAst[] =>
      this.arr(o[key], `${p}.${key}`).map((x, i) => this.mini(x, `${p}.${key}[${String(i)}]`, d + 1));
    switch (t) {
      case 'seq':
        return {
          t,
          steps: this.arr(o.steps, `${p}.steps`).map((s, i) => this.step(s, `${p}.steps[${String(i)}]`, d + 1)),
        };
      case 'stack':
        return { t, layers: list('layers') };
      case 'alt':
        return { t, items: list('items') };
      case 'choice':
        return {
          t,
          items: list('items'),
          ...(o.at !== undefined ? { at: this.int(o.at, `${p}.at`, 0, BIG) } : undefined),
        };
      case 'poly':
        return {
          t,
          layers: list('layers'),
          ...(o.steps !== undefined ? { steps: this.mini(o.steps, `${p}.steps`, d + 1) } : undefined),
        };
      case 'atom':
        return {
          t,
          text: this.str(o.text, `${p}.text`),
          ...(o.index !== undefined ? { index: this.int(o.index, `${p}.index`, 0, BIG) } : undefined),
          range: this.miniRange(o.range, `${p}.range`),
        };
      case 'rest':
        return { t, range: this.miniRange(o.range, `${p}.range`) };
    }
  }
  step(v: unknown, p: string, d: number): MiniStep {
    const o = this.obj(v, p);
    const weight = this.rational(o.weight, `${p}.weight`);
    if (Number(weight.n) <= 0) fail(`${p}.weight`, 'weight must be positive');
    return {
      body: this.mini(o.body, `${p}.body`, d + 1),
      weight,
      replicate: this.int(o.replicate, `${p}.replicate`, 1, 1024),
      ops: this.arr(o.ops, `${p}.ops`).map((x, i) => this.op(x, `${p}.ops[${String(i)}]`, d + 1)),
    };
  }
  op(v: unknown, p: string, d: number): MiniOp {
    const o = this.obj(v, p);
    const op = this.pick(o.op, `${p}.op`, ['fast', 'slow', 'degrade', 'euclid'] as const);
    switch (op) {
      case 'fast':
        return { op, by: this.mini(o.by, `${p}.by`, d + 1) };
      case 'slow':
        return { op, by: this.mini(o.by, `${p}.by`, d + 1) };
      case 'degrade': {
        if (o.amount !== undefined && (typeof o.amount !== 'number' || !(o.amount >= 0 && o.amount <= 1)))
          fail(`${p}.amount`, 'expected a number in [0, 1]');
        return {
          op,
          ...(typeof o.amount === 'number' ? { amount: o.amount } : undefined),
          ...(o.at !== undefined ? { at: this.int(o.at, `${p}.at`, 0, BIG) } : undefined),
        };
      }
      case 'euclid':
        return {
          op,
          k: this.mini(o.k, `${p}.k`, d + 1),
          n: this.mini(o.n, `${p}.n`, d + 1),
          ...(o.rot !== undefined ? { rot: this.mini(o.rot, `${p}.rot`, d + 1) } : undefined),
        };
    }
  }
  diagnostic(v: unknown, p: string): Diagnostic {
    const o = this.obj(v, p);
    return {
      id: this.str(o.id, `${p}.id`),
      severity: this.pick(o.severity, `${p}.severity`, ['error', 'warning', 'info'] as const),
      message: this.str(o.message, `${p}.message`),
      range: this.range(o.range, `${p}.range`),
      effect: this.pick(o.effect, `${p}.effect`, [
        'none',
        'subtree-muted',
        'output-muted',
        'program-rejected',
      ] as const),
      ...(o.node !== undefined ? { node: this.str(o.node, `${p}.node`) } : undefined),
      ...(o.output !== undefined ? { output: this.str(o.output, `${p}.output`) } : undefined),
      ...(o.definition !== undefined ? { definition: this.str(o.definition, `${p}.definition`) } : undefined),
    };
  }
  advisory(v: unknown, p: string): Advisory {
    const o = this.obj(v, p);
    if (typeof o.headphones !== 'boolean') fail(`${p}.headphones`, 'expected a boolean');
    let pulse: readonly [number, number] | undefined;
    if (o.pulse !== undefined) {
      const a = this.arr(o.pulse, `${p}.pulse`);
      const [lo, hi] = a;
      if (a.length !== 2 || typeof lo !== 'number' || typeof hi !== 'number' || !(lo <= hi))
        fail(`${p}.pulse`, 'expected [min, max] in order');
      pulse = [lo, hi];
    }
    return { output: this.str(o.output, `${p}.output`), headphones: o.headphones, ...(pulse ? { pulse } : undefined) };
  }
  program(v: unknown): Program {
    const o = this.obj(v, '$');
    if (o.irVersion !== 'tartlet/1') fail('$.irVersion', 'unsupported IR version');
    const s = this.obj(o.settings, '$.settings');
    const metaIn = this.obj(s.meta, '$.settings.meta');
    const meta = Object.create(null) as Record<string, string>;
    for (const [k, x] of Object.entries(metaIn)) meta[k] = this.str(x, `$.settings.meta.${k}`);
    const settings = {
      cps: this.rational(s.cps, '$.settings.cps'),
      ...(s.seed !== undefined ? { seed: this.str(s.seed, '$.settings.seed') } : undefined),
      meta,
    };
    const bindings: Binding[] = this.arr(o.bindings, '$.bindings').map((b, i) => {
      const p = `$.bindings[${String(i)}]`;
      const bo = this.obj(b, p);
      const id = this.str(bo.id, `${p}.id`);
      if (this.refs.has(id)) fail(`${p}.id`, 'duplicate binding id');
      this.current = new Set();
      const expr = this.node(bo.expr, `${p}.expr`, 0);
      this.refs.set(id, this.current);
      return { id, name: this.str(bo.name, `${p}.name`), expr };
    });
    this.current = new Set();
    const outputs: Output[] = this.arr(o.outputs, '$.outputs').map((x, i) => {
      const p = `$.outputs[${String(i)}]`;
      const oo = this.obj(x, p);
      return {
        id: this.str(oo.id, `${p}.id`),
        ...(oo.label !== undefined ? { label: this.str(oo.label, `${p}.label`) } : undefined),
        expr: this.node(oo.expr, `${p}.expr`, 0),
        status: this.pick(oo.status, `${p}.status`, ['ok', 'muted-error', 'muted-user'] as const),
      };
    });
    for (const target of [...this.current, ...[...this.refs.values()].flatMap((r) => [...r])]) {
      if (!this.refs.has(target)) fail('$', `reference to unknown binding ${target}`);
    }
    this.checkAcyclic();
    const resources: ResourceDecl[] = this.arr(o.resources, '$.resources').map((x, i) => {
      const p = `$.resources[${String(i)}]`;
      const ro = this.obj(x, p);
      const kind = this.pick(ro.kind, `${p}.kind`, ['samples', 'wav', 'bank'] as const);
      const spec = this.str(ro.spec, `${p}.spec`);
      if (kind === 'wav' && !isWavPath(spec)) fail(`${p}.spec`, 'not a sample path');
      if (kind === 'bank' && !isBankPath(spec)) fail(`${p}.spec`, 'not a bank path');
      let name: string | undefined;
      if (kind === 'wav') {
        name = this.str(ro.name, `${p}.name`);
        if (!isSoundName(name)) fail(`${p}.name`, 'not a sound name');
      }
      return {
        kind,
        ...(name !== undefined ? { name } : undefined),
        spec,
        range: this.range(ro.range, `${p}.range`),
      };
    });
    const diagnostics = this.arr(o.diagnostics, '$.diagnostics').map((x, i) =>
      this.diagnostic(x, `$.diagnostics[${String(i)}]`),
    );
    let advisories: Advisory[] | undefined;
    if (o.advisories !== undefined) {
      advisories = this.arr(o.advisories, '$.advisories').map((x, i) => this.advisory(x, `$.advisories[${String(i)}]`));
    }
    let source: SourceRef | undefined;
    if (o.source !== undefined) {
      const so = this.obj(o.source, '$.source');
      source = { hash: this.str(so.hash, '$.source.hash'), length: this.int(so.length, '$.source.length', 0, BIG) };
    }
    return {
      irVersion: 'tartlet/1',
      ...(source ? { source } : undefined),
      settings,
      bindings,
      outputs,
      resources,
      diagnostics,
      ...(advisories ? { advisories } : undefined),
    };
  }
  private checkAcyclic(): void {
    const state = new Map<string, 1 | 2>();
    const visit = (id: string): void => {
      const s = state.get(id);
      if (s === 2) return;
      if (s === 1) fail('$.bindings', `binding reference cycle through ${id}`);
      state.set(id, 1);
      for (const next of this.refs.get(id) ?? []) visit(next);
      state.set(id, 2);
    };
    for (const id of this.refs.keys()) visit(id);
  }
}
