import { type Rational, ONE, ZERO, gt, lte, parseDecimal, rat, toNumber } from '@tartlet/time';
import type { MiniAst, MiniDiagnostic, MiniOp, MiniParseResult, MiniStep } from './ast';
import { lexMini, type MiniToken } from './lexer';

/** idea.md §7.2 and §10.4. */
export const MAX_STEP_MULTIPLIER = 1024;
export const MAX_MINI_DEPTH = 32;
const LIMIT = rat(MAX_STEP_MULTIPLIER);
const INT = /^\d+$/;
const SEQ_END = [',', ']', '>', '}', ')', '|'];

export function parseMini(src: string): MiniParseResult {
  const { tokens, diagnostics } = lexMini(src);
  const parser = new MiniParser(tokens, diagnostics);
  return { ast: parser.parseTop(), diagnostics };
}

function singleAtomText(ast: MiniAst): string | undefined {
  if (ast.t !== 'seq' || ast.steps.length !== 1) return undefined;
  const body = ast.steps[0]?.body;
  return body?.t === 'atom' ? body.text : undefined;
}

class MiniParser {
  private i = 0;
  private depth = 0;
  private aborted = false;
  constructor(
    private readonly toks: readonly MiniToken[],
    private readonly diags: MiniDiagnostic[],
  ) {}

  parseTop(): MiniAst {
    const ast = this.parseStack(null, undefined);
    const t = this.toks[this.i];
    if (t && !this.aborted) {
      this.err('E-MINI-UNEXPECTED', `Unexpected \`${t.text}\`.`, t);
      this.i = this.toks.length;
    }
    return ast;
  }

  private peek(): MiniToken | undefined {
    return this.toks[this.i];
  }
  private isPunct(t: MiniToken | undefined, ch: string): boolean {
    return t !== undefined && t.kind === 'punct' && t.text === ch;
  }
  private err(id: string, message: string, t: MiniToken): void {
    this.diags.push({ id, message, range: [t.start, t.end] });
  }
  private overLimit(text: string | undefined): boolean {
    const v = text === undefined ? null : parseDecimal(text);
    return v !== null && gt(v, LIMIT);
  }

  private parseStack(close: string | null, open: MiniToken | undefined): MiniAst {
    const layers: MiniAst[] = [this.parseLayer()];
    while (!this.aborted && this.isPunct(this.peek(), ',')) {
      this.i++;
      layers.push(this.parseLayer());
    }
    if (close !== null && !this.aborted) {
      if (this.isPunct(this.peek(), close)) this.i++;
      else if (open) this.err('E-MINI-UNCLOSED', `\`${open.text}\` is never closed; expected \`${close}\`.`, open);
    }
    return layers.length === 1 && layers[0] ? layers[0] : { t: 'stack', layers };
  }

  /** Sequences separated by `|` form a seeded per-cycle choice (M-25). */
  private parseLayer(): MiniAst {
    const first = this.parseSeq();
    const items: MiniAst[] = [first];
    let at: number | undefined;
    while (!this.aborted && this.isPunct(this.peek(), '|')) {
      at ??= this.peek()?.start;
      this.i++;
      items.push(this.parseSeq());
    }
    return items.length === 1 ? first : { t: 'choice', items, at: at ?? 0 };
  }

