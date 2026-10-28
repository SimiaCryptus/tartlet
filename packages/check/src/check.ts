// Lowering from the syntax tree to the Music IR, with the closed-language rules (idea.md §7.3, §10).
import {
  type Rational,
  rat,
  add,
  sub,
  mul,
  div,
  neg,
  isZero,
  parseDecimal,
  toNumber,
  fromFloat,
  max,
  min,
} from '@tartlet/time';
import { parseMini, type MiniAst } from '@tartlet/mini';
import { parse, LineIndex, type Expr, type Range, type SyntaxTree } from '@tartlet/syntax';
import type {
  Arg,
  Binding,
  Diagnostic,
  Fix,
  LimitsConfig,
  MiniNode,
  NodeId,
  Offset,
  Output,
  PatternNode,
  Program,
  ResourceDecl,
  SourceRange,
  PatternType,
} from '@tartlet/ir';
import { DEFAULT_LIMITS } from '@tartlet/ir';
import {
  VOICE_TYPES,
  defaultRegistry,
  normalizeVowel,
  parseScale,
  parseSyllable,
  suggestSyllable,
  type ParamSpec,
  type Registry,
  type RegistryEntry,
} from '@tartlet/registry';
import { hash64 } from '@tartlet/random';
/** The result of looking up a sound name. @tartlet/resources implements this structurally. */
export type SoundResolution =
  { readonly status: 'ok' } | { readonly status: 'fallback'; readonly to: string } | { readonly status: 'missing' };
export interface SoundCatalog {
  resolve(name: string): SoundResolution;
}

export interface CheckOptions {
  readonly documentId: string;
  readonly blobIndex: string;
  readonly seed?: string;
  readonly limits?: Partial<LimitsConfig>;
  readonly registry?: Registry;
  /** Enables resource diagnostics before playback (Q-05, Q-08). */
  readonly catalog?: SoundCatalog;
}

export interface CheckResult {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
  readonly tree: SyntaxTree;
}

const CONTROLS: PatternType = { kind: 'pattern', of: 'controls' };
const ERR: PatternType = { kind: 'error' };
const SAMPLE_IDS: ReadonlySet<string> = new Set(['s']);
const SCALE_OK: ReadonlySet<string> = new Set(['n', 'note', 'freq']);
const PITCH_OK: ReadonlySet<string> = new Set(['note', 'freq']);
/** String controls whose atoms are checked against closed sets (TS-45). */
const VOCAL_STRINGS: ReadonlySet<string> = new Set(['syl', 'vowel', 'voicetype']);
const VOICE_TYPE_SET: ReadonlySet<string> = new Set(VOICE_TYPES);

/** Host APIs that a document can never reach (idea.md §7.3, Z-02). */
export const HOST_NAMES: ReadonlySet<string> = new Set([
  'window',
  'document',
  'globalThis',
  'self',
  'fetch',
  'eval',
  'Function',
  'setTimeout',
  'setInterval',
  'require',
  'XMLHttpRequest',
  'WebSocket',
  'localStorage',
  'sessionStorage',
  'navigator',
  'location',
  'process',
  'Deno',
  'Worker',
]);
/** Names that could reach a prototype (idea.md §6.2, Z-07). */
export const PROTO_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Maps a UTF-16 index in `source` to an Offset. Used by core for provenance. */
export function locator(source: string): (index: number) => Offset {
  const li = new LineIndex(source);
  return (i) => li.position(i);
}

/** Splices a fix's edits into the source, last edit first. */
export function applyFix(source: string, fix: Fix): string {
  const li = new LineIndex(source);
  const edits = fix.edits
    .map((e) => ({ s: li.index(e.range.start), e: li.index(e.range.end), text: e.text }))
    .sort((a, b) => b.s - a.s);
  let out = source;
  for (const e of edits) out = out.slice(0, e.s) + e.text + out.slice(e.e);
  return out;
}

function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3;
  }
  return n;
}

function rootOf(e: Expr): Expr {
  let cur = e;
  for (;;) {
    if (cur.k === 'call') cur = cur.callee;
    else if (cur.k === 'member') cur = cur.object;
    else return cur;
  }
}
/** The name in a trailing `.label("name")` on the outermost chain, if any (X-33, TS-36). */
function chainLabel(e: Expr): string | undefined {
  let cur = e;
  while (cur.k === 'call' && cur.callee.k === 'member') {
    const a = cur.args[0];
    if (cur.callee.name === 'label' && a?.k === 'str') return a.value;
    cur = cur.callee.object;
  }
  return undefined;
}
/** Every atom in a mini-notation AST. */
function miniAtoms(a: MiniAst, out: { text: string; range: readonly [number, number] }[]): void {
  switch (a.t) {
    case 'atom':
      out.push(a);
      return;
    case 'rest':
      return;
    case 'seq':
      for (const s of a.steps) miniAtoms(s.body, out);
      return;
    case 'stack':
    case 'poly':
      for (const l of a.layers) miniAtoms(l, out);
      return;
    case 'alt':
    case 'choice':
      for (const i of a.items) miniAtoms(i, out);
      return;
  }
}

