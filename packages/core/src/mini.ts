import { type Rational, ONE, ZERO, div, isZero, parseDecimal, toNumber } from "@tartlet/time";
import { MAX_STEP_MULTIPLIER, type MiniAst, type MiniAtom, type MiniOp } from "@tartlet/mini";
import { bindWindow, degradeBy, fast, fastcat, pure, silence, slowcat, stack, timecat, type Pattern } from "./pattern";

const numberLeaf = (a: MiniAtom): Pattern<Rational> => {
  const v = parseDecimal(a.text);
  return v ? pure(v) : silence();
};

const intOf = (r: Rational): number => Math.floor(toNumber(r));

/** Distributes k onsets as evenly as possible over n steps, by repeated pairwise grouping. */
export function bjorklund(k: number, n: number): boolean[] {
  if (n <= 0) return [];
  if (k <= 0) return Array.from({ length: n }, () => false);
  if (k >= n) return Array.from({ length: n }, () => true);
  let a: boolean[][] = Array.from({ length: k }, () => [true]);
  let b: boolean[][] = Array.from({ length: n - k }, () => [false]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const joined: boolean[][] = [];
    for (let i = 0; i < m; i++) joined.push([...(a[i] ?? []), ...(b[i] ?? [])]);
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = joined;
    b = rest;
  }
  return [...a.flat(), ...b.flat()];
}

/** Plays `p` on the onset steps of a Euclidean rhythm, rotated left by `rot` (TS-19). */
export function euclid<V>(p: Pattern<V>, k: number, n: number, rot: number): Pattern<V> {
  if (n <= 0 || n > MAX_STEP_MULTIPLIER) return silence();
  const bits = bjorklund(k, n);
  const r = ((rot % n) + n) % n;
  const rotated = bits.slice(r).concat(bits.slice(0, r));
  return fastcat(rotated.map((on) => (on ? p : silence<V>())));
}

function applyOp<V>(p: Pattern<V>, op: MiniOp): Pattern<V> {
  switch (op.op) {
    case "fast":
    case "slow": {
      const factor = compileMini(op.by, numberLeaf);
      return bindWindow(factor, (r) => (isZero(r) ? silence<V>() : fast(op.op === "fast" ? r : div(ONE, r), p)));
    }
    case "degrade":
      return degradeBy(op.amount ?? 0.5, p, `?${String(op.at ?? 0)}`);
    case "euclid": {
      const kP = compileMini(op.k, numberLeaf);
      const nP = compileMini(op.n, numberLeaf);
      const rP = op.rot ? compileMini(op.rot, numberLeaf) : pure(ZERO);
      return bindWindow(kP, (k) => bindWindow(nP, (n) => bindWindow(rP, (r) => euclid(p, intOf(k), intOf(n), intOf(r)))));
    }
  }
}

/** Compiles a mini-notation AST, interpreting atoms with `leaf`. */
export function compileMini<V>(ast: MiniAst, leaf: (atom: MiniAtom) => Pattern<V>): Pattern<V> {
  switch (ast.t) {
    case "atom":
      return leaf(ast);
    case "rest":
      return silence();
    case "stack":
      return stack(ast.layers.map((l) => compileMini(l, leaf)));
    case "alt":
      return slowcat(ast.items.map((i) => compileMini(i, leaf)));
    case "seq": {
      const parts: (readonly [Pattern<V>, Rational])[] = [];
      for (const step of ast.steps) {
        const p = step.ops.reduce((acc, op) => applyOp(acc, op), compileMini(step.body, leaf));
        for (let r = 0; r < step.replicate; r++) parts.push([p, step.weight]);
      }
      if (parts.length === 1 && parts[0]) return parts[0][0];
      return timecat(parts);
    }
    default:
      return silence();
  }
}