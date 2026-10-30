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
- `Expr` and `Stmt` are tagged unions keyed by `k`. Ranges are UTF-16 offsets. Lambdas carry
  all their parameters in `params`, each with an optional default (TS-48).
- Block-bodied lambdas are desugared at parse time. `lambda.block` records the original form.
- `keywordId(name)` returns the rejection id for a JavaScript keyword.
- `LineIndex` maps UTF-16 indices to `{ line, col, byte }` (0-based, with `byte` counting
  UTF-8) and back. Its `lineText(line)` returns the text of a line.

## @tartlet/ir

IR types, the codec and the sample path grammar.

- Types:
  - `Program`, `Settings`, `Binding`, `Output`, `ResourceDecl`, `Advisory`;
  - `PatternNode` and its variants, `Arg`, `FunctionValue`, `ConstValue`;
  - `Diagnostic`, `Fix`, `Provenance`, `SourceRange`, `Offset`;
  - `LimitsConfig` and `QueryBudget`.
- `ResourceDecl.kind` is `samples` (a remote bank, never fetched), `wav` (one file bound to
  `name`) or `bank` (a manifest in the host's collection). `spec` holds the path (TS-90).
- `Program.advisories` lists, per output, whether it needs headphones and its constant pulse
  range (TS-61).
- `DEFAULT_LIMITS`:
  - `maxSourceBytes`: 65 536;
  - `maxNestingDepth`: 32;
  - `maxStepMultiplier`: 1024;
  - `cpsRange`: [0.001, 100];
  - `maxEvalSteps`: 200 000;
  - `maxEventsPerWindow`: 2048;
  - `maxDenominator`: 10⁹;
  - `maxExpandedNodes`: 10 000 (function expansion, TS-52).
- `encodeProgram(p)` returns `tartlet/1` JSON. `decodeProgram(text)` and
  `validateProgram(value)` validate untrusted input and throw `IngestError` with a JSON path.
- Path helpers shared by the checker, the codec and hosts: `isSamplePath`, `isWavPath`,
  `isBankPath`, `isSoundName` and `MAX_SAMPLE_PATH`.

## @tartlet/registry

The single source of truth for names.

- `ENTRIES` is the list of `RegistryEntry` objects. Each has an id, names (canonical first),
  optional compatibility aliases, form, params, returns, level, determinism, `since`, an
  original description and a `category`.
- The category drives lowering. It is one of `control`, `combinator`, `transform`, `tonal`,
  `directive`, `constant` or `signal`. Level `L3` marks library entries and Tartlet extensions.
- `Registry`:
  - `lookup(name)` returns `{ entry, via: 'canonical' | 'alias' | 'compat', typed }`;
  - `get(id)` and `entries()`;
  - `suggest(name)` returns the unique nearest name within edit distance 2.
- `defaultRegistry`, `editDistance`, and `systemPrompt(reg?)`, which generates the model prompt
  snippet from the non-L3 entries. A test keeps it under 260 words.
- Tonal helpers: `noteToMidi(text)` (a bare letter means octave 3, so `c` = 48), `SCALES`,
  `parseScale("D:minor")` and `degreeToMidi(degree, scale)`.
- The singing alphabet (TS-45): `VOWELS`, `CONSONANTS`, `VOICE_TYPES`, `VOCAL_SOUNDS`,
  `MAX_SYLLABLE_LENGTH`, `parseSyllable`, `suggestSyllable` and `normalizeVowel`.
- Sound kinds, mirrored from `@tartlet/resources` and checked by a conformance test:
  `OSCILLATOR_SOUNDS`, `NOISE_SOUNDS`, `DRUM_SOUNDS`, `AMBIENCE_SOUNDS`, `FOLEY_SOUNDS`,
  `CREATURE_SOUNDS`, `TEXTURE_SOUNDS` and `SPACE_NAMES`.
- Closed value sets for enum controls: `SPECTRAL_MODES` (its order is the kernel's mode index),
  `FIR_DESIGNS`, `FIR_LENGTHS`, `BODY_NAMES`, `CAB_NAMES`, `CURVE_NAMES` and `ENVCURVE_NAMES`.

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
  `{ kind: 'midi', value }`. Other controls are plain numbers or strings. Core also adds
  per-event seeds for the audio adapter: `vseed`, `iseed`, `tseed`, `dseed` and `rseed` (see
  [architecture.md](architecture.md#per-event-seeds)).
- `sanity(compiled, cycles = 4)` returns a `SanityReport`: `totalEvents`, `eventsPerCycle`,
  `maxEventsPerCycle`, `silentOutputs`, `mutedOutputs`, `pitch` and `ok`.
- The pattern algebra listed in [architecture.md](architecture.md), plus the library
  primitives `within`, `chunk`, `whenCycle`, `lastOf`, `brak`, `someCyclesBy`, `zoom`,
  `linger`, `segment`, `pressBy`, `swingBy`, `shuffle`, `sampleOnset` and `filterOnsets`.
- `compileMini(ast, leaf, salt?)`, `bjorklund(k, n)` and `euclid(p, k, n, rot)`.
- `BudgetExceeded` is the error thrown when a query exhausts its budget.

## @tartlet/resources

- `createCatalog({ fallback?, extra? })` returns a `SoundCatalog` with `resolve(name)` and
  `list()`. A resolution is `ok`, `fallback` (with `to`) or `missing`. With
  `fallback: false`, unknown names are always `missing`.
- `resolveSound(name)` uses the default catalog, with fallback on.
- `GENERAL_KIT` is the license manifest for the kit. Each `KitEntry` has a kind: `drum`,
  `oscillator`, `noise`, `voice`, `ambience`, `foley` or `creature`.
- Kit lists: `DRUMS`, `OSCILLATORS`, `NOISES`, `VOICES`, `AMBIENCES`, `FOLEY` and `CREATURES`.
- Fallback first tries an exact alias table (`808bd → bd`, `rhodes → triangle`, …) and then
  ordered keyword heuristics.

## @tartlet/samples

WAV files, the sample standard, manifests, interpreters and host loading (TS-90 to TS-94).
Everything here is pure or takes a host-supplied byte fetcher; the core path never imports it.

- WAV: `parseWav(bytes)` (PCM 16 and 24-bit, float 32-bit, mono or stereo, at most
  `MAX_WAV_BYTES`), `encodeWav(data, format?)`, `WavError`, `WavData` and `WavFormat`.
- The standard: `measure`, `standardIssues(wav, kind)`, `normalize(wav)`, `PEAK_TARGET`,
  `SILENCE` and `MAX_SAMPLE_SECONDS`.
- Manifests: `parseManifest`, `parseManifestText`, `toManifestJson`, `ManifestError` and
  `MANIFEST_VERSION`.
- Interpreters: `planImpulse(count, { n, speed })`, `planNote(zones, { note, velocity, speed,
rseed })`, `speedRate`, `MAX_TRANSPOSE` and the General MIDI map `GM_DRUMS`.
- Host loading: `loadSamples(resources, fetchBytes, opts?)` returns
  `{ library, diagnostics }` and never throws for bad files. `SampleLibrary` holds decoded
  entries and the names still loading. `sampleResources` filters `wav` and `bank`
  declarations. `FetchBytes` and `HostDiagnostic` are the host-facing types.
- Helpers: `sha256Hex`, `dirOf` and `joinPath`.

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
  `stop`, `setCps`, `position()`, `running` and `mapping`. Onsets in a window are dispatched in
  time order, which mono lines rely on (TS-42).
- `cycleToTime(mapping, cycle)` converts a cycle position to seconds.

## @tartlet/webaudio

- `AudioEngine.create(ctx?)` must be called from a user gesture. It loads the safety, spectral
  and gate worklets from `blob:` URLs; the last two are optional.
- The engine has:
  - `play(controls, time, duration)` and `stopAll()`;
  - `ctx`, and `unknown`, the set of sound names it could not play;
  - `setLibrary(library)`, which installs host samples (they win over kit sounds);
  - `skippedSamples`, the number of events skipped while their sample was loading;
  - `shortenedLeads`, the number of voices whose latency compensation was cut short (TS-85).
- Pure DSP helpers from `dsp.ts` (envelopes, waves, formants, noise, curves, FIR and body
  designs, the STFT kernel, the gate kernel), tested in Node.
- Static worklet sources: `SAFETY_WORKLET_SOURCE`, `SPECTRAL_WORKLET_SOURCE` and
  `GATE_WORKLET_SOURCE`.

## @tartlet/element

- `TartletPlayerElement` and `defineTartletPlayer()`. See [embedding.md](embedding.md).

## @tartlet/cli (private)

- `classify(source)`, `summarise(results)` and `extractCode(output)` make up the corpus
  harness.
- The sample tools: `importSamples(dir, opts)`, `verifyCollection(dir)`,
  `listCollection(dir)`, `collectionBanks(dir)` and `parseStem(stem)`.
- The `tartlet` binary is described in [getting-started.md](getting-started.md).

## @tartlet/conformance (private)

- `runSource(source, span, seed?)`, `runFixture(fixture)` and `canon(events)`. See
  [testing.md](testing.md).
