/**
 * Exact rational numbers with a small-integer fast path (idea.md §8.1, ADR-002).
 * Invariant: n and d are both numbers (|n|, d ≤ 2³¹−1) or both bigints, with d > 0 and
 * gcd(|n|, d) = 1.
 */
export interface Rational {
  readonly n: number | bigint;
  readonly d: number | bigint;
}
interface Small {
  readonly n: number;
  readonly d: number;
}

const SMALL = 0x7fffffff;
const SMALL_B = 0x7fffffffn;
const SAFE = Number.MAX_SAFE_INTEGER;

export const ZERO: Rational = { n: 0, d: 1 };
export const ONE: Rational = { n: 1, d: 1 };

function isSmall(r: Rational): r is Small {
  return typeof r.n === 'number';
}
function safe(x: number): boolean {
  return x <= SAFE && x >= -SAFE;
}
function gcdN(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function gcdB(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function normN(n: number, d: number): Rational {
  if (d === 0) throw new RangeError('Rational: zero denominator');
  if (n === 0) return ZERO;
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcdN(n, d);
  if (g !== 1) {
    n /= g;
    d /= g;
  }
  if (d <= SMALL && n <= SMALL && n >= -SMALL) return { n, d };
  return { n: BigInt(n), d: BigInt(d) };
}
function normB(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new RangeError('Rational: zero denominator');
  if (n === 0n) return ZERO;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcdB(n, d);
  if (g !== 1n) {
    n /= g;
    d /= g;
  }
  if (d <= SMALL_B && n <= SMALL_B && n >= -SMALL_B) return { n: Number(n), d: Number(d) };
  return { n, d };
}
function big(r: Rational): readonly [bigint, bigint] {
  return [BigInt(r.n), BigInt(r.d)];
}

export function rat(n: number | bigint, d: number | bigint = 1): Rational {
  if (typeof n === 'number' && typeof d === 'number') {
    if (!Number.isInteger(n) || !Number.isInteger(d)) throw new RangeError('rat: integer components required');
    if (safe(n) && safe(d)) return normN(n, d);
  }
  return normB(BigInt(n), BigInt(d));
}

export function isRational(x: unknown): x is Rational {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as { n?: unknown; d?: unknown };
  return (typeof r.n === 'number' && typeof r.d === 'number') || (typeof r.n === 'bigint' && typeof r.d === 'bigint');
}

export function add(a: Rational, b: Rational): Rational {
  if (isSmall(a) && isSmall(b)) {
    if (a.d === b.d) {
      const s = a.n + b.n;
      if (safe(s)) return normN(s, a.d);
    } else {
      const x = a.n * b.d;
      const y = b.n * a.d;
      const z = a.d * b.d;
      if (safe(x) && safe(y) && safe(z) && safe(x + y)) return normN(x + y, z);
    }
  }
  const [an, ad] = big(a);
  const [bn, bd] = big(b);
  return normB(an * bd + bn * ad, ad * bd);
}

export function neg(a: Rational): Rational {
  if (isSmall(a)) return a.n === 0 ? ZERO : { n: -a.n, d: a.d };
  return { n: -(a.n as bigint), d: a.d };
}

export function sub(a: Rational, b: Rational): Rational {
  return add(a, neg(b));
}

export function mul(a: Rational, b: Rational): Rational {
  if (isSmall(a) && isSmall(b)) {
    const x = a.n * b.n;
    const z = a.d * b.d;
    if (safe(x) && safe(z)) return normN(x, z);
  }
  const [an, ad] = big(a);
  const [bn, bd] = big(b);
  return normB(an * bn, ad * bd);
}

export function div(a: Rational, b: Rational): Rational {
  if (isZero(b)) throw new RangeError('Rational: division by zero');
  if (isSmall(a) && isSmall(b)) {
    const x = a.n * b.d;
    const z = a.d * b.n;
    if (safe(x) && safe(z)) return normN(x, z);
  }
  const [an, ad] = big(a);
  const [bn, bd] = big(b);
  return normB(an * bd, ad * bn);
}

export function cmp(a: Rational, b: Rational): -1 | 0 | 1 {
  if (isSmall(a) && isSmall(b)) {
    const x = a.n * b.d;
    const y = b.n * a.d;
    if (safe(x) && safe(y)) return x < y ? -1 : x > y ? 1 : 0;
  }
  const [an, ad] = big(a);
  const [bn, bd] = big(b);
  const x = an * bd;
  const y = bn * ad;
  return x < y ? -1 : x > y ? 1 : 0;
}

export const eq = (a: Rational, b: Rational): boolean => cmp(a, b) === 0;
export const lt = (a: Rational, b: Rational): boolean => cmp(a, b) < 0;
export const lte = (a: Rational, b: Rational): boolean => cmp(a, b) <= 0;
export const gt = (a: Rational, b: Rational): boolean => cmp(a, b) > 0;
export const gte = (a: Rational, b: Rational): boolean => cmp(a, b) >= 0;
export const min = (a: Rational, b: Rational): Rational => (lte(a, b) ? a : b);
export const max = (a: Rational, b: Rational): Rational => (gte(a, b) ? a : b);

export function isZero(a: Rational): boolean {
  return isSmall(a) ? a.n === 0 : a.n === 0n;
}

/** The largest integer ≤ a. */
export function floor(a: Rational): Rational {
  if (isSmall(a)) {
    const m = a.n % a.d;
    let q = (a.n - m) / a.d;
    if (m < 0) q -= 1;
    return normN(q, 1);
  }
  const [n, d] = big(a);
  let q = n / d;
  if (n % d !== 0n && n < 0n) q -= 1n;
  return normB(q, 1n);
}

export function ceil(a: Rational): Rational {
  return neg(floor(neg(a)));
}

export function toNumber(a: Rational): number {
  return Number(a.n) / Number(a.d);
}

export function toString(a: Rational): string {
  return isSmall(a)
    ? a.d === 1
      ? String(a.n)
      : `${String(a.n)}/${String(a.d)}`
    : `${a.n.toString()}/${a.d.toString()}`;
}

/**
 * Best rational approximation with a denominator ≤ maxDen, by continued fractions.
 * Used only at float boundaries such as seek and scheduler windows.
 */
export function fromFloat(x: number, maxDen = 1_000_000): Rational {
  if (!Number.isFinite(x)) throw new RangeError('fromFloat: non-finite');
  if (Number.isInteger(x) && safe(x)) return normN(x, 1);
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  let v = x;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen || !safe(h2)) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    const frac = v - a;
    if (frac < 1e-12) break;
    v = 1 / frac;
  }
  return k1 === 0 ? normN(Math.round(x), 1) : normN(h1, k1);
}

