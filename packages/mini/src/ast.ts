import type { Rational } from '@tartlet/time';

/** Mini-notation AST (idea.md §9.4). Ranges are relative to the string content. */
export type MiniAst =
  | { readonly t: 'seq'; readonly steps: readonly MiniStep[] }
  | { readonly t: 'stack'; readonly layers: readonly MiniAst[] }
  | { readonly t: 'alt'; readonly items: readonly MiniAst[] }
  | { readonly t: 'poly'; readonly layers: readonly MiniAst[]; readonly steps?: MiniAst }
  /** `at` is the string offset of the first `|`, used to salt the choice (TS-30). */
  | { readonly t: 'choice'; readonly items: readonly MiniAst[]; readonly at?: number }
  | MiniAtom
  | { readonly t: 'rest'; readonly range: readonly [number, number] };

export interface MiniAtom {
  readonly t: 'atom';
  readonly text: string;
  readonly index?: number;
  readonly range: readonly [number, number];
}

export interface MiniStep {
  readonly body: MiniAst;
  readonly weight: Rational;
  readonly replicate: number;
  readonly ops: readonly MiniOp[];
}

export type MiniOp =
  | { readonly op: 'fast'; readonly by: MiniAst }
  | { readonly op: 'slow'; readonly by: MiniAst }
  /** `at` is the string offset of the `?`, used to salt its draws (TS-17). */
  | { readonly op: 'degrade'; readonly amount?: number; readonly at?: number }
  | { readonly op: 'euclid'; readonly k: MiniAst; readonly n: MiniAst; readonly rot?: MiniAst };

export interface MiniDiagnostic {
  readonly id: string;
  readonly message: string;
  readonly range: readonly [number, number];
}

export interface MiniParseResult {
  readonly ast: MiniAst;
  readonly diagnostics: readonly MiniDiagnostic[];
}
