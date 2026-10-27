/** UTF-16 offsets into the source. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

export type Expr =
  | { readonly k: 'num'; readonly text: string; readonly range: Range }
  | {
      readonly k: 'str';
      readonly value: string;
      readonly contentStart: number;
      readonly quote: string;
      readonly range: Range;
    }
  | { readonly k: 'bool'; readonly value: boolean; readonly range: Range }
  | { readonly k: 'ident'; readonly name: string; readonly range: Range }
  | { readonly k: 'call'; readonly callee: Expr; readonly args: readonly Expr[]; readonly range: Range }
  | {
      readonly k: 'member';
      readonly object: Expr;
      readonly name: string;
      readonly nameRange: Range;
      readonly range: Range;
    }
  | {
      readonly k: 'binary';
      readonly op: '+' | '-' | '*' | '/';
      readonly left: Expr;
      readonly right: Expr;
      readonly range: Range;
    }
  | { readonly k: 'unary'; readonly op: '+' | '-'; readonly arg: Expr; readonly range: Range }
  | { readonly k: 'array'; readonly items: readonly Expr[]; readonly range: Range }
  /** `...expr`, only as a call argument or array item. */
  | { readonly k: 'spread'; readonly arg: Expr; readonly range: Range }
  /**
   * `x => body`. A block body `{ return body; }` is desugared at parse time, so `block`
   * records only the original form. `param` is null for `() => …`.
   */
  | {
      readonly k: 'lambda';
      readonly param: string | null;
      readonly paramRange: Range;
      readonly body: Expr;
      readonly block: boolean;
      readonly range: Range;
    };

export type Stmt =
  | {
      readonly k: 'output';
      readonly label: string;
      readonly labelRange: Range;
      readonly expr: Expr;
      readonly range: Range;
    }
  | {
      readonly k: 'binding';
      readonly decl: 'const' | 'let';
      readonly name: string;
      readonly nameRange: Range;
      readonly expr: Expr;
      readonly range: Range;
    }
  | { readonly k: 'expr'; readonly expr: Expr; readonly range: Range }
  | { readonly k: 'error'; readonly range: Range };

export interface SyntaxDiagnostic {
  readonly id: string;
  readonly message: string;
  readonly range: Range;
}

export interface SyntaxTree {
  readonly source: string;
  readonly statements: readonly Stmt[];
  /** Comments are kept for edits and highlighting (X-30). */
  readonly comments: readonly Range[];
  readonly diagnostics: readonly SyntaxDiagnostic[];
}
