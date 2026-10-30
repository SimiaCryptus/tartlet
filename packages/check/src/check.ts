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
import { parse, LineIndex, type Expr, type Range, type Stmt, type SyntaxTree } from '@tartlet/syntax';
import type {
  Advisory,
  Arg,
  Binding,
  ControlNode,
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
import { DEFAULT_LIMITS, isBankPath, isSoundName, isWavPath } from '@tartlet/ir';
import {
  BODY_NAMES,
  CAB_NAMES,
  CURVE_NAMES,
  DRUM_SOUNDS,
  ENVCURVE_NAMES,
  FIR_DESIGNS,
  FIR_LENGTHS,
  NOISE_SOUNDS,
  OSCILLATOR_SOUNDS,
  SPACE_NAMES,
  SPECTRAL_MODES,
  TEXTURE_SOUNDS,
  VOCAL_SOUNDS,
  VOICE_TYPES,
  defaultRegistry,
  editDistance,
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
/** String controls whose atoms are checked against closed sets (TS-45, TS-68). */
const VOCAL_STRINGS: ReadonlySet<string> = new Set([
  'syl',
  'vowel',
  'voicetype',
  'earsplit',
  'space',
  'spectral',
  'fir',
  'firlen',
  'body',
  'cab',
  'curve',
  'envcurve',
]);
const EARSPLIT_MODES: ReadonlySet<string> = new Set(['none', 'harmonics', 'bands']);
const SPACE_SET: ReadonlySet<string> = new Set(SPACE_NAMES);
const SPECTRAL_SET: ReadonlySet<string> = new Set(SPECTRAL_MODES);
/** Spectral controls that only matter in one spectral mode (TS-80). */
const SPECTRAL_NEEDS: ReadonlyMap<string, string> = new Map([
  ['scomb', 'comb'],
  ['sgate', 'gate'],
  ['sshift', 'shift'],
]);
const FIR_SET: ReadonlySet<string> = new Set(FIR_DESIGNS);
/** Closed value sets for impulse-response controls, and the value used for unknown ones (TS-84). */
const MODE_LISTS: ReadonlyMap<string, { readonly names: readonly string[]; readonly fallback: string }> = new Map([
  ['fir', { names: FIR_DESIGNS, fallback: 'none' }],
  ['firlen', { names: FIR_LENGTHS, fallback: 'medium' }],
  ['body', { names: BODY_NAMES, fallback: 'none' }],
  ['cab', { names: CAB_NAMES, fallback: 'none' }],
  ['curve', { names: CURVE_NAMES, fallback: 'none' }],
  ['envcurve', { names: ENVCURVE_NAMES, fallback: 'lin' }],
]);
interface Need {
  readonly owner: string;
  readonly modes?: ReadonlySet<string>;
}
/** Controls that only matter when another control selects something (TS-84). */
const MODE_NEEDS: ReadonlyMap<string, Need> = new Map<string, Need>([
  ['firwidth', { owner: 'fir', modes: new Set(['bandpass', 'bandstop']) }],
  ['bodysize', { owner: 'body' }],
  ['bodymix', { owner: 'body' }],
  ['spacepre', { owner: 'space' }],
  ['spacedamp', { owner: 'space' }],
  ['drive', { owner: 'curve' }],
  ['bias', { owner: 'curve' }],
  ['curvemix', { owner: 'curve' }],
]);
/** Known values of the controls that MODE_NEEDS depend on. */
const OWNER_SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['fir', FIR_SET],
  ['body', new Set(BODY_NAMES)],
  ['space', SPACE_SET],
  ['curve', new Set(CURVE_NAMES)],
]);
const VOICE_TYPE_SET: ReadonlySet<string> = new Set(VOICE_TYPES);
/** Stands in for a parameter in a constant position while a definition is checked (TS-50). */
const PLACEHOLDER: Rational = rat(1);
const DUMMY_FN: Arg = { kind: 'function', fn: { kind: 'ref', fn: 'rev', args: [] } };
/** Expr fields that only record formatting, left out of a definition's structural hash (TS-49). */
const LAYOUT_KEYS: ReadonlySet<string> = new Set([
  'range',
  'paramRange',
  'nameRange',
  'contentStart',
  'quote',
  'block',
]);

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
/** Controls whose effect needs headphones (TS-40, TS-61, TS-62, TS-64 to TS-67). */
const HEADPHONE_CONTROLS: ReadonlySet<string> = new Set([
  'binaural',
  'azimuth',
  'elevation',
  'distance',
  'earsh',
  'itd',
  'ild',
  'iphase',
  'earswap',
  'lcutoff',
  'rcutoff',
  'lhcutoff',
  'rhcutoff',
  'icorr',
  'earsplit',
  'dichotic',
  'irate',
]);
/** Controls whose value is a steady pulse rate in hertz (TS-61, TS-67). */
const PULSE_CONTROLS: ReadonlySet<string> = new Set(['binaural', 'isochronic', 'irate']);
/** Constant pulse rates in this range get I-EXT-PULSE. */
const PULSE_RANGE: readonly [number, number] = [3, 30];
/** A constant `iphase` at or above this many degrees gets I-EXT-MONO (TS-68). */
const MONO_PHASE = 150;
/** Controls that only affect oscillator voices, and ones that only affect noise voices (TS-68). */
const OSC_ONLY: ReadonlySet<string> = new Set(['iphase', 'irate']);
const NOISE_ONLY: ReadonlySet<string> = new Set(['dichotic', 'icorr']);
/** Settings of the compressor shared by an orbit (TS-87). */
const COMP_CONTROLS: ReadonlySet<string> = new Set(['comp', 'compratio', 'compknee', 'compattack', 'comprelease']);
type SoundKind = 'osc' | 'noise' | 'drum' | 'other';
const OSC_SET: ReadonlySet<string> = new Set(OSCILLATOR_SOUNDS);
const NOISE_SET: ReadonlySet<string> = new Set(NOISE_SOUNDS);
const DRUM_SET: ReadonlySet<string> = new Set(DRUM_SOUNDS);
/** Every built-in kit sound; a sample bound to one of these names replaces it (TS-90). */
const KIT_SOUNDS: ReadonlySet<string> = new Set([
  ...OSCILLATOR_SOUNDS,
  ...NOISE_SOUNDS,
  ...DRUM_SOUNDS,
  ...VOCAL_SOUNDS,
  ...TEXTURE_SOUNDS,
]);
function soundKind(name: string): SoundKind {
  if (OSC_SET.has(name)) return 'osc';
  if (NOISE_SET.has(name)) return 'noise';
  if (DRUM_SET.has(name)) return 'drum';
  return 'other';
}

