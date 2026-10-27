import type { Range, SyntaxDiagnostic } from "./tree";

export interface Token {
  readonly kind: "ident" | "num" | "str" | "punct" | "eof";
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly nlBefore: boolean;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
const NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const PUNCT3 = ["..."];
const PUNCT2 = ["=>"];
const PUNCT1 = new Set("()[]{}.,;:=+-*/<>!?&|%".split(""));

export function lex(src: string): { tokens: Token[]; comments: Range[]; diagnostics: SyntaxDiagnostic[] } {
  const tokens: Token[] = [];
  const comments: Range[] = [];
  const diagnostics: SyntaxDiagnostic[] = [];
  let i = 0;
  let nl = true;
  const push = (kind: Token["kind"], start: number, end: number): void => {
    tokens.push({ kind, text: src.slice(start, end), start, end, nlBefore: nl });
    nl = false;
  };
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "\n") { nl = true; i++; continue; }
    if (ch === " " || ch === "\t" || ch === "\r") { i++; continue; }
    if (src.startsWith("//", i)) {
      const e = src.indexOf("\n", i);
      const end = e < 0 ? src.length : e;
      comments.push({ start: i, end });
      i = end;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? src.length : e + 2;
      if (e < 0) diagnostics.push({ id: "E-SYN-UNTERMINATED", message: "Unclosed comment.", range: { start: i, end } });
      if (src.slice(i, end).includes("\n")) nl = true;
      comments.push({ start: i, end });
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        const c = src.charAt(j);
        if (c === "\\") { j += 2; continue; }
        if (c === ch) { closed = true; break; }
        if (c === "\n" && ch !== "`") break;
        if (ch === "`" && c === "$" && src.charAt(j + 1) === "{") {
          diagnostics.push({ id: "E-LX-INTERP", message: "Template interpolation `${…}` is not allowed.", range: { start: j, end: j + 2 } });
        }
        j++;
      }
      if (!closed) diagnostics.push({ id: "E-SYN-UNTERMINATED", message: "Unterminated string.", range: { start: i, end: j } });
      push("str", i, closed ? j + 1 : j);
      i = closed ? j + 1 : j;
      continue;
    }
    NUM.lastIndex = i;
    const m = /[0-9.]/.test(ch) ? NUM.exec(src) : null;
    if (m && !(ch === "." && !/[0-9]/.test(src.charAt(i + 1)))) {
      push("num", i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && IDENT.test(src.charAt(j))) j++;
      push("ident", i, j);
      i = j;
      continue;
    }
    const p3 = PUNCT3.find((p) => src.startsWith(p, i));
    const p2 = p3 ?? PUNCT2.find((p) => src.startsWith(p, i));
    if (p2) {
      push("punct", i, i + p2.length);
      i += p2.length;
      continue;
    }
    if (PUNCT1.has(ch)) {
      push("punct", i, i + 1);
      i++;
      continue;
    }
    diagnostics.push({ id: "E-SYN-CHAR", message: `Unexpected character \`${ch}\`.`, range: { start: i, end: i + 1 } });
    i++;
  }
  tokens.push({ kind: "eof", text: "", start: src.length, end: src.length, nlBefore: true });
  return { tokens, comments, diagnostics };
}