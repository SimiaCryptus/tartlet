import { lex, type Token } from './lexer';
import type { Expr, Range, Stmt, SyntaxDiagnostic, SyntaxTree } from './tree';

class ParseError extends Error {
  constructor(
    readonly token: Token,
    message: string,
    readonly id = 'E-SYN-UNEXPECTED',
  ) {
    super(message);
  }
}

const MAX_DEPTH = 32; // idea.md §10.4 maxNestingDepth

const CONTROL_KW = new Set([
  'for',
  'while',
  'do',
  'if',
  'else',
  'switch',
  'case',
  'try',
  'catch',
  'finally',
  'throw',
  'return',
  'break',
  'continue',
]);
const LX_KW = new Map<string, string>([
  ['import', 'E-LX-IMPORT'],
  ['export', 'E-LX-IMPORT'],
  ['function', 'E-LX-KEYWORD'],
  ['class', 'E-LX-KEYWORD'],
  ['new', 'E-LX-KEYWORD'],
  ['async', 'E-LX-KEYWORD'],
  ['await', 'E-LX-KEYWORD'],
  ['var', 'E-LX-KEYWORD'],
  ['yield', 'E-LX-KEYWORD'],
  ['delete', 'E-LX-KEYWORD'],
  ['typeof', 'E-LX-KEYWORD'],
  ['void', 'E-LX-KEYWORD'],
  ['this', 'E-LX-KEYWORD'],
  ['super', 'E-LX-KEYWORD'],
  ['with', 'E-LX-KEYWORD'],
  ['debugger', 'E-LX-KEYWORD'],
]);

/** The rejection id for a JavaScript keyword outside the closed language (idea.md §7.3). */
export function keywordId(name: string): string | undefined {
  return CONTROL_KW.has(name) ? 'E-LX-CONTROL' : LX_KW.get(name);
}