type Ident = Extract<Expr, { k: 'ident' }>;
type Lambda = Extract<Expr, { k: 'lambda' }>;
type Member = Extract<Expr, { k: 'member' }>;
type BindingStmt = Extract<Stmt, { k: 'binding' }>;

/**
 * What a name stands for inside a function body or lambda (TS-48):
 * - `param`: a lambda parameter, lowered to a `param:<id>` reference;
 * - `abstract`: a parameter of a definition being checked on its own (TS-50);
 * - `arg`: a call-site argument, lowered at each use in the caller's context;
 * - `node`: an already lowered receiver.
 */
type Subst =
  | { readonly k: 'param'; readonly id: string }
  | { readonly k: 'abstract'; readonly used: { n: number } }
  | { readonly k: 'arg'; readonly expr: Expr; readonly ctx: Ctx }
  | { readonly k: 'node'; readonly node: PatternNode };

interface Ctx {
  readonly scope: ReadonlyMap<string, Subst>;
  /** The call id of the expansion being lowered, used to salt method ids (TS-49). */
  readonly salt?: string;
}
const ROOT_CTX: Ctx = { scope: new Map<string, Subst>() };

interface FnDef {
  readonly name: string;
  readonly lambda: Lambda;
  /** The whole definition statement. */
  readonly range: Range;
  readonly defHash: string;
  errored: boolean;
  /** Diagnostics already reported when the definition was checked. */
  readonly dryKeys: Set<string>;
}

interface Frame {
  readonly def: FnDef;
  readonly callRange: Range;
}

class ExpandLimit extends Error {
  constructor() {
    super('function expansion limit reached');
  }
}

function diagKey(id: string, r: Range): string {
  return `${id}@${String(r.start)}:${String(r.end)}`;
}