  private parseSeq(): MiniAst {
    const steps: MiniStep[] = [];
    const groups: MiniStep[][] = [];
    for (;;) {
      if (this.aborted) break;
      const t = this.peek();
      if (!t) break;
      if (t.kind === 'punct' && SEQ_END.includes(t.text)) break;
      if (this.isPunct(t, '!')) {
        // Bare `!` repeats the previous step (TS-9: not allowed first).
        this.i++;
        const last = steps[steps.length - 1];
        if (!last) this.err('E-MINI-REPLICATE', '`!` must follow a step.', t);
        else steps[steps.length - 1] = { ...last, replicate: last.replicate + 1 };
        continue;
      }
      if (t.kind === 'word' && t.text === '.') {
        // A standalone `.` separates equal groups (M-28, TS-2, TS-31).
        groups.push(steps.splice(0));
        this.i++;
        continue;
      }
      const step = this.parseStep();
      if (step) steps.push(step);
    }
    if (groups.length === 0) return { t: 'seq', steps };
    groups.push(steps);
    return {
      t: 'seq',
      steps: groups
        .filter((g) => g.length > 0)
        .map((g) => ({ body: { t: 'seq', steps: g }, weight: ONE, replicate: 1, ops: [] })),
    };
  }

  private parseStep(): MiniStep | null {
    const body = this.parseTerm();
    if (!body) return null;
    let weight: Rational = ONE;
    let replicate = 1;
    const ops: MiniOp[] = [];
    for (;;) {
      if (this.aborted) break;
      const t = this.peek();
      if (!t || t.kind !== 'punct' || t.spaceBefore) break;
      if (t.text === '*' || t.text === '/') {
        this.i++;
        const by = this.parseTerm();
        if (!by) {
          this.err('E-MINI-FACTOR', `\`${t.text}\` needs a factor.`, t);
          break;
        }
        if (by.t === 'atom' && this.overLimit(by.text)) {
          this.diags.push({
            id: 'E-LIMIT-MULTIPLIER',
            message: `Factor exceeds ${String(MAX_STEP_MULTIPLIER)}.`,
            range: by.range,
          });
        }
        ops.push({ op: t.text === '*' ? 'fast' : 'slow', by });
        continue;
      }
      if (t.text === '!') {
        const nt = this.toks[this.i + 1];
        if (nt && nt.kind === 'word' && !nt.spaceBefore && INT.test(nt.text)) {
          this.i += 2;
          replicate = Number(nt.text);
          if (replicate > MAX_STEP_MULTIPLIER) {
            this.err('E-LIMIT-MULTIPLIER', `Replication exceeds ${String(MAX_STEP_MULTIPLIER)}.`, nt);
            replicate = 1;
          }
        } else {
          this.i++;
          replicate += 1;
        }
        continue;
      }
      if (t.text === '@') {
        this.i++;
        const nt = this.peek();
        const w = nt?.kind === 'word' ? parseDecimal(nt.text) : null;
        if (nt?.kind === 'word') this.i++;
        if (!w || lte(w, ZERO)) this.err('E-MINI-WEIGHT', '`@` needs a positive number.', t);
        else weight = w;
        continue;
      }
      if (t.text === '?') {
        this.i++;
        let amount: number | undefined;
        const nt = this.peek();
        if (nt?.kind === 'word' && !nt.spaceBefore) {
          const v = parseDecimal(nt.text);
          if (v) {
            this.i++;
            const x = toNumber(v);
            if (x < 0 || x > 1) this.err('E-MINI-DEGRADE', '`?` amount must be between 0 and 1.', nt);
            else amount = x;
          }
        }
        ops.push(amount === undefined ? { op: 'degrade', at: t.start } : { op: 'degrade', amount, at: t.start });
        continue;
      }
      if (t.text === '(') {
        const e = this.parseEuclid(t);
        if (e) ops.push(e);
        continue;
      }
      break;
    }
    return { body, weight, replicate, ops };
  }

