import { type Rational, rat } from './rational';

/** The tartlet/1 serialised form [n, d]. Decimal strings are used beyond the safe-integer range (idea.md §8.1). */
export type RationalJson = [number | string, number | string];

const SAFE_B = BigInt(Number.MAX_SAFE_INTEGER);

function enc(x: number | bigint): number | string {
  if (typeof x === 'number') return x;
  return x <= SAFE_B && x >= -SAFE_B ? Number(x) : x.toString();
}

export function toJson(r: Rational): RationalJson {
  return [enc(r.n), enc(r.d)];
}

function dec(x: unknown): bigint {
  if (typeof x === 'number' && Number.isSafeInteger(x)) return BigInt(x);
  if (typeof x === 'string' && /^-?\d{1,400}$/.test(x)) return BigInt(x);
  throw new TypeError('RationalJson: invalid component');
}

/** Strict decoder for untrusted input. The denominator must be positive. */
export function fromJson(j: unknown): Rational {
  if (!Array.isArray(j) || j.length !== 2) throw new TypeError('RationalJson: expected [n, d]');
  const d = dec(j[1]);
  if (d <= 0n) throw new RangeError('RationalJson: denominator must be positive');
  return rat(dec(j[0]), d);
}
