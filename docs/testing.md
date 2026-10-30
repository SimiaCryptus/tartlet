# Testing

Tests live in `packages/*/test/**/*.test.ts`. Vitest runs them in a Node environment. Coverage
is measured over `packages/*/src`.

```sh
pnpm test                                   # everything
pnpm vitest run packages/core               # one package
pnpm vitest run -t "M-19"                   # tests whose name matches
pnpm coverage
```

## Test kinds

Test kinds follow the matrix in `idea.md` §12.1. Name each test after its matrix row, for
example `it('M-19 euclid', …)`, so that rows can be found with `grep`.

- **P (parse):** `packages/syntax/test`, `packages/mini/test`.
- **E (events):** golden expectations. These are in `packages/core/test/mini-*.test.ts` (L1),
  `packages/conformance/test/expr*.test.ts` (L2) and the JSON fixtures.
- **L (laws):** `packages/core/test/laws.test.ts`. A fast-check property generates spans and
  checks span splitting and containment for each source in `SOURCES`. Add new mini-notation
- **D (determinism):** the D rows in `expr-t1.test.ts` and `expr-t2.test.ts`. They check that
  constructs to that list, and transforms built directly from the algebra to `BUILT`.
  results are stable for a fixed seed and differ across seeds. They also check that appending a
  method or editing another output leaves draws unchanged.
- **X (diagnostics)** and **R (rejection):** `packages/check/test/reject.test.ts`.
- **S (sanity):** `packages/cli/test/corpus.test.ts`.
- **Codec and ingestion (Z-10):** `packages/ir/test/codec.test.ts`.
- **Rational differential:** `packages/time/test/rational.test.ts`.
- **E2E:** `e2e/playground.spec.ts`, run with Playwright via `pnpm e2e`.

## Rules for expectations

Golden expectations are **written by hand** from `idea.md`, from oracle specifications or from
musical reasoning. Never generate them by running Tartlet or any reference implementation and
copying the output. Where behaviour is ambiguous:

1. Pick an interpretation and record it in `spec-issues.md` as a new `TS-n`.
2. Cite `TS-n` in the test name or a comment, and at the code site.
3. Mark the row provisional if an oracle specification is still pending (see TS-37).

## Helpers

- `runSource(source, span, seed?)` in `packages/conformance/src/run.ts` checks, compiles and
  queries a source with document id `conformance` and blob index `0`.
- Most test files define small helpers along these lines:
  - `cyc(c)` returns the span of cycle `c`;
  - `isOnset(e)` keeps events whose part starts with their whole;
  - `onsets`, `begins` and `notes` sort and project events.

  Compare rationals through `toJson` or `eq`, never through floats.

- For a pattern built directly, query it with a large budget:

```ts
p.query({
  span: { begin: rat(0), end: rat(1) },
  seed: 't',
  controls: new Map(),
  provenance: false,
  budget: { steps: 1e7, events: 1e7 },
});
```

## JSON fixtures

`packages/conformance/fixtures/*.json` are picked up automatically by `fixtures.test.ts`. They
follow `fixture.schema.json`. That schema is documentation: the test runner does not validate
fixtures against it at runtime. Required fields:

```json
{
  "id": "X-05",
  "kinds": ["E"],
  "phase": 1,
  "source": "s(\"hh*2\").gain(\"<.5 1>\")",
  "span": [
    [1, 1],
    [2, 1]
  ],
  "expected": [
    {
      "whole": [
        [1, 1],
        [3, 2]
      ],
      "part": [
        [1, 1],
        [3, 2]
      ],
      "value": { "s": "hh", "gain": 1 }
    }
  ],
  "interpretation": "Why these events are right.",
  "expectationSource": "documented"
}
```

- Spans and rationals use the `[n, d]` encoding.
- Comparison is order-independent, and object keys inside values are sorted. Every event the
  runner returns must be listed, including non-onset fragments.
- `note` values appear as `{ "kind": "midi", "value": 48 }`.
- `expectationSource` is one of `documented`, `oracle-spec` or `musical-reasoning`. Add
  `"oracle": "oracle/<topic>.md"` when an oracle specification informed the expectation.
- Prettier ignores `**/fixtures/**`, so format fixtures by hand.

## Property tests

Use `fast-check`. Keep spans short: the laws are local, and long spans over dense patterns make
runs very slow. Give long property tests an explicit timeout, as `laws.test.ts` does with
`30_000`. `plan.md` targets 10⁴ spans per construct for the T1 exit. Raise `numRuns` locally
when you are changing the algebra.

## The corpus harness

`classify(source)` in `@tartlet/cli` checks and compiles a source, runs `sanity`, and assigns
it to a bucket:

- **rejected:** no playable output;
- **partial:** errors, muted outputs, or a failed sanity check;
- **degraded:** warnings only;
- **clean:** none of the above.

A program that passes the check but plays nothing counts as **partial** (Q-09). `summarise`
ranks misses by frequency, and that ranking is the L3 backlog.

## End-to-end tests

```sh
pnpm exec playwright install --with-deps
pnpm build
pnpm e2e
```

The preview server sends the production CSP, so the e2e test also catches CSP violations.