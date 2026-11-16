// Generators, embedded grammars and arithmetic for long-form composition (docs/symphonic.md).
// Everything here is pure and local: a value depends only on its index and constants.
import { type Rational, ONE, ZERO, add, div, isZero, lt, lte, parseDecimal } from '@tartlet/time';

export interface GrammarError {
  readonly message: string;
  /** Offsets inside the string. */
  readonly range: readonly [number, number];
}
export type GrammarResult<T> = T | { readonly error: GrammarError };

interface Word {
  readonly text: string;
  readonly start: number;
  // eslint-disable-next-line no-restricted-syntax -- a string offset, not musical time
  readonly end: number;
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function words(text: string, base: number): Word[] {
  const out: Word[] = [];
  let i = 0;
  while (i < text.length) {
    if (isSpace(text.charAt(i))) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && !isSpace(text.charAt(j))) j++;
    out.push({ text: text.slice(i, j), start: base + i, end: base + j });
    i = j;
  }
  return out;
}

function fail(message: string, start: number, end: number): { readonly error: GrammarError } {
  return { error: { message, range: [start, Math.max(start, end)] } };
}
// ---- repeats and endings in layouts (docs/long_compositions.md P4)
const MAX_REPEAT = 16;
const MAX_GROUP_DEPTH = 32;
const ENDING = /^(\d{1,2})\.(.+)$/;
const REPEAT = /^\*(\d{1,3})/;
type LayoutItem =
  | { readonly k: 'w'; readonly w: Word; readonly ending?: number }
  | { readonly k: 'g'; readonly items: readonly LayoutItem[]; readonly times: number };
class LayoutFail extends Error {
  constructor(readonly error: GrammarError) {
    super(error.message);
  }
}
/**
 * The words of a layout with `( … )*n` groups played out. `1.name` inside a group plays only on
 * that pass. Words keep their offsets in `text`, so repeated sections point at the same text.
 */
function layoutWords(text: string): GrammarResult<{ readonly words: readonly Word[] }> {
  let i = 0;
  function stop(message: string, s: number, e: number): never {
    throw new LayoutFail({ message, range: [s, Math.max(s, e)] });
  }
  const seq = (depth: number, open: number | null): LayoutItem[] => {
    const items: LayoutItem[] = [];
    for (;;) {
      while (i < text.length && isSpace(text.charAt(i))) i++;
      if (i >= text.length) {
        if (open !== null) stop('`(` is never closed; expected `)*n`.', open, open + 1);
        return items;
      }
      const ch = text.charAt(i);
      if (ch === ')') {
        if (open === null) stop('Unexpected `)`.', i, i + 1);
        return items;
      }
      if (ch === '(') {
        const start = i;
        if (depth >= MAX_GROUP_DEPTH) stop('Repeats nest too deeply.', i, i + 1);
        i++;
        const inner = seq(depth + 1, start);
        i++;
        const m = REPEAT.exec(text.slice(i));
        if (!m) stop('A group needs a repeat count right after `)`, such as `)*2`.', i - 1, i);
        const times = Number(m[1]);
        const countStart = i;
        i += m[0].length;
        if (!(times >= 2 && times <= MAX_REPEAT))
          stop(`A group repeats from 2 to ${String(MAX_REPEAT)} times.`, countStart, i);
        if (inner.length === 0) stop('A group needs at least one section.', start, i);
        for (const it of inner) {
          if (it.k === 'w' && it.ending !== undefined && it.ending > times)
            stop(
              `Ending ${String(it.ending)} never plays: the group repeats ${String(times)} times.`,
              it.w.start,
              it.w.end,
            );
        }
        items.push({ k: 'g', items: inner, times });
        continue;
      }
      let j = i;
      while (j < text.length && !isSpace(text.charAt(j)) && text.charAt(j) !== '(' && text.charAt(j) !== ')') j++;
      const raw = text.slice(i, j);
      const m = ENDING.exec(raw);
      if (m) {
        if (open === null)
          stop('An ending such as `1.name` must be inside a repeated group, as in `(a 1.b 2.c)*2`.', i, j);
        const n = Number(m[1]);
        if (n < 1) stop('Endings count from 1.', i, j);
        const off = (m[1] ?? '').length + 1;
        items.push({ k: 'w', w: { text: m[2] ?? '', start: i + off, end: j }, ending: n });
      } else {
        items.push({ k: 'w', w: { text: raw, start: i, end: j } });
      }
      i = j;
    }
  };
  try {
    const items = seq(0, null);
    const out: Word[] = [];
    const emit = (list: readonly LayoutItem[], pass: number | undefined): void => {
      for (const it of list) {
        if (it.k === 'g') {
          for (let p = 1; p <= it.times; p++) emit(it.items, p);
          continue;
        }
        if (it.ending !== undefined && it.ending !== pass) continue;
        if (out.length >= MAX_SECTIONS)
          stop(
            `A layout has at most ${String(MAX_SECTIONS)} sections once repeats are played out.`,
            it.w.start,
            it.w.end,
          );
        out.push(it.w);
      }
    };
    emit(items, undefined);
    return { words: out };
  } catch (e) {
    if (e instanceof LayoutFail) return { error: e.error };
    throw e;
  }
}