  private parseEuclid(open: MiniToken): MiniOp | null {
    this.i++;
    const k = this.parseSeq();
    if (!this.isPunct(this.peek(), ',')) {
      this.err('E-MINI-EUCLID', 'Euclid needs `(k,n)` or `(k,n,r)`.', open);
      while (this.peek() && !this.isPunct(this.peek(), ')')) this.i++;
      if (this.isPunct(this.peek(), ')')) this.i++;
      return null;
    }
    this.i++;
    const n = this.parseSeq();
    let rot: MiniAst | undefined;
    if (this.isPunct(this.peek(), ',')) {
      this.i++;
      rot = this.parseSeq();
    }
    if (!this.isPunct(this.peek(), ')')) {
      if (!this.aborted) this.err('E-MINI-UNCLOSED', '`(` is never closed; expected `)`.', open);
      return null;
    }
    this.i++;
    const empty = (a: MiniAst): boolean => a.t === 'seq' && a.steps.length === 0;
    if (empty(k) || empty(n) || (rot !== undefined && empty(rot))) {
      this.err('E-MINI-EUCLID', 'Euclid needs `(k,n)` or `(k,n,r)`.', open);
      return null;
    }
    if (this.overLimit(singleAtomText(n)))
      this.err('E-LIMIT-MULTIPLIER', `Euclid steps exceed ${String(MAX_STEP_MULTIPLIER)}.`, open);
    return rot ? { op: 'euclid', k, n, rot } : { op: 'euclid', k, n };
  }

  private parsePoly(open: MiniToken): MiniAst {
    const body = this.parseStack('}', open);
    const layers = body.t === 'stack' ? body.layers : [body];
    const c = this.peek();
    if (!this.aborted && c && this.isPunct(c, '%') && !c.spaceBefore) {
      this.i++;
      const steps = this.parseTerm();
      if (!steps) {
        this.err('E-MINI-FACTOR', '`%` needs a step count.', c);
        return { t: 'poly', layers };
      }
      if (steps.t === 'atom' && this.overLimit(steps.text)) {
        this.diags.push({
          id: 'E-LIMIT-MULTIPLIER',
          message: `Steps exceed ${String(MAX_STEP_MULTIPLIER)}.`,
          range: steps.range,
        });
      }
      return { t: 'poly', layers, steps };
    }
    return { t: 'poly', layers };
  }

  private parseTerm(): MiniAst | null {
    const t = this.toks[this.i++];
    if (!t) return null;
    if (t.kind === 'rest') return { t: 'rest', range: [t.start, t.end] };
    if (t.kind === 'word') {
      const c = this.peek();
      if (this.isPunct(c, ':') && c && !c.spaceBefore) {
        const nt = this.toks[this.i + 1];
        if (nt && nt.kind === 'word' && !nt.spaceBefore && INT.test(nt.text)) {
          this.i += 2;
          return { t: 'atom', text: t.text, index: Number(nt.text), range: [t.start, nt.end] };
        }
        this.err('E-MINI-INDEX', '`:` needs a whole-number index.', c);
        this.i++;
      }
      return { t: 'atom', text: t.text, range: [t.start, t.end] };
    }
    if (t.text === '[' || t.text === '<' || t.text === '{') {
      if (++this.depth > MAX_MINI_DEPTH) {
        this.err('E-LIMIT-DEPTH', `Pattern nests deeper than ${String(MAX_MINI_DEPTH)} levels.`, t);
        this.aborted = true;
        this.i = this.toks.length;
        this.depth--;
        return null;
      }
      const r =
        t.text === '[' ? this.parseStack(']', t) : t.text === '<' ? toAlt(this.parseStack('>', t)) : this.parsePoly(t);
      this.depth--;
      return r;
    }
    this.err('E-MINI-UNEXPECTED', `Unexpected \`${t.text}\`.`, t);
    return null;
  }
}

function toAlt(ast: MiniAst): MiniAst {
  if (ast.t === 'stack') return { t: 'stack', layers: ast.layers.map(toAlt) };
  if (ast.t !== 'seq') return { t: 'alt', items: [ast] };
  const items: MiniAst[] = [];
  for (const step of ast.steps) {
    const plain = step.ops.length === 0;
    for (let r = 0; r < step.replicate; r++) {
      items.push(plain ? step.body : { t: 'seq', steps: [{ ...step, replicate: 1 }] });
    }
  }
  return { t: 'alt', items };
}
