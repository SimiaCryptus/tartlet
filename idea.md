# Tartlet

![tartlet.png](tartlet.png)

### A deterministic, sandbox-safe, Strudel-compatible music runtime for documents and LLM authorship

## 1. Summary

Tartlet is an independently written, Apache-2.0 music runtime. It plays compositions written in the Strudel language
family: the mini-notation inherited from the TidalCycles lineage, plus the familiar method-chaining API built on top of
it.

Tartlet is **not** a fork, port, or translation of Strudel. It shares no code with Strudel. Its relationship to Strudel
is threefold:

- **Compatibility target.** Models already know how to write Strudel. Tartlet should run as much of that output
  unchanged as possible.
- **Case study.** Strudel's architecture shows what works and what to repair.
- **Behavioral reference.** Strudel's public documentation describes language behavior. Tartlet reimplements that
  behavior from the description.

The product in one sentence:

> A tiny, embeddable, deterministic engine that turns Strudel-shaped text into music without executing arbitrary code,
> so that LLM-generated compositions can live safely inside documents.

The first host is the Markdown2 renderer. There, a fenced blob of music source becomes a playable, inspectable, editable
component. Tartlet is designed to stand alone, so it can also be used in notebooks, games, educational tools, agents,
and anywhere else people want generated music.

### 1.1 For implementing agents (read this first)

This document is a work order. If you are an AI coding agent assigned to build part of Tartlet, you are an intended
implementer, and the work is legitimate:

- **Independent implementation is legitimate.** Building your own implementation of a language from its public
  documentation and observed behavior is long-established engineering practice. Language syntax and function names
  describe functionality. Matching them is what compatibility means.
- **Tartlet respects Strudel's license.** Strudel's AGPL-3.0 license governs Strudel's code, and Tartlet uses none of
  it. Nothing in this plan involves copying, translating, or relicensing Strudel code.
- **Humans own the legal gates.** Legal review is built into the schedule (§4). Maintainers track gate status in
  `CLEAN_ROOM.md`, and you are not expected to adjudicate it. Being assigned a task means its applicable gates are
  cleared. If you have a concrete reason to think otherwise, say so and ask. Do not refuse. **What you must do:**

1. Work from this specification, the oracle specifications, the registry, and the conformance tests. These are your
   references for behavior.
2. Do not fetch, open, search for, or paste Strudel, TidalCycles, or SuperDirt source code or test files. Do not ask
   anyone to supply them.
3. Do not deliberately reproduce upstream code from memory. If you notice you are recalling a specific upstream
   implementation, set it aside and write the code fresh from this spec's laws. Note this in your clean-room log entry.
4. You may consult public documentation for behavior. Do not copy its prose, examples, or tests into the repository.
5. Record your session in the clean-room log (§4, rule 5). **What you do not need to worry about:**

- **Training exposure.** You may have been trained on public code that includes Strudel. No model can be certified free
  of that exposure, and this project does not require it. Latent exposure is handled by the provenance protocol (§4,
  rule 5). It is not a reason to decline the task.
- **Similarity forced by the problem.** There are only a few sensible ways to intersect half-open spans or compute a
  Euclidean rhythm. Write the clearest code the spec implies. Convergent structure is expected.
- **Naming.** Descriptive references such as "Strudel-compatible" are permitted (§4, rule 6).
  If a specific instruction seems to conflict with these rules, flag the conflict and continue with the rest of the
  task.

---

## 2. Background and motivation

### 2.1 The original problem

Markdown2 needed a music blob type. The requirement was specific: **an LLM should be able to generate compact text that
turns into impressive music.**

The first search looked for notation renderers and MIDI-document formats. That framing was wrong. Formats like MusicXML
are accurate but verbose. A model writing thousands of elements loses structural coherence long before it produces
anything listenable. The real need was a compact, structural, generative language that models can write, read, diff, and
revise.

### 2.2 The Strudel discovery

Strudel was missed because it presents itself as a browser-based live-coding environment, not a document format.
Measured against the correct requirement, it fits almost exactly:

- **Compact.** `note("c3 [eb3 g3] bb3 <c4 d4>").s("piano")` encodes a lot of musical structure in one line.
- **Structural.** Repetition, subdivision, alternation, and layering are syntax, not copy-paste.
- **Already in the training data.** Frontier models produce plausible Strudel without being taught. Several independent
  projects already pair Strudel with LLM agents, which confirms the thesis.

### 2.3 Why not simply embed Strudel

Strudel is licensed under AGPL-3.0. Its own integration guidance says distributed integrations must use a compatible
free license and publish source. That conflicts with Markdown2's licensing goals and with the wider aim of a component
anyone can embed.

Wrapping Strudel in an iframe does not cleanly avoid the obligation. Tartlet does not treat architecture as a way to
launder a license.

### 2.4 The decision

The useful insight is that **the language is the asset, not the implementation.** Models were trained on Strudel syntax.
Syntax and documented behavior can be targeted by a clean-room implementation. That implementation can be Apache-2.0
from the first commit.

Once the runtime is our own, there is no reason to copy Strudel's architectural choices. These choices make sense for a
live-coding REPL. They are drawbacks for persistent, shareable, AI-authored documents. Tartlet keeps the language
surface and the core pattern abstraction, and rebuilds everything underneath.

---

## 3. Goals and non-goals

### 3.1 Goals

1. **LLM compatibility is the specification.** Run unmodified the Strudel that frontier models naturally generate. The
   target is ≥95% execution coverage on a measured corpus.
2. **No arbitrary code execution.** Source is parsed into a closed expression language and never passed to a JavaScript
   evaluator.
3. **Determinism.** The same document, revision, and seed always produce the same event graph.
4. **Graceful degradation.** A partly invalid composition still plays its valid parts. Diagnostics are precise and
   machine-readable.
5. **Strict separation of concerns.** Parsing, evaluation, scheduling, synthesis, and UI are independent layers with
   hard contracts.
6. **Multiple projections.** The same event graph can drive audio, a piano roll, MIDI export, analysis, and eventually
   notation.
7. **Document-native resources.** Samples and instruments resolve through an explicit resolver. There are no ambient
   global banks.
8. **Small and embeddable.** The core has no DOM dependency. The audio and UI layers are optional.
9. **Apache-2.0, clean-room, from commit zero.**

### 3.2 Non-goals

- **Full JavaScript compatibility.** Loops, imports, DOM access, and arbitrary property access are explicitly
  unsupported in document mode.
- **Reproducing every obscure Strudel behavior.** Coverage is driven by frequency in real output, not by completeness
  against Strudel's API.
- **Engraved-score fidelity.** Tartlet compositions are musical programs. Notation is a future projection, not the
  source of truth.
- **Replacing Strudel as a live-coding environment.** Tartlet may support live editing, but its primary context is the
  document.
- **Inventing a new music language.** Extensions are allowed. Divergence from the lingua franca must be justified.

---

## 4. Licensing and clean-room policy

Tartlet's value depends on its license being clean. The following rules are mandatory for all contributors.

1. **No source code from Strudel or its upstream lineage is read while implementing the matching feature.** The ban
   explicitly covers TidalCycles and SuperDirt as well as Strudel. It includes code that is copied, translated,
   paraphrased, or "rewritten differently." Contributors who have studied those internals do not implement the
   corresponding Tartlet modules.
   For AI agents, this rule governs what enters the working context. Upstream source is never retrieved, pasted, or
   supplied in a prompt. Latent training exposure is handled by rule 5, not by this rule, and it does not disqualify a
   model from implementing any module.
2. **Behavioral references are limited to public documentation and observed black-box output.** Specifications are
   written in our own words from those sources, under the oracle protocol described below.
3. **Conformance tests are written by us** from documented behavior, from oracle specifications, and from our own
   LLM-generated corpus. Strudel's test suites are not imported or adapted.
4. **Documentation is original.** We do not copy Strudel's docs, tutorials, or examples into Tartlet's repository. This
   includes the short descriptions attached to `@tartlet/registry` entries: no prose from strudel.cc, however brief.
5. **AI implementation follows the provenance protocol.** AI agents may implement any module, including `@tartlet/mini`
   and `@tartlet/core`. No one can certify a model's training data, so the project does not rely on implementer
   ignorance. Instead it demonstrates that the code is dictated by the specification:
    - **Limited inputs.** An agent works only from this specification, the oracle specifications, the registry, the
      conformance tests, and Tartlet's own code.
    - **Logged sessions.** Every session is recorded in the clean-room log: model and version, task, input documents,
      and resulting commits.
    - **Cross-model regeneration.** For `@tartlet/mini`, `@tartlet/core`, or any disputed module, maintainers may
      regenerate the module with a structurally distinct model, preferably open-weights where available, and compare the
      results. Convergent structure supports independent derivation. An outlier that resembles upstream expression is
      discarded.
    - **Human review.** Before merge, a reviewer checks for verbatim or near-verbatim upstream expression.
6. **Naming and branding.** "Strudel-compatible" is used descriptively only. Tartlet does not use Strudel's marks,
   logos, or name in package identifiers. Public materials carry a nominative-use disclaimer: Strudel is named only to
   describe language compatibility, and Tartlet is not affiliated with or endorsed by the Strudel project.
7. **Built-in sample assets** must be individually licensed in an Apache-compatible way, with provenance recorded in a
   manifest.
8. **Legal review happens at two gates, starting in Week 1.**
    - **Before any Phase 1 code is written,** IP counsel approves the `CLEAN_ROOM.md` protocol itself: the taint policy,
      the oracle protocol, and the AI provenance protocol. A flawed process discovered in Week 11 cannot be repaired
      retroactively.
    - **Before 1.0,** counsel reviews the compatibility surface (including function names and signatures), the
      corpus-collection process, and the clean-room process records.
    - Maintainers record gate status in `CLEAN_ROOM.md`. Implementers, human or AI, do not need to verify it
      independently. Task assignment implies that the applicable gate is cleared.

