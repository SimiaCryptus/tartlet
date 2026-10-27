# Spec issues

Ambiguities found during implementation. None are resolved silently in code. Each code site
cites its ID.

TS-1 to TS-10 are seeded from plan.md §13 and still open. The T0 status of each:

- **TS-2:** T0 treats a standalone `.` as the T2 group separator and rejects it with
  `E-MINI-UNSUPPORTED`. `.5` lexes as a number.
- **TS-3:** adopted provisionally. `cat` lowers to `slowcat`, `seq` to `fastcat`, and the IR
  gains a `timecat` op.
- **TS-6:** adopted. A duplicate named label gives `E-NAME-DUP`, and `$` outputs stack.
- **TS-7:** adopted. The last tempo directive wins, with `I-TEMPO-OVERRIDE`.
- **TS-8:** adopted. Ranges are blob-relative.
- **TS-9:** adopted. `"! a"` produces `E-MINI-REPLICATE`.

## Found during T0

- **TS-11: scale root octave.** X-03 expects C, Eb, G, but no octave is specified. T0 uses
  octave 3 for a bare root (`C` = 48). Needs an oracle spec before T2.
- **TS-12: fragment consistency vs receiver structure.** §8.6 says a receiver event combines
  with each argument event active within it, splitting the part. So two fragments of one whole
  can carry different values, which contradicts §8.3 law 4. T0 follows §8.6. The law test
  exempts control merges until resolved.
- **TS-13: package graph.** `MiniNode.ast: MiniAst` (§9.2) makes `@tartlet/ir` depend on
  `@tartlet/mini` (type-only). §6.3 lists `ir → time` only. T0 adds the edge.
- **TS-14: nested alternation.** In `<a b>`, child *i* is queried at cycle floor(k/n), so
  `<a <b c>>` gives a, b, a, c. Needs oracle confirmation.
- **TS-15: `MiniNode.textOffset`.** Provenance needs the string-content offset in the
  document. T0 adds `textOffset` (a UTF-16 index) to `MiniNode`. `Offset.col` is in UTF-16
  code units, and `Offset.byte` is UTF-8.
- **TS-16: multiple bare expressions.** §7.3 says "a bare expression, which is the output
  pattern". T0 stacks every bare top-level expression as an unlabelled output.

## Found during T1

- **TS-17: draw salt for `?`.** Two `?` operators in one string must draw independently.
  `MiniOp.degrade` gains an optional `at` (the string offset of the `?`), used as a salt.
  The draw is keyed by (node seed, salt, cycle, whole.begin, 0).
- **TS-18: seed chaining.** §8.4 writes node seed = hash(parent seed, node id). Chaining
  would reseed an inner `?` whenever a seeded transform is wrapped around it, which breaks
  §12.1 D ("edits outside a subtree leave its draws unchanged"). T1 uses
  hash(root seed, node id). Node ids are already structural and unique, so they carry the
  path. `.seed()` (T2) will need a decision here.
- **TS-19: Euclid rotation direction.** §7.2 says "optional rotation" without a direction.
  T1 rotates left: `(3,8,2)` gives onsets at 1/8, 1/2 and 3/4. Needs an oracle spec.
- **TS-20: `every` count.** Only a constant `n` is accepted in T1. Whether it is patternable
  is open.
- **TS-21: statement termination.** A statement must end at a newline, `;` or end of input.
  `s("a") s("b")` on one line is an error, which matches JavaScript.
- **TS-22: lambda parameter references.** §9.2 says a lambda body "contains a RefNode to
  param". T1 encodes this as `binding: "param:<name>"`. Ingestion validation treats the
  `param:` prefix as local.
- **TS-23: object literals.** §7.3 accepts plain objects as literals, but no L2 entry takes
  one yet. T1 emits `E-NOT-YET`.
- **TS-24: new diagnostic ids.** T1 adds the following ids, which are not listed in §7.3:
  - `E-LX-KEYWORD` for `function`, `class`, `new`, `async`, `await`, `var` and similar;
  - `E-LX-PROTO` for `__proto__`, `constructor` and `prototype`;
  - `E-LX-SPREAD`;
  - `E-LX-ASSIGN`;
  - `E-ARG-FUNCTION`;
  - `W-ARG-EXTRA`.
- **TS-25: program rejection.** When no output is playable and errors exist, the checker
  adds `E-PROGRAM-EMPTY` with effect `program-rejected` (§10.2 rule 6).
- **TS-26: Q-09 example.** `s("bd").mask("0")` cannot check cleanly in T1, because `mask`
  is a T2 transform and its name is an edit-distance-2 neighbour of `fast`. The S-row test
  uses `s("~ ~")` until `mask` lands.
- **TS-27: T0 test expectations corrected.** In X-07, `s(cat("a","b"))` plays a then b. In
  X-09, cycle 1 of `.slow("<1 2>")` holds one onset. Both follow from §8.6 window semantics.