export function check(source: string, opts: CheckOptions): CheckResult {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const lines = new LineIndex(source);
  const sr = (r: Range): SourceRange => ({ start: lines.position(r.start), end: lines.position(r.end) });
  const diagnostics: Diagnostic[] = [];

  if (source.length > limits.maxSourceBytes || utf8Bytes(source) > limits.maxSourceBytes) {
    const d: Diagnostic = {
      id: 'E-LIMIT-SOURCE',
      severity: 'error',
      message: `Source exceeds ${String(limits.maxSourceBytes)} bytes.`,
      range: sr({ start: 0, end: 0 }),
      effect: 'program-rejected',
    };
    return {
      program: emptyProgram([d]),
      diagnostics: [d],
      tree: { source, statements: [], comments: [], diagnostics: [] },
    };
  }

  const tree = parse(source);
  for (const d of tree.diagnostics) {
    diagnostics.push({ id: d.id, severity: 'error', message: d.message, range: sr(d.range), effect: 'subtree-muted' });
  }

  const lw = new Lowerer(opts.registry ?? defaultRegistry, sr, diagnostics, limits);
  lw.run(tree);
  lw.checkVocal();
  if (opts.catalog) lw.checkResources(opts.catalog);

  if (!lw.outputs.some((o) => o.status === 'ok') && diagnostics.some((d) => d.severity === 'error')) {
    diagnostics.push({
      id: 'E-PROGRAM-EMPTY',
      severity: 'error',
      message: 'Nothing in this document can play.',
      range: sr({ start: 0, end: 0 }),
      effect: 'program-rejected',
    });
  }

  const program: Program = {
    irVersion: 'tartlet/1',
    source: { hash: hash64(source), length: source.length },
    settings: {
      cps: lw.cps,
      ...(opts.seed !== undefined ? { seed: opts.seed } : undefined),
      meta: Object.create(null) as Record<string, string>,
    },
    bindings: lw.bindings,
    outputs: lw.outputs,
    resources: lw.resources,
    diagnostics,
  };
  return { program, diagnostics, tree };
}

function emptyProgram(diagnostics: Diagnostic[]): Program {
  return {
    irVersion: 'tartlet/1',
    settings: { cps: rat(1, 2), meta: Object.create(null) as Record<string, string> },
    bindings: [],
    outputs: [],
    resources: [],
    diagnostics,
  };
}

class Lowerer {
  cps: Rational = rat(1, 2);
  readonly bindings: Binding[] = [];
  readonly outputs: Output[] = [];
  readonly resources: ResourceDecl[] = [];
  private readonly bindingIndex = new Map<string, { id: NodeId; errored: boolean }>();
  private readonly bindingExprs = new Map<string, PatternNode>();
  private readonly constBindings = new Map<string, Rational>();
  private readonly labels = new Set<string>();
  /** Lambda parameters in scope, innermost last. */
  private readonly params: string[] = [];
  private tempoSeen = false;
  private outputLabel: string | undefined;
  private errored = false;

  constructor(
    private readonly reg: Registry,
    private readonly sr: (r: Range) => SourceRange,
    private readonly diags: Diagnostic[],
    private readonly limits: LimitsConfig,
  ) {}