function exprKey(e: Expr): string {
  return JSON.stringify(e, (k, v: unknown) => (LAYOUT_KEYS.has(k) ? undefined : v));
}

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
/** Constant numbers in a control argument: a constant, or the atoms of a mini-notation string. */
function constRates(a: Arg): number[] {
  if (a.kind === 'const') return a.value.t === 'num' ? [toNumber(a.value.v)] : [];
  if (a.kind !== 'pattern') return [];
  const n = a.node;
  if (n.kind === 'pure') return n.value.t === 'num' ? [toNumber(n.value.v)] : [];
  if (n.kind !== 'mini') return [];
  const found: { text: string; range: readonly [number, number] }[] = [];
  miniAtoms(n.ast, found);
  return found.flatMap((x) => {
    const v = parseDecimal(x.text);
    return v ? [toNumber(v)] : [];
  });
}
/** Constant strings in a control argument: a constant, or the atoms of a mini-notation string. */
function constStrings(a: Arg): string[] {
  if (a.kind === 'const') return a.value.t === 'str' ? [a.value.v] : [];
  if (a.kind !== 'pattern') return [];
  const n = a.node;
  if (n.kind === 'pure') return n.value.t === 'str' ? [n.value.v] : [];
  if (n.kind !== 'mini') return [];
  const found: { text: string; range: readonly [number, number] }[] = [];
  miniAtoms(n.ast, found);
  return found.map((x) => x.text);
}
/** Whether a control argument is fully known at check time: a constant or a mini-notation string. */
function isConstArg(a: Arg): boolean {
  return a.kind === 'const' || (a.kind === 'pattern' && (a.node.kind === 'pure' || a.node.kind === 'mini'));
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
  lw.checkAdvisories();

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
    ...(lw.advisories.length > 0 ? { advisories: lw.advisories } : undefined),
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
  readonly advisories: Advisory[] = [];
  private readonly bindingIndex = new Map<string, { id: NodeId; errored: boolean }>();
  private readonly bindingExprs = new Map<string, PatternNode>();
  private readonly constBindings = new Map<string, Rational>();
  private readonly labels = new Set<string>();
  /** User function definitions (TS-48). */
  private readonly functions = new Map<string, FnDef>();
  /** The lexical context: what names mean here. */
  private ctx: Ctx = ROOT_CTX;
  /** IR lambda parameter ids enclosing the node being lowered, used to keep ids unique (TS-51). */
  private readonly irParams: string[] = [];
  /** Function expansions in progress, innermost last. */
  private readonly frames: Frame[] = [];
  /** The definition being checked on its own, if any (TS-50). */
  private dry: FnDef | undefined;
  private defLabel: string | undefined;
  private expandCount = 0;
  /** Set when a constant fold touched a placeholder parameter. */
  private taint = false;
  private readonly seenDiags = new Set<string>();
  private readonly sizes = new WeakMap<PatternNode, number>();
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
      this.resetState();
      if (st.k === 'error') continue;
      if (st.k === 'binding') {
        this.outputLabel = undefined;
        this.binding(st);
        continue;
      }
      this.outputLabel = undefined;
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
      const expr = this.guarded(st.range, () => this.pattern(st.expr, hash64('output', anchor)));
      this.outputs.push({
        id: hash64('out', anchor),
        label: anchor,
        expr,
        status: this.errored ? 'muted-error' : 'ok',
      });
    }
    this.outputLabel = undefined;
  }
  /**
   * Clears the per-statement error flag. A method call keeps TypeScript from narrowing
   * `errored` to `false` for the rest of the statement.
   */
  private resetErrored(): void {
    this.errored = false;
  }
  /**
   * Clears the placeholder taint flag before a constant fold. A method call keeps TypeScript
   * from narrowing `taint` to `false`, since `fold` may set it.
   */
  private resetTaint(): void {
    this.taint = false;
  }

  private resetState(): void {
    this.ctx = ROOT_CTX;
    this.irParams.length = 0;
    this.frames.length = 0;
    this.dry = undefined;
    this.defLabel = undefined;
    this.expandCount = 0;
  }

  private binding(st: BindingStmt): void {
    if (PROTO_NAMES.has(st.name) || HOST_NAMES.has(st.name)) {
      this.diag(
        'E-LX-PROTO',
        'error',
        `\`${st.name}\` cannot be used as a binding name.`,
        st.nameRange,
        'subtree-muted',
      );
      return;
    }
    if (this.bindingIndex.has(st.name) || this.functions.has(st.name)) {
      this.diag('E-NAME-DUP', 'error', `\`${st.name}\` is already declared.`, st.nameRange, 'subtree-muted');
      return;
    }
    if (this.reg.lookup(st.name)) {
      this.diag(
        'E-NAME-SHADOW',
        'error',
        `\`${st.name}\` is a built-in name. Choose another name.`,
        st.nameRange,
        'subtree-muted',
      );
      return;
    }
    if (st.expr.k === 'lambda') {
      this.defineFunction(st.name, st.expr, st.range);
      return;
    }
    const expr = this.guarded(st.range, () => this.pattern(st.expr, hash64('bind', st.name)));
    const id = hash64('binding', st.name);
    this.bindings.push({ id, name: st.name, expr });
    this.bindingExprs.set(id, expr);
    this.bindingIndex.set(st.name, { id, errored: this.errored });
    if (expr.kind === 'pure' && expr.value.t === 'num') this.constBindings.set(st.name, expr.value.v);
  }

  /** Runs a lowering, turning an exhausted expansion budget into E-LIMIT-EXPAND (TS-52). */
  private guarded(range: Range, f: () => PatternNode): PatternNode {
    try {
      return f();
    } catch (e) {
      if (!(e instanceof ExpandLimit)) throw e;
      this.frames.length = 0;
      this.diag(
        'E-LIMIT-EXPAND',
        'error',
        `Function calls here expand to more than ${String(this.limits.maxExpandedNodes)} nodes. Track muted.`,
        range,
        'output-muted',
      );
      return this.errorNode('E-LIMIT-EXPAND', range);
    }
  }

  // ---- user functions (TS-48 to TS-52)

  /** Checks a definition once, with placeholder parameters, and records it (TS-50). */
  private defineFunction(name: string, lam: Lambda, range: Range): void {
    this.defLabel = name;
    const def: FnDef = {
      name,
      lambda: lam,
      range,
      defHash: hash64('fn', exprKey(lam)),
      errored: false,
      dryKeys: new Set<string>(),
    };
    const scope = new Map<string, Subst>();
    const counters: { readonly name: string; readonly range: Range; readonly used: { n: number } }[] = [];
    for (const p of lam.params) {
      if (PROTO_NAMES.has(p.name) || HOST_NAMES.has(p.name)) {
        this.diag('E-LX-PROTO', 'error', `\`${p.name}\` cannot be used as a parameter name.`, p.range, 'subtree-muted');
        continue;
      }
      if (scope.has(p.name)) {
        this.diag('E-NAME-DUP', 'error', `Parameter \`${p.name}\` appears twice.`, p.range, 'subtree-muted');
        continue;
      }
      const d = p.default;
      if (d && d.k !== 'str' && d.k !== 'bool' && !this.fold(d)) {
        this.diag('E-ARG-TYPE', 'error', 'A default must be a constant.', d.range, 'subtree-muted');
      }
      const used = { n: 0 };
      scope.set(p.name, { k: 'abstract', used });
      counters.push({ name: p.name, range: p.range, used });
    }
    this.dry = def;
    this.guarded(range, () =>
      this.inCtx({ scope, salt: hash64('dry', name) }, () => this.pattern(lam.body, hash64('fn', name))),
    );
    this.dry = undefined;
    def.errored = this.errored;
    if (!def.errored) {
      for (const c of counters) {
        if (c.used.n === 0)
          this.diag('W-FN-UNUSED', 'warning', `Parameter \`${c.name}\` of \`${name}\` is never used.`, c.range, 'none');
      }
    }
    this.functions.set(name, def);
    this.defLabel = undefined;
  }

  /** Expands a call by lowering the body with its parameters bound (TS-48, TS-49). */
  private callUser(
    def: FnDef,
    recv: Subst | undefined,
    base: NodeId,
    args: readonly Subst[],
    callRange: Range,
    nameRange: Range,
  ): PatternNode {
    if (def.errored) {
      this.diag(
        'E-NAME-ERRORED',
        'error',
        `\`${def.name}\` has errors, so this output is muted.`,
        nameRange,
        'output-muted',
      );
      return this.errorNode('E-NAME-ERRORED', callRange);
    }
    const params = def.lambda.params;
    const scope = new Map<string, Subst>();
    let pi = 0;
    if (recv) {
      const p0 = params[0];
      if (!p0) {
        this.diag(
          'E-ARG-TYPE',
          'error',
          `\`${def.name}\` takes no pattern, so it cannot be called on one. Call it as \`${def.name}()\`.`,
          nameRange,
          'subtree-muted',
        );
        return this.errorNode('E-ARG-TYPE', callRange);
      }
      scope.set(p0.name, recv);
      pi = 1;
    }
    let ai = 0;
    for (; pi < params.length; pi++) {
      const p = params[pi];
      if (!p) break;
      const a = args[ai++];
      if (a) scope.set(p.name, a);
      else if (p.default) scope.set(p.name, { k: 'arg', expr: p.default, ctx: ROOT_CTX });
      else {
        this.diag('E-ARG-MISSING', 'error', `\`${def.name}\` needs \`${p.name}\`.`, callRange, 'subtree-muted');
        return this.errorNode('E-ARG-MISSING', callRange);
      }
    }
    const extra = args[ai];
    if (extra) {
      this.diag(
        'W-ARG-EXTRA',
        'warning',
        `Extra arguments to \`${def.name}\` are ignored.`,
        extra.k === 'arg' ? extra.expr.range : callRange,
        'none',
      );
    }
    const id = hash64(base, 'user', def.name, def.defHash);
    this.frames.push({ def, callRange });
    try {
      return this.inCtx({ scope, salt: id }, () => this.pattern(def.lambda.body, id));
    } finally {
      this.frames.pop();
    }
  }

  /** A user function passed where a function value is expected (`.every(4, chop(3))`). */
  private userFnValue(
    def: FnDef,
    partial: readonly Subst[],
    anchor: NodeId,
    callRange: Range,
    nameRange: Range,
  ): Arg | null {
    const p0 = def.lambda.params[0];
    if (!p0) {
      this.diag(
        'E-ARG-FUNCTION',
        'error',
        `\`${def.name}\` takes no pattern, so it cannot be used as a function here.`,
        nameRange,
        'subtree-muted',
      );
      return null;
    }
    const id = this.freshParam(p0.name);
    this.irParams.push(id);
    try {
      const body = this.callUser(def, { k: 'param', id }, anchor, partial, callRange, nameRange);
      return { kind: 'function', fn: { kind: 'lambda', param: id, body } };
    } finally {
      this.irParams.pop();
    }
  }

  /** `.apply(f, …args)`: lowers `f` applied to the receiver inline (TS-48). */
  private applyCall(recv: PatternNode, rawArgs: readonly Expr[], range: Range): PatternNode {
    const args = this.spreads(rawArgs);
    const f = args[0];
    if (!f) {
      this.diag('E-ARG-MISSING', 'error', '`.apply` needs a function.', range, 'subtree-muted');
      return this.errorNode('E-ARG-MISSING', range, recv);
    }
    return this.applyTo(
      f,
      this.ctx,
      recv,
      args.slice(1).map((a) => this.thunk(a)),
      range,
    );
  }

  private applyTo(f: Expr, ctx: Ctx, recv: PatternNode, extra: readonly Subst[], range: Range): PatternNode {
    let head: Ident | undefined;
    let callArgs: readonly Expr[] = [];
    if (f.k === 'ident') head = f;
    else if (f.k === 'call' && f.callee.k === 'ident') {
      head = f.callee;
      callArgs = f.args;
    }
    if (head) {
      const s = ctx.scope.get(head.name);
      if (s && f.k === 'ident') {
        if (s.k === 'arg') return this.applyTo(s.expr, s.ctx, recv, extra, range);
        if (s.k === 'abstract') {
          s.used.n++;
          return recv;
        }
      }
      if (s) {
        if (s.k === 'abstract') s.used.n++;
        return this.reject(
          'E-ARG-FUNCTION',
          f.k === 'call'
            ? `\`${head.name}\` is a parameter. Pass its extra arguments to \`.apply\` instead, as in \`.apply(${head.name}, …)\`.`
            : `\`${head.name}\` is a pattern, not a function.`,
          head.range,
          range,
          recv,
        );
      }
      const partial = this.inCtx(ctx, () => this.thunks(callArgs));
      const all = [...partial, ...extra];
      const def = this.functions.get(head.name);
      if (def) return this.callUser(def, { k: 'node', node: recv }, recv.id, all, range, head.range);
      const hit = this.reg.lookup(head.name);
      if (hit && (hit.entry.category === 'transform' || hit.entry.category === 'tonal') && hit.entry.id !== 'apply') {
        return this.syntheticMethod(recv, head.name, head.range, all, range);
      }
      return this.reject('E-ARG-FUNCTION', `\`${head.name}\` is not a known transform.`, head.range, range, recv);
    }
    if (f.k === 'lambda') {
      const scope = new Map(ctx.scope);
      const bound: Subst[] = [{ k: 'node', node: recv }, ...extra];
      for (const [i, p] of f.params.entries()) {
        if (PROTO_NAMES.has(p.name))
          return this.reject('E-LX-PROTO', `\`${p.name}\` cannot be used as a name.`, p.range, range, recv);
        const a = bound[i];
        if (a) scope.set(p.name, a);
        else if (p.default) scope.set(p.name, { k: 'arg', expr: p.default, ctx });
        else return this.reject('E-ARG-MISSING', `The function needs \`${p.name}\`.`, f.range, range, recv);
      }
      const id = hash64(recv.id, 'apply', hash64(exprKey(f)));
      return this.inCtx({ scope, salt: id }, () => this.pattern(f.body, id));
    }
    return this.reject(
      'E-ARG-FUNCTION',
      'Expected a function such as `rev`, a named function, or `x => x.fast(2)`.',
      f.range,
      range,
      recv,
    );
  }

  /** Lowers `recv.name(args…)` for a registry transform reached through `.apply`. */
  private syntheticMethod(
    recv: PatternNode,
    name: string,
    nameRange: Range,
    args: readonly Subst[],
    range: Range,
  ): PatternNode {
    const scope = new Map<string, Subst>([['#recv', { k: 'node', node: recv }]]);
    const idents: Expr[] = args.map((a, i) => {
      const key = `#arg${String(i)}`;
      scope.set(key, a);
      return { k: 'ident', name: key, range: a.k === 'arg' ? a.expr.range : range };
    });
    const member: Member = { k: 'member', object: { k: 'ident', name: '#recv', range }, name, nameRange, range };
    return this.inCtx({ ...this.ctx, scope }, () => this.method(member, idents, range, recv.id));
  }

  private lookup(name: string): Subst | undefined {
    return this.ctx.scope.get(name);
  }

  private inCtx<T>(ctx: Ctx, f: () => T): T {
    const saved = this.ctx;
    this.ctx = ctx;
    try {
      return f();
    } finally {
      this.ctx = saved;
    }
  }

  private thunk(e: Expr): Subst {
    return { k: 'arg', expr: e, ctx: this.ctx };
  }

  private thunks(args: readonly Expr[]): Subst[] {
    return this.spreads(args).map((a) => this.thunk(a));
  }

  /** Salts a base id inside an expansion, so each call has its own ids (TS-49). */
  private salted(id: NodeId): NodeId {
    return this.ctx.salt === undefined ? id : hash64(id, 'in', this.ctx.salt);
  }

  /** A lambda parameter id not used by any enclosing lambda in the IR (TS-51). */
  private freshParam(name: string): string {
    let id = name;
    for (let k = 1; this.irParams.includes(id); k++) id = `${name}$${String(k)}`;
    return id;
  }

  /** Follows argument substitutions, for checks that inspect the source form. */
  private resolve(e: Expr | undefined, ctx: Ctx = this.ctx): Expr | 'abstract' | undefined {
    if (e?.k !== 'ident') return e;
    const s = ctx.scope.get(e.name);
    if (s?.k === 'arg') return this.resolve(s.expr, s.ctx);
    if (s?.k === 'abstract') return 'abstract';
    return e;
  }

  private sizeOf(n: PatternNode): number {
    const hit = this.sizes.get(n);
    if (hit !== undefined) return hit;
    let size = 1;
    const arg = (a: Arg): void => {
      if (a.kind === 'pattern') size += this.sizeOf(a.node);
      else if (a.kind === 'function') {
        if (a.fn.kind === 'lambda') size += this.sizeOf(a.fn.body);
        else a.fn.args.forEach(arg);
      }
    };
    switch (n.kind) {
      case 'combine':
        for (const c of n.children) size += this.sizeOf(c);
        break;
      case 'transform':
        size += this.sizeOf(n.target);
        n.args.forEach(arg);
        break;
      case 'control':
        if (n.target) size += this.sizeOf(n.target);
        arg(n.value);
        break;
      case 'error':
        if (n.recovered) size += this.sizeOf(n.recovered);
        break;
      default:
        break;
    }
    this.sizes.set(n, size);
    return size;
  }

  /** Counts a reused node against the expansion budget (TS-52). */
  private charge(n: PatternNode): void {
    if (this.frames.length === 0) return;
    this.expandCount += this.sizeOf(n);
    if (this.expandCount > this.limits.maxExpandedNodes) throw new ExpandLimit();
  }

  // ---- diagnostics
  /** Resource diagnostics for every sample name used by an `s` control (idea.md §11.2). */
  checkResources(cat: SoundCatalog): void {
    const seen = new Set<number>();
    // Declared samples are known; names a bank may provide are only known after loading (TS-91).
    const declared = new Set(this.resources.flatMap((r) => (r.kind === 'wav' && r.name ? [r.name] : [])));
    const banks = this.resources.some((r) => r.kind === 'bank');
    const walk = (n: PatternNode, inS: boolean): void => {
      switch (n.kind) {
        case 'mini': {
          if (!inS) return;
          const found: { text: string; range: readonly [number, number] }[] = [];
          miniAtoms(n.ast, found);
          for (const a of found) {
            const start = n.textOffset + a.range[0];
            if (seen.has(start)) continue;
            seen.add(start);
            const range = { start, end: n.textOffset + a.range[1] };
            if (declared.has(a.text)) continue;
            const r = cat.resolve(a.text);
            if (banks && r.status !== 'ok') continue;
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
        } else if (control === 'earsplit') {
          if (!EARSPLIT_MODES.has(a.text))
            this.diag(
              'W-ARG-MODE',
              'warning',
              `Unknown earsplit mode \`${a.text}\`; use none, harmonics or bands. \`none\` is used.`,
              range,
              'none',
            );
        } else if (control === 'space') {
          if (!SPACE_SET.has(a.text))
            this.diag(
              'W-ARG-MODE',
              'warning',
              `Unknown space \`${a.text}\`; use room, hall, plate, church or outdoor. The plain reverb is used.`,
              range,
              'none',
            );
        } else if (control === 'spectral') {
          if (!SPECTRAL_SET.has(a.text))
            this.diag(
              'W-ARG-MODE',
              'warning',
              `Unknown spectral mode \`${a.text}\`; use ${SPECTRAL_MODES.join(', ')}. \`none\` is used.`,
              range,
              'none',
            );
        } else if (MODE_LISTS.has(control)) {
          const m = MODE_LISTS.get(control);
          if (m && !m.names.includes(a.text))
            this.diag(
              'W-ARG-MODE',
              'warning',
              `Unknown ${control} value \`${a.text}\`; use ${m.names.join(', ')}. \`${m.fallback}\` is used.`,
              range,
              'none',
            );
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
  /** Headphone, pulse and mono facts per playable output, for hosts to show warnings (TS-61, TS-68). */
  checkAdvisories(): void {
    /** Constant compressor settings per orbit, to spot clashes between tracks (TS-87). */
    const orbitComp = new Map<number, string>();
    for (const o of this.outputs) {
      if (o.status !== 'ok') continue;
      const phones: PatternNode[] = [];
      const pulsing: PatternNode[] = [];
      const rates: number[] = [];
      const mono: PatternNode[] = [];
      const sounds = new Set<string>();
      const needOsc: ControlNode[] = [];
      const needNoise: ControlNode[] = [];
      const seen = new Set<string>();
      const spectralModes = new Set<string>();
      const spectral = { open: false };
      const needSpectral: ControlNode[] = [];
      const owned = new Map<string, Set<string>>();
      const ownerOpen = new Set<string>();
      const needOwner: ControlNode[] = [];
      const lag: { fir?: ControlNode; spectral?: ControlNode; send: boolean } = { send: false };
      const compVals = new Map<string, string>();
      const compState: { open: boolean; node?: ControlNode } = { open: false };
      const orbits: number[] = [];
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
            if (HEADPHONE_CONTROLS.has(n.control)) phones.push(n);
            if (PULSE_CONTROLS.has(n.control)) {
              for (const r of constRates(n.value)) {
                if (r <= 0) continue;
                rates.push(r);
                if (r >= PULSE_RANGE[0] && r <= PULSE_RANGE[1]) pulsing.push(n);
              }
            }
            if (n.control === 's') for (const x of constStrings(n.value)) sounds.add(x);
            if (n.control === 'iphase' && constRates(n.value).some((r) => r >= MONO_PHASE)) mono.push(n);
            if (OSC_ONLY.has(n.control) || (n.control === 'earsplit' && constStrings(n.value).includes('harmonics')))
              needOsc.push(n);
            if (NOISE_ONLY.has(n.control)) needNoise.push(n);
            if (n.control === 'spectral') {
              if (isConstArg(n.value)) for (const x of constStrings(n.value)) spectralModes.add(x);
              else spectral.open = true;
            }
            if (SPECTRAL_NEEDS.has(n.control)) needSpectral.push(n);
            if (OWNER_SETS.has(n.control)) {
              if (isConstArg(n.value)) {
                let set = owned.get(n.control);
                if (!set) {
                  set = new Set<string>();
                  owned.set(n.control, set);
                }
                for (const x of constStrings(n.value)) set.add(x);
              } else {
                ownerOpen.add(n.control);
              }
            }
            if (MODE_NEEDS.has(n.control)) needOwner.push(n);
            if (n.control === 'fir') lag.fir ??= n;
            if (n.control === 'spectral') lag.spectral ??= n;
            if (n.control === 'ssend') lag.send = true;
            if (COMP_CONTROLS.has(n.control)) {
              if (isConstArg(n.value)) compVals.set(n.control, constRates(n.value).join('|'));
              else compState.open = true;
              if (n.control === 'comp') compState.node ??= n;
            }
            if (n.control === 'orbit') orbits.push(...constRates(n.value).map((x) => Math.round(x)));
            if (n.target) walk(n.target);
            walkArg(n.value);
            return;
          case 'transform':
            walk(n.target);
            n.args.forEach(walkArg);
            return;
          case 'combine':
            n.children.forEach(walk);
            return;
          case 'ref': {
            if (n.binding.startsWith('param:') || seen.has(n.binding)) return;
            seen.add(n.binding);
            const b = this.bindingExprs.get(n.binding);
            if (b) walk(b);
            return;
          }
          case 'error':
            if (n.recovered) walk(n.recovered);
            return;
          default:
            return;
        }
      };
      walk(o.expr);
      const output = o.label ?? o.id;
      const hp = phones[0];
      if (hp) this.advise('I-EXT-HEADPHONES', 'This track uses controls that only work on headphones.', hp, output);
      const pulse = pulsing[0];
      if (pulse) this.advise('I-EXT-PULSE', 'This track pulses at a steady rate between 3 and 30 Hz.', pulse, output);
      const m = mono[0];
      if (m)
        this.advise(
          'I-EXT-MONO',
          'The two ears are in opposite phase, so this track nearly cancels on speakers or in mono.',
          m,
          output,
        );
      // Stages whose latency playback compensates (TS-85).
      const firOn = [...(owned.get('fir') ?? [])].some((v) => v !== 'none' && FIR_SET.has(v));
      const specOn = !lag.send && [...spectralModes].some((v) => v !== 'none' && SPECTRAL_SET.has(v));
      const lagNode = firOn ? lag.fir : specOn ? lag.spectral : undefined;
      if (lagNode)
        this.advise(
          'I-DSP-LATENCY',
          'This track uses a filter that delays its sound, so playback starts it a little early to stay in time.',
          lagNode,
          output,
        );
      // Only when every sound of the track is known and of the wrong kind (TS-68).
      const kinds = [...sounds].map(soundKind);
      const only = (...ks: readonly SoundKind[]): boolean => kinds.length > 0 && kinds.every((k) => ks.includes(k));
      if (only('noise', 'drum'))
        for (const n of needOsc)
          this.unsupported(n, 'needs an oscillator voice; it has no effect on noise or drums.', output);
      if (only('osc'))
        for (const n of needNoise)
          this.unsupported(n, 'works on noise sounds only; it has no effect on oscillators.', output);
      // Mode-specific spectral controls without their mode, when every spectral value is known (TS-80).
      if (!spectral.open) {
        for (const n of needSpectral) {
          const mode = SPECTRAL_NEEDS.get(n.control) ?? '';
          if (!spectralModes.has(mode))
            this.unsupported(n, `only affects spectral("${mode}"); it has no effect here.`, output);
        }
      }
      // Controls whose owner control is missing or selects nothing they affect (TS-84).
      for (const n of needOwner) {
        const need = MODE_NEEDS.get(n.control);
        if (!need || ownerOpen.has(need.owner)) continue;
        const known = OWNER_SETS.get(need.owner);
        const modes = need.modes;
        const vals = [...(owned.get(need.owner) ?? [])];
        const ok = vals.some((v) => (modes ? modes.has(v) : known?.has(v) === true && v !== 'none'));
        if (ok) continue;
        this.unsupported(
          n,
          modes
            ? `only affects ${[...modes].map((x) => `${need.owner}("${x}")`).join(' or ')}; it has no effect here.`
            : `needs ${need.owner}; it has no effect here.`,
          output,
        );
      }
      // Compressor settings are per orbit; tell hosts when tracks disagree (TS-87).
      const cn = compState.node;
      const cv = compVals.get('comp');
      if (cn && !compState.open && cv !== undefined && cv !== '0') {
        const sig = [...compVals]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join(',');
        for (const orbit of orbits.length > 0 ? orbits : [0]) {
          const prev = orbitComp.get(orbit);
          if (prev === undefined) {
            orbitComp.set(orbit, sig);
          } else if (prev !== sig) {
            this.advise(
              'I-DSP-ORBIT',
              `Another track on orbit ${String(orbit)} sets different compressor settings; the latest onset wins.`,
              cn,
              output,
            );
            break;
          }
        }
      }
      if (!hp && rates.length === 0) continue;
      this.advisories.push({
        output,
        headphones: hp !== undefined,
        ...(rates.length > 0 ? { pulse: [Math.min(...rates), Math.max(...rates)] as const } : undefined),
      });
    }
  }
  private advise(id: string, message: string, n: PatternNode, output: string): void {
    this.diags.push({ id, severity: 'info', message, range: n.range, effect: 'none', output });
  }
  private unsupported(n: ControlNode, rest: string, output: string): void {
    this.diags.push({
      id: 'W-ARG-UNSUPPORTED',
      severity: 'warning',
      message: `\`${n.control}\` ${rest}`,
      range: n.range,
      effect: 'none',
      output,
    });
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

  /**
   * Emits a diagnostic. Inside an expansion, a diagnostic in a function body that was already
   * reported at the definition is dropped; any other one is moved to the call site (TS-50).
   */
  private diag(
    id: string,
    severity: Diagnostic['severity'],
    message: string,
    range: Range,
    effect: Diagnostic['effect'],
    fixes?: Fix[],
  ): void {
    if (severity === 'error' && effect !== 'none') this.errored = true;
    let r = range;
    let msg = message;
    let fx = fixes;
    const related: { range: SourceRange; message: string }[] = [];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (!f || r.start < f.def.range.start || r.end > f.def.range.end) continue;
      if (f.def.dryKeys.has(diagKey(id, r))) return;
      related.push({ range: this.sr(r), message: `Inside \`${f.def.name}\`.` });
      r = f.callRange;
      msg = `In \`${f.def.name}\`: ${msg}`;
      fx = undefined;
    }
    const key = diagKey(id, r);
    if (this.dry) this.dry.dryKeys.add(key);
    if (this.seenDiags.has(key)) return;
    this.seenDiags.add(key);
    this.diags.push({
      id,
      severity,
      message: msg,
      range: this.sr(r),
      effect,
      ...(this.outputLabel !== undefined ? { output: this.outputLabel } : undefined),
      ...(this.outputLabel === undefined && this.defLabel !== undefined ? { definition: this.defLabel } : undefined),
      ...(fx ? { fixes: fx } : undefined),
      ...(related.length > 0 ? { related } : undefined),
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
    if (id === 'samples' || id === 'sample') {
      this.sampleDirective(id, e);
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
  /** `sample(name, path)` and `samples(path)` (docs/samples.md §1, TS-90). Nothing is fetched here. */
  private sampleDirective(id: 'sample' | 'samples', e: Extract<Expr, { k: 'call' }>): void {
    const strArg = (i: number): Extract<Expr, { k: 'str' }> | undefined => {
      const a = e.args[i];
      return a?.k === 'str' ? a : undefined;
    };
    const badPath = (a: Extract<Expr, { k: 'str' }>, what: string): void => {
      this.diag(
        'E-RES-PATH',
        'error',
        `\`${a.value}\` is not a ${what}. Use a relative path inside the sample collection, such as "./drums/kick.wav"; absolute paths, URLs and ".." are not allowed.`,
        a.range,
        'none',
      );
    };
    if (id === 'samples') {
      const a = strArg(0);
      if (!a) {
        this.diag('E-ARG-TYPE', 'error', '`samples` needs a constant string.', e.range, 'none');
        return;
      }
      if (a.value.includes(':')) {
        // A remote bank, declared but never fetched (X-31, TS-90).
        this.resources.push({ kind: 'samples', spec: a.value, range: this.sr(a.range) });
        this.diag(
          'I-RES-DECLARED',
          'info',
          'Sample bank declared. It is fetched only if the host allows it.',
          e.range,
          'none',
        );
        return;
      }
      if (!isBankPath(a.value)) {
        badPath(a, 'bank path (a directory ending in "/" or a ".json" manifest)');
        return;
      }
      this.resources.push({ kind: 'bank', spec: a.value, range: this.sr(a.range) });
      this.diag(
        'I-RES-DECLARED',
        'info',
        'Sample bank declared. The host loads it from its sample collection.',
        e.range,
        'none',
      );
      return;
    }
    const n = strArg(0);
    const p = strArg(1);
    if (!n || !p) {
      this.diag(
        'E-ARG-TYPE',
        'error',
        '`sample` needs a constant name and a constant path, as in sample("kick", "./drums/kick.wav").',
        e.range,
        'none',
      );
      return;
    }
    if (!isSoundName(n.value)) {
      this.diag(
        'E-ARG-TYPE',
        'error',
        `\`${n.value}\` is not a sound name: start with a letter, then use letters, digits, "_" or "-".`,
        n.range,
        'none',
      );
      return;
    }
    if (!isWavPath(p.value)) {
      badPath(p, 'path to a .wav file');
      return;
    }
    if (this.resources.some((r) => r.kind === 'wav' && r.name === n.value)) {
      this.diag('E-NAME-DUP', 'error', `The sample \`${n.value}\` is already declared.`, n.range, 'none');
      return;
    }
    if (KIT_SOUNDS.has(n.value)) {
      this.diag(
        'I-RES-OVERRIDE',
        'info',
        `The sample \`${n.value}\` replaces the built-in kit sound of the same name in this document.`,
        n.range,
        'none',
      );
    }
    this.resources.push({ kind: 'wav', name: n.value, spec: p.value, range: this.sr(p.range) });
  }

  // ---- constants

  private fold(e: Expr): Rational | null {
    switch (e.k) {
      case 'num':
        return parseDecimal(e.text);
      case 'ident': {
        const s = this.lookup(e.name);
        if (s?.k === 'arg') {
          const { expr, ctx } = s;
          return this.inCtx(ctx, () => this.fold(expr));
        }
        if (s?.k === 'abstract') {
          s.used.n++;
          this.taint = true;
          return PLACEHOLDER;
        }
        if (s) return null;
        return this.constBindings.get(e.name) ?? null;
      }
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
    if (this.frames.length > 0 && ++this.expandCount > this.limits.maxExpandedNodes) throw new ExpandLimit();
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
          const s = this.lookup(name);
          if (s) {
            if (s.k === 'abstract') s.used.n++;
            return this.reject(
              'E-LX-CALL',
              `\`${name}\` is a parameter, not a function. Use \`.apply(${name})\` to call a function argument.`,
              e.callee.range,
              e.range,
            );
          }
          const def = this.functions.get(name);
          if (def) return this.callUser(def, undefined, anchor, this.thunks(e.args), e.range, e.callee.range);
          if (this.bindingIndex.has(name))
            return this.reject('E-LX-CALL', `\`${name}\` is a pattern, not a function.`, e.callee.range, e.range);
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

  /** Lowers a substituted name in a pattern position. */
  private substPattern(s: Subst, e: Ident, anchor: NodeId): PatternNode {
    switch (s.k) {
      case 'param':
      case 'abstract': {
        if (s.k === 'abstract') s.used.n++;
        const id = s.k === 'param' ? s.id : e.name;
        return {
          kind: 'ref',
          id: hash64(anchor, 'param', e.name),
          range: this.sr(e.range),
          type: CONTROLS,
          name: e.name,
          binding: `param:${id}`,
        };
      }
      case 'arg': {
        const { expr, ctx } = s;
        return this.inCtx(ctx, () => this.pattern(expr, anchor));
      }
      case 'node':
        this.charge(s.node);
        return s.node;
    }
  }

  private ident(e: Ident, anchor: NodeId): PatternNode {
    if (PROTO_NAMES.has(e.name))
      return this.reject('E-LX-PROTO', `\`${e.name}\` cannot be used as a name.`, e.range, e.range);
    const s = this.lookup(e.name);
    if (s) return this.substPattern(s, e, anchor);
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
    if (this.functions.has(e.name))
      return this.reject(
        'E-ARG-TYPE',
        `\`${e.name}\` is a function. Call it, as in \`${e.name}(…)\`, or pass it to a method such as \`.every\`.`,
        e.range,
        e.range,
      );
    const hit = this.reg.lookup(e.name);
    if (hit?.entry.id === 'run' || hit?.entry.id === 'irand')
      return this.reject('E-ARG-MISSING', `\`${e.name}\` needs a count, as in \`${e.name}(8)\`.`, e.range, e.range);
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
  private spreads(args: readonly Expr[]): Expr[] {
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
    let s = this.reg.suggest(name);
    for (const fn of this.functions.keys()) {
      const d = editDistance(name, fn);
      if (d <= 2 && (!s || d < s.distance)) s = { name: fn, distance: d };
    }
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
    const args = this.spreads(rawArgs);
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
    if (entry.id === 'run') return this.runCall(args, range, anchor, id);
    if (entry.id === 'irand') {
      // TS-58: irand(n) lowers onto the rand signal, so the IR gains no new node kind.
      const lowered = this.lowerArgs(entry, args, range, anchor, name);
      if (!lowered) return this.errorNode('E-ARG-TYPE', range);
      const sig: PatternType = { kind: 'signal', of: 'number' };
      const target: PatternNode = {
        kind: 'signal',
        id: hash64(anchor, 'signal', 'rand'),
        range: this.sr(range),
        type: sig,
        fn: 'rand',
      };
      return { kind: 'transform', id, range: this.sr(range), type: sig, fn: 'irand', target, args: lowered };
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
  /** `run(n)` lowers to a fastcat of the constants 0 … n−1 (TS-58). */
  private runCall(args: readonly Expr[], range: Range, anchor: NodeId, id: NodeId): PatternNode {
    const a = args[0];
    const v = a ? this.fold(a) : null;
    const k = v ? toNumber(v) : NaN;
    const cap = this.limits.maxStepMultiplier;
    if (!Number.isInteger(k) || k < 1 || k > cap) {
      this.diag(
        'E-ARG-TYPE',
        'error',
        `\`run\` needs a whole number from 1 to ${String(cap)}.`,
        a?.range ?? range,
        'subtree-muted',
      );
      return this.errorNode('E-ARG-TYPE', range);
    }
    const extra = args[1];
    if (extra) this.diag('W-ARG-EXTRA', 'warning', 'Extra arguments to `run` are ignored.', extra.range, 'none');
    if (this.frames.length > 0) {
      this.expandCount += k;
      if (this.expandCount > this.limits.maxExpandedNodes) throw new ExpandLimit();
    }
    const type: PatternType = { kind: 'pattern', of: 'number' };
    const children = Array.from({ length: k }, (_, i): PatternNode => ({
      kind: 'pure',
      id: hash64(anchor, 'run', String(i)),
      range: this.sr(range),
      type,
      value: { t: 'num', v: rat(i) },
    }));
    return { kind: 'combine', id, range: this.sr(range), type, op: 'fastcat', children };
  }

  private method(m: Member, rawArgs: readonly Expr[], range: Range, anchor: NodeId): PatternNode {
    const recv = this.pattern(m.object, anchor);
    if (PROTO_NAMES.has(m.name))
      return this.reject('E-LX-PROTO', `\`${m.name}\` cannot be used as a name.`, m.nameRange, range, recv);
    const def = this.functions.get(m.name);
    if (def) return this.callUser(def, { k: 'node', node: recv }, recv.id, this.thunks(rawArgs), range, m.nameRange);
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
    if (hit.entry.id === 'apply') return this.applyCall(recv, rawArgs, range);
    this.alias(hit, m.nameRange);
    const args = this.spreads(rawArgs);
    const entry = hit.entry;
    const base = this.salted(recv.id);
    const id = hash64(base, entry.id);
    if (entry.category === 'control') {
      const a0 = args[0];
      const p = entry.params[0];
      if (!a0 || !p) {
        this.diag('E-ARG-MISSING', 'error', `\`.${m.name}\` needs a value.`, range, 'subtree-muted');
        return this.errorNode('E-ARG-MISSING', range, recv);
      }
      const value = this.arg(a0, p, hash64(base, entry.id, '0'), entry);
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
      if (entry.id === 'scale' || entry.id === 'transpose' || entry.id === 'octave') {
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
        const a0 = this.resolve(args[0]);
        if (a0 !== 'abstract' && !(a0?.k === 'str' && parseScale(a0.value))) {
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
      const lowered = this.lowerArgs(entry, args, range, base, `.${m.name}`);
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
    if (e.k === 'ident') {
      const s = this.lookup(e.name);
      if (s?.k === 'arg') {
        const { expr, ctx } = s;
        return this.inCtx(ctx, () => this.arg(expr, p, anchor, entry));
      }
      if (s?.k === 'abstract') {
        if (p.patternable) return { kind: 'pattern', node: this.substPattern(s, e, anchor) };
        s.used.n++;
        return { kind: 'const', value: { t: 'num', v: PLACEHOLDER } };
      }
    }
    this.resetTaint();
    const v = this.fold(e);
    if (v) {
      if (p.range && !this.taint) {
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

  /**
   * Lowers a function argument: a registered transform, a partial application, a user function
   * (TS-48) or a restricted lambda.
   */
  private fnArg(e: Expr, anchor: NodeId): Arg | null {
    if (e.k === 'ident') {
      const s = this.lookup(e.name);
      if (s?.k === 'arg') {
        const { expr, ctx } = s;
        return this.inCtx(ctx, () => this.fnArg(expr, anchor));
      }
      if (s?.k === 'abstract') {
        s.used.n++;
        return DUMMY_FN;
      }
      if (s) {
        this.diag('E-ARG-FUNCTION', 'error', `\`${e.name}\` is a pattern, not a function.`, e.range, 'subtree-muted');
        return null;
      }
      const def = this.functions.get(e.name);
      if (def) return this.userFnValue(def, [], anchor, e.range, e.range);
    }
    if (e.k === 'call' && e.callee.k === 'ident') {
      const name = e.callee.name;
      const s = this.lookup(name);
      if (s) {
        if (s.k === 'abstract') s.used.n++;
        this.diag(
          'E-LX-CALL',
          'error',
          `\`${name}\` is a parameter, not a function. Use \`.apply(${name})\` to call a function argument.`,
          e.callee.range,
          'subtree-muted',
        );
        return null;
      }
      const def = this.functions.get(name);
      if (def) return this.userFnValue(def, this.thunks(e.args), anchor, e.range, e.callee.range);
    }
    const transformRef = (name: string, nameRange: Range, args: readonly Expr[], range: Range): Arg | null => {
      const hit = this.reg.lookup(name);
      if (!hit || (hit.entry.category !== 'transform' && hit.entry.category !== 'tonal') || hit.entry.id === 'apply') {
        this.diag('E-ARG-FUNCTION', 'error', `\`${name}\` is not a known transform.`, nameRange, 'subtree-muted');
        return null;
      }
      this.alias(hit, nameRange);
      const lowered = this.lowerArgs(hit.entry, this.spreads(args), range, anchor, name);
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
        (this.reg.lookup(root.name) !== undefined || this.functions.has(root.name));
      const oneParam = e.params.length === 1 && e.params[0]?.default === undefined;
      if (param === null || !oneParam || PROTO_NAMES.has(param) || !(startsFromParam || registryCall)) {
        this.diag(
          'E-LX-LAMBDA',
          'error',
          'A function must take one parameter and transform it, as in `x => x.fast(2)`.',
          e.range,
          'subtree-muted',
        );
        return null;
      }
      const id = this.freshParam(param);
      const scope = new Map(this.ctx.scope);
      scope.set(param, { k: 'param', id });
      this.irParams.push(id);
      try {
        const body = this.inCtx({ ...this.ctx, scope }, () => this.pattern(e.body, hash64(anchor, 'lambda')));
        return { kind: 'function', fn: { kind: 'lambda', param: id, body } };
      } finally {
        this.irParams.pop();
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