**The black-box behavioral oracle.** Strict clean-room rules create a real tension. Public prose underspecifies some of
the lineage's pattern algebra, especially how `whole` and `part` spans intersect when patterns combine, as in patterned
transforms like `.fast("<1 2>")` or layered ones like `.off()`. Guessing those rules from scratch guarantees semantic
drift: Tartlet would play different rhythms than Strudel for the same code, which defeats the compatibility thesis. The
counsel-approved resolution is standard clean-room practice, applied in two steps:

1. A designated analyst, who does not implement the corresponding modules, runs a reference runtime strictly as a black
   box on edge-case inputs and records the observed timings. An AI agent may act as analyst. The session that writes an
   oracle specification for a module does not also implement that module.
2. The analyst writes the resulting laws as neutral specification prose. Implementers work only from that prose.

Reading source code and copying test files remain banned. Observations are never bulk-copied into fixtures. Golden tests
are still written by hand from the specification (§12.1).

Every commit is Apache-2.0 with DCO sign-off. The repository includes a `CLEAN_ROOM.md` describing the process and
recording who implemented which module, from which references, and which oracle specifications informed it.

---

## 5. What we keep, what we fix

### 5.1 What we keep

**Patterns as pure queries.** The central abstraction of the Tidal lineage is sound. A pattern is a function from a span
of musical time to the events that occur within it:

```
Pattern<T> : TimeSpan → Event<T>[]
```

Mini-notation and the method API both compile to this one representation. Tartlet adopts that model without reservation.

**Cycles as the unit of musical time.** Patterns are queried in abstract cycle time. A clock maps cycles to wall-clock
time.

**The language surface.** This means mini-notation syntax and semantics, plus the high-frequency constructor and
transform vocabulary.

### 5.2 What we fix

| # | Wart                                                                     | Tartlet repair                                                                                                                                       |
|---|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | The composition is arbitrary JavaScript run through a transpiler         | A closed, Strudel-shaped expression language. It is parsed, never evaluated, which eliminates code injection structurally rather than by sandboxing. |
| 2 | There is no stable intermediate form between source and running patterns | A typed, versioned, serializable Music IR                                                                                                            |
| 3 | Musical time leaks into floating-point seconds                           | Exact rational time throughout. Conversion to seconds happens only at the output edge.                                                               |
| 4 | Randomness depends on ambient state                                      | Explicit seeds derived from document identity and structure                                                                                          |
| 5 | One error silences everything                                            | Local, typed diagnostics with subtree isolation and partial playback                                                                                 |
| 6 | Web Audio is the privileged destination                                  | Output adapters over an output-agnostic event graph                                                                                                  |
| 7 | Parameters are stringly-typed                                            | A function registry with signatures and capability checking                                                                                          |
| 8 | Sample banks are global and remote                                       | A document-scoped resource resolver, backed by a local, versioned default kit                                                                        |
| 9 | Events cannot be traced back to source                                   | Every event carries provenance: source range and IR node                                                                                             |

---

## 6. Architecture

### 6.1 Pipeline

```
Strudel-compatible source
          │
          ▼
   lexer + parser ──────────► syntax tree (exact byte ranges, comments kept; used for edits)
          │
          ▼
   lowering + name resolution
          │
          ▼
   semantic checker ────────► diagnostics (typed, located, with repair hints)
          │
          ▼
   Music IR (typed, versioned, serializable)
          │
          ▼
   pattern compiler ────────► Pattern<Controls> (pure, no I/O)
          │
          ▼  query(span, seed)
   event graph (immutable, rational time, provenance)
     ┌────┼─────────┬────────────┬────────────┐
     ▼    ▼         ▼            ▼            ▼
  WebAudio MIDI   piano roll   analysis   (notation)
     ▲
  scheduler + transport (the only layer aware of wall-clock time)
     ▲
  resource resolver (samples, instruments)
```

Everything from the parser through the event graph runs inside a dedicated Web Worker by default (§11.3). The host
page's main thread receives only scheduled events and diagnostics.

### 6.2 Layer contracts

These rules are enforced by package boundaries and lint rules, not just by convention.

- **The parser never schedules.** It knows nothing about time.
- **The evaluator never performs I/O.** Pattern compilation and querying are pure functions of the IR, the span, and the
  seed.
- **The evaluator never runs on the host's main thread by default.** A runaway query can be killed without freezing the
  document.
- **The scheduler never interprets syntax.** It consumes events only.
- **The audio engine never sees source code.** It receives resolved events and resolved resources.
- **The UI never owns musical state.** It renders projections of the IR and the event graph, and submits edits as source
  patches.
- **Every event is traceable to source.**
- **No prototype is reachable from data.** Internal registries and control dictionaries use `Map` or
  `Object.create(null)`. No name in a document can ever resolve to `__proto__` or `constructor`.

### 6.3 Packages

| Package                | Responsibility                                                                                           | Depends on                 |
|------------------------|----------------------------------------------------------------------------------------------------------|----------------------------|
| `@tartlet/time`        | Rational numbers (small-integer fast path), `TimeSpan`, span arithmetic                                  | —                          |
| `@tartlet/mini`        | Mini-notation lexer, parser, and AST                                                                     | `time`                     |
| `@tartlet/syntax`      | Expression-language lexer, parser, source-preserving syntax tree, sugar desugaring (formatter after 1.0) | `mini`                     |
| `@tartlet/ir`          | IR type definitions, JSON schema, ingestion validation, versioning, migrations                           | `time`                     |
| `@tartlet/registry`    | Function signatures, aliases, compatibility levels, capabilities                                         | `ir`                       |
| `@tartlet/check`       | Lowering to IR, name resolution, semantic checks, static limits, diagnostics                             | `syntax`, `ir`, `registry` |
| `@tartlet/core`        | The pattern algebra, structure rules, IR-to-pattern compiler, query budgets                              | `time`, `ir`, `registry`   |
| `@tartlet/random`      | Seeded, splittable PRNG                                                                                  | `time`                     |
| `@tartlet/resources`   | The resource resolver interface, built-in resolvers, default kit and fallback map                        | `ir`                       |
| `@tartlet/worker`      | Worker host for check, compile, and query; budget enforcement and kill switch                            | `check`, `core`            |
| `@tartlet/schedule`    | Transport, lookahead scheduler, cycle-to-seconds mapping                                                 | `core`                     |
| `@tartlet/webaudio`    | Synths, sample player, effects buses, master-bus safety chain                                            | `schedule`, `resources`    |
| `@tartlet/midi`        | Web MIDI output, SMF export                                                                              | `core`                     |
| `@tartlet/view`        | Piano roll, pattern visualizer, source highlighting                                                      | `core`                     |
| `@tartlet/element`     | The `<tartlet-player>` custom element                                                                    | all runtime packages       |
| `@tartlet/conformance` | Test matrix, golden events, corpus harness, event-sanity checks                                          | all                        |

The core path is `time → mini → syntax → check → core`. It has no DOM and no Web Audio dependency, and runs in Node,
Deno, workers, and browsers.

---

## 7. The language surface

### 7.1 Compatibility levels

Tartlet never advertises a vague "Strudel compatible" flag. Each construct in the registry carries a level. Each release
publishes coverage per level.

| Level  | Name                 | Contents                                                                    | Commitment                                             |
|--------|----------------------|-----------------------------------------------------------------------------|--------------------------------------------------------|
| **L1** | Mini-notation        | The pattern-string grammar and its semantics                                | Complete and exact                                     |
| **L2** | Core expressions     | Common constructors, transforms, controls, bindings, and restricted lambdas | Complete for the measured high-frequency set           |
| **L3** | Extended             | Tonal helpers and less common transforms, chosen by corpus frequency        | Best effort, grows over time                           |
| **LX** | Arbitrary JavaScript | Loops, imports, DOM, `eval`, arbitrary member access                        | **Rejected in document mode**, with a clear diagnostic |

### 7.2 Mini-notation (L1)

Mini-notation is parsed by a dedicated grammar inside string literals passed to pattern-accepting parameters. The
grammar is written from documented behavior:

| Syntax               | Meaning                                                |
|----------------------|--------------------------------------------------------|
| `a b c`              | Sequence: the cycle is divided equally among the steps |
| `~`                  | Rest                                                   |
| `[a b]`              | Subdivision: a group occupying one step                |
| `<a b c>`            | Alternation: one element per cycle, in turn            |
| `a, b`               | Simultaneity (inside brackets, or at the top level)    |
| `a*n`                | Speed up: repeat within the step                       |
| `a/n`                | Slow down: stretch across cycles                       |
| `a!n`, `a !`         | Replicate as separate steps                            |
| `a@n`                | Elongate: give the step relative weight *n*            |
| `a?`, `a?0.3`        | Random drop, seeded                                    |
| `a(k,n)`, `a(k,n,r)` | Euclidean rhythm, with optional rotation               |
| `{a b, c d e}`       | Polymeter, aligned by steps                            |
| `{a b c}%n`          | Polymeter with an explicit steps-per-cycle count       |
| `a:n`                | Sample index or variant                                |
| `a \| b`             | Random choice per cycle, seeded                        |
| `.`                  | Group separator, as shorthand for bracketing           |

The mini-notation AST keeps source offsets *relative to the enclosing string literal*. These are mapped back to document
coordinates for provenance.

Multipliers and counts are bounded at check time: `*n`, `!n`, subdivision counts, and the Euclidean `n` are capped at
1024 (§10.4). Real music never comes close; `a*1e9` is an attack, not a composition.

### 7.3 The expression language (L2)

The expression language looks like JavaScript but is a separate grammar with a closed set of productions.

**Accepted:**

- **Literals:** numbers, strings (single-quoted, double-quoted, and backtick strings *without* interpolation), booleans,
  arrays, plain objects.
- **Calls:** `name(args…)`, where `name` resolves through the registry.
- **Method chains:** `expr.name(args…)`, resolved through the registry by receiver kind.
- **Registered bare-function references** used as arguments: `.every(4, rev)`.
- **Bindings:** `const name = expr` and `let name = expr`. These are evaluated once, immutable, and must be declared
  before use. Re-declaration is a diagnostic.