  run(tree: SyntaxTree): void {
    let slot = 0;
    for (const st of tree.statements) {
      this.resetErrored();
      this.params.length = 0;
      if (st.k === 'error') continue;
      if (st.k === 'binding') {
        this.outputLabel = undefined;
        if (PROTO_NAMES.has(st.name) || HOST_NAMES.has(st.name)) {
          this.diag(
            'E-LX-PROTO',
            'error',
            `\`${st.name}\` cannot be used as a binding name.`,
            st.nameRange,
            'subtree-muted',
          );
          continue;
        }
        if (this.bindingIndex.has(st.name)) {
          this.diag('E-NAME-DUP', 'error', `\`${st.name}\` is already declared.`, st.nameRange, 'subtree-muted');
          continue;
        }
        const expr = this.pattern(st.expr, hash64('bind', st.name));
        const id = hash64('binding', st.name);
        this.bindings.push({ id, name: st.name, expr });
        this.bindingExprs.set(id, expr);
        this.bindingIndex.set(st.name, { id, errored: this.errored });
        if (expr.kind === 'pure' && expr.value.t === 'num') this.constBindings.set(st.name, expr.value.v);
        continue;
      }
      if (st.k === 'expr' && this.directive(st.expr)) continue;
      const named = st.k === 'output' && st.label !== '$';
      const label = named ? st.label : chainLabel(st.expr);
      if (label !== undefined) {
        if (this.labels.has(label)) {
          this.diag(
            'E-NAME-DUP',
            'error',
            `Output \`${label}\` is already defined (TS-6).`,
            st.k === 'output' ? st.labelRange : st.range,
            'output-muted',
          );
          continue;
        }
        this.labels.add(label);
      }
      const anchor = label ?? `$${String(slot++)}`;
      this.outputLabel = anchor;
      const expr = this.pattern(st.expr, hash64('output', anchor));
      this.outputs.push({
        id: hash64('out', anchor),
        label: anchor,
        expr,
        status: this.errored ? 'muted-error' : 'ok',
      });
    }
  }
  /**
   * Clears the per-statement error flag. A method call keeps TypeScript from narrowing
   * `errored` to `false` for the rest of the statement.
   */
  private resetErrored(): void {
    this.errored = false;
  }

  // ---- diagnostics
  /** Resource diagnostics for every sample name used by an `s` control (idea.md §11.2). */
  checkResources(cat: SoundCatalog): void {
    const seen = new Set<number>();
    const atoms = (a: MiniAst, out: { text: string; range: readonly [number, number] }[]): void => {
      switch (a.t) {
        case 'atom':
          out.push(a);
          return;
        case 'rest':
          return;
        case 'seq':
          for (const s of a.steps) atoms(s.body, out);
          return;
        case 'stack':
        case 'poly':
          for (const l of a.layers) atoms(l, out);
          return;
        case 'alt':
        case 'choice':
          for (const i of a.items) atoms(i, out);
          return;
      }
    };
    const walk = (n: PatternNode, inS: boolean): void => {
      switch (n.kind) {
        case 'mini': {
          if (!inS) return;
          const found: { text: string; range: readonly [number, number] }[] = [];
          atoms(n.ast, found);
          for (const a of found) {
            const start = n.textOffset + a.range[0];
            if (seen.has(start)) continue;
            seen.add(start);
            const range = { start, end: n.textOffset + a.range[1] };
            const r = cat.resolve(a.text);
            if (r.status === 'fallback')
              this.diag(
                'I-RES-FALLBACK',
                'info',
                `\`${a.text}\` is not in the kit, so it plays as \`${r.to}\`.`,
                range,
                'none',
              );
            else if (r.status === 'missing')
              this.diag(
                'W-RES-MISSING',
                'warning',
                `No sound named \`${a.text}\` is available. It will be silent.`,
                range,
                'none',
              );
          }
          return;
        }
        case 'control':
          if (n.target) walk(n.target, false);
          if (n.value.kind === 'pattern') walk(n.value.node, n.control === 's');
          return;
        case 'transform':
          walk(n.target, false);
          for (const a of n.args) {
            if (a.kind === 'pattern') walk(a.node, false);
            else if (a.kind === 'function' && a.fn.kind === 'lambda') walk(a.fn.body, false);
          }
          return;
        case 'combine':
          for (const c of n.children) walk(c, inS);
          return;
        case 'error':
          if (n.recovered) walk(n.recovered, inS);
          return;
        default:
          return;
      }
    };
    this.outputLabel = undefined;
    for (const b of this.bindings) walk(b.expr, false);
    for (const o of this.outputs) {
      this.outputLabel = o.label;
      walk(o.expr, false);
    }
    this.outputLabel = undefined;
  }
  /** Syllables, vowels and voice types in constant patterns (W-ARG-PHONEME, W-ARG-VOWEL; TS-45). */
  checkVocal(): void {
    const seen = new Set<number>();
    const inspect = (control: string, n: PatternNode): void => {
      if (n.kind !== 'mini' || !VOCAL_STRINGS.has(control)) return;
      const found: { text: string; range: readonly [number, number] }[] = [];
      miniAtoms(n.ast, found);
      for (const a of found) {
        const start = n.textOffset + a.range[0];
        if (seen.has(start)) continue;
        seen.add(start);
        const range = { start, end: n.textOffset + a.range[1] };
        if (control === 'syl') {
          if (parseSyllable(a.text) !== null) continue;
          const fix = suggestSyllable(a.text);
          this.diag(
            'W-ARG-PHONEME',
            'warning',
            `\`${a.text}\` is not a syllable in the singing alphabet, so it is sung as \`ah\`.`,
            range,
            'none',
            fix === undefined
              ? undefined
              : [{ title: `Replace with \`${fix}\``, edits: [{ range: this.sr(range), text: fix }], safe: false }],
          );
        } else if (control === 'vowel') {
          if (normalizeVowel(a.text) === undefined)
            this.diag('W-ARG-VOWEL', 'warning', `Unknown vowel \`${a.text}\`; \`ah\` is used.`, range, 'none');
        } else if (!VOICE_TYPE_SET.has(a.text.toLowerCase())) {
          this.diag('W-ARG-VOWEL', 'warning', `Unknown voice type \`${a.text}\`; \`tenor\` is used.`, range, 'none');
        }
      }
    };
    const walkArg = (a: Arg): void => {
      if (a.kind === 'pattern') walk(a.node);
      else if (a.kind === 'function') {
        if (a.fn.kind === 'lambda') walk(a.fn.body);
        else a.fn.args.forEach(walkArg);
      }
    };
    const walk = (n: PatternNode): void => {
      switch (n.kind) {
        case 'control':
          if (n.target) walk(n.target);
          if (n.value.kind === 'pattern') inspect(n.control, n.value.node);
          walkArg(n.value);
          return;
        case 'transform':
          walk(n.target);
          n.args.forEach(walkArg);
          return;
        case 'combine':
          n.children.forEach(walk);
          return;
        case 'error':
          if (n.recovered) walk(n.recovered);
          return;
        default:
          return;
      }
    };
    this.outputLabel = undefined;
    for (const b of this.bindings) walk(b.expr);
    for (const o of this.outputs) {
      this.outputLabel = o.label;
      walk(o.expr);
    }
    this.outputLabel = undefined;
  }
  /** Whether a subtree sets any of `ids`. Lambda parameters are assumed to (idea.md §11.1). */
  private hasControl(n: PatternNode, ids: ReadonlySet<string>, depth = 0): boolean {
    if (depth > 64) return false;
    switch (n.kind) {
      case 'control':
        return ids.has(n.control) || (n.target !== null && this.hasControl(n.target, ids, depth + 1));
      case 'transform':
        if (n.fn === 'scale' && ids.has('note')) return true;
        return this.hasControl(n.target, ids, depth + 1);
      case 'combine':
        return n.children.some((c) => this.hasControl(c, ids, depth + 1));
      case 'ref': {
        if (n.binding.startsWith('param:')) return true;
        const b = this.bindingExprs.get(n.binding);
        return b ? this.hasControl(b, ids, depth + 1) : false;
      }
      case 'error':
        return n.recovered ? this.hasControl(n.recovered, ids, depth + 1) : false;
      default:
        return false;
    }
  }

