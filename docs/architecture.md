# Architecture

This page describes the system as implemented. The design rationale is in `idea.md` §§5–11.

## Pipeline

```
source text
   │  @tartlet/syntax   lex + parse → SyntaxTree (UTF-16 ranges, comments kept)
   │  @tartlet/mini     mini-notation strings → MiniAst (string-relative ranges)
   ▼
@tartlet/check          lowering, name resolution, closed-language rules, limits,
   │                    capability and resource checks → Program (IR) + Diagnostic[]
   ▼
@tartlet/core           compile(Program) → CompiledProgram (one Pattern per output)
   │                    query(span) → Event<ControlMap>[] per output, with budgets
   ▼
@tartlet/schedule       lookahead scheduler: cycles → AudioContext seconds
   ▼
@tartlet/webaudio       synthesis, general kit, non-bypassable safety chain
```

`@tartlet/worker` runs check, compile and query inside a dedicated worker. `@tartlet/element`
wires the worker, scheduler and engine together as `<tartlet-player>`.

## Layer contracts

These rules are enforced by lint, tsconfig or tests, not just by convention:

- **The parser knows nothing about time.** `mini` and `syntax` deal only in source offsets.
- **The core path is pure.** `time`, `mini`, `syntax`, `ir`, `registry`, `check`, `random`,
  `core` and `resources` are type-checked without the DOM lib (`tsconfig.core.json`). Lint bans
  `window`, `document`, `fetch`, timers, `Math.random`, `Date.now`, `performance.now` and
  `new Date()` in these packages.
- **Musical time is never `number`.** A lint rule rejects `number`-typed properties named
  `begin`, `end`, `cycle`, `whole` or `part` in packages that carry time.
- **No prototype is reachable from data.** Dictionaries are `Map` or `Object.create(null)`. Lint
  bans empty `{}` literals in the core path. The registry is backed by a `Map`, so
  `lookup('__proto__')` is `undefined`. IR ingestion rejects `__proto__`, `constructor` and
  `prototype` keys.
- **Nothing is evaluated.** `no-eval`, `no-implied-eval` and `no-new-func` apply, and the
  `Function` and `eval` globals are banned. Dynamic `import()` needs a literal specifier, and
  string timers are rejected.
- **The dependency graph is fixed.** Each package may import only the packages allowed by its
  `deps(...)` entry in `eslint.config.js`.

## Dependency graph

These edges are the ones enforced by `eslint.config.js`:

```
time      ← (none)
mini      ← time
syntax    ← mini
ir        ← time, mini            (TS-13: MiniNode embeds MiniAst)
registry  ← ir
random    ← time
check     ← syntax, mini, ir, registry, random, time
core      ← time, mini, ir, registry, random
resources ← ir                    (currently imports nothing)
schedule  ← core, time
webaudio  ← schedule, time, ir, resources, registry   (TS-45: the singing-alphabet parser)
worker    ← check, core, ir, time
element, cli, conformance, apps   ← anything they need
```

`check` defines its own structural `SoundCatalog` interface, so it never imports `resources`.
The CLI passes a `@tartlet/resources` catalog in.

## Time

`@tartlet/time` implements exact rationals with a small-integer fast path (ADR-002):

- A `Rational` is `{ n, d }`. Both fields are either numbers with absolute value ≤ 2³¹−1, or
  bigints. The value is always normalised: `d > 0` and `gcd(|n|, d) = 1`.
- Arithmetic stays in doubles while every intermediate is a safe integer. Otherwise it falls
  back to bigint and demotes the result when it fits again.
- A differential property test compares every operation against a naive bigint reference.
- `parseDecimal('0.25')` parses a decimal literal exactly to 1/4. `fromFloat` produces a
  bounded-denominator approximation and is used only at float boundaries.
- The serialised form is `[n, d]`, with decimal strings beyond the safe-integer range
  (`toJson` and `fromJson`).

A `TimeSpan` is half-open: `[begin, end)`. `spanCycles` splits a span at cycle boundaries, and
`sect` intersects two spans.

## Patterns and events

A pattern is a pure query:

```ts
interface Pattern<T> {
  query(state: QueryState): Event<T>[];
}
interface QueryState {
  span: TimeSpan;
  seed: string;
  controls: ReadonlyMap<string, unknown>;
  provenance: boolean;
  budget: QueryBudget;
}
interface Event<T> {
  whole: TimeSpan | null;
  part: TimeSpan;
  value: T;
  provenance: readonly Provenance[];
}
```

- `whole` is the full logical note. `part` is the fragment inside the queried span. An event is
  an **onset** when `part.begin == whole.begin`. Continuous signals have `whole: null`.
- **Laws.** The tests enforce these:
  - purity;
  - span splitting: querying `[a, c)` equals the merged results of querying `[a, t)` and
    `[t, c)`;
  - containment;
  - fragment consistency, which is relaxed for patterned controls (TS-12).
- Every combinator calls `tick(st)`, which decrements `budget.steps`. Running out throws
  `BudgetExceeded`, and the compiled program turns that into an `E-LIMIT-DENSITY` mute for
  that output only.
- Provenance arrays are allocated only when `provenance: true`.

The algebra (`packages/core/src/pattern.ts`) contains:

- constructors: `pure` and `silence`;
- `signal`: one whole-less event per query (TS-33);
- `fmap` and `stack`;
- `compress`, `timecat` and `fastcat`;
- `slowcat`, where nested alternation advances (TS-14);
- `chooseCycle`;
- time transforms: `fast`, `slow`, `late`, `early` and `rev`;
- `every`, `ply`, `degradeBy` and `withSeed`;
- `bindWindow`, which implements patterned transform arguments (§8.6);
- `appLeft` and `appRight`, which implement structure from the receiver and from the argument.

## Structure rules

How two patterns combine (`idea.md` §8.6):

- **Constant control or arithmetic arguments** use `fmap`, so events are never split (TS-34).
- **Patterned control arguments** and `add` / `transpose` use `appLeft`. The receiver keeps its
  wholes, and each part is the intersection of the receiver's part with the argument's part.
- **`mask`** is `appLeft` with a truthiness filter. **`struct`** and the **`euclid` method** are
  `appRight`, so the argument's wholes survive (TS-32).
- **Patterned numeric transform arguments** (`.fast("<1 2>")`, mini `*<2 3>`) use `bindWindow`.
  The argument is queried first, and the transform is applied inside each argument event's
  part.

These are provisional until oracle specifications land (TS-37).

## The IR

`@tartlet/ir` defines `Program`, `PatternNode` (mini, pure, silence, ref, combine, transform,
control, signal and error), `Arg`, `FunctionValue`, `Diagnostic`, `Fix` and `LimitsConfig`. Key
points:

- The IR is derived from source and is lossy. Aliases are resolved, but the typed alias is kept
  on control nodes as `alias`. Constants are folded. Source text stays the canonical artifact.
- Lambda parameters are encoded as `RefNode` with `binding: "param:<name>"` (TS-22).
- `encodeProgram` and `decodeProgram` implement the `tartlet/1` JSON form. Decoding treats its
  input as untrusted. It validates shapes and enums, rejects forbidden keys, caps nesting at 256
  and enforces the denominator ceiling of 10⁹. It also rejects dangling and cyclic binding
  references.

## Node ids and seeds

- **Node ids** are structural 64-bit hashes (`hash64` in `@tartlet/random`). Each id is
  computed bottom-up along a chain:
  - an output's anchor is its label, or `$<slot>`;
  - a constructor's id is `hash(anchor, entryId)`;
  - a method's id is `hash(receiverId, entryId)`;
  - argument `i` is anchored at `hash(receiverId, entryId, i)`.

  Appending `.gain(.8)` to a chain therefore never changes any earlier id.

- **The root seed** is `rootSeed(documentId, blobIndex, seed ?? "default")`.
- **Draws** are counter-based. `draw(...parts)` hashes its inputs into a number in [0, 1), so
  there is no hidden state. Seeded nodes salt their draws with their own node id, and a draw is
  keyed by (scope, node id, cycle, `whole.begin`, …). The scope is the root seed, or
  `hash(root, "seed", x)` below `.seed(x)` (TS-18, TS-28).
- `?` and `|` in mini-notation also salt their draws with their string offset, so two of them
  in one string draw independently (TS-17, TS-30).

## Checking and recovery

`check(source, opts)` always returns a `Program`, even if every output in it is muted:

1. If the source exceeds `maxSourceBytes`, the check stops with `E-LIMIT-SOURCE`.
2. Parse. Errors are recovered at statement boundaries, and a whole broken `for (…) { … }`
   block is skipped as one unit.
3. Lower each statement:
   - bindings (`const` / `let`);
   - directives (`setcps`, `setcpm`, `samples`);
   - outputs (`$:`, `name:`, or bare expressions; TS-16).

   Unknown names are checked against the registry, with a suggestion when one name is within
   edit distance 2. An unknown method whose closest suggestion is a control is treated as
   cosmetic: the method is dropped with a warning and the track still plays. Any other unknown
   function mutes its subtree.

4. Optionally check resources against a `SoundCatalog`.
5. If nothing can play and errors exist, add `E-PROGRAM-EMPTY`.

An output is `muted-error` when any error with a non-`none` effect was raised while lowering
it. Muted outputs are not compiled. See [diagnostics.md](diagnostics.md).

## Scheduling and audio

- `Scheduler` ticks every 25 ms and queries `[cursor, horizon)`. The horizon is 100 ms of
  lookahead, converted to cycles and approximated with a denominator of at most 1000. The
  scheduler keeps only onsets. Each onset is converted once with
  `t = t0 + (cycle − cycle0) / cps`. Changing tempo re-anchors `(t0, cycle0)` at the cursor.
  Queries may be asynchronous, as they are for the worker. A generation counter discards
  results that arrive after a stop.
- `AudioEngine.create()` must be called from a user gesture. It builds this chain:
  - bus gain 0.7;
  - a `DynamicsCompressor`;
  - an `AudioWorklet` safety processor: DC blocker, NaN guard and a brickwall limiter with a
    0.98 ceiling.

  Every voice connects to the bus. Parameters are clamped at the adapter (gain, pan, filter
  frequency and Q, envelope times). Each voice runs through a per-voice effects chain
  (low-pass with envelope, high-pass, shape, crush, vowel, tremolo), then the panner. Reverb
  and delay are shared buses per `orbit` that also feed the master bus (TS-41). Polyphony is
  budgeted at 64 cost units, one per running source, with the oldest voices stolen (TS-42).
  The general kit is synthesized: `bd sd hh oh cp rim lt mt ht cr rd`, plus `sine`,
  `square`, `triangle`, `sawtooth` and the noises `white`, `pink` and `brown`. Pure DSP
  helpers (envelopes, waves, curves, noise) live in `dsp.ts` and are unit-tested in Node.