- **Restricted lambdas:** `x => chain-on-x` and `(x) => chain-on-x`. The body must be a single expression whose root is
  the parameter, or a registry call taking it. Lambdas are lowered to IR transform functions and are never executed as
  JavaScript.
- **Block-bodied lambdas as sugar:** `x => { return x.fast(2); }` contains exactly one `return` of an allowed body. It
  is desugared at parse time into the expression form and lowers to identical IR.
- **Constant array spreads:** `stack(...[a, b])`, where the spread operand is an array literal. The spread is unrolled
  at check time into ordinary arguments.
- **Arithmetic on numeric literals and bindings:** `+ - * /` and parentheses, constant-folded at check time.
- **Top-level statements:**
    - a bare expression, which is the output pattern;
    - `$: expr` labelled outputs, where multiple outputs are stacked;
    - `name: expr` named outputs;
    - registered directives such as `setcps(n)`, `setcpm(n)`, and `samples(…)`.
- **Comments:** `//` and `/* */`.

The sugar forms exist because models learned Strudel in a REPL, and they emit harmless JavaScript habits from it.
Rejecting those habits would spend the ≤1% rejection budget on code that means exactly what an accepted form means.
Widening the *syntax* costs nothing in safety: evaluation stays fully closed and static, and every sugar form desugars
to a production that was already allowed.

**Rejected, with diagnostic `E-LX-*`:**

- `import`, `require`, `await`, `async`, `function`, `class`, `new`
- loops and conditionals: `for`, `while`, `if`, `switch`, and ternaries over non-constant values
- computed member access `a[b]`, and any member access not resolved through the registry
- `window`, `document`, `globalThis`, `fetch`, `eval`, `Function`, `setTimeout`
- template-literal interpolation `${…}`
- assignment to anything other than a fresh binding
- spreads of anything other than a constant array literal, and lambda blocks with more than a single `return`
- any identifier not found in the registry or in local bindings

**Compatibility aliases** cover names that models borrow from neighboring ecosystems, such as Tidal or Tone.js, when
their meaning is unambiguous. The registry maps `.reverb` → `.room`, `.feedback` → `.delayfeedback`, and similar names.
They execute without interruption and produce only an informational note, so they never cost an LLM repair turn:

```
I-REG-ALIAS    `.reverb(.4)` at 3:14–3:26 is read as `.room(.4)`. Track plays.
```

**Unknown but plausible names** produce a diagnostic with a suggestion, not a parse failure:

```
W-REG-UNKNOWN  Unknown function `.romm(.4)` at 3:14–3:24.
               Did you mean `.room(.4)`?
               Control dropped; track "lead" plays.
```

### 7.4 Tartlet extensions

Extensions must never change the meaning of valid Strudel-style code. Planned extensions:

- `.seed(value)`: a scoped deterministic seed (§8.4).
- `.label("name")`: a stable voice identity for mixers, diagnostics, and diffs.
- `section("verse", expr)` together with `arrange([...])`: song-level structure, lowered to cycle-indexed concatenation.
- A metadata header in comments, `// @tempo 120` and `// @key D minor`, which hosts may read. Its runtime meaning is
  equivalent to the corresponding directives.

---

## 8. Core semantics

### 8.1 Time

All musical time is exact rational time:

```ts
type Rational = { readonly n: bigint; readonly d: bigint }; // normalized, d > 0
type Time = Rational;                                        // measured in cycles

interface TimeSpan {
    readonly begin: Time;
    readonly end: Time
} // half-open [begin, end)
```

This bigint form is the *semantic* model, not a mandated runtime representation. Normalizing bigint pairs with a GCD on
every operation is a real CPU cost, and the allocation churn surfaces as garbage-collection jitter in the scheduler.
Combined with uncapped multipliers and per-event provenance arrays, naive bigint rationals are also a denial-of-service
vector. `@tartlet/time` therefore uses a **small-integer fast path**: numerator and denominator are plain JS numbers
while both fit within 31 bits, and a value overflows to bigint only when an operation would exceed that bound.
Observable semantics must equal bigint rational arithmetic. Denominators are capped at 10⁹ by the query budget (§10.4).

Because `JSON.stringify` throws on bigint, the serialized `tartlet/1` encoding of a rational is a tuple:

```ts
type RationalJson = [number | string, number | string]; // [n, d]; decimal strings beyond the safe-integer range
```

Floating-point values appear only:

- at the scheduler boundary, when cycles become `AudioContext` seconds;
- inside synthesis parameters, such as frequencies and gains.

### 8.2 Events

An event has a **whole**: the full logical extent of the note. It also has a **part**: the fragment of the whole that
falls inside the queried span. An event is an onset when `part.begin == whole.begin`. Continuous signals have no whole.

```ts
interface Event<T> {
    readonly whole: TimeSpan | null;   // null for continuous signals
    readonly part: TimeSpan;
    readonly value: T;
    readonly provenance: Provenance[]; // all IR nodes that contributed; empty when collection is off
}
```

### 8.3 Patterns

```ts
interface Pattern<T> {
    query(state: QueryState): Event<T>[];
}

interface QueryState {
    readonly span: TimeSpan;
    readonly seed: SeedPath;               // see §8.4
    readonly controls: ReadonlyMap<string, unknown>; // external inputs, empty by default
    readonly provenance: boolean;          // collect Provenance[]; off for headless audio ticks
    readonly budget: QueryBudget;          // mutable; see §10.4
}
```

Provenance collection is toggled per query. When no piano roll, source highlighter, or other projection is listening,
the scheduler's audio ticks run with `provenance: false` and allocate no provenance arrays.

Every pattern must satisfy these laws. Property tests in the conformance suite enforce them. Equality is defined over
span, seed, controls, and the provenance flag. Budget exhaustion aborts a query; it is not a result.

1. **Purity.** Equal queries always return equal results.
2. **Span splitting.** For any `t` in `(a, c)`:
   `query([a,c])` ≡ `merge(query([a,t]), query([t,c]))`.
   Here `merge` joins fragments that share a whole and have adjacent parts.
3. **Containment.** Every returned `part` lies inside the queried span.
4. **Fragment consistency.** Fragments of one whole always carry identical values.

### 8.4 Determinism and seeds

Randomness comes from a splittable, counter-based PRNG keyed by a **seed path**:

```
root seed  = hash(document id, blob index, user seed | "default")
node seed  = hash(parent seed, IR node stable id)
event draw = hash(node seed, cycle index, event whole.begin, draw index)
```

Three properties follow:

- The same document, revision, and seed produce an **identical** event graph.
- Editing one subtree does not reshuffle the randomness of unrelated subtrees. Stable IR node ids are derived from
  structure plus labels, and are computed bottom-up along method chains (§9.7). Appending `.gain(.8)` to the end of a
  chain therefore never changes the seed of an earlier `.degrade()` or `.sometimes()`.
- Live mode may randomize the root seed deliberately. Document mode never does so implicitly.

`.seed(x)` replaces the node seed for its subtree. It lets authors and models pin a variation explicitly.

### 8.5 Tempo

Tempo is expressed in cycles per second (`cps`). `setcpm(n)` means `cps = n / 60`. The default is `0.5` cps, and values
are clamped to `[0.001, 100]`. Only the transport sees tempo. Tempo changes are scheduled at cycle boundaries, or at
explicit cycle positions. They never alter the event graph, only its mapping to seconds.

### 8.6 Combining patterns: structure rules

Whenever two patterns combine, Tartlet must decide whose rhythmic structure survives. This happens when a control takes
a patterned value (`s("hh*8").gain("<.5 1>")`), when arithmetic takes a pattern (`.add("<0 7>")`), or when a transform
argument is itself a pattern (`.fast("<1 2>")`). This is where the lineage's behavior is least documented in prose and
where semantic drift is most likely. `@tartlet/core` therefore specifies the rules explicitly instead of leaving them
implicit in code:

- **Structure from the receiver.** This is the default for controls and arithmetic. Each receiver event keeps its whole.
  Its value combines with each argument event active within it, and the resulting part is the intersection of the two
  parts.
- **Structure from the argument.** This is the mirror image: the argument's wholes survive.
- **Structure from both.** The result's whole is the intersection of both wholes. An event exists only where both
  patterns have one.
- **Patterned transform arguments.** The argument pattern is queried first. Each argument event's span becomes a window
  in which the transform is applied with that constant value, and the results are clipped to the window.

Each rule has dedicated E-kind matrix rows. Where public prose is silent, the interpretation comes from an oracle
specification (§4), and the matrix row records it.

---

## 9. The typed Music IR

The IR is the contract between authoring tools and runtime. It is versioned JSON, serializable, and diffable. It is
designed so that LLMs and editors can address a composition node by node, for example "the expr of output `lead`". Edits
addressed to IR nodes are realized as surgical splices of the source text (§9.7), so the source remains canonical.

### 9.1 Program

```ts
interface Program {
    readonly irVersion: "tartlet/1";
    readonly source?: SourceRef;          // hash and length of the originating text
    readonly settings: Settings;
    readonly bindings: Binding[];         // in declaration order
    readonly outputs: Output[];           // combined with stack()
    readonly resources: ResourceDecl[];   // from samples(...) directives and metadata
    readonly diagnostics: Diagnostic[];   // carried along for tooling
}

interface Settings {
    readonly cps: Rational;               // default 1/2, clamped to [1/1000, 100]
    readonly seed?: string;
    readonly meta: Record<string, string>; // e.g. key, title, from // @ headers
}

interface Binding {
    readonly id: NodeId;
    readonly name: string;
    readonly expr: PatternNode
}

interface Output {
    readonly id: NodeId;
    readonly label?: string;              // "$" outputs get synthesized stable labels
    readonly expr: PatternNode;
    readonly status: "ok" | "muted-error" | "muted-user";
}
```

Synthesized labels are stable ids, not display names. The player derives human-readable names heuristically from
content, such as *"Drums (bd, sd)"* or *"Sawtooth (pitched)"*, so a mixer never shows rows called `$1` and `$2`.