  private diag(
    id: string,
    severity: Diagnostic['severity'],
    message: string,
    range: Range,
    effect: Diagnostic['effect'],
    fixes?: Fix[],
  ): void {
    if (severity === 'error' && effect !== 'none') this.errored = true;
    this.diags.push({
      id,
      severity,
      message,
      range: this.sr(range),
      effect,
      ...(this.outputLabel !== undefined ? { output: this.outputLabel } : undefined),
      ...(fixes ? { fixes } : undefined),
    });
  }

  private errorNode(id: string, range: Range, recovered?: PatternNode): PatternNode {
    return {
      kind: 'error',
      id: hash64('error', id, String(range.start)),
      range: this.sr(range),
      type: ERR,
      diagnostic: id,
      ...(recovered ? { recovered } : undefined),
    };
  }

  private reject(id: string, message: string, at: Range, whole: Range, recovered?: PatternNode): PatternNode {
    this.diag(id, 'error', message, at, 'subtree-muted');
    return this.errorNode(id, whole, recovered);
  }

  // ---- directives

  private directive(e: Expr): boolean {
    if (e.k !== 'call' || e.callee.k !== 'ident') return false;
    const hit = this.reg.lookup(e.callee.name);
    if (hit?.entry.category !== 'directive') return false;
    const id = hit.entry.id;
    if (id === 'samples') {
      const a = e.args[0];
      if (a?.k === 'str') {
        this.resources.push({ kind: 'samples', spec: a.value, range: this.sr(a.range) });
        this.diag(
          'I-RES-DECLARED',
          'info',
          'Sample bank declared. It is fetched only if the host allows it.',
          e.range,
          'none',
        );
      }
      return true;
    }
    const a = e.args[0];
    const v = a ? this.fold(a) : null;
    if (!v) {
      this.diag('E-ARG-TYPE', 'error', `\`${id}\` needs a constant number.`, e.range, 'none');
      return true;
    }
    if (this.tempoSeen)
      this.diag('I-TEMPO-OVERRIDE', 'info', 'A later tempo directive replaces an earlier one (TS-7).', e.range, 'none');
    this.tempoSeen = true;
    let cps = id === 'setcpm' ? div(v, rat(60)) : v;
    const lo = fromFloat(this.limits.cpsRange[0]);
    const hi = fromFloat(this.limits.cpsRange[1]);
    const clamped = max(lo, min(hi, cps));
    if (clamped !== cps)
      this.diag('W-RANGE', 'warning', `Tempo clamped to ${String(toNumber(clamped))} cps.`, e.range, 'none');
    cps = clamped;
    this.cps = cps;
    return true;
  }

