# Package reference

All packages are ESM, Apache-2.0, and published as TypeScript source (`exports: ./src/index.ts`).
This page lists the public surface. Read the source and its TSDoc for the details.

## @tartlet/time

Exact rational time.

- `Rational`, plus `rat(n, d?)`, `ZERO`, `ONE`, `isRational`.
- Arithmetic: `add`, `sub`, `mul`, `div`, `neg`, `floor`, `ceil`.
- Comparison: `cmp`, `eq`, `lt`, `lte`, `gt`, `gte`, `min`, `max`, `isZero`.
- Conversion: `toNumber`, `toString` (`"3/4"`), `parseDecimal(text)` (exact, or `null`), and
  `fromFloat(x, maxDen)`.
- Spans: `TimeSpan`, `span(b, e)`, `spanCycles`, `sect`, `spanEquals`, `mapSpan`.
- JSON: `RationalJson`, `toJson`, and `fromJson`, which is strict, rejects `d ≤ 0`, and is safe
  for untrusted input.

## @tartlet/mini

The mini-notation lexer and parser.

- `parseMini(src)` returns `{ ast: MiniAst; diagnostics: MiniDiagnostic[] }`. Ranges are
  relative to the string content.
- Types: `MiniAst`, `MiniAtom`, `MiniStep`, `MiniOp`.
- Constants: `MAX_STEP_MULTIPLIER = 1024` and `MAX_MINI_DEPTH = 32`.
- `lexMini` is exported for tooling.

## @tartlet/syntax

The expression-language lexer and parser.

- `parse(source)` returns a `SyntaxTree`: `{ source, statements, comments, diagnostics }`.
- `Expr` and `Stmt` are tagged unions keyed by `k`. Ranges are UTF-16 offsets.
- Block-bodied lambdas are desugared at parse time. `lambda.block` records the original form.
- `keywordId(name)` returns the rejection id for a JavaScript keyword.
- `LineIndex` maps UTF-16 indices to `{ line, col, byte }` (0-based, with `byte` counting
  UTF-8) and back. Its `lineText(line)` returns the text of a line.

## @tartlet/ir

IR types and the codec.

- Types:
  - `Program`, `Settings`, `Binding`, `Output`, `ResourceDecl`;
  - `PatternNode` and its variants, `Arg`, `FunctionValue`, `ConstValue`;
  - `Diagnostic`, `Fix`, `Provenance`, `SourceRange`, `Offset`;
  - `LimitsConfig` and `QueryBudget`.
- `DEFAULT_LIMITS`:
  - `maxSourceBytes`: 65 536;
  - `maxNestingDepth`: 32;
  - `maxStepMultiplier`: 1024;
  - `cpsRange`: [0.001, 100];
  - `maxEvalSteps`: 200 000;
  - `maxEventsPerWindow`: 2048;
  - `maxDenominator`: 10⁹.
- `encodeProgram(p)` returns `tartlet/1` JSON. `decodeProgram(text)` and
  `validateProgram(value)` validate untrusted input and throw `IngestError` with a JSON path.

## @tartlet/registry

The single source of truth for names.

- `ENTRIES` is the list of `RegistryEntry` objects. Each has an id, names (canonical first),
  optional compatibility aliases, form, params, returns, level, determinism, `since`, an
  original description and a `category`.
- The category drives lowering. It is one of `control`, `combinator`, `transform`, `tonal`,
  `directive`, `constant` or `signal`.
- `Registry`:
  - `lookup(name)` returns `{ entry, via: 'canonical' | 'alias' | 'compat', typed }`;
  - `get(id)` and `entries()`;
  - `suggest(name)` returns the unique nearest name within edit distance 2.
- `defaultRegistry`, `editDistance`, and `systemPrompt(reg?)`, which generates the model prompt
  snippet.
- Tonal helpers:
  - `noteToMidi(text)`: a bare letter means octave 3, so `c` = 48;
  - `SCALES`;
  - `parseScale("D:minor")`;
  - `degreeToMidi(degree, scale)`.

## @tartlet/random

- `hash64(...parts)` is a synchronous, length-prefixed 64-bit hash that returns 16 hex
  characters.
- `rootSeed(documentId, blobIndex, seed?)` derives the root seed.
- `draw(...parts)` returns a uniform number in [0, 1) using 52 bits of the hash.

## @tartlet/check