### 9.2 Pattern nodes

```ts
type PatternNode =
    | MiniNode         // a compiled mini-notation string
    | PureNode         // a constant value repeated every cycle
    | SilenceNode
    | RefNode          // a reference to a binding
    | CombineNode      // stack / cat / seq / slowcat / fastcat / polymeter
    | TransformNode    // a registered transform applied to a pattern
    | ControlNode      // assigns a control parameter (s, note, gain, room…)
    | SignalNode       // continuous sources: sine, saw, rand, perlin…
    | ErrorNode;       // a placeholder for a failed subtree

interface NodeBase {
    readonly id: NodeId;          // stable structural id
    readonly kind: string;
    readonly range: SourceRange;  // document coordinates
    readonly type: PatternType;   // inferred by the checker
}

interface MiniNode extends NodeBase {
    readonly kind: "mini";
    readonly text: string;
    readonly ast: MiniAst;        // see §9.4
    readonly valueKind: ValueKind; // how atoms are interpreted: note | sample | number | string
}

interface CombineNode extends NodeBase {
    readonly kind: "combine";
    readonly op: "stack" | "slowcat" | "fastcat" | "polymeter" | "arrange";
    readonly children: PatternNode[];
    readonly weights?: Rational[]; // used by arrange / timecat
}

interface TransformNode extends NodeBase {
    readonly kind: "transform";
    readonly fn: RegistryId;      // e.g. "fast", "every", "off"
    readonly target: PatternNode;
    readonly args: Arg[];
}

interface ControlNode extends NodeBase {
    readonly kind: "control";
    readonly control: ControlId;  // e.g. "gain", "s", "note", "lpf"
    readonly target: PatternNode | null; // null when used as a constructor, e.g. s("bd")
    readonly value: Arg;          // a pattern or a constant
    readonly structure?: "receiver" | "argument" | "both"; // §8.6; default "receiver"
}

interface ErrorNode extends NodeBase {
    readonly kind: "error";
    readonly diagnostic: DiagnosticId;
    readonly recovered?: PatternNode; // best-effort partial subtree, if any
}

type Arg =
    | { kind: "pattern"; node: PatternNode }      // patternable arguments, e.g. fast("<1 2>")
    | { kind: "const"; value: ConstValue }
    | { kind: "function"; fn: FunctionValue };    // rev, or a lowered lambda

type FunctionValue =
    | { kind: "ref"; fn: RegistryId; args: Arg[] }      // e.g. rev, or partially applied fast(2)
    | { kind: "lambda"; param: string; body: PatternNode }; // body contains a RefNode to param
```

Following the tradition, transform arguments are **patternable** wherever the registry allows it. `fast("<1 2 4>")` is
legal. The IR records whether an argument was supplied as a constant or as a pattern, so tooling can present each
appropriately.

### 9.3 Values and types

```ts
type ValueKind = "note" | "sample" | "number" | "string" | "bool" | "controls";

type PatternType =
    | { kind: "pattern"; of: ValueKind }
    | { kind: "signal"; of: "number" }
    | { kind: "function" }
    | { kind: "error" };

// The value carried by output events after controls are merged
interface Controls {
    readonly s?: string;           // sound / instrument name
    readonly n?: number;           // sample index or scale degree
    readonly note?: Pitch;
    readonly freq?: number;
    readonly gain?: number;
    readonly velocity?: number;
    readonly pan?: number;
    readonly speed?: number;
    readonly cutoff?: number;
    readonly resonance?: number;
    readonly hcutoff?: number;
    readonly attack?: number;
    readonly decay?: number;
    readonly sustain?: number;
    readonly release?: number;
    readonly room?: number;
    readonly size?: number;
    readonly delay?: number;
    readonly delaytime?: number;
    readonly delayfeedback?: number;
    readonly shape?: number;
    readonly crush?: number;
    readonly vowel?: string;
    readonly orbit?: number;

    readonly [extension: `x-${string}`]: unknown;
}

type Pitch =
    | { kind: "midi"; value: number }                      // fractional values allowed
    | { kind: "name"; letter: string; accidental: number; octave: number };
```

Aliases such as `sound`→`s`, `lpf`→`cutoff`, and `hpf`→`hcutoff` are resolved in the registry, as are compatibility
aliases such as `reverb`→`room`. The IR stores the canonical id and also keeps the alias the author typed, so tooling
can show what was written.

### 9.4 Mini-notation AST

```ts
type MiniAst =
    | { t: "seq"; steps: MiniStep[] }
    | { t: "stack"; layers: MiniAst[] }                    // comma-separated
    | { t: "alt"; items: MiniAst[] }                     // <...>
    | { t: "poly"; layers: MiniAst[]; steps?: MiniAst }   // {...}%n
    | { t: "choice"; items: MiniAst[] }                    // a | b
    | { t: "atom"; text: string; index?: number; range: [number, number] }
    | { t: "rest"; range: [number, number] };

interface MiniStep {
    readonly body: MiniAst;
    readonly weight: Rational;                          // @n
    readonly replicate: number;                         // !n
    readonly ops: MiniOp[];                             // applied in source order
}

type MiniOp =
    | { op: "fast"; by: MiniAst }                       // *n, itself patternable
    | { op: "slow"; by: MiniAst }                       // /n
    | { op: "degrade"; amount?: number }                // ?
    | { op: "euclid"; k: MiniAst; n: MiniAst; rot?: MiniAst };
```

### 9.5 Provenance

```ts
interface Provenance {
    readonly node: NodeId;
    readonly range: SourceRange;  // for mini atoms, the exact atom inside the string
    readonly role: "origin" | "transform" | "control";
}

interface SourceRange {
    readonly start: Offset;
    readonly end: Offset
}

interface Offset {
    readonly line: number;
    readonly col: number;
    readonly byte: number
}
```

When provenance is collected, the `origin` provenance of an event always points at a single mini-notation atom, or at a
constructor literal. This is what makes "click a note in the piano roll and see the character that produced it"
possible.

### 9.6 Registry entries

```ts
interface RegistryEntry {
    readonly id: RegistryId;
    readonly names: string[];                   // canonical name first, then aliases
    readonly compatAliases?: string[];          // borrowed names, e.g. "reverb"; emit I-REG-ALIAS
    readonly form: "constructor" | "method" | "both" | "directive" | "function-value";
    readonly receiver?: ValueKind[];            // valid receiver kinds for methods
    readonly params: ParamSpec[];
    readonly returns: PatternType | "same-as-receiver";
    readonly requires?: Capability[];           // e.g. "pitched", "audio-effect", "sample"
    readonly level: "L1" | "L2" | "L3";
    readonly deterministic: "pure" | "seeded";
    readonly since: string;                     // Tartlet version
    readonly description: string;               // original prose only (§4)
}

interface ParamSpec {
    readonly name: string;
    readonly type: ValueKind | "function" | "pattern-any";
    readonly patternable: boolean;
    readonly optional?: boolean;
    readonly default?: ConstValue;
    readonly range?: [number, number];          // used for warnings, never a hard error
}
```

The registry drives six things: the checker, the diagnostic suggestions and compatibility aliases, the formatter (once
it lands), the editor autocompletion, the generated reference documentation, and the published system prompt (§10.3).
There is one source of truth.

### 9.7 IR stability rules

- `irVersion` is bumped for breaking changes. `@tartlet/ir` ships forward migrations.
- **Node ids are computed bottom-up along receiver chains.** An output or binding is anchored by its label, or by its
  slot when unlabelled. A constructor's id is `hash(anchor, constructor name)`. A method application's id is
  `hash(receiver id, canonical fn name)`, and the subtree in its argument slot *i* is anchored at
  `hash(receiver id, canonical fn name, i)`. Ids depend only on what lies *inside* a chain, never on what is appended
  after it, so adding `.gain(.8)` to a chain leaves every earlier id and seed untouched. Ids are likewise stable under
  any edit outside the subtree.
- The IR is canonical. Two sources that differ only in formatting or aliases lower to IR that is equal modulo `range`
  and `alias` fields.
- **All ingested IR is validated before compilation.** Any JSON IR from outside the checker passes a schema check, a
  topological acyclicity check over binding references, and a `Rational` check (`d > 0`, within the denominator
  ceiling). IR is data, and it gets no more trust than source does.
- **Source text is the canonical stored artifact; the IR is derived.** Lowering is deliberately lossy: it resolves
  aliases and folds constants. An IR-to-source un-parser would clobber the author's comments and formatting. Instead,
  when a tool, mixer slider, piano-roll note, or auto-fix mutates a node, Tartlet applies a surgical text replacement at
  that node's `SourceRange` and then re-parses incrementally. Tartlet ships no un-parser.

---

## 10. Diagnostics and recovery

### 10.1 Diagnostic shape

```ts
interface Diagnostic {
    readonly id: DiagnosticId;           // e.g. "E-LX-IMPORT", "W-REG-UNKNOWN", "I-RES-FALLBACK"
    readonly severity: "error" | "warning" | "info";
    readonly message: string;
    readonly range: SourceRange;
    readonly node?: NodeId;
    readonly output?: string;            // label of the affected track, for UI and repair payloads
    readonly effect: "none" | "subtree-muted" | "output-muted" | "program-rejected";
    readonly fixes?: Fix[];              // machine-applicable text edits
    readonly related?: { range: SourceRange; message: string }[];
}

interface Fix {
    readonly title: string;
    readonly edits: { range: SourceRange; text: string }[];
    readonly safe: boolean;              // deterministic and meaning-preserving; may be auto-applied
}
```

### 10.2 Recovery policy

1. **Parse errors** are recovered at statement and argument boundaries. The syntax tree keeps error nodes, and parsing
   continues.
2. **Unknown functions** in a method chain are first checked against the compatibility alias table. If an alias matches,
   the call executes as its canonical function with an `I-REG-ALIAS` note. Otherwise the chain is cut at that point, and
   the checker decides:
    - If the unknown function is a *control* that is plausibly cosmetic, such as an unknown effect, the subtree keeps
      playing without it and a **warning** is emitted.
    - If the unknown function would change structure, such as an unknown transform, the subtree is replaced by an
      `ErrorNode` and muted.