  // ---- constants

  private fold(e: Expr): Rational | null {
    switch (e.k) {
      case 'num':
        return parseDecimal(e.text);
      case 'ident':
        return this.params.includes(e.name) ? null : (this.constBindings.get(e.name) ?? null);
      case 'unary': {
        const v = this.fold(e.arg);
        return v && (e.op === '-' ? neg(v) : v);
      }
      case 'binary': {
        const l = this.fold(e.left);
        const r = this.fold(e.right);
        if (!l || !r) return null;
        if (e.op === '/' && isZero(r)) {
          this.diag('E-ARG-DIVZERO', 'error', 'Division by zero.', e.range, 'subtree-muted');
          return null;
        }
        return e.op === '+' ? add(l, r) : e.op === '-' ? sub(l, r) : e.op === '*' ? mul(l, r) : div(l, r);
      }
      default:
        return null;
    }
  }

  // ---- patterns

  private mini(e: Extract<Expr, { k: 'str' }>, kind: MiniNode['valueKind'], id: NodeId): PatternNode {
    const res = parseMini(e.value);
    if (res.diagnostics.length > 0) {
      for (const d of res.diagnostics) {
        this.diag(
          d.id,
          'error',
          d.message,
          { start: e.contentStart + d.range[0], end: e.contentStart + d.range[1] },
          'output-muted',
        );
      }
      return this.errorNode(res.diagnostics[0]?.id ?? 'E-MINI', e.range);
    }
    return {
      kind: 'mini',
      id,
      range: this.sr(e.range),
      type: { kind: 'pattern', of: kind },
      text: e.value,
      textOffset: e.contentStart,
      ast: res.ast,
      valueKind: kind,
    };
  }

  private pattern(e: Expr, anchor: NodeId): PatternNode {
    switch (e.k) {
      case 'str':
        return this.mini(e, 'string', hash64(anchor, 'mini'));
      case 'num':
      case 'unary':
      case 'binary': {
        const v = this.fold(e);
        if (!v) return this.errorNode('E-ARG-TYPE', e.range);
        return {
          kind: 'pure',
          id: hash64(anchor, 'pure'),
          range: this.sr(e.range),
          type: { kind: 'pattern', of: 'number' },
          value: { t: 'num', v },
        };
      }
      case 'ident':
        return this.ident(e, anchor);
      case 'call': {
        if (e.callee.k === 'ident') {
          const name = e.callee.name;
          if (PROTO_NAMES.has(name))
            return this.reject('E-LX-PROTO', `\`${name}\` cannot be used as a name.`, e.callee.range, e.range);
          if (HOST_NAMES.has(name))
            return this.reject(
              'E-LX-HOST',
              `\`${name}\` is a host API. Documents cannot reach it.`,
              e.callee.range,
              e.range,
            );
          return this.constructorCall(name, e.callee.range, e.args, e.range, anchor);
        }
        if (e.callee.k === 'member') return this.method(e.callee, e.args, e.range, anchor);
        break;
      }
      case 'member': {
        const r = rootOf(e);
        if (r.k === 'ident' && HOST_NAMES.has(r.name))
          return this.reject('E-LX-HOST', `\`${r.name}\` is a host API. Documents cannot reach it.`, r.range, e.range);
        if (PROTO_NAMES.has(e.name))
          return this.reject('E-LX-PROTO', `\`${e.name}\` cannot be used as a name.`, e.nameRange, e.range);
        return this.reject('E-LX-MEMBER', `\`.${e.name}\` must be called as a method.`, e.nameRange, e.range);
      }
      case 'lambda':
        return this.reject('E-ARG-TYPE', 'A function cannot be used as a pattern here.', e.range, e.range);
      case 'spread':
        return this.reject(
          'E-LX-SPREAD',
          'A spread is allowed only as a call argument over an array literal.',
          e.range,
          e.range,
        );
      case 'bool':
      case 'array':
        break;
    }
    return this.reject('E-SYN-EXPR', 'This expression is not a pattern.', e.range, e.range);
  }

