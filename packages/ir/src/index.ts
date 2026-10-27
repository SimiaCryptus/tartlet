// Types from idea.md §9 and §10. T0 deviations are noted inline and in spec-issues.md.
import type { Rational } from '@tartlet/time';
import type { MiniAst } from '@tartlet/mini'; // TS-13

export type NodeId = string;
export type RegistryId = string;
export type ControlId = string;
export type DiagnosticId = string;

export type ValueKind = 'note' | 'sample' | 'number' | 'string' | 'bool' | 'controls';
export type PatternType =
  | { readonly kind: 'pattern'; readonly of: ValueKind }
  | { readonly kind: 'signal'; readonly of: 'number' }
  | { readonly kind: 'function' }
  | { readonly kind: 'error' };

/** Line and col are 0-based. col counts UTF-16 units and byte counts UTF-8 bytes (TS-15). */
export interface Offset {
  readonly line: number;
  readonly col: number;
  readonly byte: number;
}
export interface SourceRange {
  readonly start: Offset;
  readonly end: Offset;
}
export interface Provenance {
  readonly node: NodeId;
  readonly range: SourceRange;
  readonly role: 'origin' | 'transform' | 'control';
}

export type ConstValue =
  | { readonly t: 'num'; readonly v: Rational }
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean };

export interface NodeBase {
  readonly id: NodeId;
  readonly range: SourceRange;
  readonly type: PatternType;
}
export interface MiniNode extends NodeBase {
  readonly kind: 'mini';
  readonly text: string;
  /** UTF-16 index of the string content in the source (TS-15). */
  readonly textOffset: number;
  readonly ast: MiniAst;
  readonly valueKind: 'note' | 'sample' | 'number' | 'string';
}
export interface PureNode extends NodeBase {
  readonly kind: 'pure';
  readonly value: ConstValue;
}
export interface SilenceNode extends NodeBase {
  readonly kind: 'silence';
}
export interface RefNode extends NodeBase {
  readonly kind: 'ref';
  readonly name: string;
  readonly binding: NodeId;
}
export interface CombineNode extends NodeBase {
  readonly kind: 'combine';
  readonly op: 'stack' | 'slowcat' | 'fastcat' | 'timecat' | 'polymeter' | 'arrange'; // timecat: TS-3
  readonly children: readonly PatternNode[];
  readonly weights?: readonly Rational[];
}
export interface TransformNode extends NodeBase {
  readonly kind: 'transform';
  readonly fn: RegistryId;
  readonly target: PatternNode;
  readonly args: readonly Arg[];
}
export interface ControlNode extends NodeBase {
  readonly kind: 'control';
  readonly control: ControlId;
  readonly alias?: string;
  readonly target: PatternNode | null;
  readonly value: Arg;
  readonly structure?: 'receiver' | 'argument' | 'both';
}
export interface SignalNode extends NodeBase {
  readonly kind: 'signal';
  readonly fn: RegistryId;
}
export interface ErrorNode extends NodeBase {
  readonly kind: 'error';
  readonly diagnostic: DiagnosticId;
  readonly recovered?: PatternNode;
}
export type PatternNode =
  MiniNode | PureNode | SilenceNode | RefNode | CombineNode | TransformNode | ControlNode | SignalNode | ErrorNode;

export type Arg =
  | { readonly kind: 'pattern'; readonly node: PatternNode }
  | { readonly kind: 'const'; readonly value: ConstValue }
  | { readonly kind: 'function'; readonly fn: FunctionValue };
export type FunctionValue =
  | { readonly kind: 'ref'; readonly fn: RegistryId; readonly args: readonly Arg[] }
  | { readonly kind: 'lambda'; readonly param: string; readonly body: PatternNode };

export interface SourceRef {
  readonly hash: string;
  readonly length: number;
}
export interface Settings {
  readonly cps: Rational;
  readonly seed?: string;
  readonly meta: Readonly<Record<string, string>>;
}
export interface Binding {
  readonly id: NodeId;
  readonly name: string;
  readonly expr: PatternNode;
}
export interface Output {
  readonly id: NodeId;
  readonly label?: string;
  readonly expr: PatternNode;
  readonly status: 'ok' | 'muted-error' | 'muted-user';
}
export interface ResourceDecl {
  readonly kind: 'samples';
  readonly spec: string;
  readonly range: SourceRange;
}
export interface Program {
  readonly irVersion: 'tartlet/1';
  readonly source?: SourceRef;
  readonly settings: Settings;
  readonly bindings: readonly Binding[];
  readonly outputs: readonly Output[];
  readonly resources: readonly ResourceDecl[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface Fix {
  readonly title: string;
  readonly edits: readonly { readonly range: SourceRange; readonly text: string }[];
  readonly safe: boolean;
}
export interface Diagnostic {
  readonly id: DiagnosticId;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly range: SourceRange;
  readonly node?: NodeId;
  readonly output?: string;
  readonly effect: 'none' | 'subtree-muted' | 'output-muted' | 'program-rejected';
  readonly fixes?: readonly Fix[];
  readonly related?: readonly { readonly range: SourceRange; readonly message: string }[];
}

export interface LimitsConfig {
  readonly maxSourceBytes: number;
  readonly maxNestingDepth: number;
  readonly maxStepMultiplier: number;
  readonly cpsRange: readonly [number, number];
  readonly maxEvalSteps: number;
  readonly maxEventsPerWindow: number;
  readonly maxDenominator: bigint;
}
export const DEFAULT_LIMITS: LimitsConfig = {
  maxSourceBytes: 65_536,
  maxNestingDepth: 32,
  maxStepMultiplier: 1024,
  cpsRange: [0.001, 100],
  maxEvalSteps: 200_000,
  maxEventsPerWindow: 2_048,
  maxDenominator: 10n ** 9n,
};
export interface QueryBudget {
  steps: number;
  events: number;
}

export type Pitch =
  | { readonly kind: 'midi'; readonly value: number }
  | { readonly kind: 'name'; readonly letter: string; readonly accidental: number; readonly octave: number };
export * from './codec';