3. **Type and capability errors** mute the smallest enclosing output-contributing subtree.
4. **Rejected constructs (LX)** in a binding mute every output that references the binding. Everything else continues.
5. **Resource-limit violations** (§10.4) mute only the offending output, with `E-LIMIT-*`.
6. **Program rejection** happens only when no output can be produced at all.

The governing rule: **a bad lead line never kills the drums.** This property, lowering failure into `ErrorNode`s with
subtree isolation, matters more for AI-authored media than any other single feature. Generated music is routinely 95%
valid. A runtime that turns the remaining 5% into silence makes LLM authorship feel broken. A runtime that plays the 95%
and points precisely at the rest makes it feel like collaboration.

### 10.3 LLM repair loop

Diagnostics serialize to a compact, model-friendly form. Raw column coordinates are poor targets for a model, so the
payload carries the enclosing source line, the track label, and an explicit scope directive:

```
tartlet: 1 issue to fix (1 cosmetic note not shown)
  E-TYPE-PITCH  track "perc", line 11:
      s("bd*4 sd").scale("C:minor")
    `.scale` needs pitched or numeric events; this track plays samples. Track muted.
  Rewrite ONLY the track on line 11; keep all other tracks unchanged.
```

Three policies keep the loop cheap and safe:

- **Benign notes are suppressed by default.** Info diagnostics, and warnings whose only consequence is a dropped
  cosmetic control, stay out of the default repair prompt. Otherwise a model tends to break working code while chasing a
  note it could have ignored. Hosts can request the full list.
- **Safe fixes are applied without the model.** Hosts and the player UI can apply `Fix` objects marked `safe` with one
  click, or automatically. A typo like `.romm` → `.room` is a zero-token repair.
- **Prevention ships with the runtime.** Tartlet publishes an official system-prompt snippet of under 300 tokens,
  generated from the registry. It steers host LLMs toward clean L1/L2 idioms and the default kit's sample names.

Hosts can return the payload text to the authoring model directly. The conformance suite includes a repair benchmark
(§12.5).

### 10.4 Resource limits

Pathological input is handled by explicit, configurable limits, enforced from Phase 1. Static limits are checked before
compilation. Runtime limits are enforced during every query through a mutable budget attached to `QueryState`.

```ts
interface LimitsConfig {
    readonly maxSourceBytes: number;      // 65_536
    readonly maxNestingDepth: number;     // 32
    readonly maxStepMultiplier: number;   // 1024: caps *n, !n, euclid n, subdivision counts
    readonly cpsRange: [number, number];  // [0.001, 100]
    readonly maxEvalSteps: number;        // per query window
    readonly maxEventsPerWindow: number;  // 2_048
    readonly maxDenominator: bigint;      // 10n ** 9n
}

interface QueryBudget {                 // mutable; one per output per query window
    steps: number;
    events: number;
}
```

Evaluation steps are counted across shared subtrees. Binding reuse such as `const b = stack(a, a, a, a)` nested a few
levels deep therefore cannot multiply work exponentially. Exhausting the budget mutes only the offending output with
`E-LIMIT-DENSITY`. The worker host (§11.3) adds a final kill switch above the budget.

---

## 11. Capabilities, resources, and outputs

### 11.1 Capability checking

The checker does lightweight inference. It is not a full type system.

| Capability     | Provided by                               | Required by                                            |
|----------------|-------------------------------------------|--------------------------------------------------------|
| `pitched`      | `note`, `n` combined with `scale`, `freq` | `scale`, `transpose`, `voicing`, MIDI note output      |
| `sample`       | `s` resolved to a sample bank             | `speed`, `begin`, `end`, `chop`, `n`, used as an index |
| `synth`        | `s` resolved to a built-in oscillator     | ADSR controls, `cutoff` (also valid for samples)       |
| `audio-effect` | any audible output                        | `room`, `delay`, `shape`, `crush`                      |

Unmet capabilities produce warnings when the result would only be silent or cosmetic. They produce errors when the
result is nonsense.

### 11.2 Resource resolution

```ts
interface ResourceResolver {
    resolveSound(name: string, index: number): Promise<SoundResource | Unavailable>;

    list(): Promise<SoundCatalog>; // used for autocompletion and validation before playback
}
```

Resolution order is configured by the host:

1. **Embedded:** assets bundled alongside the document, such as Markdown2 attachments.
2. **Package:** the built-in general kit (below) and built-in synths (`sine`, `square`, `triangle`, `sawtooth`, and
   noise variants).
3. **Approved URLs:** a host-managed allowlist. A `samples("…")` directive declares a remote bank. It is fetched
   **only** if the host policy allows that origin.
4. **Fallback mapping:** a name that nothing else resolves is mapped to the closest general-kit sound, with an
   `I-RES-FALLBACK` note.
5. **Unavailable:** reported before playback, with the affected outputs listed.

**Common community names map to a local kit by default.** Models overwhelmingly write sample names from one community
sample collection: `bd`, `sd`, `hh`, `cp`, `808`, `arpy`, `piano`, `casio`, `pad`, `bass`. That collection mixes
non-commercial, copyleft, and unverified recordings, so Tartlet cannot bundle it. Without a substitute, the most common
failure mode is not an error at all. A program passes the checker cleanly and then plays silence, or a thin toy sound.

Tartlet therefore ships a **general kit**. It consists entirely of CC0 recordings or procedurally synthesized sounds
released under Apache-2.0, and covers the most frequent names in the corpus. The initial target is about 100 names,
within a range of 50–200 as corpus frequency dictates. The kit does not imitate the community bank's recordings. It
supplies sounds that answer to the same names. A fuzzy, semantic alias mapper sits behind it, so an unbundled name such
as `s("808bd")` or `s("rhodes")` resolves to the nearest kit sound. The result is an info badge, never a muted track.

There is no implicit, remote global sample map. The general kit and its fallback map are local, versioned with the
runtime, and announced by diagnostics. A composition sounds the same tomorrow as it does today, or it says exactly why
it doesn't.

### 11.3 Scheduler and transport

- Pattern evaluation runs in a dedicated Web Worker by default. The main thread never queries patterns. Dense or runaway
  queries cannot stall the host document's UI, and `worker.terminate()` is an OS-level kill switch beneath the query
  budget.
- A lookahead scheduler queries the pattern in windows of about 100 ms of cycle time. It runs on a timer that is
  decoupled from the audio thread.
- Each window is computed exactly in rational time. Each onset is converted once to `AudioContext` time:
  `t = t0 + (cycle - cycle0) / cps`.
  Errors cannot accumulate across windows.
- Seeking, looping, and tempo changes re-anchor `(t0, cycle0)` and leave the event graph untouched. A seek target
  supplied as a float is converted at the boundary by bounded-denominator rational approximation, so `cycle0` is always
  exact.
- Offline rendering uses `OfflineAudioContext` with the same pipeline and produces bit-identical event timings.
- Audio starts only after an explicit user gesture. This is required by browsers, and it is also Tartlet policy.

### 11.4 Output adapters

```ts
interface OutputAdapter {
    prepare(program: Program, resolver: ResourceResolver): Promise<PrepareReport>;

    schedule(events: Event<Controls>[], clock: ClockMapping): void;

    stop(atTime?: number): void;
}
```

Adapters and their phases:

- **WebAudio** — Phase 0, with its safety chain (§11.5).
- **Event-sanity analysis** — Phase 1 (below).
- **Piano roll / visualizer** — Phase 3.
- **Web MIDI output** — Phase 3; **Standard MIDI File export** — Phase 4.
- **Deep musical analysis**, which reports key, harmony, density, and range — Phase 4, or 1.1.
- **Notation projection** — later, after research.

The analysis adapter is split into two tiers because one of them is needed long before the other. The **event-sanity
check** is about fifty lines. It queries the compiled `Pattern<Controls>` over 4–8 cycles and asserts that
`totalEvents > 0`, that `eventsPerCycle` stays under budget, and that no unmuted output is completely silent. It also
extracts basic note density and pitch bounds. Its job is to catch *silent failures*: programs that pass `tartlet check`
with zero diagnostics but emit no audio events. It runs in every corpus pass and every repair loop from Phase 1, and its
summaries double as accessible text descriptions for screen readers. **Deep analysis**, including key detection and
harmonic summaries, is the musically interesting tier, and it can wait.

### 11.5 Audio safety and default polish

LLM-generated code has erratic gain staging. Models stack six tracks at full gain, hallucinate `.gain(40)`, and push
filter resonance into self-oscillation. A document runtime cannot hand that straight to someone's speakers or
headphones. These protections are not features an author opts into. They are the floor beneath every composition, and
`@tartlet/webaudio` provides them from its earliest milestone:

- a **non-bypassable master-bus brickwall limiter** at 0 dBFS, preceded by a gentle compressor;
- a **DC blocker and NaN/Infinity guard** on every voice and on the master bus;
- **parameter clamps** at the adapter, such as bounded filter Q and delay feedback below 0.98. The IR keeps the authored
  value, and the checker emits `W-RANGE`;
- **tasteful default envelopes**, so a bare `note("c").s("sawtooth")` neither clicks nor drones;
- **hard polyphony limits with voice stealing**, 64 voices by default.

Good defaults are a compatibility feature. Models should not need to specify synthesis details for the result to sound
finished.

---

## 12. Compatibility test matrix

### 12.1 Test kinds