// ---- form layouts

export interface FormSection {
  /** 0 for `A`, 1 for `B`, … */
  // eslint-disable-next-line no-restricted-syntax -- a part index, not musical time
  readonly part: number;
  readonly primes: number;
  readonly len: Rational;
  readonly range: readonly [number, number];
}
export const MAX_SECTIONS = 256;
// eslint-disable-next-line security/detect-unsafe-regex -- anchored, no nested repetition: linear time
const SECTION = /^([A-Z]{1,3})('*)(?:@(.+))?$/;
// eslint-disable-next-line security/detect-unsafe-regex -- anchored, no nested repetition: linear time
const NUMBERED = /^#(\d{1,4})('*)(?:@(.+))?$/;
/** `A` is part 0, `Z` 25, `AA` 26, `AB` 27, … (bijective base 26). */
export function partIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** The letters of part `i`: the inverse of `partIndex`. */
export function partName(i: number): string {
  let n = Math.floor(i) + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
/** A section length: a decimal, or `n/d` in generated layouts. */
function parseLength(text: string, fractions: boolean): Rational | null {
  const i = text.indexOf('/');
  if (i < 0 || !fractions) return parseDecimal(text);
  const n = parseDecimal(text.slice(0, i));
  const d = parseDecimal(text.slice(i + 1));
  return n && d && !isZero(d) ? div(n, d) : null;
}

/**
 * `A@16 B@8 A'@16`: letters name parts (A to Z, then AA, AB, …), primes make variants, `@n` is a
 * length in cycles. With `numbered`, parts may also be written `#12` and lengths `3/2`; only
 * layouts generated by the checker use it.
 */
export function parseFormLayout(
  text: string,
  opts?: { readonly numbered?: boolean },
): GrammarResult<{ readonly sections: readonly FormSection[]; readonly total: Rational }> {
  const numbered = opts?.numbered === true;
  const lw = layoutWords(text);
  if ('error' in lw) return lw;
  const ws = lw.words;
  if (ws.length === 0) return fail('A form needs at least one section, such as "A@8".', 0, text.length);
  const sections: FormSection[] = [];
  let total = ZERO;
  for (const w of ws) {
    const m = SECTION.exec(w.text) ?? (numbered ? NUMBERED.exec(w.text) : null);
    if (!m) {
      return fail(
        `\`${w.text}\` is not a section: use capital letters (A to Z, then AA, AB, …), optional primes and an optional length, such as "A@8" or "B'".`,
        w.start,
        w.end,
      );
    }
    const lenText = m[3];
    const len = lenText === undefined ? ONE : parseLength(lenText, numbered);
    if (!len || lte(len, ZERO)) return fail(`The length of \`${w.text}\` must be a positive number.`, w.start, w.end);
    const head = m[1] ?? 'A';
    sections.push({
      part: /^\d/.test(head) ? Number(head) : partIndex(head),
      primes: (m[2] ?? '').length,
      len,
      range: [w.start, w.end],
    });
    total = add(total, len);
  }
  return { sections, total };
}
// ---- song timelines (docs/long_compositions.md)
export interface SongSection {
  readonly name: string;
  readonly primes: number;
  readonly len: Rational;
  /** The length as written, reused in generated form layouts. */
  readonly lenText: string;
  readonly range: readonly [number, number];
}
// eslint-disable-next-line security/detect-unsafe-regex -- anchored, no nested repetition: linear time
const SONG_SECTION = /^([a-z][a-z0-9_]*)('*)(?:@(.+))?$/;
const SECTION_NAME = /^([a-z][a-z0-9_]*)('*)$/;
const MAP_ENTRY = /^(\*|[a-z][a-z0-9_]*)('*):(.+)$/;
/** `intro@4 verse@16 chorus@16 verse'@16`: lowercase names, optional primes and lengths. */
export function parseSongLayout(
  text: string,
): GrammarResult<{ readonly sections: readonly SongSection[]; readonly total: Rational }> {
  const lw = layoutWords(text);
  if ('error' in lw) return lw;
  const ws = lw.words;
  if (ws.length === 0) return fail('A song needs at least one section, such as "verse@8".', 0, text.length);
  const sections: SongSection[] = [];
  let total = ZERO;
  for (const w of ws) {
    const m = SONG_SECTION.exec(w.text);
    if (!m) {
      return fail(
        `\`${w.text}\` is not a section: use a lowercase name, optional primes and an optional length, such as "verse@16" or "chorus'".`,
        w.start,
        w.end,
      );
    }
    const lenText = m[3] ?? '1';
    const len = parseDecimal(lenText);
    if (!len || lte(len, ZERO)) return fail(`The length of \`${w.text}\` must be a positive number.`, w.start, w.end);
    sections.push({ name: m[1] ?? '', primes: (m[2] ?? '').length, len, lenText, range: [w.start, w.end] });
    total = add(total, len);
  }
  return { sections, total };
}
export interface SectionRef {
  readonly name: string;
  readonly primes: number;
  readonly range: readonly [number, number];
}
/** `verse chorus'`: section names for `.sections` and `.exceptSections`. */
export function parseSectionNames(text: string): GrammarResult<{ readonly names: readonly SectionRef[] }> {
  const ws = words(text, 0);
  if (ws.length === 0) return fail('Name at least one section, such as "chorus".', 0, text.length);
  if (ws.length > MAX_SECTIONS) return fail('Too many section names.', 0, text.length);
  const names: SectionRef[] = [];
  for (const w of ws) {
    const m = SECTION_NAME.exec(w.text);
    if (!m) return fail(`\`${w.text}\` is not a section name such as "verse" or "chorus'".`, w.start, w.end);
    names.push({ name: m[1] ?? '', primes: (m[2] ?? '').length, range: [w.start, w.end] });
  }
  return { names };
}
export interface SectionValue extends SectionRef {
  /** `*` is the default for sections that are not listed. */
  readonly value: string;
}
/** `intro:.4 chorus':2 *:.9`: one value per section, for `bysec`. */
export function parseSectionMap(text: string): GrammarResult<{ readonly entries: readonly SectionValue[] }> {
  const ws = words(text, 0);
  if (ws.length === 0) return fail('Give at least one value, such as "verse:.6 *:.9".', 0, text.length);
  if (ws.length > MAX_SECTIONS + 1) return fail('Too many section values.', 0, text.length);
  const entries: SectionValue[] = [];
  const seen = new Set<string>();
  for (const w of ws) {
    const m = MAP_ENTRY.exec(w.text);
    const name = m?.[1];
    const primes = (m?.[2] ?? '').length;
    if (!m || name === undefined || (name === '*' && primes > 0)) {
      return fail(`\`${w.text}\` is not a section value such as "verse:.6" or "*:1".`, w.start, w.end);
    }
    const key = `${name}${"'".repeat(primes)}`;
    if (seen.has(key)) return fail(`\`${key}\` has two values.`, w.start, w.end);
    seen.add(key);
    entries.push({ name, primes, value: m[3] ?? '', range: [w.start, w.end] });
  }
  return { entries };
}
// ---- tempo maps (docs/long_compositions.md P5)
export interface TempoMapPoint {
  readonly cycle: Rational;
  /** Cycles per minute. */
  readonly cpm: Rational;
  readonly range: readonly [number, number];
}
export const MAX_TEMPO_POINTS = 256;
const TEMPO_POINT = /^([^:]+):([^:]+)$/;
/** `0:25 92:25 100:15`: cycle:cpm points in order; a repeated cycle is a step. */
export function parseTempoMap(text: string): GrammarResult<{ readonly points: readonly TempoMapPoint[] }> {
  const ws = words(text, 0);
  if (ws.length === 0) return fail('A tempo map needs at least one point, such as "0:120".', 0, text.length);
  if (ws.length > MAX_TEMPO_POINTS) {
    return fail(
      `A tempo map has at most ${String(MAX_TEMPO_POINTS)} points.`,
      ws[MAX_TEMPO_POINTS]?.start ?? 0,
      text.length,
    );
  }
  const points: TempoMapPoint[] = [];
  for (const w of ws) {
    const m = TEMPO_POINT.exec(w.text);
    const cycle = m?.[1] === undefined ? null : parseDecimal(m[1]);
    const cpm = m?.[2] === undefined ? null : parseDecimal(m[2]);
    if (!cycle || !cpm) {
      return fail(
        `\`${w.text}\` is not a point such as "16:120": a cycle, a colon and a tempo in cycles per minute.`,
        w.start,
        w.end,
      );
    }
    if (lt(cycle, ZERO)) return fail(`The cycle of \`${w.text}\` must not be negative.`, w.start, w.end);
    if (lte(cpm, ZERO)) return fail(`The tempo of \`${w.text}\` must be positive.`, w.start, w.end);
    const prev = points[points.length - 1];
    if (prev && lt(cycle, prev.cycle)) {
      return fail(
        `\`${w.text}\` comes before the point in front of it; list points in order of cycle.`,
        w.start,
        w.end,
      );
    }
    points.push({ cycle, cpm, range: [w.start, w.end] });
  }
  return { points };
}

// ---- envelopes

export interface EnvPoint {
  readonly value: number;
  /** Length of the segment that starts at this point. */
  readonly weight: number;
}
// eslint-disable-next-line security/detect-unsafe-regex -- anchored, no nested repetition: linear time
const POINT = /^([^@]+)(?:@(.+))?$/;

/** `0.2 1@3 0.6 1@2 0`: values with optional `@` weights for the segment that follows each one. */
export function parseEnvPoints(text: string): GrammarResult<{ readonly points: readonly EnvPoint[] }> {
  const ws = words(text, 0);
  if (ws.length === 0) return fail('An envelope needs at least one value.', 0, text.length);
  if (ws.length > 256) return fail('An envelope has at most 256 points.', 0, text.length);
  const points: EnvPoint[] = [];
  for (const w of ws) {
    const m = POINT.exec(w.text);
    const v = m?.[1] === undefined ? null : parseDecimal(m[1]);
    if (!m || !v) return fail(`\`${w.text}\` is not a value such as "0.5" or "1@3".`, w.start, w.end);
    const wt = m[2] === undefined ? ONE : parseDecimal(m[2]);
    if (!wt || lte(wt, ZERO)) return fail(`The weight of \`${w.text}\` must be a positive number.`, w.start, w.end);
    points.push({ value: Number(v.n) / Number(v.d), weight: Number(wt.n) / Number(wt.d) });
  }
  return { points };
}

/** The envelope value at `pos` in [0, 1), joining the points with straight lines. */
export function envAt(points: readonly EnvPoint[], pos: number): number {
  const n = points.length;
  const first = points[0];
  if (!first) return 0;
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += points[i]?.weight ?? 0;
  if (n === 1 || total <= 0) return first.value;
  let x = Math.min(1, Math.max(0, pos)) * total;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) break;
    if (x < a.weight || i === n - 2) {
      const f = a.weight > 0 ? Math.min(1, x / a.weight) : 1;
      return a.value + (b.value - a.value) * f;
    }
    x -= a.weight;
  }
  return points[n - 1]?.value ?? first.value;
}

// ---- sieves

export type Sieve =
  | { readonly k: 'class'; readonly m: number; readonly r: number }
  | { readonly k: 'or' | 'and'; readonly a: Sieve; readonly b: Sieve }
  | { readonly k: 'not'; readonly a: Sieve };

class SieveFail extends Error {
  constructor(readonly error: GrammarError) {
    super(error.message);
  }
}

interface Tok {
  readonly t: string;
  readonly s: number;
  readonly e: number;
}

/** `3@0 | 4@1 & -5@2`: residue classes joined by `|`, intersected by `&` and complemented by `-`. */
export function parseSieve(text: string): GrammarResult<{ readonly sieve: Sieve }> {
  const toks: Tok[] = [];
  for (let i = 0; i < text.length;) {
    const ch = text.charAt(i);
    if (isSpace(ch)) {
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < text.length && text.charAt(j) >= '0' && text.charAt(j) <= '9') j++;
      toks.push({ t: text.slice(i, j), s: i, e: j });
      i = j;
      continue;
    }
    if ('@|&-()'.includes(ch)) {
      toks.push({ t: ch, s: i, e: i + 1 });
      i++;
      continue;
    }
    return fail(`Unexpected \`${ch}\` in a sieve.`, i, i + 1);
  }
  if (toks.length > 256) return fail('A sieve has at most 256 symbols.', 0, text.length);
  let p = 0;
  let depth = 0;
  const isInt = (t: Tok | undefined): t is Tok => t !== undefined && /^\d+$/.test(t.t);
  function stop(message: string, t: Tok | undefined = toks[p]): never {
    throw new SieveFail({
      message,
      range: t ? [t.s, t.e] : [Math.max(0, text.length - 1), text.length],
    });
  }
  const peek = (): string | undefined => toks[p]?.t;
  const or = (): Sieve => {
    let a = and();
    while (peek() === '|') {
      p++;
      a = { k: 'or', a, b: and() };
    }
    return a;
  };
  const and = (): Sieve => {
    let a = unary();
    while (peek() === '&') {
      p++;
      a = { k: 'and', a, b: unary() };
    }
    return a;
  };
  const unary = (): Sieve => {
    if (++depth > 32) stop('The sieve nests too deeply.');
    try {
      if (peek() === '-') {
        p++;
        return { k: 'not', a: unary() };
      }
      return primary();
    } finally {
      depth--;
    }
  };
  const primary = (): Sieve => {
    const t = toks[p];
    if (t?.t === '(') {
      p++;
      const inner = or();
      if (peek() !== ')') stop('Expected `)`.');
      p++;
      return inner;
    }
    if (!isInt(t)) return stop('Expected a residue class such as `3@0`.');
    p++;
    if (peek() !== '@') stop('Expected `@` and a remainder, as in `3@0`.');
    p++;
    const r = toks[p];
    if (!isInt(r)) return stop('Expected a remainder after `@`.');
    p++;
    const m = Number(t.t);
    if (m < 1 || m > 1_000_000) stop('The modulus must be from 1 to 1000000.', t);
    return { k: 'class', m, r: Number(r.t) % m };
  };
  try {
    const sieve = or();
    if (p < toks.length) stop(`Unexpected \`${toks[p]?.t ?? ''}\`.`);
    return { sieve };
  } catch (e) {
    if (e instanceof SieveFail) return { error: e.error };
    throw e;
  }
}

export function sieveHas(s: Sieve, i: number): boolean {
  switch (s.k) {
    case 'class':
      return ((i % s.m) + s.m) % s.m === s.r;
    case 'or':
      return sieveHas(s.a, i) || sieveHas(s.b, i);
    case 'and':
      return sieveHas(s.a, i) && sieveHas(s.b, i);
    case 'not':
      return !sieveHas(s.a, i);
  }
}

// ---- integer sequences

export const INT_SEQUENCES: readonly string[] = [
  'ruler',
  'thuemorse',
  'norgard',
  'fib',
  'sturm',
  'vdc',
  'prime',
  'collatz',
  'digits',
];
export const MAX_INT_INDEX = 2 ** 31 - 1;

const isInt = (x: number | undefined, lo: number, hi: number): x is number =>
  x !== undefined && Number.isInteger(x) && x >= lo && x <= hi;

function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  let x = b % m;
  let k = e;
  while (k > 0n) {
    if ((k & 1n) === 1n) r = (r * x) % m;
    x = (x * x) % m;
    k >>= 1n;
  }
  return r;
}

/** Deterministic Miller–Rabin, exact below 3 215 031 751. */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (const p of [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]) {
    if (n === p) return true;
    if (n % p === 0) return false;
  }
  if (n < 1369) return true;
  const N = BigInt(n);
  let d = N - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  for (const a of [2n, 3n, 5n, 7n]) {
    let x = modPow(a, d, N);
    if (x === 1n || x === N - 1n) continue;
    let composite = true;
    for (let r = 1; r < s; r++) {
      x = (x * x) % N;
      if (x === N - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

function fibMod(i: number, m: number): number {
  let a = 0;
  let b = 1 % m;
  for (const bit of i.toString(2)) {
    const c = (a * ((2 * b - a + m) % m)) % m;
    const d = (a * a + b * b) % m;
    if (bit === '1') {
      a = d;
      b = (c + d) % m;
    } else {
      a = c;
      b = d;
    }
  }
  return a;
}

function champernowne(i: number, b: number): number {
  let idx = i;
  if (idx < b) return idx;
  idx -= b;
  let k = 2;
  let start = b;
  for (;;) {
    const total = start * (b - 1) * k;
    if (idx < total) {
      const num = start + Math.floor(idx / k);
      const pos = idx % k;
      return Math.floor(num / b ** (k - 1 - pos)) % b;
    }
    idx -= total;
    start *= b;
    k++;
  }
}

/** The value of a named sequence at index `i` (0 ≤ i ≤ 2³¹ − 1), or undefined. */
export function intAt(name: string, i: number, a?: number, b?: number): number | undefined {
  if (!isInt(i, 0, MAX_INT_INDEX)) return undefined;
  switch (name) {
    case 'ruler': {
      let x = i + 1;
      let n = 0;
      while (x % 2 === 0) {
        x /= 2;
        n++;
      }
      return n;
    }
    case 'thuemorse': {
      let v = i >>> 0;
      let n = 0;
      while (v !== 0) {
        v &= v - 1;
        n++;
      }
      return n & 1;
    }
    case 'norgard': {
      if (i === 0) return 0;
      let v = 0;
      for (const bit of i.toString(2)) v = bit === '1' ? v + 1 : 0 - v;
      return v;
    }
    case 'fib': {
      const m = a ?? 12;
      return isInt(m, 1, 1_000_000) ? fibMod(i, m) : undefined;
    }
    case 'sturm': {
      const p = a ?? 1;
      const q = b ?? 2;
      if (!isInt(q, 1, 1_048_576) || !isInt(p, 0, q)) return undefined;
      return Math.floor(((i + 1) * p) / q) - Math.floor((i * p) / q);
    }
    case 'vdc': {
      const base = a ?? 2;
      if (!isInt(base, 2, 36)) return undefined;
      let x = 0;
      let f = 1 / base;
      let n = i;
      while (n > 0) {
        x += (n % base) * f;
        n = Math.floor(n / base);
        f /= base;
      }
      return x;
    }
    case 'prime':
      return isPrime(i) ? 1 : 0;
    case 'collatz': {
      let n = i + 1;
      let steps = 0;
      while (n !== 1 && steps < 1024) {
        n = n % 2 === 0 ? n / 2 : 3 * n + 1;
        if (n > 2 ** 52) return 1024;
        steps++;
      }
      return steps;
    }
    case 'digits': {
      const base = a ?? 10;
      return isInt(base, 2, 36) ? champernowne(i, base) : undefined;
    }
    default:
      return undefined;
  }
}

// ---- permutations and change ringing

function factorial(n: number): number {
  if (n > 18) return Infinity;
  let f = 1;
  for (let k = 2; k <= n; k++) f *= k;
  return f;
}

/** The `k`-th permutation of 0 … n−1 in lexicographic order (factorial number system). */
export function permutation(n: number, k: number): number[] {
  const items = Array.from({ length: n }, (_, j) => j);
  let rest = Math.max(0, Math.floor(k));
  const all = factorial(n);
  if (Number.isFinite(all)) rest %= all;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = factorial(n - 1 - i);
    const d = Number.isFinite(f) ? Math.floor(rest / f) : 0;
    if (Number.isFinite(f)) rest %= f;
    out.push(items.splice(Math.min(d, items.length - 1), 1)[0] ?? 0);
  }
  return out;
}

export const RING_METHODS: readonly string[] = ['plainhunt'];

/** Row `row` of a ringing method on `bells` bells, as bell numbers from 1. Plain hunt repeats every 2n rows. */
export function ringRow(method: string, bells: number, row: number): number[] | null {
  if (method !== 'plainhunt' || !isInt(bells, 3, 16)) return null;
  const period = 2 * bells;
  const r = ((Math.floor(row) % period) + period) % period;
  const out = Array.from({ length: bells }, (_, j) => j + 1);
  for (let c = 0; c < r; c++) {
    for (let j = c % 2; j + 1 < bells; j += 2) {
      const t = out[j] ?? 0;
      out[j] = out[j + 1] ?? 0;
      out[j + 1] = t;
    }
  }
  return out;
}

// ---- twelve-tone rows

export function isTwelveToneRow(pcs: readonly number[]): boolean {
  return pcs.length === 12 && pcs.every((x) => isInt(x, 0, 11)) && new Set(pcs).size === 12;
}

const ROW_FORM = /^(RI|P|I|R)(\d{1,2})$/;

/** `P0`, `I5`, `R3` or `RI7`. */
export function parseRowForm(
  text: string,
): { readonly retro: boolean; readonly invert: boolean; readonly t: number } | null {
  const m = ROW_FORM.exec(text);
  if (!m) return null;
  const t = Number(m[2]);
  if (t > 11) return null;
  const kind = m[1] ?? 'P';
  return { retro: kind.startsWith('R'), invert: kind.includes('I'), t };
}

// ---- rewriting systems

export const MAX_LSYS_GENERATIONS = 16;
export const MAX_LSYS_LENGTH = 2 ** 20;
const ATOM = /^[A-Za-z0-9#._^'-]+$/;

function atomError(w: Word): { readonly error: GrammarError } {
  return fail(`\`${w.text}\` is not a symbol: use letters, digits and . _ # - ^ '.`, w.start, w.end);
}

export function parseLsysAxiom(text: string): GrammarResult<{ readonly atoms: readonly string[] }> {
  const ws = words(text, 0);
  if (ws.length === 0) return fail('The axiom needs at least one symbol.', 0, text.length);
  for (const w of ws) if (!ATOM.test(w.text)) return atomError(w);
  return { atoms: ws.map((w) => w.text) };
}

/** `a=a b, b=a`: one symbol on the left, one or more on the right, rules separated by commas. */
export function parseLsysRules(
  text: string,
): GrammarResult<{ readonly rules: ReadonlyMap<string, readonly string[]> }> {
  const rules = new Map<string, readonly string[]>();
  if (text.trim() === '') return { rules };
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text.charAt(i) !== ',') continue;
    const piece = text.slice(start, i);
    const bar = piece.indexOf('|');
    if (bar >= 0) return fail('Choosing between rules with `|` is not supported yet.', start + bar, start + bar + 1);
    const eq = piece.indexOf('=');
    if (eq < 0) return fail('Expected a rule such as `a=a b`.', start, i);
    const lhs = words(piece.slice(0, eq), start);
    const rhs = words(piece.slice(eq + 1), start + eq + 1);
    const name = lhs[0];
    if (!name || lhs.length !== 1) return fail('A rule rewrites exactly one symbol.', start, start + eq);
    if (!ATOM.test(name.text)) return atomError(name);
    if (rhs.length === 0) return fail('A rule needs at least one symbol after `=`.', start + eq, i);
    for (const w of rhs) if (!ATOM.test(w.text)) return atomError(w);
    if (rules.has(name.text)) return fail(`\`${name.text}\` has two rules.`, name.start, name.end);
    rules.set(
      name.text,
      rhs.map((w) => w.text),
    );
    start = i + 1;
  }
  return { rules };
}

export interface LsysPlan {
  readonly axiom: readonly string[];
  readonly rules: ReadonlyMap<string, readonly string[]>;
  /** lens[g] gives the length of each symbol after g generations, capped. */
  readonly lens: readonly ReadonlyMap<string, number>[];
  readonly total: number;
  readonly generations: number;
}

/** Expansion lengths per generation, or null when the result exceeds MAX_LSYS_LENGTH. */
export function lsysPlan(
  axiom: readonly string[],
  rules: ReadonlyMap<string, readonly string[]>,
  generations: number,
): LsysPlan | null {
  const g = Math.max(0, Math.min(MAX_LSYS_GENERATIONS, Math.floor(generations)));
  const symbols = new Set<string>(axiom);
  for (const [k, v] of rules) {
    symbols.add(k);
    for (const x of v) symbols.add(x);
  }
  const cap = MAX_LSYS_LENGTH + 1;
  const lens: Map<string, number>[] = [new Map([...symbols].map((s) => [s, 1] as const))];
  for (let k = 1; k <= g; k++) {
    const prev = lens[k - 1] ?? new Map<string, number>();
    const next = new Map<string, number>();
    for (const s of symbols) {
      const rhs = rules.get(s);
      if (!rhs) {
        next.set(s, 1);
        continue;
      }
      let sum = 0;
      for (const x of rhs) {
        sum += prev.get(x) ?? 1;
        if (sum >= cap) {
          sum = cap;
          break;
        }
      }
      next.set(s, sum);
    }
    lens.push(next);
  }
  const top = lens[g] ?? new Map<string, number>();
  let total = 0;
  for (const s of axiom) total = Math.min(cap, total + (top.get(s) ?? 1));
  if (total > MAX_LSYS_LENGTH) return null;
  return { axiom, rules, lens, total, generations: g };
}

/** The symbol at position `j` of the expansion, found by descending the derivation tree. */
export function lsysAt(plan: LsysPlan, j: number): string {
  let g = plan.generations;
  let seq = plan.axiom;
  let rest = j;
  for (;;) {
    const lens = plan.lens[g];
    let found: string | undefined;
    for (const s of seq) {
      const l = lens?.get(s) ?? 1;
      if (rest < l) {
        found = s;
        break;
      }
      rest -= l;
    }
    if (found === undefined) return seq[seq.length - 1] ?? '';
    if (g === 0) return found;
    const rhs = plan.rules.get(found);
    if (!rhs) return found;
    seq = rhs;
    g--;
  }
}