// Kept free of nested quantifiers (security/detect-unsafe-regex); the literal is split by hand.
const DIGITS = /^\d*$/;
const EXPONENT = /^[+-]?\d+$/;

/** Parses a decimal literal exactly: "0.25" gives 1/4. Returns null if the text is not a number. */
export function parseDecimal(text: string): Rational | null {
  let body = text;
  let negative = false;
  if (body.startsWith('+') || body.startsWith('-')) {
    negative = body.startsWith('-');
    body = body.slice(1);
  }
  let expText = '0';
  const e = body.search(/[eE]/);
  if (e >= 0) {
    expText = body.slice(e + 1);
    body = body.slice(0, e);
    if (!EXPONENT.test(expText)) return null;
  }
  const dot = body.indexOf('.');
  const intPart = dot >= 0 ? body.slice(0, dot) : body;
  const fracPart = dot >= 0 ? body.slice(dot + 1) : '';
  // DIGITS rejects any second '.', so "1.2.3" fails here.
  if (!DIGITS.test(intPart) || !DIGITS.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;
  const exp = Number(expText) - fracPart.length;
  if (Math.abs(exp) > 40) return null;
  let n = BigInt(intPart + fracPart || '0');
  if (negative) n = -n;
  return exp >= 0 ? normB(n * 10n ** BigInt(exp), 1n) : normB(n, 10n ** BigInt(-exp));
}