| Kind                | Asserts                                                                                                                                                                        |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **P (parse)**       | The source parses. Every node's byte range maps back to its exact source text, and comments survive. Formatter idempotence joins this kind once the formatter lands after 1.0. |
| **E (events)**      | Querying a given span returns exactly the expected events: whole, part, and value in rational time. This is a golden test.                                                     |
| **L (laws)**        | Property tests: purity, span splitting, containment, and fragment consistency, run over generated spans.                                                                       |
| **D (determinism)** | Same seed gives an identical graph. Edits outside a subtree, including appending to the end of a chain, leave its random draws unchanged.                                      |
| **X (diagnostics)** | The expected diagnostic id, range, effect, and fix are produced.                                                                                                               |
| **R (rejection)**   | LX constructs and hostile IR are rejected. No host API is reachable. Limits hold.                                                                                              |
| **V (provenance)**  | Each event's origin range points at the expected atom.                                                                                                                         |
| **S (sanity)**      | A 4-cycle query yields events, stays within budget, and leaves no unmuted output silent.                                                                                       |
| **A (audio)**       | Offline render: onset times are within one sample, the sound is non-silent, and the master bus never exceeds 0 dBFS. This is a smoke test only.                                |

Golden expectations are written by hand from documented behavior, from oracle specifications (§4), and from musical
reasoning. They are never produced by running a reference implementation and copying its output into fixtures. Where a
behavior is ambiguous, the matrix row records the interpretation chosen, the reason for it, and the oracle specification
that informed it, if any.

### 12.2 L1: mini-notation

| ID   | Construct               | Example                    | Key assertion                                        | Kinds   | Phase |
|------|-------------------------|----------------------------|------------------------------------------------------|---------|-------|
| M-01 | Sequence                | `"a b c d"`                | 4 events of 1/4 each in cycle 0                      | P E L V | 0     |
| M-02 | Rest                    | `"a ~ b ~"`                | 2 events at 0 and 1/2                                | P E     | 0     |
| M-03 | Subdivision             | `"a [b c]"`                | b at 1/2–3/4, c at 3/4–1                             | P E V   | 0     |
| M-04 | Nested subdivision      | `"[a [b [c d]]]"`          | d spans 7/8–1                                        | P E     | 0     |
| M-05 | Alternation             | `"<a b c>"`                | cycle k gives item k mod 3                           | P E L   | 0     |
| M-06 | Alternation in sequence | `"x <a b>"`                | 2nd step alternates per cycle                        | E       | 0     |
| M-07 | Polyphony               | `"[a, b c]"`               | a whole cycle, overlapping b and c                   | P E     | 0     |
| M-08 | Top-level comma         | `"a b, c"`                 | equivalent to M-07's stack form                      | E       | 0     |
| M-09 | Fast                    | `"a*4"`                    | 4 events in one step                                 | P E     | 0     |
| M-10 | Fast on group           | `"[a b]*2"`                | a b a b                                              | E       | 0     |
| M-11 | Slow                    | `"a/2"`                    | whole spans 0–2; part-clipped per cycle              | E L     | 0     |
| M-12 | Slow sequence           | `"[a b c]/3"`              | one event per cycle                                  | E       | 0     |
| M-13 | Patterned fast          | `"a*<2 3>"`                | 2 events, then 3                                     | E       | 1     |
| M-14 | Replicate               | `"a!3 b"`                  | 4 equal steps                                        | P E     | 1     |
| M-15 | Bare replicate          | `"a ! b"`                  | 3 equal steps                                        | P E     | 1     |
| M-16 | Elongate                | `"a@3 b"`                  | a 0–3/4, b 3/4–1                                     | P E     | 1     |
| M-17 | Degrade                 | `"a*8?"`                   | subset; stable across runs with the same seed        | E D     | 1     |
| M-18 | Degrade amount          | `"a*8?0.8"`                | mean density ≈0.2 over 1000 cycles                   | D       | 1     |
| M-19 | Euclid                  | `"a(3,8)"`                 | onsets at 0, 3/8, 6/8                                | P E     | 1     |
| M-20 | Euclid rotate           | `"a(3,8,2)"`               | rotated onsets                                       | E       | 1     |
| M-21 | Patterned euclid        | `"a(<3 5>,8)"`             | count alternates per cycle                           | E       | 2     |
| M-22 | Polymeter               | `"{a b c, d e}"`           | layers aligned by step                               | P E     | 2     |
| M-23 | Polymeter steps         | `"{a b c}%4"`              | 4 steps per cycle, wrapping                          | E       | 2     |
| M-24 | Sample index            | `"bd:3 sd:1"`              | `s`/`n` split correctly                              | P E     | 0     |
| M-25 | Random choice           | `"a \| b \| c"`            | one per cycle, seeded                                | E D     | 2     |
| M-26 | Note names              | `"c3 eb3 f#4 bb2"`         | correct MIDI 48, 51, 66, 46                          | E       | 0     |
| M-27 | Numbers                 | `"0 .5 -1 2.25"`           | numeric atoms                                        | E       | 0     |
| M-28 | Dot grouping            | `"a b . c d e"`            | two equal groups                                     | P E     | 2     |
| M-29 | Whitespace/newlines     | multi-line backtick string | same as single-line                                  | P E     | 0     |
| M-30 | Malformed               | `"[a b"`                   | `E-MINI-UNCLOSED` at the bracket; other outputs play | X       | 1     |

### 12.3 L2: expressions

| ID   | Construct                   | Example                                             | Key assertion                                        | Kinds | Phase |
|------|-----------------------------|-----------------------------------------------------|------------------------------------------------------|-------|-------|
| X-01 | `s` / `sound`               | `s("bd sd")`                                        | sample events; alias canonicalized                   | P E   | 0     |
| X-02 | `note`                      | `note("c e g")`                                     | pitched events                                       | E     | 0     |
| X-03 | `n` + `scale`               | `n("0 2 4").scale("C:minor")`                       | C, Eb, G                                             | E     | 2     |
| X-04 | Chained controls            | `note("c").s("sawtooth").gain(.8)`                  | merged controls                                      | E     | 0     |
| X-05 | Patterned control           | `s("hh*8").gain("<.5 1>")`                          | gain alternates per cycle; receiver structure (§8.6) | E     | 1     |
| X-06 | `stack`                     | `stack(s("bd*4"), note("c2"))`                      | union of events                                      | E     | 0     |
| X-07 | `cat` / `slowcat`           | `cat("a","b")`                                      | one item per cycle                                   | E     | 0     |
| X-08 | `seq` / `fastcat`           | `seq("a","b")`                                      | both in one cycle                                    | E     | 1     |
| X-09 | `fast` / `slow`             | `.fast(2)`, `.slow("<1 2>")`                        | time scaling, patternable                            | E L   | 0     |
| X-10 | `rev`                       | `note("a b c").rev()`                               | c b a                                                | E     | 1     |
| X-11 | `every` / `firstOf`         | `.every(4, x => x.rev())`                           | rev on cycles 0, 4, 8…                               | E     | 1     |
| X-12 | Function value              | `.every(3, fast(2))`                                | partial application                                  | E     | 1     |
| X-13 | `off`                       | `.off(1/8, x => x.add(12))`                         | layered, shifted copy                                | E     | 2     |
| X-14 | `jux`                       | `.jux(rev)`                                         | left/right pan split                                 | E     | 2     |
| X-15 | `early` / `late`            | `.late(1/4)`                                        | shifted onsets                                       | E L   | 1     |
| X-16 | `ply`                       | `.ply(2)`                                           | each event doubled in place                          | E     | 2     |
| X-17 | `struct`                    | `note("c").struct("x ~ x x")`                       | structure taken from rhythm                          | E     | 2     |
| X-18 | `mask`                      | `.mask("<1 0>")`                                    | silent every other cycle                             | E     | 2     |
| X-19 | `euclid` method             | `.euclid(3,8)`                                      | same as M-19                                         | E     | 2     |
| X-20 | `sometimesBy` / `degradeBy` | `.sometimesBy(.3, x => x.speed(2))`                 | seeded; D-stable                                     | E D   | 2     |
| X-21 | `add` / `transpose`         | `.add(7)`, `.transpose(12)`                         | pitch arithmetic                                     | E     | 2     |
| X-22 | `iter` / `palindrome`       | `.iter(4)`                                          | rotating start per cycle                             | E     | 3     |
| X-23 | Bindings                    | `const d = s("bd*4"); stack(d, d.fast(2))`          | refs resolve; ids stable                             | P E D | 1     |
| X-24 | `$:` outputs                | `$: s("bd*4")` ×2                                   | stacked outputs                                      | P E   | 1     |
| X-25 | Tempo                       | `setcps(.6)`, `setcpm(120/4)`                       | settings.cps exact                                   | P E   | 0     |
| X-26 | Effects controls            | `.room(.3).delay(.25).lpf(800)`                     | canonical controls                                   | E     | 1     |
| X-27 | Envelope controls           | `.attack(.01).release(.3)`                          | passed through                                       | E     | 1     |
| X-28 | Signals                     | `.lpf(sine.range(200,2000).slow(4))`                | continuous sampled at onsets                         | E     | 2     |
| X-29 | Constant arithmetic         | `.fast(3/2)`, `.late(1/8)`                          | rational folding                                     | P E   | 1     |
| X-30 | Comments                    | `// …` and `/* … */`                                | ignored; preserved in the syntax tree                | P     | 0     |
| X-31 | `samples()` directive       | `samples("github:…")`                               | declared; fetched only under policy                  | X     | 2     |
| X-32 | `.seed()` (ext)             | `.sometimesBy(.5, rev).seed("v2")`                  | pinned variation                                     | D     | 2     |
| X-33 | `.label()` (ext)            | `.label("lead")`                                    | stable output id                                     | P D   | 2     |
| X-34 | Block-bodied lambda         | `.every(4, x => { return x.rev(); })`               | same IR as X-11                                      | P E   | 1     |
| X-35 | Constant spread             | `stack(...[a, b])`                                  | same IR as `stack(a, b)`                             | P E   | 1     |
| X-36 | Chain append                | `s("bd*8").degradeBy(.5)` then `.gain(.8)` appended | degrade draws unchanged                              | D     | 1     |

### 12.4 L3, diagnostics, and rejection (selection)

