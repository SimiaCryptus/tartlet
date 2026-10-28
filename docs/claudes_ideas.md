# Extensions: Claude's ideas

**Status: proposal.** Nothing on this page is implemented. These ideas were collected while
reading the rest of the developer documentation. They focus on gaps that the other extension
pages leave open: seeing what a program plays, getting music out of Tartlet, editing during
performance, and making repair loops measurable. Each item that changes the language, the
registry, the IR or `Program` needs a `TS-n` entry in `spec-issues.md`, registry entries
marked as extensions where relevant, and tests as described in [testing.md](testing.md).
Tooling that stays outside the core path (the CLI, the playground and test harnesses) needs
tests but no TS entry.

The ideas are grouped in five parts:

1. [Seeing the music](#part-1-seeing-the-music): text grids, plain-language explanations and
   event diffs.
2. [Getting music out](#part-2-getting-music-out): MIDI export and offline rendering.
3. [Live editing](#part-3-live-editing): quantised hot-swap, incremental re-checking and seed
   variations.
4. [Catching problems earlier](#part-4-catching-problems-earlier): static density bounds and
   unused bindings.
5. [Testing without goldens](#part-5-testing-without-goldens): metamorphic identities and
   repair-locality checks.

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints): the core
path stays pure, controls are data, randomness is decided in core, musical time is rational,
the safety chain cannot be bypassed and nothing is fetched. These ideas add:

- **Derived views are pure functions of events or IR.** A grid, an explanation, a diff or a
  MIDI file is computed from `Program` or from `query` results, never from audio. The same
  document and seed always produce the same bytes.
- **Tooling lives outside the core path.** New packages such as `@tartlet/export` are
  private or tooling-level, may import `core`, `time` and `ir`, and are not imported by any
  core package. The dependency graph in [architecture.md](architecture.md#dependency-graph)
  gains leaves, never new edges between existing packages.
- **Views never become expectations.** A grid or a diff of Tartlet's own output is a
  debugging aid. It is never pasted into a test as an expected value, as
  [testing.md](testing.md#rules-for-expectations) requires.
- **Nothing leaves the machine.** Exports are created locally (a file in the CLI, a `blob:`
  download in the playground). No upload, no telemetry.
- **Quantisation is explicit.** Wherever rational time must become a coarser grid (text
  columns, MIDI ticks), the tool says how much it rounded and where. Silent rounding is a
  bug.

## Part 1: seeing the music

### 1.1 Text event grids

A compact, monospaced picture of what each output plays:

```
$ tartlet grid examples/basic.tt --cycles 1
cycle 0          |1 . . . 2 . . . 3 . . . 4 . . . |
$1    s          |bd. . . bd. . . bd. . . bd. . . |
hats  s          |hh. hh. hh. hh. hh. hh. hh. hh. |
bass  note       |c2. . . . . eb2 . g2. . . . . . |
```

- The column width is the least common multiple of the onset denominators within each
  cycle, capped at 64 columns per cycle. Above the cap, onsets are placed in the nearest
  column and the header reports `rounded: 3 onsets`.
- Each cell shows the onset's main value (`s`, `note` or `n`, in that order). `.` is a
  sustained or empty column. Fragments without an onset are not drawn.
- Muted outputs are listed with their diagnostic id instead of a row.

Uses:

- **The repair payload.** An optional `--grid` flag on `check`, and an `includeGrid` option
  on `repairPayload`, append a one-cycle grid for each affected track. Models often cannot
  tell what a pattern plays from its source. A grid makes "the hats are too dense" or "the
  bass misses the downbeat" visible in text. This is the most valuable item on this page for
  the corpus work.
- **Accessibility.** The playground can offer the grid as a text alternative to its visual
  highlighting. A screen reader reads rows, not animation.
- **Documentation.** Examples in [language.md](language.md) can show their grid next to the
  source, written by hand from the semantics, not captured.

### 1.2 Plain-language explanations

`tartlet explain <file>` describes each output in sentences generated from the IR and the
registry descriptions:

```
$1: plays "bd" four times per cycle. Every 4th cycle, the pattern is played twice as fast.
hats: plays "hh" eight times per cycle at gain 0.5, with 30% of hits dropped at random
      (seeded).
```

- Generation is template-based over `PatternNode` kinds. It uses only the original registry
  descriptions, so it inherits their clean-room status.
- It never claims more than the IR shows. Patterned arguments are described as "varies by
  cycle: 1, 2" up to a small number of values, then "patterned".
- The playground shows the explanation on hover over an output label, and the element can
  expose it as an accessible description.

### 1.3 Event diffs

`tartlet diff <a> <b> [--cycles n] [--seed s]` queries both documents over the same span and
compares events per output label, through the same canonical form as `canon(events)`:

```
hats: 2 events removed, 0 added
  - [3/8, 1/2) s=hh gain=0.5
  - [7/8, 1)   s=hh gain=0.5
bass: unchanged
$1:   unchanged
```

- Outputs are matched by label. Anonymous outputs are matched by slot, with a warning when
  the number of anonymous outputs differs.
- The diff is on events, not source. Two different programs that play the same thing are
  reported as unchanged.
- It is also a library function (`diffEvents`) used by Part 5.2.

## Part 2: getting music out

### 2.1 MIDI export

Tartlet's exact time and deterministic events make it a good MIDI source. `tartlet midi
<file> --cycles n -o out.mid` writes a Standard MIDI File, type 1, one track per output.

- **Time.** Ticks per quarter note (PPQ) default to 960. A cycle is mapped to one bar of
  4/4 by default (`--beats-per-cycle` changes it), and the tempo meta event comes from
  `program.settings` cps. An onset at cycle `c` lands at tick `c · beats · PPQ`, computed on
  rationals. Onsets that are not exact multiples of a tick are rounded to the nearest tick,
  and the tool reports the count and the largest error in ticks.
- **Pitch.** `note` (`{ kind: 'midi', value }`) maps directly. `n` after `.scale` is
  already a note. Events with neither, and a kit sound name, map to General MIDI percussion
  on channel 10: `bd` 36, `rim` 37, `sd` 38, `cp` 39, `hh` 42, `lt` 45, `oh` 46, `mt` 47,
  `cr` 49, `ht` 50, `rd` 51. Other events are skipped and counted.
- **Velocity.** `velocity × gain`, clamped to 1–127. A missing velocity counts as 1.
- **Length.** Note-off at `whole.end`, scaled by `legato` when present. Events with no
  whole (signals) are never exported.
- **Controls.** `pan` maps to CC 10 at each onset. Other controls are dropped and listed
  once in the report, so users know what MIDI could not carry.
- **Determinism.** The encoder is a pure function from events to bytes and runs in Node.
  Identical inputs give identical files.

The encoder lives in a tooling package, `@tartlet/export`, imported by the CLI and the
playground. The playground offers "Export MIDI" as a local `blob:` download.

### 2.2 Offline audio rendering

"Export WAV" in the playground renders a number of cycles with `OfflineAudioContext` through
the same engine and safety chain as live playback.

- The engine is created against the offline context. The scheduler is driven synchronously
  over the whole span instead of by a timer.
- The WAV encoder (16- or 24-bit PCM, interleaved) is a pure helper next to `dsp.ts` and is
  unit-tested in Node.
- Rendering respects the polyphony cost budget, so the file sounds like playback.
- Documents with pulsing controls show the same advisory before export as before playback
  (see [binaural.md](binaural.md#safety)).
- The CLI does not render audio, because the core path has no `AudioContext`. It can export
  MIDI.

## Part 3: live editing

### 3.1 Quantised hot-swap

Today a re-check while playing takes effect at the next query window. During performance,
users usually want changes to land on a musical boundary.

- A new element attribute, `swap`, accepts `now` (the current behaviour, the default),
  `cycle`, or `cycles:n` (the next multiple of `n` cycles).
- The scheduler keeps a pending program. When a query window `[cursor, horizon)` contains
  the boundary `b`, it is split into `[cursor, b)` on the old program and `[b, horizon)` on
  the new one. Span splitting makes this exact.
- The boundary is rational and computed from `position()`. A tempo change in the new
  program re-anchors at `b`, not at the cursor.
- The element fires a `swappending` event with `{ at }` when a swap is scheduled, and the
  status region announces it. A further edit before `b` replaces the pending program.
- Stopping discards the pending program.

This needs a TS entry, mainly to settle how per-output continuity (`mono`, `glide`) behaves
across a swap. The open question in [instruments.md](instruments.md#open-questions) about
recompiling while playing applies.

### 3.2 Incremental re-checking

Editing one track should not re-lower the whole document.

- `EvalCore` caches each statement's lowered result, keyed by a hash of its text, the hashes
  of the bindings it references, the settings that affect lowering, and the registry
  version.
- Node ids are already structural and append-stable, so a cached output's ids are identical
  to a fresh lowering's. Compiled patterns for unchanged outputs are reused.
- Diagnostics for unchanged statements are reused. Document-level diagnostics
  (`E-NAME-DUP`, `E-PROGRAM-EMPTY`, `I-TEMPO-OVERRIDE`) are always recomputed.
- **Correctness rule:** an incremental check must equal a full check. A property test edits
  random statements of fixture documents and compares `encodeProgram` output and
  diagnostics from both paths.

### 3.3 Seed variations

`rootSeed(documentId, blobIndex, seed)` makes variations free. The playground can show a
"Variations" strip: the same document with seeds `v1` to `v8`, each with its own play
button, sharing the transport. Picking one writes the chosen seed into the element's `seed`
attribute, or wraps the output in `.seed("v3")` when only one track should change. Documents
without random draws hide the strip; the checker already knows whether any seeded node
exists.

## Part 4: catching problems earlier

### 4.1 Static density bounds

`E-LIMIT-DENSITY` is reported at query time, after the user presses play. Many cases can be
predicted from the IR alone.

- An abstract interpretation over `PatternNode` computes an upper bound on onsets per cycle:
  a mini-notation string from its step counts, multipliers and replications; `stack` sums
  its layers; constant `fast(f)` multiplies by `ceil(f)`; `ply(n)` multiplies by `n`;
  patterned arguments take their largest constant value; `degradeBy`, `mask` and `struct`
  are bounded by their receiver or argument.
- When a node's bound is unknown (for example a signal used as a factor), the analysis stops
  for that output and reports nothing. It never guesses.
- If the bound exceeds `maxEventsPerWindow` for one cycle, the checker reports
  `W-LIMIT-LIKELY` with effect `none`. The track still plays and may still be muted at query
  time.
- The same bound feeds `sanity` and the proposed cost budgeting
  ([instruments.md](instruments.md#cost-budgeting)).

### 4.2 Unused bindings

A `const` binding that no output reaches is dead code, and it confuses models that edit
it expecting a change. The checker reports `I-NAME-UNUSED` at the binding. It is benign and
hidden from the repair payload, but editors can grey the line out. Bindings referenced only
by other unused bindings are reported too.

## Part 5: testing without goldens

### 5.1 Metamorphic identities

Some expectations need no hand-written events at all, because they relate two programs to
each other. A `fast-check` property generates sources from `SOURCES` and spans, and checks
that both sides give the same canonical events:

| Left                  | Right           | Notes                                 |
| --------------------- | --------------- | ------------------------------------- |
| `x.fast(a).slow(a)`   | `x`             | `a` a positive constant rational.     |
| `x.fast(a).fast(b)`   | `x.fast(a * b)` | Constant factors.                     |
| `x.late(a).early(a)`  | `x`             |                                       |
| `x.rev().rev()`       | `x`             | Compare onsets; fragments may differ. |
| `stack(x, silence)`   | `x`             |                                       |
| `x.every(1, f)`       | `f(x)`          | For each registered transform `f`.    |
| `x.degradeBy(0)`      | `x`             |                                       |
| `x.sometimesBy(0, f)` | `x`             |                                       |
| `x.sometimesBy(1, f)` | `f(x)`          | Deterministic `f` only.               |
| `x.add(0)`            | `x`             | Numeric and note receivers.           |
| `x.within(0, 1, f)`   | `f(x)`          | Deterministic `f` only.               |
| `x.seed("a")` twice   | `x.seed("a")`   | Inner seed wins (TS-28).              |

- Each identity is an expectation derived from the semantics in `idea.md`, so it satisfies
  the clean-room rules. If an identity fails, the fix is either in the code or a new `TS-n`
  explaining why the identity does not hold.
- Identities that hold only for onsets, or only within whole cycles, say so in the table and
  in the test name.
- New transforms add their identities here when they join the library.

### 5.2 Repair locality

The repair payload says "Rewrite ONLY the track on line 2; keep all other tracks
unchanged." Nothing checks whether a model obeyed.

- After a corpus repair round, `diffEvents` (Part 1.3) compares every output that was not
  muted before the repair. Any change is a locality violation.
- `classify` gains a field, `repairLocal: boolean`, and `summarise` reports the violation
  rate per model next to the clean rate.
- A high violation rate is a signal that the payload wording needs work, which pairs with
  prompt and payload evolution in [genetics.md](genetics.md#26-prompt-and-payload-evolution).

## Diagnostics (proposed)

- `W-LIMIT-LIKELY`: a static bound predicts that an output will exceed its event budget.
  Effect `none`; the track still plays.
- `I-NAME-UNUSED`: a binding is never referenced by any output. Benign and hidden from the
  repair payload.

Export rounding, skipped events and dropped controls are reported by the export tool, not by
the checker, because they depend on export settings rather than on the document.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Grids and explanations.** Hand-written expectations for small programs reasoned out from
  the semantics: `s("bd*4")` over one cycle is four columns with `bd` in each. The column
  cap and rounding report get X-style tests.
- **MIDI.** The encoder gets byte-level tests on tiny event lists written by hand (one note,
  one drum hit, a tempo change), checked against the published SMF layout. A round-trip
  property parses the bytes back with a minimal test-only reader and compares note numbers,
  velocities and tick positions within the reported rounding.
- **WAV.** The encoder is tested in Node on hand-written sample arrays. The offline render
  joins the Playwright suite with the usual properties: peak below the limiter ceiling, no
  NaN, identical seeds give identical buffers on one engine.
- **Hot-swap.** Scheduler tests with a fake clock check that no event of the new program
  plays before the boundary and that no event of the old program plays after it.
- **Incremental checks.** The equivalence property in Part 3.2.
- **Density bounds.** A property checks that the static bound is never below the measured
  maximum events per cycle over the `SOURCES` list. A bound that is too low is a bug; one
  that is too high is only imprecise.
- **Metamorphic identities.** Part 5.1 itself, with an explicit timeout like
  `laws.test.ts`.

## Suggested order

1. Text grids in the CLI, then `includeGrid` in the repair payload. Small, pure and directly
   useful for the corpus.
2. Event diffs and the repair-locality metric.
3. Metamorphic identities. They need no new features and harden the existing algebra.
4. MIDI export in the CLI, then in the playground.
5. `I-NAME-UNUSED` and static density bounds with `W-LIMIT-LIKELY`.
6. Quantised hot-swap, with its TS entry.
7. Incremental re-checking, once profiling shows full checks are noticeable on large
   documents.
8. Seed variations, offline WAV rendering and plain-language explanations.

## Open questions

- Should the grid be part of the default repair payload, or only offered when a track is
  muted for density or sounds wrong by `sanity`? It costs tokens.
- Should one cycle map to one bar in MIDI export, or should `setcpm` imply a beat count?
- Should quantised hot-swap be the playground default, or stay opt-in to keep the element's
  current behaviour?
- Is a static density bound worth a warning when it is often loose, or should it stay a
  `sanity` field until it is precise enough?
- Which metamorphic identities are true by design, and which are accidents of the current
  implementation that `idea.md` does not promise?
- Should `explain` text ever be shown to models, or does it risk replacing the registry as
  their source of truth?