export function parse(source: string): SyntaxTree {
  const { tokens, comments, diagnostics } = lex(source);
  const p = new Parser(tokens, diagnostics);
  return { source, statements: p.program(), comments, diagnostics };
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(
    private readonly toks: readonly Token[],
    private readonly diags: SyntaxDiagnostic[],
  ) {}

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)] as Token;
  }
  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.i++;
    return t;
  }
  private isP(t: Token, s: string): boolean {
    return t.kind === 'punct' && t.text === s;
  }
  private expectP(s: string): Token {
    const t = this.peek();
    if (!this.isP(t, s))
      throw new ParseError(
        t,
        `Expected \`${s}\`${t.kind === 'eof' ? ' before end of input' : `, found \`${t.text}\``}.`,
      );
    return this.next();
  }
  private r(a: Token | Range, b: Token | Range): Range {
    return { start: a.start, end: b.end };
  }
  private prevEnd(): number {
    return (this.toks[this.i - 1] ?? this.peek()).end;
  }

  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.peek().kind !== 'eof') {
      if (this.isP(this.peek(), ';')) {
        this.i++;
        continue;
      }
      const start = this.peek().start;
      try {
        out.push(this.statement());
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.diags.push({ id: e.id, message: e.message, range: { start: e.token.start, end: e.token.end } });
        this.recover(e.token);
        out.push({ k: 'error', range: { start, end: this.prevEnd() } });
      }
    }
    return out;
  }

  /**
   * Skips to the next token that starts a line at bracket depth 0 and is not a chain
   * continuation, or to a `;` (idea.md §10.2). Brackets opened after the error are balanced,
   * so a whole `for (…) { … }` block is skipped as one unit.
   */
  private recover(from: Token): void {
    this.depth = 0;
    while (this.i < this.toks.length - 1 && this.peek() !== from && this.peek().start < from.start) this.i++;
    const startIdx = this.i;
    let nest = 0;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') break;
      if (nest === 0 && this.i > startIdx && (this.isP(t, ';') || (t.nlBefore && !this.isP(t, '.')))) break;
      if (t.kind === 'punct' && '([{'.includes(t.text)) nest++;
      else if (t.kind === 'punct' && ')]}'.includes(t.text)) nest = Math.max(0, nest - 1);
      this.i++;
    }
  }

  private endStatement(): void {
    const t = this.peek();
    if (t.kind === 'eof' || this.isP(t, ';') || t.nlBefore) return;
    throw new ParseError(t, `Unexpected \`${t.text}\` after the end of a statement.`);
  }

  private statement(): Stmt {
    const t = this.peek();
    if (t.kind === 'ident' && (t.text === 'const' || t.text === 'let')) {
      this.next();
      const name = this.next();
      if (name.kind !== 'ident') throw new ParseError(name, 'Expected a binding name.');
      this.expectP('=');
      const expr = this.expr();
      this.endStatement();
      return {
        k: 'binding',
        decl: t.text,
        name: name.text,
        nameRange: this.r(name, name),
        expr,
        range: this.r(t, expr.range),
      };
    }
    if (t.kind === 'ident' && this.isP(this.peek(1), ':') && keywordId(t.text) === undefined) {
      this.next();
      this.next();
      const expr = this.expr();
      this.endStatement();
      return { k: 'output', label: t.text, labelRange: this.r(t, t), expr, range: this.r(t, expr.range) };
    }
    const expr = this.expr();
    this.endStatement();
    return { k: 'expr', expr, range: expr.range };
  }

  expr(): Expr {
    if (++this.depth > MAX_DEPTH) throw new ParseError(this.peek(), 'Expression nests too deeply.', 'E-LIMIT-DEPTH');
    try {
      let left = this.mult();
      while (this.isP(this.peek(), '+') || this.isP(this.peek(), '-')) {
        const op = this.next().text as '+' | '-';
        const right = this.mult();
        left = { k: 'binary', op, left, right, range: this.r(left.range, right.range) };
      }
      const t = this.peek();
      if (this.isP(t, '?'))
        throw new ParseError(t, 'Conditionals are not allowed in a Tartlet document.', 'E-LX-CONTROL');
      if (this.isP(t, '='))
        throw new ParseError(t, 'Assignment is allowed only in a fresh `const` or `let` binding.', 'E-LX-ASSIGN');
      return left;
    } finally {
      this.depth--;
    }
  }

  private mult(): Expr {
    let left = this.unary();
    while (this.isP(this.peek(), '*') || this.isP(this.peek(), '/')) {
      const op = this.next().text as '*' | '/';
      const right = this.unary();
      left = { k: 'binary', op, left, right, range: this.r(left.range, right.range) };
    }
    return left;
  }

  private unary(): Expr {
    const t = this.peek();
    if (this.isP(t, '-') || this.isP(t, '+')) {
      this.next();
      const arg = this.unary();
      return { k: 'unary', op: t.text as '+' | '-', arg, range: this.r(t, arg.range) };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (this.isP(t, '.')) {
        this.next();
        const name = this.next();
        if (name.kind !== 'ident') throw new ParseError(name, 'Expected a method name after `.`.');
        e = { k: 'member', object: e, name: name.text, nameRange: this.r(name, name), range: this.r(e.range, name) };
      } else if (this.isP(t, '(') && !t.nlBefore) {
        const args = this.list('(', ')');
        e = { k: 'call', callee: e, args: args.items, range: { start: e.range.start, end: args.end } };
      } else if (this.isP(t, '[') && !t.nlBefore) {
        throw new ParseError(t, 'Computed member access `a[b]` is not allowed.', 'E-LX-MEMBER');
      } else {
        return e;
      }
    }
  }

  private list(open: string, close: string): { items: Expr[]; end: number } {
    this.expectP(open);
    const items: Expr[] = [];
    while (!this.isP(this.peek(), close)) {
      const t = this.peek();
      if (this.isP(t, '...')) {
        this.next();
        const arg = this.expr();
        items.push({ k: 'spread', arg, range: { start: t.start, end: arg.range.end } });
      } else {
        items.push(this.expr());
      }
      if (!this.isP(this.peek(), ',')) break;
      this.next();
    }
    const end = this.expectP(close).end;
    return { items, end };
  }

  /** Parses a lambda body after `=>`. Block bodies must be exactly `{ return expr; }`. */
  private lambdaRest(param: string | null, paramRange: Range, start: number): Expr {
    if (this.isP(this.peek(), '{')) {
      const open = this.i;
      try {
        return this.blockLambda(param, paramRange, start);
      } catch (e) {
        // Skip the whole block so recovery does not restart inside it.
        if (e instanceof ParseError) this.skipBlock(open);
        throw e;
      }
    }
    const body = this.expr();
    return { k: 'lambda', param, paramRange, body, block: false, range: { start, end: body.range.end } };
  }
  /** Moves past the bracket group opened at token index `open`, or to end of input. */
  private skipBlock(open: number): void {
    this.i = open;
    let nest = 0;
    for (;;) {
      const t = this.next();
      if (t.kind === 'eof') return;
      if (t.kind === 'punct' && '([{'.includes(t.text)) nest++;
      else if (t.kind === 'punct' && ')]}'.includes(t.text) && --nest <= 0) return;
    }
  }
  private blockLambda(param: string | null, paramRange: Range, start: number): Expr {
    {
      this.next();
      const ret = this.peek();
      if (!(ret.kind === 'ident' && ret.text === 'return')) {
        throw new ParseError(ret, 'A function block may contain only a single `return`.', 'E-LX-LAMBDA');
      }
      this.next();
      const body = this.expr();
      if (this.isP(this.peek(), ';')) this.next();
      const close = this.peek();
      if (!this.isP(close, '}'))
        throw new ParseError(close, 'A function block may contain only a single `return`.', 'E-LX-LAMBDA');
      this.next();
      return { k: 'lambda', param, paramRange, body, block: true, range: { start, end: close.end } };
    }
  }

  private primary(): Expr {
    const t = this.peek();
    switch (t.kind) {
      case 'num':
        this.next();
        return { k: 'num', text: t.text, range: this.r(t, t) };
      case 'str': {
        this.next();
        const closed = t.text.length >= 2 && t.text.endsWith(t.text.charAt(0));
        return {
          k: 'str',
          value: t.text.slice(1, closed ? -1 : undefined),
          contentStart: t.start + 1,
          quote: t.text.charAt(0),
          range: this.r(t, t),
        };
      }
      case 'ident': {
        const kw = keywordId(t.text);
        if (kw) throw new ParseError(t, `\`${t.text}\` is not allowed in a Tartlet document.`, kw);
        if (t.text === 'true' || t.text === 'false') {
          this.next();
          return { k: 'bool', value: t.text === 'true', range: this.r(t, t) };
        }
        if (this.isP(this.peek(1), '=>')) {
          this.next();
          this.next();
          return this.lambdaRest(t.text, this.r(t, t), t.start);
        }
        this.next();
        return { k: 'ident', name: t.text, range: this.r(t, t) };
      }
      case 'punct':
        if (t.text === '(') {
          if (this.isP(this.peek(1), ')') && this.isP(this.peek(2), '=>')) {
            this.i += 3;
            return this.lambdaRest(null, this.r(t, t), t.start);
          }
          const p1 = this.peek(1);
          if (p1.kind === 'ident' && this.isP(this.peek(2), ')') && this.isP(this.peek(3), '=>')) {
            this.i += 4;
            return this.lambdaRest(p1.text, this.r(p1, p1), t.start);
          }
          this.next();
          const e = this.expr();
          this.expectP(')');
          return e;
        }
        if (t.text === '[') {
          const l = this.list('[', ']');
          return { k: 'array', items: l.items, range: { start: t.start, end: l.end } };
        }
        if (t.text === '{') throw new ParseError(t, 'Object literals are not supported yet.', 'E-NOT-YET');
        throw new ParseError(t, `Unexpected \`${t.text}\`.`);
      default:
        throw new ParseError(t, 'Unexpected end of input.');
    }
  }
}