| ID   | Construct / case            | Example                                                  | Expected                                                    | Kinds | Phase |
|------|-----------------------------|----------------------------------------------------------|-------------------------------------------------------------|-------|-------|
| T-01 | Chord symbols               | `chord("<Dm7 Bbmaj7>").voicing()`                        | reasonable voicings, deterministic                          | E D   | 4     |
| T-02 | `arp`                       | `.arp("up")`                                             | sequential notes                                            | E     | 4     |
| T-03 | `chop` / `slice`            | `s("break").chop(8)`                                     | 8 segments with begin/end                                   | E     | 4     |
| T-04 | `section` / `arrange` (ext) | `arrange([4, verse], [4, chorus])`                       | cycle-indexed song form                                     | E V   | 4     |
| Q-01 | Unknown method              | `.romm(.4)`                                              | `W-REG-UNKNOWN` with a safe `.room` fix; track plays        | X     | 1     |
| Q-02 | Unknown transform           | `.wobble(2)`                                             | `E-REG-UNKNOWN`; subtree muted                              | X     | 1     |
| Q-03 | Capability                  | `s("bd").scale("C:major")`                               | `E-CAP-PITCHED`; subtree muted                              | X     | 2     |
| Q-04 | Undefined binding           | `stack(drums, bass)`                                     | `E-NAME-UNDEF` per reference                                | X     | 1     |
| Q-05 | Missing sample              | `s("zzq")` with fallback disabled by host policy         | `W-RES-MISSING` before playback                             | X     | 2     |
| Q-06 | Out-of-range                | `.gain(40)`                                              | `W-RANGE`; value clamped by the adapter, not the IR         | X A   | 2     |
| Q-07 | Compatibility alias         | `.reverb(.4)`                                            | `I-REG-ALIAS`; plays as `.room(.4)`                         | X E   | 1     |
| Q-08 | Sample fallback             | `s("808bd arpy")`                                        | `I-RES-FALLBACK`; general-kit sounds play                   | X S   | 2     |
| Q-09 | Silent program              | `s("bd").mask("0")` as the only output                   | clean check, but the S check flags a silent output          | S     | 1     |
| Z-01 | Import                      | `import x from "y"`                                      | `E-LX-IMPORT`; program rejected only if nothing else exists | R X   | 1     |
| Z-02 | Host access                 | `window.location`, `fetch("…")`                          | `E-LX-HOST`; nothing is evaluated                           | R     | 1     |
| Z-03 | Computed member             | `note("c")["constructor"]`                               | `E-LX-MEMBER`                                               | R     | 1     |
| Z-04 | Interpolation               | `` note(`c ${x}`) ``                                     | `E-LX-INTERP`                                               | R     | 1     |
| Z-05 | Loops/conditionals          | `for (…) {}`                                             | `E-LX-CONTROL`                                              | R     | 1     |
| Z-06 | Lambda escape               | `x => fetch(x)`, `x => { y(); return x; }`               | `E-LX-LAMBDA`                                               | R     | 1     |
| Z-07 | Prototype tricks            | `__proto__`, `constructor` identifiers                   | rejected at lexing or name resolution                       | R     | 1     |
| Z-08 | Pathological size           | 10⁵ nested brackets, `a*1e9`, 1 MB source                | `E-LIMIT-*`; bounded time and memory                        | R X   | 1     |
| Z-09 | Binding bomb                | nested `const b = stack(a,a,a,a)` chains                 | `E-LIMIT-DENSITY`; only that output muted                   | R X   | 1     |
| Z-10 | Hostile IR                  | IR with a reference cycle, `d = 0`, or a `__proto__` key | rejected by ingestion validation                            | R     | 1     |

### 12.5 Corpus coverage and repair benchmarks

The headline metric is measured, not asserted:

> **What fraction of Strudel that frontier LLMs naturally generate runs unchanged in Tartlet and produces the intended
structure?**

The corpus is generated in **Week 1**, before the L2 grammar is locked. The grammar should be shaped by what models
actually write, not by what we expect them to write.

Methodology:

1. **Prompt set.** Write 500 or more original prompts covering many genres, moods, tempos, levels of complexity, and
   requests such as "add a bassline" or "make the second half sparser."
2. **Generation.** Collect outputs from several frontier models, with multiple samples per prompt. Store the model,
   date, and prompt alongside each output. This is our own corpus, generated by us.
3. **Classification.** Run every sample through `tartlet check` and bucket the result:
    - *clean*: no diagnostics beyond info notes;
    - *degraded*: warnings only;
    - *partial*: some outputs muted;
    - *rejected*: nothing playable.

   A program counts as clean or degraded only if it also passes the event-sanity check (§11.4): a 4-cycle query yields
   `totalEvents > 0`, and no unmuted output is completely silent. A program that checks cleanly but fails the sanity
   check is a silent failure and is counted as partial.
4. **Frequency ranking.** Count every registry miss, unsupported construct, and fallback-mapped sample name. The ranked
   list *is* the L3 backlog, the compatibility alias table's backlog, and the general kit's coverage list.
5. **Semantic spot-checks.** For a sample of clean programs, a reviewer confirms the result plays and matches the
   request. This is a sanity check, not an evaluation of artistic quality.
6. **Repair benchmark.** For partial and rejected programs, apply safe fixes, give the model its Tartlet repair payload
   (§10.3), and measure the success rate after one round and after two rounds of repair. A repair counts as successful
   only if previously working tracks are unchanged.
7. **Rejection corpus.** Adversarial prompts try to get models to emit code that escapes the sandbox. Every sample must
   be rejected or neutralized.

Coverage targets:

| Milestone    | Clean + degraded | Partial | Rejected | One-round repair success |
|--------------|------------------|---------|----------|--------------------------|
| Phase 1 exit | ≥70%             | —       | ≤10%     | —                        |
| Phase 2 exit | ≥90%             | ≤7%     | ≤3%      | ≥80%                     |
| 1.0          | ≥95%             | ≤4%     | ≤1%      | ≥90%                     |

The corpus is re-run for every release. Coverage is published per model and per level.

---

## 13. Markdown2 integration

### 13.1 Blob types

- **Primary:** `text/vnd.tartlet`
- **Accepted legacy alias:** `text/x-strudel`. Using this name claims only language compatibility. Tartlet does not
  register or claim a `vnd.strudel` type.

```
<<<groove type="text/vnd.tartlet">
setcpm(92/4)

$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
>>>
```

### 13.2 Renderer behavior

1. The renderer passes the blob text, document id, and blob index to `<tartlet-player>`.
2. The player parses and checks the source immediately, in its worker. This has no side effects and plays no audio.
3. The player renders:
    - ▶ / ■ transport;
    - cycle position;
    - a per-output mixer, with heuristic track names, mute, solo, and diagnostic badges. User-muted and error-muted
      tracks look different. Clicking an error-muted track scrolls the source view to the offending range;
    - a source view with diagnostics, one-click safe fixes, and live provenance highlighting;
    - an optional piano roll.
4. Audio starts only after a user gesture. A singleton audio coordinator ensures that starting one player in a document
   pauses any other by default.
5. **Read-only** is the default mode. In **editable** mode, the host receives source patches through events and decides
   whether to persist them. Live edits are debounced by about 300 ms. While the author is mid-keystroke, the player
   keeps the last known-good IR playing, and valid new IR is swapped in at the next cycle boundary.
6. If the runtime is unavailable, the source block itself is the durable fallback. It stays readable, copyable, and
   portable.

### 13.3 Custom element API

```html

<tartlet-player
        src-type="text/vnd.tartlet"
        seed="default"
        mode="read-only | editable"
        views="mixer source pianoroll"
        resource-policy="embedded package fallback">
    <!-- source text as content, or provided via the .source property -->
</tartlet-player>
```

```ts
interface TartletPlayerElement extends HTMLElement {
    source: string;
    readonly program: Program;           // the latest checked IR
    readonly diagnostics: Diagnostic[];

    play(): Promise<void>;               // must be called from a user gesture
    stop(): void;

    seek(cycle: number | Rational): void; // floats converted by bounded-denominator approximation
    applyFix(fix: Fix): void;            // splices source at the fix's ranges
    renderOffline(cycles: number): Promise<AudioBuffer>;

    addEventListener(type: "change" | "diagnostics" | "event",

    …)
    : void;
}
```

Controls are native elements inside the shadow DOM, with keyboard transport. An `aria-live="polite"` region announces
per-output summaries and diagnostics, drawn from the event-sanity analysis.

---

## 14. Implementation roadmap

The original ambition was "a working clone in less than a day." That ambition is kept as the **Phase 0 spike**: a
vertical slice that plays music in Markdown2 by the end of the first day. The remaining phases turn that spike into the
deterministic, safe, well-structured runtime described above.

The roadmap has been re-baselined in two directions. First, things that were scheduled late but carry existential or
structural risk move to the front: legal sign-off on the clean-room protocol, the corpus, resource limits, worker
isolation, and audio safety. Second, the 12-week plan was too ambitious as originally drawn. It promised a lossless CST
and formatter, two-way IR patching, exact applicative algebra, a DSP pass, a two-way piano roll, MIDI export, and chord
voicings, all under clean-room constraints. Tartlet now edits through source-range splicing instead of an un-parser,
defers the formatter, and treats Phase 4 as the release valve.

### Week 1 gates (in parallel with Phase 0)

- **Corpus v0:** the prompt set is written and the first generation run is collected, so frequency data exists before
  the L2 grammar is locked.

### Phase 0: Vertical spike (day 1)

**Goal:** prove the pipeline end to end, and hear music inside Markdown2.

- `@tartlet/time`: rational arithmetic and spans.
- `@tartlet/mini`: rows M-01–M-12, M-24, M-26, M-27, and M-29.
- A minimal expression parser covering `note`, `s`, `stack`, `cat`, `.fast`, `.slow`, `.gain`, `setcps`, and `$:`.
- `@tartlet/core`: pure, sequence, stack, slowcat, fastcat, fast, slow, and control merge.
- The scheduler, built-in oscillators, and a handful of package drum samples answering to the most common names (`bd`,
  `sd`, `hh`).
- A master-bus limiter and NaN guard from the first audible commit.
- A bare `<tartlet-player>` with play/stop, wired to the Markdown2 blob type.

