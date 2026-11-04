# Extensions: long-form and generative composition

**Status: partly implemented.** These are implemented as L3 extensions:

- `form` with local time, variants and `.once()`;
- `env`, `.during`, `.enter`, `.exit`, `.fadein` and `.fadeout`;
- `.invert`, `.retro`, `.sequence`, `.canon`, `.prolation`, `.fragment` and `.augment`;
- `ints` (all names in the table except the `period` sequences), `sieve`, `lsys` without
   stochastic rules, `.permute(n, k)`, `.ring("plainhunt", bells)`, `row` and `.rowform`;
- `.phase`, `.additive`, `.subtractive` and `.converge`;
- the repeat-period report of `sanity`, and `tartlet sanity --cycles n`.

Harmony (Part 3), `formula`, `.nest`, `.develop`, `.ornament`, `.expand`, `.stretto`,
`.isorhythm`, chaotic maps and the form map are still proposals. `.invert()` without an
axis mirrors notes around middle C, and `row(p)` plays like `n(p)`. Each item that changes the
language, the registry, the IR or `Program` needs a `TS-n` entry in `spec-issues.md`,
registry entries marked as extensions, and tests as described in [testing.md](testing.md).
Tooling that stays outside the core path (the CLI and the playground) needs tests but no TS
entry. The embedded grammars in [Part 4](#part-4-mathematical-generators) need an ADR before
implementation, because they add small closed languages inside strings, alongside
mini-notation.

A five-step string that repeats every cycle is a loop, not a piece. Composers have long used
deterministic procedures to get material that is coherent but does not simply repeat:

- canons, imitation, inversion and retrograde;
- melodic sequences that repeat a figure at rising pitch;
- isorhythm, where a pitch series and a rhythm series of different lengths cycle against
  each other;
- change ringing, which walks through permutations of a set of bells;
- twelve-tone rows and their transformations;
- self-similar series such as Per Nørgård's infinity series;
- sieves built from residue classes, as in Xenakis;
- phasing, additive processes and tempo canons, as in Reich, Glass and Nancarrow;
- proportions taken from integer sequences.

Many of these are exactly computable. Tartlet already has the right foundations: exact
rational time, pure queries, seeded counter-based draws and node ids that are stable under
appending. What it lacks is:

1. **structure above the cycle**: sections, form and large-scale shape;
2. **development of material**: ways to transform a motif across a piece;
3. **moving harmony**: progressions, keys and voicing that other tracks can follow;
4. **long, non-repeating, deterministic generators**: integer sequences, rewriting systems,
   sieves, permutations and closed formulas;
5. **processes**: transforms whose effect changes steadily from cycle to cycle.

This page proposes all five, under one rule: **every construct must be able to answer "what
plays in cycle `c`?" without replaying cycles 0 to `c − 1`.**

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints): the core
path stays pure, controls are data, randomness is decided in core, musical time is rational,
the safety chain cannot be bypassed and nothing is fetched. Long-form work adds these:

- **Query locality.** A pattern's events in a span must be computable from the span, the
  scope, the node ids and constants alone. The cost of a query may grow at most with the
  logarithm of the cycle number, never linearly. This keeps the span-splitting and
  containment laws true, keeps the query budget honest, and makes seeking free: starting
  playback at cycle 900 costs the same as starting at cycle 0.
