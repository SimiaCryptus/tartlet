import type { MiniDiagnostic } from './ast';

export interface MiniToken {
  readonly kind: 'word' | 'punct' | 'rest';
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** True when whitespace (or the start of the string) precedes this token. */
  readonly spaceBefore: boolean;
}

const PUNCT = new Set(['[', ']', '<', '>', '{', '}', ',', '*', '/', '!', '@', ':', '(', ')', '?', '%', '|']);
const WORD = /[A-Za-z0-9#.\-_^']/;
const SPACE = /\s/;

export function lexMini(src: string): { tokens: MiniToken[]; diagnostics: MiniDiagnostic[] } {
  const tokens: MiniToken[] = [];
  const diagnostics: MiniDiagnostic[] = [];
  let i = 0;
  let space = true;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (SPACE.test(ch)) {
      i++;
      space = true;
      continue;
    }
    if (ch === '~') {
      tokens.push({ kind: 'rest', text: ch, start: i, end: i + 1, spaceBefore: space });
      i++;
    } else if (PUNCT.has(ch)) {
      tokens.push({ kind: 'punct', text: ch, start: i, end: i + 1, spaceBefore: space });
      i++;
    } else if (WORD.test(ch)) {
      let j = i + 1;
      while (j < src.length && WORD.test(src.charAt(j))) j++;
      tokens.push({ kind: 'word', text: src.slice(i, j), start: i, end: j, spaceBefore: space });
      i = j;
    } else {
      diagnostics.push({ id: 'E-MINI-CHAR', message: `Unexpected character \`${ch}\` in pattern.`, range: [i, i + 1] });
      i++;
    }
    space = false;
  }
  return { tokens, diagnostics };
}