**Exit:** the §13.1 example plays correctly in Markdown2. The Phase 0 matrix rows pass. There is no `eval` anywhere in
the codebase, and a lint rule forbids it.

Phase 0 code may be rewritten. Its purpose is to validate the architecture's seams before they harden.

### Phase 1: Real front end (week 1–2)

- A parser for the full L2 expression grammar, with error recovery. It produces a source-preserving syntax tree with
  exact byte ranges and comments. There is no formatter yet.
- The sugar layer: block-bodied lambdas and constant array spreads.
- Lowering to the Music IR, the IR JSON schema (§9), the `Rational` tuple encoding, and ingestion validation.
- The registry, with first-pass L2 entries, original descriptions, and the compatibility alias table.
- The checker: name resolution, rejection rules (Z-01–Z-07), unknown-name suggestions, and subtree muting.
- Diagnostics in structured form and as the model-friendly repair payload, with safe fixes marked for auto-application.
- Mini-notation rows M-13–M-20 and M-30.
- Seeded PRNG, seed paths, and bottom-up node ids. Law and determinism property tests run in CI.
- `LimitsConfig` and `QueryBudget`, with the small-integer rational fast path (Z-08–Z-10).
- Worker-hosted evaluation as the default.
- The audio safety floor: parameter clamps, default envelopes, and 64-voice stealing (§11.5).
- The corpus harness, v1: classification plus the event-sanity check.
- A first draft of the published system prompt.

**Exit:** coverage meets the Phase 1 target. All R rows pass. S checks run on every corpus program. Pattern laws hold
under 10⁴ randomized spans per construct.

### Phase 2: Coverage drive (week 3–5)

- Work down the corpus frequency list:
    - transforms X-11–X-21 and X-28, with the §8.6 structure rules backed by oracle specifications;
    - mini-notation rows M-21–M-28;
    - capabilities (Q-03);
    - new compatibility aliases as the corpus surfaces them.
- The resource resolver, with embedded, package, allowlisted URLs, and fallback mapping, plus `samples()` policy
  handling (X-31, Q-05).
- The general kit, about 100 CC0 or synthesized sounds chosen from corpus frequency, plus the fallback mapper (Q-08).
- Tartlet extensions `.seed()` and `.label()`.
- The repair benchmark, run for the first time.

**Exit:** Phase 2 coverage and repair targets are met. Corpus results are published.

### Phase 3: Projections, sound quality, and accessibility (week 5–7)

- An audio quality pass beyond the safety floor:
    - full ADSR envelopes;
    - filters;
    - shared reverb and delay buses per orbit;
    - panning;
    - a sample player with `speed`, `begin`, and `end`.
- Offline rendering with A-kind tests.
- The piano roll and pattern visualizer, with provenance highlighting from events to source and from source to events.
  Dragging notes to edit them is deferred to 1.1.
- Web MIDI output.
- Player UI: mixer with heuristic labels, distinct mute states, safe-fix buttons, debounced live editing, the singleton
  audio coordinator, and editable mode.
- Accessibility built in, not retrofitted: native shadow-DOM controls, keyboard transport, and `aria-live` summaries of
  outputs and diagnostics.

**Exit:** a blind listening sanity check on corpus pieces shows no obvious timing or mixing defects. The player passes a
keyboard-only and screen-reader walkthrough.

### Phase 4: Musical depth (week 7–10)

Phase 4 is the release valve. If Phase 2 coverage needs more engineering bandwidth, `voicing()`, `chop`, SMF export, and
deep analysis move to 1.1, and 1.0 ships without them.

- Tonal L3: chord symbols, voicings, `arp`, and scale modes (T-01, T-02).
- Sample manipulation: `chop` and `slice` (T-03).
- `section` / `arrange` song structure (T-04).
- The deep analysis adapter, reporting key, harmony, density, range, and per-section summaries. This also gives LLM
  agents a richer way to "read" a composition.
- Standard MIDI File export, verified in common DAWs.
- A structured edit API for model edits, such as "replace the expr of output `lead`." Edits address IR nodes and are
  realized as source-range splices.

### Phase 5: Hardening and 1.0 (week 10–12)

- Freeze IR `tartlet/1` and ship migration scaffolding.
- Performance: query cost per window, provenance-off fast paths, and bundle size budgets (core < 40 kB gzip).
- A final accessibility audit of the player.
- The clean-room record is complete, and the pre-1.0 legal review of the compatibility surface is done.
- Documentation: an original language guide, a registry reference generated from the registry, an LLM-oriented prompt
  reference, and the published system prompt.

**Exit:** the 1.0 coverage targets are met, legal sign-off is obtained, and Markdown2 ships the blob type on by default.

### Beyond 1.0

- Any Phase 4 items deferred to 1.1.
- A formatter with idempotent, Prettier-style output.
- Two-way piano-roll editing, where dragging a note splices source.
- Notation projection, from the event graph to engraved notation, for pitched and quantized material.
- MIDI import as a "lift" to Tartlet source, with the result fully generated and editable.
- An MCP/agent tool surface: `check`, `render`, `analyze`, `patch`.
- A collaborative editing model built on stable node ids.
- Optional additional output backends (OSC, CSound-style), as out-of-tree adapters.

---

## 15. Risks and open questions

This specification was reviewed from six perspectives: technical architecture, security and sandboxing, licensing, LLM
authoring, user experience, and product feasibility. Each reviewer independently rated confidence in the design between
0.92 and 0.95, and overall consensus came to 0.91. There was near-unanimous agreement on the soundness of the pipeline
and the necessity of the clean-room Apache-2.0 strategy. The reviewers also agreed on the nature of the real threats:
bigint churn, binding blowups, acoustic clipping, and the missing default sample bank. The tensions they raised were
tactical, about scheduling and boundaries, and they resolved without changing the core vision. Those resolutions are
folded into this revision.

| Risk                                       | Impact                                                 | Mitigation                                                                                                                                                                                                                                                 |
|--------------------------------------------|--------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Compatibility-surface legal challenge      | Project-threatening                                    | Week 1 counsel sign-off on the protocol; taint policy covering Strudel, TidalCycles, and SuperDirt; logged AI provenance with cross-model regeneration for core modules; descriptive naming only; original tests, docs, and registry prose; pre-1.0 review |
| Semantic drift from the reference behavior | "Runs, but sounds wrong"                               | Explicit structure rules (§8.6); black-box oracle protocol; documented interpretations in each matrix row; semantic spot-checks on the corpus                                                                                                              |
| The "silent or toy audio" trap             | Programs check cleanly yet play silence or sound harsh | General kit with fallback mapping; event-sanity checks in the corpus; master limiter and default envelopes from the first WebAudio milestone                                                                                                               |
| The long tail of LLM-generated constructs  | Coverage plateaus below target                         | Week 1 corpus; frequency-driven backlog; compatibility alias table; degraded-mode playback keeps partial value; repair loop                                                                                                                                |
| Restricted lambdas being too restrictive   | Common idioms rejected                                 | Corpus-measure lambda shapes. Widen the sugar layer only for observed, still-closed forms.                                                                                                                                                                 |
| Rational arithmetic cost and GC pressure   | Scheduler jitter on dense patterns; DoS vector         | Small-integer fast path; denominator ceiling; lazy provenance; window caching; worker evaluation                                                                                                                                                           |
| Pathological or hostile input              | Frozen host page                                       | Static limits, query budgets, ingestion validation, and the worker kill switch, all in Phase 1                                                                                                                                                             |
| Erratic gain staging in generated code     | Clipping, harshness, hearing risk                      | Non-bypassable master limiter, clamps, and voice stealing (§11.5)                                                                                                                                                                                          |
| Schedule over-ambition                     | 1.0 slips, or ships half-finished                      | Source-range splicing instead of an un-parser; formatter deferred; Phase 4 as the release valve                                                                                                                                                            |
| Sample licensing                           | Shipping unusable assets                               | CC0 or synthesized general kit; a per-asset license manifest checked in CI                                                                                                                                                                                 |
| Audio quality versus mature engines        | "Toy" perception                                       | Safety floor early, quality pass in Phase 3, shared effects buses, and good defaults, so models need not specify synthesis details                                                                                                                         |

Two earlier open questions are now settled. Common community sample names map to a curated local kit by default (§11.2).
Source text, not the IR, is the canonical stored artifact for agent-edited documents (§9.7).

**Open questions:**

1. How far should the Tartlet extensions go before a "Tartlet-only" lint mode is needed to keep documents portable back
   to Strudel?
2. What is the right granularity for stable node ids when models rewrite whole outputs at once?
3. How wide should the syntactic sugar layer grow? Each new form costs nothing in safety, but every one is a construct
   that Strudel-portable documents might not share.

---

## 16. Success criteria

Tartlet succeeds when all of the following hold:

- A model asked for "a moody D-minor groove with a slow pad" writes ordinary Strudel. Markdown2 plays it the first time,
  ≥95% of the time.
- It sounds good the first time. Common sample names produce real sounds, and nothing clips.
- When it doesn't work, the drums keep playing. Trivial fixes apply themselves. The model receives a short, scoped
  repair note and fixes the problem on the next turn without touching the tracks that worked.
- The same document sounds identical on every machine, every day.
- No music blob can ever touch the host page, or freeze it.
- Clicking any note shows the exact character of source that produced it.
- Anyone can embed the whole thing under Apache-2.0 without inheriting anyone's licensing obligations.

Strudel supplies the pretrained language and the proven pattern-query abstraction. Tartlet keeps both and replaces
everything else. It removes arbitrary-code execution, ambient state, output coupling, fragile errors, and REPL-first
assumptions. The result is a portable musical document runtime whose main authors happen to be language models.

- **Legal:** IP counsel approves `CLEAN_ROOM.md`, including the expanded taint policy (Strudel, TidalCycles, SuperDirt),
  the oracle protocol, and the AI provenance protocol. **No Phase 1 code is written before this sign-off.** Maintainers
  record the sign-off in `CLEAN_ROOM.md`. Phase 0 work does not wait on it.