- **Memory is bounded and declared.** A process that genuinely needs history (a walk, a
  Markov chain, a chaotic map, isorhythm counted by onset) takes a constant `period` after
  which it restarts, exactly like the bounded walks in [noise.md](noise.md#walks-and-memory).
  The cost charged to `budget.steps` is at most proportional to `period`.
- **Embedded grammars are closed and checked.** Roman numerals, sieve expressions, rewrite
  rules and integer formulas are constant strings parsed by hand-written parsers (ADR-001),
  at check time, with diagnostic ranges inside the string, like mini-notation. They are
  never evaluated as JavaScript, and they contain no names, no host access and no loops.
- **Integer arithmetic is defined exactly.** Generated values are integers. Formula
  arithmetic wraps to signed 32 bits, division and modulo by zero give 0, and shift amounts
  are masked. The same document gives the same numbers on every engine.
- **Growth is capped.** Every construct whose output size grows exponentially with a
  parameter (rewriting generations, nesting depth) has a constant-only parameter, a hard cap,
  and a check-time size computation that reports `E-LIMIT-GROWTH` before anything is queried.
- **Shared context goes through bindings, not cross-output routing.** A harmony that several
  tracks follow is a `const` binding that each output references. Outputs stay independent,
  as everywhere else in Tartlet.
- **No claims about meaning.** Descriptions say what a construct does to events. Historical
  notes are attributions of a technique, never claims that a construct makes music "better"
  or that a proportion has special aesthetic power.

### What locality allows

| Kind of construct                        | Cost of cycle `c`         | Offered as                |
| ---------------------------------------- | ------------------------- | ------------------------- |
| Function of the cycle number             | O(1)                      | Directly.                 |
| Bit-level or digit-level sequences       | O(log c)                  | Directly.                 |
| Rewriting systems with a fixed tree      | O(generations)            | Directly, with a cap.     |
| Self-similar nesting                     | O(depth)                  | Directly, with a cap.     |
| Recurrences that need every earlier step | O(c)                      | Only with a `period`.     |
| Counting onsets since the start          | O(events in cycles 0..c)  | Only with a `period`.     |

## Part 1: form

### 1.1 What already works

Some long-form structure is already expressible, and the docs should show it before adding
anything:

- `<a b c>` alternation and `!` replication give per-cycle sections:
  `"<C:minor!16 Eb:major!8>"`.
- `saw.slow(64)` is a ramp over 64 cycles, usable for slow change.
- `.every`, `.lastOf` and `.someCyclesBy` give change at the phrase level.
- `const` bindings name sections.

What is missing is a way to say "this, for 16 cycles, then that, for 8", where each part
starts from its own beginning.

### 1.2 `form(layout, ...parts)`

```js
// proposed syntax: not accepted today
const verse = n('0 2 4 2').scale('D:dorian').s('triangle');
const chorus = n('<[4 5] [7 5]> 4 2 0').scale('D:dorian').s('triangle');
const bridge = n('0 ~ -3 ~').scale('D:dorian').s('sine').slow(2);

$: form("A@16 B@8 A'@16 B@8 C@4 B@8", verse, chorus, bridge);
```

- `layout` is a constant string in a closed grammar: letters `A`–`Z` naming the parts by
  position (`A` is the first part argument), each with an optional `@n` length in cycles
  (default 1) and optional primes (`'`). Spaces separate sections. `/` is not needed, so the
  string never conflicts with mini-notation rules.
- **Local time.** A section's part starts at its own cycle 0: the verse plays its first
  cycle when it enters, not whatever cycle the piece has reached. This is a `late` by the
  section's start, so rational time and the laws are unaffected.
- **Variants.** Each prime makes a variant: `A'` plays `A` with every draw below it scoped
  as if under `.seed("'")`, `A''` as under `.seed("''")`, and so on (TS-28). A variant has
  the same notes where nothing is random, and different choices where something is.
- **Repetition.** A form loops after its total length. `form(...).once()` plays it once and
  then nothing, which is how a piece ends.
- **Locality.** Finding the section for cycle `c` is a lookup in a constant table of section
  starts, O(log sections).
- Arguments may be any pattern, including other forms, so movements can nest:
  `form("X@40 Y@64", form(...), form(...))`.

`arrange([n, part], …)` from [language_extensions.md](language_extensions.md#21-time-and-structure)
needs list-typed parameters. `form` covers the same need without them, and `arrange` could
later become sugar for it.

### 1.3 Cycle windows

- `.during(b, e, f, period?)`: applies `f` in cycles `[b, e)` of each `period` (default: no
  repetition). Constant arguments only. Derived from `every`-style cycle arithmetic.
- `.enter(c)` and `.exit(c)`: silent before cycle `c`, or from cycle `c` on. Derived from
  `mask`. With `form`, the more common way to bring tracks in is to give a section `silence`.
- `.fadein(n)` and `.fadeout(n, at)`: a gain ramp over `n` cycles. Derived from `env` (Part 6).

## Part 2: motifs and development

A motif is a binding. Development is a set of transforms on it. To stay musical, these
transforms work on **scale degrees** (`n` before `.scale`) where they can, so an inverted
minor motif stays in minor.

| Transform               | Meaning                                                                       | Built from                     |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| `.invert(axis = 0)`     | Mirrors degrees (or semitones on `note`) around `axis`.                       | `fmap`                         |
| `.retro(n = 1)`         | Plays each `n`-cycle window backwards.                                        | `x.fast(n).rev().slow(n)`      |
| `.sequence(step, k)`    | Repeats the receiver `k` times per group, each copy `step` degrees higher.    | `slowcat` of `add`             |
| `.fragment(f)`          | Repeats the first fraction `f` of each cycle.                                 | `linger` (exists)              |
| `.augment(k)`           | Plays `k` times slower (`k` may be a pattern).                                | `slow` (exists)                |
| `.ornament(kind)`       | Subdivides notes into `turn`, `mordent`, `trill`, `appoggiatura` figures.     | `ply` + degree offsets         |
| `.expand(k)`            | Multiplies intervals from the first note by `k`, on degrees.                  | `fmap` with onset reference    |
| `.develop(period, f…)`  | Applies a seeded one of the given transforms per `period`-cycle phrase.       | `someCyclesBy`-style draws     |

- `.expand` needs the first note of each cycle as a reference. That is a per-cycle query of
  the receiver, so it is local.
- `.develop(4, rev, invert, sequence(1, 2))` is a deterministic choice per phrase: the same
  document and seed always develop the same way, and appending a method later never changes
  the choices (the draw is keyed by node id and phrase index).
- On a sample-only receiver, degree transforms give `E-CAP-PITCHED` (TS-35).

### 2.1 Imitation

- `.canon(voices, delay, interval = 0)`: stacks `voices` copies, copy `k` delayed by
  `k · delay` cycles and moved by `k · interval` degrees. Each copy is a separate layer of
  the same output, so `.jux`-style panning helpers apply.
- `.stretto(delay)`: a canon whose delay shrinks by half in each later section of a form.
  Defined per cycle, so local.
- `.prolation(r1, r2, …)`: a mensuration canon. Each layer plays the receiver at its own
  constant speed ratio. Ratios are rationals: `.prolation(1, 3/2, 2)`.

## Part 3: harmony over time

### 3.1 Progressions

```js
// proposed syntax: not accepted today
const harm = prog('<i iv V7 i> <VI ii65 V7 i>').key('<D:minor!8 F:major!8>');
```

- `prog(pat)` takes mini-notation whose atoms are Roman numerals in a closed grammar:
  - an optional accidental `b` or `#` (`bVII`);
  - a numeral `I`–`VII`, upper case for major, lower case for minor;
  - an optional quality: `o` (diminished), `+` is not an atom character, so augmented is
    `aug`;
  - optional figures: `7`, `6`, `64`, `65`, `43`, `42`, `maj7`, `sus2`, `sus4`;
  - an optional applied target after `^`: `V7^V` is the dominant of the dominant. (`/` is not
    an atom character, so the usual slash is spelled `^`.)
- `.key(pat)` sets the key for numerals, as `Root:scale` strings, and may be patterned, so a
  modulation is just a change of key at a section boundary.
- The result is a stack of notes per step, like a chord: each chord tone is an event with the
  step's whole, and all carry the same `chord` control so later helpers can find them.
- Chord symbols (`chord("Cm7")` from [instruments.md](instruments.md#tier-3-performance-and-articulation))
  are the absolute counterpart. Both lower to the same chord representation.

### 3.2 Voicing without memory

Voice leading usually depends on the previous chord, which would break locality. Instead:

- `.voicing(centre = 60, spread = 12)` chooses, for each chord on its own, the inversion and
  octave placement whose mean pitch is closest to `centre`, within `spread` semitones per
  voice. Ties go to the lower voicing.
- Because every chord is placed near the same centre, successive chords move little, which
  gives most of the smoothness of voice leading at O(1) cost and with no history.
- `.rootNotes(octave)` (from [language_extensions.md](language_extensions.md#24-tonal)) gives
  a bass line from the same binding.

### 3.3 Following the harmony

Other tracks reference the harmony binding:

- `.fit(harm)`: snaps each note to the nearest chord tone sounding at its onset. Structure
  comes from the receiver (`appLeft`), as for other patterned arguments. `.fitBy(p, harm)`
  snaps a seeded share `p` of notes, so passing tones survive.
- `.tones(harm)`: reads `n` as an index into the current chord (0 the bass, 1 the next tone,
  and so on, wrapping into higher octaves). `n("0 1 2 1 3 2 1 2").tones(harm)` is an
  arpeggio that follows any progression.
- `.cadence(n, kind)`: replaces the chords in the last cycle of each `n`-cycle group with an
  `authentic` (V–I), `plagal` (IV–I), `half` (–V) or `deceptive` (V–vi) cadence in the
  current key. Derived from `lastOf`.

## Part 4: mathematical generators

Each generator is a constructor that produces integer steps, a fixed number per cycle. Step
`i` is global: `i = steps · cycle + position`. Values are plain numbers in events, so they
combine with `.mod`, `.add`, `.range` and `.scale`.

### 4.1 Named integer sequences

`ints(name, steps = 1, ...args)` selects from a closed set:

| Name         | Value at index `i`                                                 | Cost      |
| ------------ | ------------------------------------------------------------------ | --------- |
| `ruler`      | The number of times 2 divides `i + 1`. Rhythmic hierarchy.         | O(log i)  |
| `thuemorse`  | Parity of the number of 1 bits in `i`. Never repeats a block three times. | O(log i) |
| `norgard`    | The infinity series: `a(2i) = −a(i)`, `a(2i+1) = a(i) + 1`.         | O(log i)  |
| `fib`        | The `i`-th Fibonacci number modulo `m` (argument, default 12).     | O(log i)  |
| `sturm`      | `⌊(i+1)·p/q⌋ − ⌊i·p/q⌋` for constants `p < q`: an evenly spread 0/1 rhythm. | O(1) |
| `vdc`        | The base-`b` radical inverse of `i`, scaled to `[0, 1)`: "even randomness". | O(log i) |
| `prime`      | 1 if `i` is prime, else 0 (deterministic Miller–Rabin for 32 bits). | O(log i)  |
| `collatz`    | The number of Collatz steps from `i + 1` to 1, capped at 1024.      | ≤ 1024    |
| `digits`     | The digits of `i` in base `b`, read in order across steps.          | O(log i)  |

```js
// proposed syntax: not accepted today
$: n(ints('norgard', 8)).scale('C:major').s('triangle'); // never-repeating self-similar melody
$: s('hh*8').gain(ints('ruler', 8).range(0.3, 1));       // accents from the binary hierarchy
$: s('bd').struct(ints('sturm', 16, 5, 13));             // 5 hits spread over 13, drifting
```

- Indices are capped at 2³¹ − 1. At 16 steps per cycle and 1 cps that is over four years.
- Sequences that need every earlier value (Kolakoski, Recamán) are offered only with a
  `period`, under the memory rule above, as `ints("kolakoski", 8, period)`.

### 4.2 Integer formulas

`formula(expr, steps = 1)` evaluates a closed integer expression at every step:

```js
// proposed syntax: not accepted today
$: n(formula('(i * 7) % 12', 8)).add(48).s('sine');      // circle of fifths, one note per step
$: s('hh*16').mask(formula('(i & (i >> 3)) % 3', 16));  // bit-twiddled rhythm
```

- Variables: `i` (global step), `c` (cycle number) and `k` (step within the cycle).
- Operators: `+ - * // % & | ^ ~ << >>`, comparisons giving 0 or 1, and parentheses.
  Functions: `abs`, `min`, `max`, `gcd`, `pop` (bit count) and `clz`.
- Semantics are exact and portable: values are signed 32-bit integers that wrap, division
  and modulo by zero give 0, and shift amounts are masked to 5 bits.
- Expressions are at most 64 tokens. There are no names besides the three variables, so a
  formula can never refer to anything outside itself.
- This is "bytebeat at pattern rate": very small formulas give long, structured, non-trivial
  sequences.

### 4.3 Rewriting systems

`lsys(axiom, rules, generations, cycles)` expands a deterministic L-system and spreads its
result evenly over `cycles` cycles:

```js
// proposed syntax: not accepted today
$: n(lsys('0', '0=0 2, 2=4, 4=0 4', 6, 8)).scale('A:minor').s('triangle');
$: s(lsys('bd', 'bd=bd hh, hh=sd bd', 5, 4));
```

- Symbols are mini-notation atoms (numbers, note names, sound names), so the output feeds
  any constructor. `rules` is a closed grammar: `atom=atom atom …`, separated by commas.
  Symbols without a rule are copied unchanged.
- **Local evaluation.** At check time, the length of each symbol's expansion is computed for
  every generation. To find the symbol at a position, a query descends the derivation tree,
  one generation per step: O(generations × rule length), independent of the cycle number.
- The expansion length is capped at 2²⁰ symbols and `generations` at 16. Exceeding either
  gives `E-LIMIT-GROWTH` at check time.
- **Stochastic rules** (`0=0 2 | 2 0`) choose by a seeded draw keyed by the path through the
  derivation tree, which is still local and deterministic.
- `a=ab, b=a` gives the Fibonacci word; `a=ab, b=ba` gives the Thue–Morse word.

### 4.4 Self-similar nesting

`.nest(depth, ratio = steps)` fills each event of the receiver with a scaled copy of the
receiver, moved by the event's value, down to `depth` levels:

```js
// proposed syntax: not accepted today
$: n('0 2 -1').nest(3).scale('E:phrygian').s('sine').slow(9);
```

- The value at any point is the sum of the receiver's values along the path from the top
  level down. Each level is heard as a slower version of the one below it.
- Cost per event is O(depth). `depth` is a constant capped at 6, and the total event count
  is bounded by the query budget like any dense pattern.

### 4.5 Sieves

`sieve(expr, steps)` produces a boolean step pattern from residue classes:

```js
// proposed syntax: not accepted today
$: s('rim').struct(sieve('3@0 | 4@1 & -5@2', 16));
```

- `m@r` is the set of indices `i` with `i % m = r`. `|` is union, `&` is intersection, `-`
  is complement and parentheses group.
- Indices are global, so a sieve whose moduli do not divide `steps` shifts across cycles and
  repeats after the least common multiple.
- O(number of terms) per step.

### 4.6 Permutations and change ringing

- `.permute(k)`: reorders the steps of each cycle by the `k`-th permutation in lexicographic
  order (factorial number system, O(steps)). `k` may be a pattern: `.permute("<0 7 13>")`.
- `.ring(method, bells)`: cuts each cycle into `bells` slices and reorders them by row
  `c` of a change-ringing method. `plainhunt` has a closed form for every row, so it is
  local. Methods whose rows depend on calls are offered only with a `period`.

### 4.7 Twelve-tone rows

- `row(pat)`: a series of pitch classes as mini-notation, for example
  `row("0 11 3 4 8 7 9 5 6 1 2 10")`. A constant row that is not a permutation of 0–11 gives
  `W-ARG-ROW` and plays as written.
- `.rowform(form)`: one of `P`, `I`, `R` or `RI` followed by a transposition, such as
  `"<P0 I5 R3 RI7>"`. It may be patterned, one form per cycle or per section.
- Rows are pitch classes. `.add(60)` or `.scale("C:chromatic")` places them.

### 4.8 Chaos, walks and automata

Iterated maps need their history and follow the bounded-memory rule:

- `logistic(r, period, steps)` iterates `x → r·x·(1 − x)` from 0.5, restarting every
  `period` cycles. Values are computed in doubles with a fixed operation order, which is
  deterministic on one engine. A TS entry must decide whether to compute on rationals with
  a denominator cap for cross-engine identity.
- Walks and Markov chains are proposed in [noise.md](noise.md#walks-and-memory), and
  cellular automata (`ca`) in [genetics.md](genetics.md#33-cellular-rhythms). Both use the
  same `period` rule.

## Part 5: process music

Processes are transforms whose effect is a function of the cycle number, so they are local.

| Transform                   | Process                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `.phase(step)`              | Cycle `c` is delayed by `(c · step) mod 1`. Stacked with the original, two identical parts drift apart and back together. |
| `.additive(n)`              | The receiver is cut into `n` steps. Cycle `c` plays the first `(c mod n) + 1` steps, stretched to fill the cycle. |
| `.subtractive(n)`           | The reverse: one step fewer each cycle.                                     |
| `.converge(at, r1, r2, …)`  | A tempo canon: layers at constant speed ratios that coincide exactly at cycle `at`. |
| `.isorhythm(color, period)` | The `k`-th onset of the receiver within each `period` takes the `k`-th value of `color`, wrapping. |

- `.phase` is a stepwise approximation of continuous phasing: the shift changes at cycle
  boundaries. A continuous version needs in-note control (TS-33) and is not proposed.
- `.converge` computes each layer as `x.fast(r).late(at · (r − 1) / r)`, exactly on
  rationals, so at cycle `at` every layer is at the same position of the receiver.
- `.isorhythm` counts onsets, which needs history. Its `period` bounds the count, and the
  cost is at most the onsets in one period. `n(color).struct(talea)` is the cheaper,
  time-aligned alternative when values should follow the clock rather than the onset count.

## Part 6: shape over long spans

- `env(points, cycles)`: a breakpoint envelope over `cycles` cycles. `points` is
  mini-notation of numbers with `@` weights for segment lengths:
  `env("0.2 1@3 0.6 1@2 0", 64)`. Values are interpolated linearly between points. It is a
  signal (TS-33): sampled at onsets, or stepped with `.segment(n)`.
- Bind an envelope once and use it for several controls, so loudness, brightness and density
  rise together:

  ```js
  // proposed syntax: not accepted today
  const arc = env('0.1 1@5 0.3 0.8@2 0', 64);
  $: s('hh*16').densityBy(arc).gain(arc.range(0.3, 0.8));
  $: note('c2').s('sawtooth').cutoff(arc.range(300, 3000));
  ```

- `.densityBy` is proposed in [noise.md](noise.md#tier-p3-stochastic-structure).
- Section lengths in `form` are rationals, so proportions such as consecutive Fibonacci
  numbers (`A@21 B@13 C@8`) are exact. Whether such proportions matter perceptually is
  disputed. The docs present them as a compositional choice, not a rule.

## Recipes

```js
// proposed syntax: form, prog, key, voicing, tones, rootNotes, ints, sieve and env
// are not accepted today

setcpm(72 / 4);

const key = '<D:minor!16 F:major!8 D:minor!8>';
const harm = prog('<i iv V7 i>').key(key).voicing(60);
const theme = n('0 2 [4 3] 1 0 ~ -1 ~').slow(2);
const arc = env('0.2 1@3 0.6 1@2 0', 32);

melody: form("A@16 B@8 A'@8", theme, theme.invert().sequence(1, 4))
  .scale(key).s('voice').syl('ah').gain(arc.range(0.4, 0.9));
chords: harm.s('choir').gain(arc.range(0.2, 0.5)).legato(1);
arp: n(ints('ruler', 8).mod(4)).tones(harm).s('triangle').gain(0.4);
bass: harm.rootNotes(2).s('sawtooth').cutoff(arc.range(200, 900));
pulse: s('rim').struct(sieve('3@0 | 8@5', 16)).gain(arc.range(0.2, 0.7));
```

- The melody states a theme, develops it by inversion and sequence, and returns with a
  variant (`A'`).
- The arpeggio follows any key and progression through `.tones(harm)`, with its shape taken
  from the binary ruler sequence.
- One envelope shapes the whole 32-cycle arc.

## Part 7: tooling for long pieces

All of these stay outside the core path.

- **Long sanity.** `sanity --cycles n` in the CLI, with a periodicity report: the shortest
  period after which each output's events repeat exactly, up to a limit, found by hashing
  each cycle's canonical events. "This track repeats every cycle" is the most useful
  feedback for a model asked to write something long.
- **Form map.** An extension of the text grids in [claudes_ideas.md](claudes_ideas.md#11-text-event-grids):
  one row per output, one character per cycle showing density, with section letters above.
  It shows the shape of a piece in a few lines of text.
- **Seeking.** Because every construct is local, the playground can start playback at any
  cycle or section without warm-up. A "play from section" control follows directly.
- **Export.** MIDI export ([claudes_ideas.md](claudes_ideas.md#21-midi-export)) makes long
  pieces usable in other tools.

## Registry and language impact

- New constructors: `form`, `prog`, `ints`, `formula`, `lsys`, `sieve`, `row`, `env` and
  `logistic`. New transforms: the motif, harmony and process transforms above. All are
  Tartlet extensions at level L3 with original descriptions.
- No new expression syntax is needed. Lists are avoided by using variadic arguments and
  constant strings.
- Four small grammars live inside constant strings: form layouts, Roman numerals, sieve
  expressions, rewrite rules and integer formulas. Each is hand-written, closed and
  check-time only, and reports ranges inside its string. This is the part that needs an ADR.
- Generators produce numbers outside [0, 1]. They are step patterns with wholes, not signals,
  so the [0, 1] convention for signals is unchanged.
- Generators that take a `period` treat it as constant-only. A patterned `period` is
  `E-ARG-TYPE`.

## Diagnostics (proposed)

- `E-ARG-GRAMMAR`: a malformed constant string in an embedded grammar (form layout, numeral,
  sieve, rewrite rule or formula). The range points inside the string. Like mini-notation
  errors, it mutes the output.
- `E-LIMIT-GROWTH`: an L-system expansion or a nesting depth exceeds its cap. Computed at
  check time. Only that output is muted.
- `E-ARG-MISSING`: a form layout names a letter with no matching part argument.
- `W-FORM-UNUSED`: a part argument of `form` is never named in the layout.
- `W-ARG-ROW`: a constant row is not a permutation of 0–11. It plays as written.
- `W-ARG-MODE`: an unknown sequence name, ringing method, cadence kind or ornament.
- `W-RANGE`: a `depth`, `generations` or `period` above its cap, or an index beyond 2³¹ − 1.
- `E-CAP-PITCHED`: degree and harmony transforms on a sample-only receiver (TS-35).
- `I-FORM-LENGTH`: benign. The total length of a form in cycles, and the period after which
  the output repeats when it is statically known. Hidden from the repair payload.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Generators.** Hand-written expectations from the mathematical definitions, never from
  running Tartlet:
  - `ints("thuemorse")` begins `0 1 1 0 1 0 0 1`;
  - `ints("norgard")` begins `0 1 -1 2 1 0 -2 3`;
  - `ints("ruler")` begins `0 1 0 2 0 1 0 3`;
  - `ints("fib", 1, 3)` begins `0 1 1 2 0 2 2 1` and repeats with period 8;
  - `sieve("3@0 | 4@1", 12)` hits steps 0, 1, 3, 5, 6 and 9;
  - `.ring("plainhunt", 4)` rows are 1234, 2143, 2413, 4231, 4321, 3412, 3142, 1324, then
    1234 again;
  - `lsys("a", "a=ab, b=a", 4, 1)` is `a b a a b a b a`.
- **Formulas.** P-style parser tests, X-style range tests, and property tests that wrapping,
  division by zero and shifts follow the stated semantics.
- **Laws.** Every new construct joins `SOURCES` in `laws.test.ts`, with short spans.
  Locality is exactly what span splitting checks.
- **Cost.** A property checks that the steps charged for querying cycle 10⁶ are at most a
  constant factor (or a logarithmic factor, as documented) above those for cycle 0, for each
  generator. Generators with a `period` check that cost does not grow beyond one period.
- **Form.** Section boundaries land on the stated cycles, local time restarts at each
  section, variants differ only where draws are involved, and `.once()` is silent after the
  last section.
- **Harmony.** `prog("I IV V").key("C:major")` gives C–E–G, F–A–C and G–B–D before voicing.
  `.voicing` never places a voice outside `centre ± spread`, and `.fit` always returns a
  chord tone.
- **Processes.** At cycle `at`, every layer of `.converge` starts the receiver together;
  `.additive(4)` plays 1, 2, 3, 4, 1, … steps in successive cycles.
- **D rows.** `.develop`, stochastic L-system rules, `.fitBy` and form variants are stable for
  a seed, differ across seeds, and are unchanged when a method is appended.
- **Expectations by reasoning.** All expected values come from definitions and music theory,
  as [testing.md](testing.md#rules-for-expectations) requires.

## Suggested order

1. `form` with local time, variants and `.once()`. It is the single biggest gain for long
   pieces and needs no embedded grammar beyond the layout.
2. `env`, `.enter`, `.exit`, `.fadein` and `.fadeout`.
3. Motif transforms: `invert`, `retro`, `sequence`, then `canon` and `prolation`.
4. `ints` with the O(log i) sequences, and `sieve`.
5. The ADR for embedded grammars, then `prog`, `.key`, `.voicing`, `.tones` and `.fit`.
6. Long sanity with periodicity, and the form map in the CLI.
7. Process transforms: `phase`, `additive`, `converge`, then `isorhythm` with `period`.
8. `lsys`, `.nest`, `.permute`, `.ring` and twelve-tone rows.
9. `formula`, once the grammar ADR has settled how far embedded languages may go.
10. Chaotic maps with `period`, together with walks and Markov chains from noise.md.

## Open questions

- Should a section in `form` restart its part's local time, or should it continue the
  global clock? Restarting is easier to reason about; continuing keeps alternations aligned
  across sections.
- Is `^` an acceptable spelling for applied chords (`V7^V`), or should mini-notation atoms
  gain `/` inside `prog` only?
- Should harmony be a dedicated context that `.scale` and `.fit` read implicitly, or should
  every track reference the harmony binding explicitly, as proposed?
- How far should embedded grammars go? `formula` is the most powerful and the most
  code-like. Is it worth an ADR, or should integer sequences stay a closed named set?
- Should `ints` values be capped to a range so that unbounded sequences (`collatz`,
  `norgard` at large indices) cannot produce extreme pitches without an explicit `.mod`?
- Should `logistic` compute on rationals with a denominator cap, for identical results on
  every engine, at a higher cost?
- How should the repair payload describe errors inside a long `form`? Naming the section and
  the part argument, as well as the line, may help models edit large documents locally.
- Should the system prompt mention any of these constructs, or should they stay L3 so models
  are not tempted to reach for them in short loops?