- `check(source, opts: CheckOptions)` returns `CheckResult { program, diagnostics, tree }`.
  The options are `documentId`, `blobIndex`, `seed?`, `limits?`, `registry?` and `catalog?`.
  Pass a catalog to get resource diagnostics.
- `repairPayload(result, { includeBenign? })` returns the compact repair text described in
  `idea.md` §10.3. `isBenign(d)` reports whether a diagnostic is hidden by default.
- `applyFix(source, fix)` splices a fix's edits into the source, last edit first.
- `locator(source)` returns a function from a UTF-16 index to an `Offset`. Pass it to
  `compile` for provenance.
- `HOST_NAMES` and `PROTO_NAMES` are the name sets that are always rejected.
- `SoundCatalog` and `SoundResolution` are the structural interfaces that the resources
  catalog satisfies.

## @tartlet/core

- `compile(program, opts?)` returns a `CompiledProgram`. The options are `locate`, `seed`,
  `documentId` and `blobIndex`.
  - `outputs` maps each output id to its pattern. `labels` maps each output id to its label.
  - `query(span, { provenance, limits? })` returns
    `{ events, byOutput, muted: Map<outputId, Diagnostic> }`.
- `ControlMap` is the merged control dictionary carried by each output event. `note` is
  `{ kind: 'midi', value }`. Other controls are plain numbers or strings.
- `sanity(compiled, cycles = 4)` returns a `SanityReport`: `totalEvents`, `eventsPerCycle`,
  `maxEventsPerCycle`, `silentOutputs`, `mutedOutputs`, `pitch` and `ok`.
- The pattern algebra listed in [architecture.md](architecture.md), plus `compileMini(ast,
leaf, salt?)`, `bjorklund(k, n)` and `euclid(p, k, n, rot)`.
- `BudgetExceeded` is the error thrown when a query exhausts its budget.

## @tartlet/resources

- `createCatalog({ fallback?, extra? })` returns a `SoundCatalog` with `resolve(name)` and
  `list()`. A resolution is `ok`, `fallback` (with `to`) or `missing`. With
  `fallback: false`, unknown names are always `missing`.
- `resolveSound(name)` uses the default catalog, with fallback on.
- `GENERAL_KIT` is the license manifest for the kit. `OSCILLATORS` lists the built-in
  oscillator names.
- Fallback first tries an exact alias table (`808bd → bd`, `rhodes → triangle`, …) and then
  ordered keyword heuristics.

## @tartlet/worker

- `EvalCore` holds a compiled program. Its `check(req)` re-checks and recompiles, and
  `query(span, provenance)` queries the current program.
- `Evaluator` is the host-neutral async interface, with `check`, `query` and `dispose`.
- `InlineEvaluator` evaluates on the same thread.
- `WorkerEvaluator(factory, timeouts?)` evaluates in a worker. A watchdog terminates and
  respawns the worker when a request times out. The defaults are 5 s for check and 2 s for
  query. After a respawn, the evaluator replays the last check. After repeated failures it
  gives up and reports itself unavailable.
- `startWorkerHost(port)` is the worker-side message loop. It ignores messages that are not
  valid requests (`isRequest`).
- Protocol types: `Request`, `Response`, `CheckRequest`, `Checked`, `QueryReply`.

## @tartlet/schedule

- `Scheduler<T>({ query, onEvent, onError?, now, cps, lookahead?, interval? })` has `start`,
  `stop`, `setCps`, `position()`, `running` and `mapping`.
- `cycleToTime(mapping, cycle)` converts a cycle position to seconds.

## @tartlet/webaudio

- `AudioEngine.create(ctx?)` must be called from a user gesture. The engine has
  `play(controls, time, duration)`, `stopAll()`, `ctx`, and `unknown`, the set of sound names
  it could not play.
- `SAFETY_WORKLET_SOURCE` is the static source of the master-bus processor.

## @tartlet/element

- `TartletPlayerElement` and `defineTartletPlayer()`. See [embedding.md](embedding.md).

## @tartlet/cli (private)

- `classify(source)`, `summarise(results)` and `extractCode(output)` make up the corpus
  harness.
- The `tartlet` binary is described in [getting-started.md](getting-started.md).

## @tartlet/conformance (private)

- `runSource(source, span, seed?)`, `runFixture(fixture)` and `canon(events)`. See
  [testing.md](testing.md).