  private ident(e: Extract<Expr, { k: 'ident' }>, anchor: NodeId): PatternNode {
    if (PROTO_NAMES.has(e.name))
      return this.reject('E-LX-PROTO', `\`${e.name}\` cannot be used as a name.`, e.range, e.range);
    if (this.params.includes(e.name)) {
      return {
        kind: 'ref',
        id: hash64(anchor, 'param', e.name),
        range: this.sr(e.range),
        type: CONTROLS,
        name: e.name,
        binding: `param:${e.name}`,
      };
    }
    if (HOST_NAMES.has(e.name))
      return this.reject('E-LX-HOST', `\`${e.name}\` is a host API. Documents cannot reach it.`, e.range, e.range);
    const b = this.bindingIndex.get(e.name);
    if (b) {
      if (b.errored)
        this.diag(
          'E-NAME-ERRORED',
          'error',
          `\`${e.name}\` has errors, so this output is muted.`,
          e.range,
          'output-muted',
        );
      return {
        kind: 'ref',
        id: hash64(anchor, 'ref', e.name),
        range: this.sr(e.range),
        type: CONTROLS,
        name: e.name,
        binding: b.id,
      };
    }
    const hit = this.reg.lookup(e.name);
    if (hit?.entry.id === 'silence')
      return { kind: 'silence', id: hash64(anchor, 'silence'), range: this.sr(e.range), type: CONTROLS };
    if (hit?.entry.category === 'signal') {
      return {
        kind: 'signal',
        id: hash64(anchor, 'signal', hit.entry.id),
        range: this.sr(e.range),
        type: { kind: 'signal', of: 'number' },
        fn: hit.entry.id,
      };
    }
    return this.reject('E-NAME-UNDEF', `\`${e.name}\` is not defined.`, e.range, e.range);
  }

  /** Unrolls constant array spreads into ordinary arguments (idea.md §7.3). */
  private expand(args: readonly Expr[]): Expr[] {
    const out: Expr[] = [];
    for (const a of args) {
      if (a.k !== 'spread') {
        out.push(a);
        continue;
      }
      if (a.arg.k === 'array' && a.arg.items.every((x) => x.k !== 'spread')) out.push(...a.arg.items);
      else
        this.diag(
          'E-LX-SPREAD',
          'error',
          'Only an array literal can be spread, as in `stack(...[a, b])`.',
          a.range,
          'subtree-muted',
        );
    }
    return out;
  }

  private unknown(name: string, nameRange: Range, full: Range): { message: string; fixes?: Fix[] } {
    const s = this.reg.suggest(name);
    if (!s) return { message: `Unknown function \`${name}\`.` };
    return {
      message: `Unknown function \`${name}\`. Did you mean \`${s.name}\`?`,
      fixes: [
        {
          title: `Replace with \`${s.name}\``,
          edits: [{ range: this.sr(nameRange), text: s.name }],
          safe: s.distance === 1 && full.end > full.start,
        },
      ],
    };
  }

  private constructorCall(
    name: string,
    nameRange: Range,
    rawArgs: readonly Expr[],
    range: Range,
    anchor: NodeId,
  ): PatternNode {
    const hit = this.reg.lookup(name);
    if (!hit || hit.entry.form === 'method' || hit.entry.form === 'directive') {
      const u = this.unknown(name, nameRange, range);
      this.diag('E-REG-UNKNOWN', 'error', u.message, nameRange, 'subtree-muted', u.fixes);
      return this.errorNode('E-REG-UNKNOWN', range);
    }
    this.alias(hit, nameRange);
    const args = this.expand(rawArgs);
    const entry = hit.entry;
    const id = hash64(anchor, entry.id);
    if (entry.category === 'control') {
      const a = args[0];
      const p = entry.params[0];
      if (!a || !p) {
        this.diag('E-ARG-MISSING', 'error', `\`${name}\` needs a value.`, range, 'subtree-muted');
        return this.errorNode('E-ARG-MISSING', range);
      }
      const value = this.arg(a, p, hash64(anchor, entry.id, '0'), entry);
      if (!value) return this.errorNode('E-ARG-TYPE', range);
      return {
        kind: 'control',
        id,
        range: this.sr(range),
        type: CONTROLS,
        control: entry.id,
        ...(hit.via !== 'canonical' ? { alias: hit.typed } : undefined),
        target: null,
        value,
      };
    }
    if (entry.category === 'combinator') {
      const op = entry.id as 'stack' | 'slowcat' | 'fastcat';
      const children = args.map((a, i) => this.pattern(a, hash64(anchor, entry.id, String(i))));
      return { kind: 'combine', id, range: this.sr(range), type: CONTROLS, op, children };
    }
    if (entry.id === 'silence') return { kind: 'silence', id, range: this.sr(range), type: CONTROLS };
    this.diag('E-NOT-YET', 'error', `\`${name}\` cannot start a pattern.`, range, 'subtree-muted');
    return this.errorNode('E-NOT-YET', range);
  }

