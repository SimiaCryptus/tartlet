# Extensions: genetic algorithms and genetic programming

**Status: proposal.** Nothing on this page is implemented. Each item that changes the
language, the registry or the IR needs a `TS-n` entry in `spec-issues.md`, registry entries
marked as extensions, and tests as described in [testing.md](testing.md). Tooling that stays
outside the core path (the CLI, the playground and test harnesses) needs tests but no TS
entry.

Tartlet has properties that suit evolutionary search unusually well:

- **Programs are small, closed and typed.** The grammar has no loops, no recursion and no host
  access. The registry says what kind of argument every parameter takes. A random edit
  therefore either checks cleanly or fails with a precise diagnostic. It never hangs the host
  or escapes the sandbox.
- **Evaluation is cheap and bounded.** `check`, `compile`, `query` and `sanity` run headless,
  without a DOM, under explicit budgets (`maxEvalSteps`, `maxEventsPerWindow`,
  `maxExpandedNodes`). A hostile genome is muted, not fatal.
- **Everything is deterministic.** Counter-based draws mean that an individual's events depend
  only on its source and seed, so fitness never changes when the same individual is evaluated
  again.
- **Node ids are stable under appending.** Appending a method never changes earlier ids or
  draws, so "add `.gain(.8)`" is a mutation whose effect is exactly what it says.
- **Time is exact.** Rhythmic distances between individuals can be computed on rationals
  instead of floats.

This page collects ideas in three groups:

1. [Evolution as a creative tool](#part-1-evolution-as-a-creative-tool): breeding patterns and
   sounds with a user in the loop.
2. [Evolution as an engineering tool](#part-2-evolution-as-an-engineering-tool): fuzzing,
   limit hunting, repair and corpus work.
3. [Evolution inside the language](#part-3-evolution-inside-the-language): a seeded,
   deterministic `mutate` transform that changes a pattern from cycle to cycle.

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints). Evolution
adds these:

- **Genomes are Tartlet.** An individual is Tartlet source, or a syntax tree that prints to
  Tartlet source. It is always passed through `check` before it is compiled. Nothing is
  evaluated as JavaScript, and no genome contains code in strings.
- **The core path does not learn about evolution.** Search loops, populations and fitness
  functions live in tooling: a private `@tartlet/evolve` package (allowed to import anything,
  like `cli` and `conformance`), the CLI and the playground. The only exception is the
  `mutate` transform in Part 3, which is an ordinary pure core transform.
- **Search randomness is seeded too.** The search itself uses
  `draw('evolve', runSeed, generation, index, operator, …)`, never `Math.random`, so a run is
  reproducible from its seed and settings. An evolved document sounds the same whether or not
  the run is reproduced: its sound depends only on its source and seed.
- **Search output is never a golden expectation.** Evolved programs may become test inputs
  (fuzz regressions, law sources, density stress cases), but their expected events are
  written by hand or checked through laws, exactly as
  [testing.md](testing.md#rules-for-expectations) requires.
- **Data tables are not evolved.** Formant tables, scale tables and kit recipes come from
  published data or original design. A search may _suggest_ a value; a human reviews it and
  records its source.
- **No health claims.** A fitness function may measure what a sound does (density, spectrum,
  pulse rate), never what it does to a listener. Searches must not reward pulsing between 3
  and 30 Hz, and evolved programs get the same advisories as hand-written ones (see
  [binaural.md](binaural.md#safety)).
- **The user owns the result.** Evolved documents are the user's work. Nothing about a run is
  sent anywhere.

## Genome representation

Three representations are possible:

| Representation | Pros                                               | Cons                                                  |
| -------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Source text    | Trivial to store and diff.                         | Most character edits produce syntax errors.           |
| Syntax tree    | Structural edits; comments and layout can survive. | Needs a printer back to source.                       |
| IR             | Already typed and constant-folded.                 | Lossy: aliases folded, no comments, no printer today. |

Recommendation: **evolve the syntax tree** (`@tartlet/syntax` `Expr` and `Stmt`) and add a
canonical printer, `print(tree)`, to tooling. The printer is useful on its own (formatting,
`applyFix` round-trips). Mini-notation strings are themselves evolved as `MiniAst`, with a
matching `printMini(ast)`. A property test checks that `parse(print(t))` gives back `t`, up to
ranges.

Typing is **strongly typed GP**. Every node has a kind taken from the registry: pattern,
constant (number, string, scale name, …) or function value. Operators only produce
replacements of the same kind, so most offspring check without errors and the population does
not fill with muted tracks.

### Mutation operators

Ordered roughly from small to large:

- **Atom edits** inside mini-notation: a note one scale step up or down, a sample name swapped
  for another in the same kit family (`hh` ↔ `oh`), a step toggled to `~`, `bd:2` → `bd:3`.
- **Mini structure edits:** wrap steps in `[ ]` or `< >`, add or change `*n`, `!n`, `@n` or
  `?p`, add or change a Euclidean `(k,n,r)`, split a step into two.
- **Constant perturbation:** nudge a constant within its documented registry range, on
  rationals (`0.5` → `5/8`). Out-of-range values are not generated, so `W-RANGE` stays rare.
- **Method append or removal:** append a registry method with type-correct arguments, or drop
  one. Appending is draw-stable for everything upstream.
- **Method swap:** replace `.fast(2)` with `.slow(2)`, `.often(f)` with `.rarely(f)`, using
  registry categories to keep swaps meaningful.
- **Function-value swap:** `rev` ↔ `fast(2)` ↔ a user function defined in the document.
- **Track operations:** duplicate a `$:` output and mutate the copy, delete a track, or mute
  one by wrapping it in `.mask("0")` (so it can be revived later without losing its genes).

### Crossover operators

- **Track crossover:** take whole outputs from two parents. This is the most musical form, and
  it never breaks anything, because outputs are independent.
- **Subtree crossover:** swap kind-compatible subtrees, such as two pattern arguments or two
  method suffixes.
- **Mini crossover:** splice step sequences of two mini-notation strings at a cycle fraction,
  keeping total weight so the rhythm grid lines up.
- **Binding crossover:** swap the bodies of `const` bindings with the same name. Bindings that
  later outputs depend on keep their kind.

### Bloat control

Genetic programming tends to grow programs without improving them. Tartlet already caps the
worst cases (`maxExpandedNodes`, `maxNestingDepth`, `maxStepMultiplier`). In addition:

- a source-length cap per individual (well below `maxSourceBytes`);
- parsimony pressure: ties in fitness go to the shorter program;
- periodic simplification: remove methods whose removal leaves events unchanged over a test
  window (for example `.fast(1)`, or `.gain(1)` when gain was already 1).

## Part 1: evolution as a creative tool

### 1.1 Interactive pattern breeding

The flagship feature: a **Breed** panel in the playground.

- The user starts from the current document, or from a small seed program such as
  `$: s("bd sd")`.
- The panel shows eight offspring. Each is a compact player with its own play button. Only one
  plays at a time, and switching is seamless because every child shares the transport.
- The user rates or picks favourites. Those become the parents of the next generation.
  "Interactive evolutionary computation" works well here, because fitness is taste and taste
  is hard to write down.
- A **mutation strength** slider moves from atom edits only (small) to structure, methods and
  crossover (large).
- **Lock** a track or a binding to keep it out of reach of the operators. Typical use: lock the
  kick, evolve the hats.
- Each child shows a diff against its parent, so the user learns the language while breeding.
- **Lineage** is stored as a list of `(source, seed, parents, operators)`. Undo and branching
  come for free.

Evaluation runs in the existing worker (`WorkerEvaluator`), so breeding never blocks the UI.
Children that do not check cleanly are discarded before they are shown, and the panel
generates replacements.

### 1.2 Automatic fitness helpers

Pure taste is slow: a user can only judge a few dozen sounds before tiring. Cheap automatic
filters cull the obviously bad before the user hears anything:

- **Clean check:** no errors, and preferably no warnings.
- **Sanity:** `sanity(p)` is ok, nothing is silent, and `eventsPerCycle` sits inside a band
  (for example 1–32 per track).
- **Pitch range:** notes inside a playable range, taken from the sanity report.
- **Novelty:** reject a child that sounds identical to its parent or a sibling. Identity is
  measured on events, not source: two different programs may play the same thing.
- **Constraints from the user:** "keep it in `C:minor`", "four on the floor", "no more than
  three tracks".

### 1.3 Target matching

Evolve towards a target instead of a taste:

- **Rhythm target.** The user taps a rhythm, or writes it as plain mini-notation. Fitness is
  the distance between onset sets over a few cycles, computed on rationals (for example the
  minimum-cost matching of onset times, or the symmetric difference on a fine grid). The
  search finds compact or interesting programs that play that rhythm, which teaches
  idiomatic Tartlet: a long literal string may come back as `s("bd(3,8), hh*4")`.
- **Melodic target.** The same for note sequences, with distance on MIDI values and onsets.
- **Compression as a goal.** Minimise program length subject to playing the target exactly.
  This is a genuine program-synthesis task, and it produces good examples for documentation.

Targets are user input. An evolved result is never compared against Tartlet's own output from
another program as an expectation.

### 1.4 Quality-diversity: MAP-Elites over patterns

Instead of one best program, keep the best program in each cell of a grid of behaviours:

- axes such as density (events per cycle), syncopation (share of onsets off the beat),
  pitch range, number of tracks, or rhythmic regularity;
- each cell holds the best individual by some secondary score, or the most recent pick.

The result is a **map of variations** the user can browse: "same groove, sparser" is one cell
to the left. MAP-Elites avoids converging on a single local favourite, which is the usual
failure of interactive evolution.

### 1.5 Sound and patch design

Evolve control sets instead of patterns, for the synthesis controls from TS-42 and the voice
controls from TS-43 to TS-47:

- the genome is a fixed list of controls (`timbre`, `fm`, `fmh`, `lpenv`, `attack`, `decay`,
  `vib`, `unison`, `detune`, …) with values in their documented ranges;
- the phenotype is a short phrase rendered with `OfflineAudioContext`, in the browser only;
- fitness is interactive, or measured by properties (spectral centroid, attack time, decay
  time, inharmonicity) against a description such as "bright, short, metallic";
- the result is written back as an ordinary chain of control methods, so it is just Tartlet.

Patch evolution is especially useful for the vocal and instrument tiers, where the parameter
space is large and the meaning of each control is not obvious to a newcomer.

### 1.6 Arrangement over time

Evolve a sequence of variations of one document and stitch them into a piece: generation 0 is
the intro, later generations are verses and fills. Once `arrange(...)` exists
([language_extensions.md](language_extensions.md#26-language-features-the-library-needs)),
the lineage can be emitted as a single document with sections.

## Part 2: evolution as an engineering tool

### 2.1 Coverage-guided fuzzing of the checker

Grammar-aware, coverage-guided fuzzing is a natural fit for a hand-written parser and checker
(ADR-001):

- the population is a set of source strings and syntax trees, seeded from the fixtures, the
  examples and the corpus;
- mutation uses the operators above, plus deliberately _ill-typed_ edits, token deletions,
  unbalanced brackets, odd Unicode, and rejected constructs (`import`, `new`, `__proto__`);
- fitness rewards new V8 coverage in `syntax`, `mini` and `check`, new diagnostic ids, and new
  `(diagnostic id, effect)` pairs.

Every individual is checked against properties that must always hold:

- `check` never throws and always returns a `Program`;
- every diagnostic range lies inside the source and on character boundaries;
- `repairPayload` never throws;
- applying a `safe` fix removes the diagnostic it targets and introduces no new error;
- `decodeProgram(encodeProgram(p))` round-trips;
- no rejected construct ever reaches the IR.

Failures are minimised (delta debugging over syntax trees, or `fast-check` shrinking) and
committed as X or R rows with hand-written expectations. The fuzzer runs locally and on a
schedule, not on every pull request, because its runtime is open-ended.

### 2.2 Fuzzing the codec

The same loop over `tartlet/1` JSON instead of source, targeting `decodeProgram`: deeply
nested shapes, huge rationals near the 10⁹ denominator ceiling, forbidden keys in unusual
positions, and dangling or cyclic binding references. This extends Z-10 from a fixed list of
attacks to a search.

### 2.3 Hunting for budget and limit gaps

Use evolution adversarially: **maximise cost per byte of source.**

- Fitness is the step count of `query` over one cycle, the expanded node count, or the wall
  time of `check`, divided by source length.
- The search looks for programs that stay _under_ every limit yet are as expensive as
  possible: nested `fast` and `ply`, polymeters with coprime step counts, patterned factors
  that make `bindWindow` split many times, function definitions that expand close to
  `maxExpandedNodes`.
- Any program that runs noticeably longer than the watchdog allows (5 s for check, 2 s for
  query) without hitting a budget is a bug: a limit is missing or measured in the wrong
  place.
- The worst survivors become benchmark inputs and density regression tests.

The same search over the scheduler and audio engine (heaviest voice mix within the polyphony
budget) checks that cost budgeting (TS-42) actually bounds CPU use.

### 2.4 Law-checking sources

`laws.test.ts` checks span splitting and containment for a hand-picked `SOURCES` list. A
search can propose new sources that maximise the number of distinct combinators and edge
cases exercised (zero-width parts, events crossing cycle boundaries, nested alternation,
patterned arguments), then a human adds the best ones to the list. The laws are the
expectations, so no golden output is involved.

### 2.5 Repair search

Given a broken program from the corpus, search for the smallest edit that makes it check
cleanly:

- edits are drawn from the operators above, guided by the diagnostics (an `E-REG-UNKNOWN` at
  a known range suggests a method swap at that range);
- fitness is (no errors, fewest warnings, smallest edit distance, events still present).

Uses:

- **New fixes.** Repairs that recur across many corpus programs suggest new machine-applicable
  `Fix` suggestions or new compatibility aliases, for example a common misspelling. A human
  reviews each one before it enters the registry, with an original description.
- **Repair payload tuning.** Compare the evolved minimal repair with what a model did after
  reading `repairPayload`. Large gaps show where the payload is unclear.

### 2.6 Prompt and payload evolution

The system prompt snippet (`systemPrompt()`) and the repair payload wording affect how often
model output lands in the **clean** bucket. Both can be evolved:

- the genome is a set of choices: which entries to list, in what order, how many examples,
  which phrasing for each rule;
- fitness is the clean rate from `classify` over the corpus prompts, from
  `node corpus/collect.mjs` with the developer's own adapters;
- a held-out prompt set guards against overfitting, and the budget of model calls is fixed in
  advance.

This costs real money and depends on external models, so it is a manual, occasional
experiment, never part of CI. Keys stay in `corpus/adapters.local.mjs` as today. The prompt
stays generated from the registry: the search tunes the generator's options, not hand-edited
text.

### 2.7 Tuning heuristics

Smaller searches over numeric settings, always reviewed by a human:

- the ordered keyword heuristics in `@tartlet/resources` fallback, scored against a labelled
  list of sound names;
- the edit-distance threshold and tie-breaking in `suggest(name)`, scored on the corpus misses;
- scheduler lookahead and interval, scored on simulated jitter and CPU.

## Part 3: evolution inside the language

A pattern that _evolves while it plays_ is musically interesting and fits Tartlet's
determinism well.

### 3.1 `.mutate(rate, period?)`

```js
// proposed syntax — not accepted today
$: n('0 2 4 7').scale('C:minor').mutate(0.2, 16);
$: s('bd ~ sd ~').mutate(0.1).seed('drift');
```

- Cycle 0 plays the receiver unchanged. Each later cycle is generation `g`, derived from
  generation `g − 1` by applying point mutations with probability `rate` per event.
- Mutations are value-level and closed: move a note by one scale degree, swap a sample within
  its kit family, drop or restore an event, or shift an onset by one step on the receiver's
  own grid. They never invent controls or structure that the receiver does not have.
- Draws are keyed by (scope, node id, generation, `whole.begin`, mutation slot), so the result
  is a pure function of the document, seed and cycle. Querying cycle 40 directly gives the
  same events as playing up to it.
- **`period` bounds the cost.** Generation `g` depends on all earlier generations, so querying
  cycle `c` costs `O(c mod period)` generation steps. The lineage restarts from the receiver
  every `period` cycles (default 8, constant-only, capped at 64, `W-RANGE` above). Every step
  calls `tick`, so an expensive receiver still ends in `E-LIMIT-DENSITY` rather than a hang.
- Span splitting holds, because each generation is a deterministic function of whole cycles.
  `mutate` joins `SOURCES` in `laws.test.ts`.

A cheaper variant, `.drift(rate)`, applies independent mutations per cycle without memory
(every cycle is one mutation away from the original). It costs `O(1)` per cycle and needs no
`period`.

### 3.2 `.breed(other, rate)`

Per cycle, each event of the receiver is replaced by the time-aligned event of `other` with a
seeded probability that rises with `rate`. It is crossover as a transform: a slow morph
between two patterns that is still deterministic. Structure comes from the receiver
(`appLeft`), as for other patterned arguments.

### 3.3 Cellular rhythms

Not strictly genetic, but closely related: one-dimensional cellular automata as rhythm
generators, for example `ca(30, 16)` for rule 30 on a ring of 16 steps, one generation per
cycle. The same `period` rule bounds cost. Like `run(n)`, it is a constructor that produces a
boolean pattern for `struct` and `mask`.

### 3.4 Language impact

- `mutate`, `drift`, `breed` and `ca` are registry entries marked as Tartlet extensions, with
  original descriptions. No new syntax is needed.
- They need TS entries for: the mutation alphabet per value kind, how scale-degree mutation
  finds the scale (only after `.scale`, or with an explicit argument), and how `period` aligns
  with `.seed(x)` and `slow`.
- They count as random transforms and get D rows.

## Diagnostics (proposed)

- `W-RANGE`: `mutate` or `ca` with a `period` above 64, or a `rate` outside [0, 1].
- `I-EVOLVE-SOURCE`: optional, benign. A document carries a lineage comment written by the
  Breed panel. Hidden from the repair payload; it exists so editors can offer "show lineage".
- Existing ids reused: `E-ARG-TYPE` for a patterned `period`, `E-CAP-PITCHED` for scale-degree
  mutation on a sample-only receiver.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Operators.** A `fast-check` property generates syntax trees from the examples and fixtures,
  applies every type-correct mutation and crossover operator, and checks that the printed
  offspring parses and that kind errors (`E-ARG-TYPE`, `E-ARG-FUNCTION`) never appear. The
  printer gets a round-trip property.
- **Search determinism.** The same run seed and settings give the same populations, generation
  by generation. A different run seed gives different populations.
- **Fuzz regressions.** Every minimised fuzz failure becomes an X or R row with a hand-written
  expectation.
- **Language features.** `mutate`, `drift`, `breed` and `ca` get D rows (stable for a seed,
  different across seeds, unchanged when a method is appended), law checks through `SOURCES`,
  and hand-written goldens for small cases reasoned out by hand, for example rule 30 from a
  single seed cell, or `mutate(0)` equal to the receiver.
- **Expectations by reasoning.** Nothing a search produces is used as an expected value, per
  [testing.md](testing.md#rules-for-expectations).

## Suggested order

1. The syntax-tree printer and `printMini`, with round-trip tests. Useful on their own.
2. Coverage-guided fuzzing of the checker and codec (Part 2.1, 2.2). High value, no user-facing
   risk.
3. Budget hunting (Part 2.3), feeding benchmarks and density tests.
4. `@tartlet/evolve` with typed operators, and a CLI command
   `evolve <file> --target <file> [--seed s] [--generations n]` for target matching.
5. The Breed panel in the playground, with locking, diffs and lineage.
6. `drift` and `ca`, then `mutate` with `period`, then `breed`.
7. MAP-Elites browsing and patch evolution with `OfflineAudioContext` features.
8. Repair search and prompt evolution over the corpus, as manual experiments.

## Open questions

- Should the Breed panel write lineage into the document as a comment, or keep it in local
  storage only?
- Is track crossover enough for most users, or is subtree crossover worth its complexity?
- Should `mutate` see the receiver's scale, or take its own mutation alphabet as an argument?
- What is the right default and cap for `period`, and should it scale with `maxEvalSteps`?
- How should the playground highlight events produced by mutation, so users can see what
  changed from the receiver?
- Should evolved repairs ever be proposed to a model automatically, or only used to improve
  fixes and payloads offline?
- Should coverage-guided fuzzing run in CI on a fixed, short budget, or only on a schedule?