  private method(
    m: Extract<Expr, { k: 'member' }>,
    rawArgs: readonly Expr[],
    range: Range,
    anchor: NodeId,
  ): PatternNode {
    const recv = this.pattern(m.object, anchor);
    if (PROTO_NAMES.has(m.name))
      return this.reject('E-LX-PROTO', `\`${m.name}\` cannot be used as a name.`, m.nameRange, range, recv);
    const hit = this.reg.lookup(m.name);
    if (!hit || hit.entry.form === 'constructor' || hit.entry.form === 'directive') {
      const u = this.unknown(m.name, m.nameRange, range);
      const suggested = this.reg.lookup(u.fixes?.[0]?.edits[0]?.text ?? '');
      // Only a likely control typo is cosmetic. An unknown transform could change structure (§10.2).
      if (suggested?.entry.category === 'control') {
        this.diag(
          'W-REG-UNKNOWN',
          'warning',
          `${u.message} Control dropped; track plays.`,
          { start: m.nameRange.start, end: range.end },
          'none',
          u.fixes,
        );
        return recv;
      }
      this.diag(
        'E-REG-UNKNOWN',
        'error',
        `${u.message} Track muted.`,
        { start: m.nameRange.start, end: range.end },
        'subtree-muted',
        u.fixes,
      );
      return this.errorNode('E-REG-UNKNOWN', range, recv);
    }
    this.alias(hit, m.nameRange);
    const args = this.expand(rawArgs);
    const entry = hit.entry;
    const id = hash64(recv.id, entry.id);
    if (entry.category === 'control') {
      const a0 = args[0];
      const p = entry.params[0];
      if (!a0 || !p) {
        this.diag('E-ARG-MISSING', 'error', `\`.${m.name}\` needs a value.`, range, 'subtree-muted');
        return this.errorNode('E-ARG-MISSING', range, recv);
      }
      const value = this.arg(a0, p, hash64(recv.id, entry.id, '0'), entry);
      if (!value) return this.errorNode('E-ARG-TYPE', range, recv);
      return {
        kind: 'control',
        id,
        range: this.sr(range),
        type: CONTROLS,
        control: entry.id,
        ...(hit.via !== 'canonical' ? { alias: hit.typed } : undefined),
        target: recv,
        value,
      };
    }
    if (entry.category === 'transform' || entry.category === 'tonal') {
      if (entry.id === 'scale' || entry.id === 'transpose') {
        // Q-03 / TS-35: only a samples-only receiver is nonsense for pitch operations.
        const ok = entry.id === 'scale' ? SCALE_OK : PITCH_OK;
        if (this.hasControl(recv, SAMPLE_IDS) && !this.hasControl(recv, ok)) {
          return this.reject(
            'E-CAP-PITCHED',
            `\`.${m.name}\` needs pitched or numeric events; this track plays samples. Track muted.`,
            m.nameRange,
            range,
            recv,
          );
        }
      }
      if (entry.id === 'scale') {
        const a0 = args[0];
        if (!(a0?.k === 'str' && parseScale(a0.value))) {
          this.diag(
            'E-ARG-SCALE',
            'error',
            'Unknown scale. Use a form like "D:minor".',
            a0?.range ?? range,
            'subtree-muted',
          );
          return this.errorNode('E-ARG-SCALE', range, recv);
        }
      }
      const lowered = this.lowerArgs(entry, args, range, recv.id, `.${m.name}`);
      if (!lowered) return this.errorNode('E-ARG-TYPE', range, recv);
      // `.label()` only names the output (see chainLabel), so it adds no node and ids stay stable.
      if (entry.id === 'label') return recv;
      return {
        kind: 'transform',
        id,
        range: this.sr(range),
        type: recv.type,
        fn: entry.id,
        target: recv,
        args: lowered,
      };
    }
    this.diag('E-NOT-YET', 'error', `\`.${m.name}\` is not supported as a method yet.`, m.nameRange, 'subtree-muted');
    return this.errorNode('E-NOT-YET', range, recv);
  }

  private lowerArgs(
    entry: RegistryEntry,
    list: readonly Expr[],
    range: Range,
    base: NodeId,
    typed: string,
  ): Arg[] | null {
    const out: Arg[] = [];
    for (const [i, p] of entry.params.entries()) {
      const e = list[i];
      const anchor = hash64(base, entry.id, String(i));
      if (!e) {
        if (p.optional === true) continue;
        this.diag('E-ARG-MISSING', 'error', `\`${typed}\` needs \`${p.name}\`.`, range, 'subtree-muted');
        return null;
      }
      const a = p.type === 'function' ? this.fnArg(e, anchor) : this.arg(e, p, anchor, entry);
      if (!a) return null;
      out.push(a);
    }
    const extra = list[entry.params.length];
    if (extra) this.diag('W-ARG-EXTRA', 'warning', `Extra arguments to \`${typed}\` are ignored.`, extra.range, 'none');
    return out;
  }

  private alias(hit: { via: string; typed: string; entry: RegistryEntry }, range: Range): void {
    if (hit.via === 'compat') {
      this.diag(
        'I-REG-ALIAS',
        'info',
        `\`${hit.typed}\` is read as \`${hit.entry.names[0] ?? hit.entry.id}\`. Track plays.`,
        range,
        'none',
      );
    }
  }

  private arg(e: Expr, p: ParamSpec, anchor: NodeId, entry: RegistryEntry): Arg | null {
    const v = this.fold(e);
    if (v) {
      if (p.range) {
        const x = toNumber(v);
        if (x < p.range[0] || x > p.range[1]) {
          this.diag(
            'W-RANGE',
            'warning',
            `\`${entry.names[0] ?? entry.id}\` value ${String(x)} is outside ${String(p.range[0])}–${String(p.range[1])}; playback clamps it.`,
            e.range,
            'none',
          );
        }
      }
      return { kind: 'const', value: { t: 'num', v } };
    }
    if (e.k === 'str') {
      if (!p.patternable) {
        // A string cannot stand in for a constant number, e.g. `.iter("<1 2>")` (TS-20, TS-39).
        if (p.type === 'number') {
          this.diag('E-ARG-TYPE', 'error', `\`${p.name}\` must be a constant number.`, e.range, 'subtree-muted');
          return null;
        }
        return { kind: 'const', value: { t: 'str', v: e.value } };
      }
      const kind =
        p.type === 'note' || p.type === 'sample' || p.type === 'number' || p.type === 'string' ? p.type : 'string';
      return { kind: 'pattern', node: this.mini(e, kind, hash64(anchor, 'mini')) };
    }
    if (e.k === 'bool') return { kind: 'const', value: { t: 'bool', v: e.value } };
    if (!p.patternable) {
      this.diag('E-ARG-TYPE', 'error', `\`${p.name}\` must be a constant.`, e.range, 'subtree-muted');
      return null;
    }
    if (e.k === 'lambda') {
      this.diag('E-ARG-TYPE', 'error', `\`${p.name}\` is not a function argument.`, e.range, 'subtree-muted');
      return null;
    }
    return { kind: 'pattern', node: this.pattern(e, anchor) };
  }

  /** Lowers a function argument: a registered transform, a partial application, or a restricted lambda. */
  private fnArg(e: Expr, anchor: NodeId): Arg | null {
    const transformRef = (name: string, nameRange: Range, args: readonly Expr[], range: Range): Arg | null => {
      const hit = this.reg.lookup(name);
      if (!hit || (hit.entry.category !== 'transform' && hit.entry.category !== 'tonal')) {
        this.diag('E-ARG-FUNCTION', 'error', `\`${name}\` is not a known transform.`, nameRange, 'subtree-muted');
        return null;
      }
      this.alias(hit, nameRange);
      const lowered = this.lowerArgs(hit.entry, this.expand(args), range, anchor, name);
      return lowered ? { kind: 'function', fn: { kind: 'ref', fn: hit.entry.id, args: lowered } } : null;
    };
    if (e.k === 'ident') return transformRef(e.name, e.range, [], e.range);
    if (e.k === 'call' && e.callee.k === 'ident') return transformRef(e.callee.name, e.callee.range, e.args, e.range);
    if (e.k === 'lambda') {
      const param = e.param;
      const root = rootOf(e.body);
      const startsFromParam = root.k === 'ident' && root.name === param;
      const registryCall =
        e.body.k === 'call' &&
        e.body.callee.k === 'ident' &&
        root.k === 'ident' &&
        !HOST_NAMES.has(root.name) &&
        this.reg.lookup(root.name) !== undefined;
      if (param === null || PROTO_NAMES.has(param) || !(startsFromParam || registryCall)) {
        this.diag(
          'E-LX-LAMBDA',
          'error',
          'A function must transform its parameter, as in `x => x.fast(2)`.',
          e.range,
          'subtree-muted',
        );
        return null;
      }
      this.params.push(param);
      try {
        const body = this.pattern(e.body, hash64(anchor, 'lambda'));
        return { kind: 'function', fn: { kind: 'lambda', param, body } };
      } finally {
        this.params.pop();
      }
    }
    this.diag(
      'E-ARG-FUNCTION',
      'error',
      'Expected a function such as `rev` or `x => x.fast(2)`.',
      e.range,
      'subtree-muted',
    );
    return null;
  }
}
