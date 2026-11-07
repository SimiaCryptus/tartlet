# Language reference

This page is a complete overview of the Tartlet language: document structure, expressions,
mini-notation, every constructor, control and transform, the long-form composition library,
sounds and samples, determinism, limits and diagnostics. It describes what Tartlet accepts **today**.

The registry (`packages/registry/src/registry.ts`) is authoritative. Run
`npx tsx packages/cli/src/main.ts prompt` to print the short summary generated from it. All
prose here is original.

Names marked "Tartlet extension" are not part of the Strudel language family. Most extension
names are registry level **L3**, which keeps them out of the generated system prompt; they work
exactly like any other name.

## Contents

1. [A first document](#a-first-document)
2. [Program structure](#program-structure)
3. [Values and expressions](#values-and-expressions)
4. [Functions](#functions)
5. [Mini-notation](#mini-notation)
6. [How patterns combine](#how-patterns-combine)
7. [Constructors and signals](#constructors-and-signals)
8. [Controls](#controls)
9. [Core transforms](#core-transforms)
10. [Standard library](#standard-library-tartlet-l3)
11. [Long-form composition](#long-form-composition-tartlet-l3)
12. [Sounds](#sounds)
13. [Samples](#samples-tartlet-extension)
14. [Randomness and determinism](#randomness-and-determinism)
15. [Event values](#event-values)
16. [Limits](#limits)
17. [Diagnostics](#diagnostics)

## A first document

```js
setcpm(92 / 4)

$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
```

Each `$:` line is a track. Tracks are checked independently: a broken track is muted and the
others keep playing.

## Program structure

A document is a sequence of statements. A statement ends at a newline, a `;` or the end of
input (TS-21). A method chain may continue on the next line when that line starts with `.`.

```js
// Line comments and /* block comments */ are kept in the syntax tree.
setcpm(120 / 4)               // tempo directive
const kick = s("bd*4")        // binding
let hat = s("hh*8")           // `let` behaves exactly like `const`
$: kick                       // anonymous output
hats: hat.gain(.5)            // named output
s("cp").label("claps")        // a bare expression is also an output (TS-16)
```

### Outputs

- `$: expr` is an anonymous output. Anonymous outputs are labelled `$0`, `$1`, … in order.
- `name: expr` is a named output. `expr.label("name")` at the end of a chain names it the same
  way and gives the same output id (TS-36).
- A bare expression statement that is not a directive is an output too.
- All outputs play at the same time (they are stacked).
- Two outputs with the same name give `E-NAME-DUP`; the second is muted.

### Bindings

- `const name = expr` (or `let`) evaluates once and may be referred to by later statements.
  A name must be declared before it is used (`E-NAME-UNDEF` otherwise), so cycles are
  impossible.
- A binding whose value is a constant number can be used in constant arithmetic:
  `const k = 2` then `.fast(k * 2)`.
- A binding whose value is a lambda defines a [function](#functions).
- Binding names may not repeat (`E-NAME-DUP`), shadow a built-in name (`E-NAME-SHADOW`), or
  be a host or prototype name (`E-LX-PROTO`).
- A binding with errors mutes every track that uses it (`E-NAME-ERRORED`).

### Directives

- `setcps(n)` sets the tempo in cycles per second. `setcpm(n)` sets it in cycles per minute,
  so the cps is `n / 60`. The argument must be a constant (`E-ARG-TYPE` otherwise). It is
  clamped to [0.001, 100] cps (`W-RANGE`). When several tempo directives appear, the last one
  wins (`I-TEMPO-OVERRIDE`, TS-7). The default is 0.5 cps.
- `samples("keys/")` or `samples("strings.json")` declares a sample bank from the host's
  sample collection: a directory ending in `/` (which holds a `manifest.json`) or a `.json`
  manifest (TS-90). A spec containing `:`, such as `samples("github:user/repo")`, is recorded
  as a remote bank and never fetched (X-31). Both give `I-RES-DECLARED`.
- `sample("kick", "./drums/kick.wav")` binds one WAV file to a sound name (Tartlet
  extension). Sound names start with a letter, then up to 63 letters, digits, `_` or `-`. A
  name that matches a kit sound replaces it in this document (`I-RES-OVERRIDE`). Declaring the
  same name twice gives `E-NAME-DUP`.

Sample paths are relative to the host's root, ASCII only and at most 256 bytes:
`("./")? segment ("/" segment)*`, with segments of `A–Z a–z 0–9 _ . -` other than `.` and
`..`. Absolute paths, URL schemes, backslashes, empty segments and `..` are rejected with
`E-RES-PATH`. The checker never reads files: hosts load samples (see
[embedding.md](embedding.md#samples)).

## Values and expressions

- **Numbers.** Decimal literals with an optional exponent: `1`, `.5`, `2.25`, `1e3`. They are
  exact rationals, never floats: `0.1` is 1/10.
- **Constant arithmetic.** `+ - * /`, unary `+ -` and parentheses on constants are folded
  exactly when the document is checked. `1/8` is the rational 1/8. Arithmetic on patterns is
  not allowed; use `.add`, `.mul` and friends instead. Division by zero gives
  `E-ARG-DIVZERO`.
- **Strings.** Single-quoted, double-quoted and backtick strings are all accepted. Backtick
  strings may span lines but may not use `${…}` interpolation (`E-LX-INTERP`). A string
  passed where a pattern is accepted is parsed as [mini-notation](#mini-notation). A string
  passed where only a constant is accepted (a scale name, a layout) is used as is. A string
  as a whole track (`$: "a b"`) is a mini-notation pattern of plain strings.
- **Booleans.** `true` and `false` are constants.
- **Arrays** may appear only as the operand of a spread in a call: `stack(...[a, b])`
  (`E-LX-SPREAD` otherwise).
- **Lambdas.** `x => x.fast(2)`, `(x) => …` and `x => { return …; }` are accepted. A block
  body must be exactly one `return` (`E-LX-LAMBDA`). Lambdas are lowered to IR and never run
  as JavaScript.

### Function arguments

Wherever a transform expects a function (`every`, `sometimes`, `off`, `jux`, …) you may pass:

- a registered transform name: `rev`, `palindrome`, `degrade`;
- a partial application of one: `fast(2)`, `iter(4)`, `superimpose(rev)`;
- a user function, or a partial application of one: `chop`, `chop(3)`;
- a one-parameter lambda without a default whose body starts from the parameter (`x => x.fast(2).rev()`) or is a
  constructor or user-function call (`x => stack(x, s("hh"))`).

Anything else gives `E-ARG-FUNCTION` or `E-LX-LAMBDA`.

### Rejected constructs

| Construct                                                                                                                                                                                                                                          | Diagnostic          |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------|
| `import`, `export`                                                                                                                                                                                                                                 | `E-LX-IMPORT`       |
| `function`, `class`, `new`, `async`, `await`, `var`, `yield`, `delete`, `typeof`, `void`, `this`, `super`, `with`, `debugger`                                                                                                                      | `E-LX-KEYWORD`      |
| Loops, `if`, `switch`, `try`, `throw`, `return` outside a lambda block, `?:`                                                                                                                                                                       | `E-LX-CONTROL`      |
| `a[b]`, or a member that is not called as a method                                                                                                                                                                                                 | `E-LX-MEMBER`       |
| Host names: `window`, `document`, `globalThis`, `self`, `fetch`, `eval`, `Function`, `setTimeout`, `setInterval`, `require`, `XMLHttpRequest`, `WebSocket`, `localStorage`, `sessionStorage`, `navigator`, `location`, `process`, `Deno`, `Worker` | `E-LX-HOST`         |
| `__proto__`, `constructor`, `prototype`                                                                                                                                                                                                            | `E-LX-PROTO`        |
| Assignment outside a fresh binding                                                                                                                                                                                                                 | `E-LX-ASSIGN`       |
| Spreading anything but an array literal                                                                                                                                                                                                            | `E-LX-SPREAD`       |
| Calling a parameter or a pattern binding                                                                                                                                                                                                           | `E-LX-CALL`         |
| Object literals                                                                                                                                                                                                                                    | `E-NOT-YET` (TS-23) |

## Functions

A `const` binding whose value is a lambda names a function (TS-48, Tartlet extension). It may
take several parameters, and parameters may have constant defaults.

```js
const chop = (x, n = 2) => x.ply(n).gain(.8)
const beat = k => s("bd").euclid(k, 8)
const twice = (x, f) => stack(x, x.apply(f))

$: s("hh*4").every(4, chop(3))   // as a function value; arguments follow the pattern
$: s("sd*2").apply(chop, 3)      // through .apply
$: s("cp*2").chop()              // as a method
$: beat(5)                       // as a pattern builder
$: s("a").twice(y => y.late(1 / 2)) // with a function parameter
```

- Functions are expanded inline when the document is checked. Nothing runs as JavaScript.
- A function can only use names declared before it, so recursion is impossible.
- A parameter can be a function. Call it with `x.apply(f)`, not `f(x)` (`E-LX-CALL`).
- `.apply(f, …args)` also works with registry transforms (`.apply(fast, 2)`) and lambdas.
- Missing arguments give `E-ARG-MISSING`; extra ones give `W-ARG-EXTRA` and are ignored.
- An unused parameter gives `W-FN-UNUSED`.
- Errors inside a body are reported once at the definition, and every track that calls it is
  muted with `E-NAME-ERRORED`. Problems caused by one particular call are reported at that
  call, prefixed with `In \`name\`:`.
- Random draws inside a function follow the call, not the layout of the definition (TS-49).
- Expansion is capped by `maxExpandedNodes` (10 000 by default, `E-LIMIT-EXPAND`).

## Mini-notation

Mini-notation is the language inside pattern strings.

| Syntax               | Meaning                                                                                                          |
|----------------------|------------------------------------------------------------------------------------------------------------------|
| `a b c`              | Divides the cycle equally among the steps.                                                                       |
| `~`                  | A rest.                                                                                                          |
| `[a b]`              | A subdivision: a group occupying one step.                                                                       |
| `<a b c>`            | Alternation: one item per cycle. Nested alternations advance, so `<a <b c>>` plays a b a c (TS-14).              |
| `a, b`               | Plays its parts at the same time, at the top level or inside brackets.                                           |
| `a*n`, `a/n`         | Speeds up or slows down a step. The factor may be a pattern: `a*<2 3>`.                                          |
| `a!n`                | Replicates a step n times. A bare `a !` repeats the previous step; a bare `!` at the start is an error (TS-9).   |
| `a@n`                | Gives a step a relative weight of n (positive).                                                                  |
| `a?`, `a?0.3`        | Drops events at random with probability 0.5, or the given amount (0–1).                                          |
| `a(k,n)`, `a(k,n,r)` | A Euclidean rhythm: k onsets over n steps, rotated left by r (TS-19). Every argument may be a pattern.           |
| `{a b c, d e}`       | Polymeter: each layer advances by steps. Steps per cycle default to the total weight of the first layer (TS-29). |
| `{…}%n`              | Polymeter with n steps per cycle; `n` may be a pattern.                                                          |
| `a \| b`             | Picks one option per cycle with a seeded draw. `\|` binds looser than a sequence and tighter than `,` (TS-30).   |
| `a . b c`            | A standalone `.` separates equal groups. `.5` remains a number (TS-31).                                          |
| `bd:3`               | Selects a sample index (`n`).                                                                                    |

Operators attach to a step only when written without a space: `a*2`, not `a *2`.

**Atoms** are runs of letters, digits and `# . - _ ^ '`. How an atom is read depends on the
parameter it is passed to:

- **Notes** (`note`): `c d e f g a b`, any number of accidentals `#`/`s` (sharp) or `b`/`f`
  (flat), then an optional octave. A bare note is in octave 3, so `c3` = `c` = MIDI 48 and
  `c4` = 60. Plain numbers are MIDI numbers.
- **Numbers** (`n`, `gain` and other numeric controls): decimal literals, read exactly.
- **Samples** (`s`): sound names, with an optional `:index`.
- **Strings** (`vowel`, `syl`, `space`, …): the text as written.

An atom that cannot be read as the needed kind is silent.

**Truthiness.** In `struct`, `mask` and `accent`, the atoms `0`, `~`, `f`, `false` and the
empty string are false; everything else is true.

**Caps.** Factors, replication counts, polymeter steps and Euclidean step counts are capped at
1024 (`E-LIMIT-MULTIPLIER`). Nesting is capped at 32 levels (`E-LIMIT-DEPTH`).

## How patterns combine

Time is measured in **cycles** and is exact. Each event has a *whole* (its full duration) and
a *part* (the fragment inside the queried window). A pattern is a pure function of time, so
the same window always gives the same events.

- **Controls take their structure from the receiver** (TS-34). In `s("hh*4").gain("<.5 1>")`
  the four hats keep their timing; each takes the gain sounding at its time. A constant control
  never splits events.
- **Signals are sampled** at each receiver event's onset (TS-33).
- `struct`, `euclid` and `sieve`-driven structures take their timing from the rhythm instead.
- Controls chain by merging: `note("c").s("sawtooth").gain(.8)` gives one event with all three
  values. A later control of the same name wins.

## Constructors and signals

- `s(pat)` (alias `sound`) chooses the sound. `name:i` sets `n`.
- `note(pat)` takes note names or MIDI numbers.
- `n(pat)`, and every other control, can also start a pattern: `n("0 2 4").scale("C:major")`.
- Any pattern may be a control's argument, including combinators: `s(cat("bd", "sd"))`.
- `stack(...)` layers its arguments.
- `cat(...)` / `slowcat(...)` play one argument per cycle, each continuing its own cycles.
- `seq(...)` / `fastcat(...)` squeeze all arguments into each cycle.
- `run(n)` counts 0 … n−1 across each cycle; n is a whole number from 1 to 1024 (L3).
- `silence` is a pattern with no events.
- `row`, `ints`, `sieve`, `lsys`, `env` and `form` are [long-form constructors](#long-form-composition-tartlet-l3).

### Signals

Signals are continuous and produce values in [0, 1]:

| Signal                | Shape                                                                  |
|-----------------------|------------------------------------------------------------------------|
| `sine`                | A smooth wave from 0.5 up to 1, down to 0 and back, once per cycle.    |
| `cosine`              | The same wave, a quarter cycle earlier.                                |
| `saw` / `isaw`        | Climbs from 0 to 1 / falls from 1 to 0 across each cycle.              |
| `tri`                 | Climbs and falls once per cycle.                                       |
| `square`              | 0 in the first half of each cycle, 1 in the second.                    |
| `rand`                | A seeded random value.                                                 |
| `perlin`              | Smooth seeded noise: one value per cycle boundary, eased between (L3). |
| `irand(n)`            | A seeded whole number from 0 to n−1 (L3).                              |
| `env(points, cycles)` | A breakpoint envelope ([below](#shape-over-time)).                     |

Typical uses: `.lpf(sine.range(200, 2000))`, `.pan(perlin)`, `n(irand(8).segment(4))`. Use
`.segment(n)` to turn a signal into n separate events per cycle.

## Controls

Every control accepts a constant or a pattern (including signals). The first name listed is
canonical; aliases are equivalent, and compatibility aliases also give an `I-REG-ALIAS` note.
A constant outside a control's range gives `W-RANGE`: the IR keeps the authored value, and the
audio adapter clamps it. A misspelt control method (`.romm(.4)`) gives `W-REG-UNKNOWN` with a
fix, is dropped, and the track plays.

### Core

- Sound and pitch: `s` / `sound`, `note`, `n` (sample index or scale degree), `freq` (hertz).
- Level and position: `gain` (0–1.5, 1 is unity), `velocity` (0–1), `pan` (0 left, 1 right).
- Samples: `speed` (its magnitude, 1/8 to 8; negative values are not reversed yet).
- Filters: `cutoff` / `lpf` (20–20000 Hz), `resonance` / `lpq` (0–30), `hcutoff` / `hpf`
  (20–20000 Hz).
- Envelope: `attack`, `decay`, `sustain` (defaults to 1, so `decay` alone changes nothing),
  `release`, all in seconds except `sustain` (a fraction of the peak).
- Effects:
    - `room` (compatibility alias `reverb`, 0–1) and `size`: a convolution reverb shared per
      `orbit`;
    - `delay` (0–1), `delaytime` (seconds) and `delayfeedback` (compatibility alias `feedback`,
      0–0.98): a feedback delay shared per `orbit`;
    - `shape` (0–1, soft clipping), `crush` (1–16 bits) and `vowel` (a formant filter:
      `a e i o u ae ah aw eh er ih oh oo uh`; unknown vowels give `W-ARG-VOWEL` and sing `ah`);
    - `orbit` (0–15): the effects bus.
- Note length and timing (L3, TS-59): `legato` (alias `clip`, 0–8) scales how long a note
  sounds as a share of its step; `nudge` (−0.05–0.25 s) moves it in real time.

### Synthesis (Tartlet extensions, TS-41, TS-42)

- Noise sounds: `white`, `pink`, `brown`.
- Filter envelope: `lpenv` (octaves, −8–8), `lpattack`, `lpdecay`, `lpsustain`, `lprelease`.
- Pitch envelope: `penv` (semitones, −48–48) and `pdecay` (seconds).
- `vib` (alias `vibrato`, Hz) and `vibdepth` (semitones); `trem` (alias `tremolo`, Hz) and
  `tremdepth` (0–1).
- `fm` / `fmi` (index, 0–50) and `fmh` (modulator ratio).
- `pw`: pulse width of square voices (0.5 is a plain square).
- `unison` (1–8 copies on oscillators) and `detune` (total spread in cents, 0–100).
- `timbre`: `organ`, `hollow`, `bright`, `soft`, `reed` or `glass`.
- `mono` (line number, 0–64) and `glide` (alias `portamento`, seconds): a new note on a mono
  line ends the previous one, and `glide` slides into it. On drums, `mono` acts as a choke
  group.

### Voices (Tartlet extensions, TS-43 to TS-47; see [vocals.md](vocals.md))

- Sounds: `voice`, `aah`, `ooh`, `hum`, `whisper`, `choir`.
- `syl`: a phonetic syllable: up to two consonants, one vowel (or several joined by `_` and
  glided across the note), then up to two consonants, at most 16 letters. Examples: `la`,
  `shee`, `sing`, `mi_a_u`. A lone `_` holds the previous vowel. Vowels:
  `a e i o u ae ah aw eh er ih oh oo uh`, with the spellings `ee` (i), `ou`/`ue` (oo), `ai`
  (e) and `oa` (oh). Consonants: `p t k b d g f s sh h v z th m n ng l r w y`. It is a
  singing alphabet, not spelling. An invalid syllable gives `W-ARG-PHONEME`, with a suggested
  repair when one exists, and is sung as `ah`.
- `voicetype` (bass, tenor, alto, soprano, child; unknown gives `W-ARG-VOWEL`), `formant`
  (−12–12 semitones), `ring` (0–1) and `vglide` (seconds, on a mono line).
- On voices: `breath`, `effort` (defaults to `velocity`), `jitter`, `shimmer`, `scoop`
  (−12–0 semitones), `vibdel` (seconds) and `fry`. On `choir`: `unison` (up to 16),
  `scatter` (0–0.06 s) and `width` (0–1).
- `talk` (0–1): how strongly a vowel or syllable shapes a non-voice sound. `overtone`
  (4–16): boosts one harmonic.

### Headphones (Tartlet extensions, TS-40, TS-62, TS-64 to TS-67; see [binaural.md](binaural.md))

- `binaural` (0–40 Hz): an oscillator voice plays one tone per ear, detuned by ±half the
  value, so headphones hear a beat at that rate.
- `azimuth` (−180–180°, 0 ahead, 90 right), `elevation` (−90–90°) and `distance` (0.5–50, 1 is
  the reference): any of them places the sound with HRTF instead of `pan`.
- Per-ear controls: `earsh` (−100–100 cents), `itd` (−40–40 ms), `ild` (−12–12 dB), `iphase`
  (0–180°, oscillators only) and `earswap` (0 or 1).
- `lcutoff`, `rcutoff`, `lhcutoff`, `rhcutoff`: filters on one ear only, in hertz.
- `earsplit`: `harmonics` (oscillators), `bands` or `none`; `splitfreq` (100–8000 Hz) sets
  the crossover for `bands`.
- `icorr` (0–1, noise only): how alike the two ears are.
- `dichotic` (100–2000 Hz, noise only) and `dichoticq` (1–50): a faint pitch heard only
  between the ears.
- `isochronic` (0–40 Hz) and `isodepth` (0–1): loudness pulses, also heard on speakers.
- `irate` (0–10 Hz, oscillators only): rotates the phase between the ears.

Two-ear voices (`binaural`, `earsh`, `iphase`, `earsplit("harmonics")`, `icorr` below 1,
`dichotic`) ignore `pan` and HRTF placement. A track using headphone controls gives
`I-EXT-HEADPHONES`. A constant pulse rate between 3 and 30 Hz (`binaural`, `isochronic` or
`irate`) gives `I-EXT-PULSE`, and hosts may warn before playback. `iphase` at 150° or more
gives `I-EXT-MONO`.

### Space and textures (Tartlet extensions, TS-69 to TS-76)

- `occlude` (0–1): muffles and softens a sound behind a wall.
- `distance` above 1 also darkens the sound and sends more of it to the reverb.
- `posglide` (0–2 s): a placed sound glides from the previous note's position.
- Ambiences: `rain wind fire stream surf crowd`, controlled by `intensity` (0–1) and
  `density` (0.1–200 events per second). Use long notes for beds, for example
  `s("rain").slow(8)`.
- Foley: `drip click tick creak step`. Creatures and machines: `bird insect engine`
  (`note` or `freq` sets their pitch).
- Granular playback on oscillators and noise: `grain` (length, 5–500 ms), `gdensity` (grains
  per second), `gjitter` (0–1) and `gpos` (0–1).

### Spectral shaping (Tartlet extensions, TS-77 to TS-80)

- Equalisers: `lowshelf` and `highshelf` (−18–12 dB, at 200 Hz and 4 kHz; `lsfreq` and
  `hsfreq` move them), `peak` (−18–12 dB) with `peakfreq` and `peakq`, `bandf` with `bandq`
  keeps a band, `notch` with `notchq` removes one, and `tilt` (−6–6 dB per octave around
  1 kHz).
- `fshift` (−2000–2000 Hz) moves every partial by the same number of hertz, so harmonic
  tones turn bell-like.
- `ringmod` (0–4000 Hz) and `ringmix` (0–1) multiply the sound by a sine.
- `spectral` works on the spectrum of short slices: `freeze`, `blur`, `gate`, `robot`,
  `whisper`, `comb`, `shift` or `none`. `samount` (0–1) sets the strength, `sgate` the gate
  level in dB (only for `gate`), `scomb` the comb spacing in hertz (only for `comb`) and
  `sshift` the shift in semitones (only for `shift`). `ssend` (0–1) sends to one spectral
  effect shared by the orbit instead of one per note.

### Impulse responses (Tartlet extensions, TS-81 to TS-85)

- `fir`: a linear-phase filter, `lowpass`, `highpass`, `bandpass`, `bandstop` or `none`,
  with `firfreq` (hertz), `firwidth` (octaves, band designs only) and `firlen` (`short`,
  `medium` or `long`). It delays the sound slightly; playback starts the voice early to
  compensate (`I-DSP-LATENCY`; per-note `spectral` does the same).
- `body`: a generated resonant body, `box`, `guitar`, `violin`, `tube`, `can`, `phone`,
  `radio`, `megaphone` or `none`. `bodysize` (0.25–4) makes it larger or smaller; `bodymix`
  (0–1) sets the wet share.
- `cab`: a speaker cabinet shared by the orbit, `small`, `open`, `closed`, `combo`, `stack`
  or `none`. It suits sounds driven by `shape` or `curve`.
- `spacepre` (0–200 ms) and `spacedamp` (0–1) reshape the tail of a `space` preset.

### Acoustic rendering (Tartlet extensions)

See [acoustic_rendering.md](acoustic_rendering.md). The impulse response is computed from a
description of a simple space: a named shape, a size, a material and positions. It is
rendered ahead of playback and then used as a fixed filter. No file is captured or fetched.

- `cavity`: a small resonant cavity on each voice, `box`, `cylinder`, `sphere`, `tube` (an
   open cylinder) or `none`. It sits where `body` sits. When a track sets both, `cavity` wins
   and `body` gives `W-ARG-UNSUPPORTED`.
   - `cavsize` (0.05–2 m): the largest inside dimension.
   - `cavratio` (0.1–1, default 0.5): the ratio of the smaller dimensions to the largest.
   - `material`: `spruce`, `maple`, `wood`, `metal`, `glass`, `plastic`, `skin` or `felt`.
   - `cavhole` (0–1): the opening as a share of one face. 0 is closed. An opening adds the
     air (Helmholtz) resonance, like the air mode of a guitar body.
   - `cavsrc` (default 0.3) and `cavmic` (default 0.7): the source and listener positions
     along the main axis, 0–1.
   - `cavmix` (0–1, default 1): the wet share.
- `space("model")`: renders the `orbit`'s reverb from a modelled space instead of a preset.
   `room`, `size`, `spacepre` and `spacedamp` still apply. Air absorption is included, and
   `distance` still shifts the dry/wet balance.
   - `spaceshape`: `box`, `cylinder`, `dome` (a half sphere) or `corridor` (a long box).
   - `spacesize` (2–100 m): the largest inside dimension.
   - `spaceratio` (0.1–1, default 0.6): the ratio of the smaller dimensions to the largest.
   - `spacemat`: `concrete`, `stone`, `brick`, `plaster`, `wood`, `glass`, `carpet`,
     `curtain` or `snow`.
   - `spacesrc` (0–1): the source distance from the listener, as a share of the size.
   - An `orbit` has one modelled space at a time; the latest onset wins, and `I-DSP-ORBIT`
     notes when tracks disagree.
- **Positions are constants.** `cavsrc`, `cavmic` and `spacesrc` take constants only. A
   patterned value gives `W-ARG-UNSUPPORTED`, and the default is used.
- **Rendering never delays playback.** Until a response is ready, the voice uses the nearest
   `body` preset, or the `orbit` uses the matching `space` preset (`I-DSP-RENDER`). Responses
   are cached, and only a few renders start per second. A patterned `cavsize`, `material` or
   similar control may therefore play the nearest cached response.

### Response curves and dynamics (Tartlet extensions, TS-86 to TS-89)

- `curve`: a transfer curve, `soft`, `hard`, `tanh`, `tube`, `fold`, `rect`, `half`, `cheby2`
  to `cheby7` or `none`. A loud sine through `chebyN` comes out as its Nth harmonic.
- `drive` (0–24 dB) pushes the sound into the curve. Loudness is compensated, so more drive
  changes the colour, not the volume. `bias` (−0.5–0.5) adds even harmonics; `curvemix`
  (0–1) sets the wet share. `shape` keeps its own fixed curve.
- `comp` (−60–0 dB, 0 is off): the threshold of a compressor shared by the orbit, with
  `compratio` (1–20, default 4), `compknee` (0–40 dB, default 6), `compattack` (default
  3 ms) and `comprelease` (default 250 ms). The latest onset on the orbit sets the settings,
  and `I-DSP-ORBIT` notes when tracks disagree.
- `gate` (dB): silences a voice whenever it falls below the threshold; `gaterelease`
  (0.005–1 s, default 0.1) sets how fast it closes.
- `envcurve`: the amplitude envelope shape, `lin`, `exp` or `log`.
- `velcurve` (0.25–4): bends how velocity maps to loudness; above 1 soft notes get softer.

### Soft checks on controls

- Unknown constant values of enum controls (`earsplit`, `space`, `spectral`, `fir`, `firlen`,
- Controls that the track's sounds or modes ignore give `W-ARG-UNSUPPORTED`: for example
   `body`, `cab`, `curve`, `envcurve`, `cavity`, `material`, `spaceshape`, `spacemat`) give
   `W-ARG-MODE`, and the default is used (for the last four: `none`, `wood`, `box`, `plaster`).
  `iphase` on noise, `icorr` on an oscillator, `scomb` without `spectral("comb")`,
  `firwidth` without a band `fir`, `drive` without a `curve`, `bodysize` without a `body`,
   `spacepre` without a `space`, cavity controls without a `cavity`, `body` on a track that
   also sets `cavity`, space model controls without `space("model")`, and patterned values
   for `cavsrc`, `cavmic` or `spacesrc`.

## Core transforms

"Const" means the argument must be a constant number written in the source (or a constant
binding); "pattern" means it may also be a pattern or signal.

### Time

- `.fast(f)`, `.slow(f)` (pattern): change speed. `slow(0)` is silence.
- `.early(c)`, `.late(c)` (pattern): shift by a number of cycles.
- `.rev()`: mirrors each cycle.
- `.iter(n)`, `.iterBack(n)` (const, 2–1024): each cycle starts one nth further along, or
  back (TS-39).
- `.palindrome()`: forwards on even cycles, backwards on odd ones.
- `.ply(n)` (pattern): repeats each event n times within its own whole.

### Conditional and layering

- `.every(n, f)` (alias `firstOf`; n const): applies `f` on cycles 0, n, 2n and so on (TS-20).
- `.off(c, f)`: layers a copy shifted later by `c` (pattern), with `f` applied to it.
- `.jux(f)`: the original at `pan` 0 and the transformed copy at `pan` 1.
- `.apply(f, …args)`: hands the pattern to a function (TS-48).

### Structure

- `.struct(rhythm)` (pattern): takes its timing from the truthy steps of `rhythm` and keeps
  this pattern's values.
- `.mask(rhythm)` (pattern): silences the pattern wherever `rhythm` is falsy.
- `.euclid(k, n, r?)` (const): keeps the hits of a Euclidean rhythm, rotated left by r.

### Randomness

- `.degradeBy(p)` (pattern): drops events with probability `p`. `.degrade()` uses p = 0.5.
- `.sometimesBy(p, f)` (p const): applies `f` to a seeded share `p` of events.
  `.sometimes(f)` uses p = 0.5. No events are lost either way.
- `.seed(x)` (a constant string or number): pins every random choice below this point to a
  named variation (TS-28).

### Values and pitch

- `.add(x)` (pattern): adds to plain numbers, to notes, or else to `n`.
- `.transpose(x)` (pattern): adds semitones to notes only.
- `.range(lo, hi)` (const): maps values in [0, 1] onto [lo, hi]. Use it with signals.
- `.scale("Root:name")`: turns `n` degrees into notes. A bare root is in octave 3, so
  `C:minor` degree 0 is 48 (TS-11); degrees outside the scale wrap into higher or lower
  octaves. Unknown scales give `E-ARG-SCALE`.

Scales: major / ionian, minor / aeolian, dorian, phrygian, lydian, mixolydian, locrian,
harmonic minor, melodic minor, major pentatonic, minor pentatonic, blues, chromatic, whole
tone, augmented, diminished, phrygian dominant, lydian dominant, hungarian minor, hirajoshi,
in sen and egyptian. Scale names ignore case, spaces, hyphens and underscores, so
`C:harmonicMinor` and `C:Harmonic-Minor` both work (TS-60).

### Naming

- `.label("name")`: names the output, and gives the same id as the `name: …` form (TS-36).

Pitch operations (`.scale`, `.transpose`, `.octave`, `.invert`, `.sequence`, `.rowform`) on a
receiver that plays only samples give `E-CAP-PITCHED` and mute the track (TS-35).

## Standard library (Tartlet L3)

These come from the standard library proposal (TS-53 to TS-60).

### Time and structure

- `.within(b, e, f)` (const, 0–1): applies `f`, keeping only what it plays between b and e of
  each cycle; the rest is left as it was.
- `.chunk(n, f)` (n const): applies `f` to slot (c mod n) of the n slots of cycle c.
  `.chunkBack(n, f)` moves the slot backwards.
- `.lastOf(n, f)` (n const): applies `f` on the last cycle of each group of n.
- `.zoom(b, e)` (const): plays only [b, e) of each cycle, stretched to fill it.
- `.compress(b, e)` (const, 0 ≤ b < e ≤ 1): squeezes each cycle into [b, e), silent elsewhere.
- `.fastGap(f)` (const, f ≥ 1): plays each cycle f times faster, then rests.
- `.linger(f)` (const, 0 < f < 1): repeats the opening fraction f of each cycle.
- `.segment(n)` (const, 1–1024): samples a pattern or signal into n steps per cycle.
- `.hurry(f)` (pattern): `fast(f)` plus `speed` multiplied by f.
- `.swingBy(a, n)` (const): cuts each cycle into n slices and delays events in the second
  half of each slice by `a` of a slice. `.swing(n)` uses a = 1/3.
- `.brak()`: on odd cycles, squeezes the cycle into its middle half.
- `.press()` and `.pressBy(r)` (pattern, 0–1): start every event later by a share of its own
  duration, keeping its end. `press` uses r = 1/2.
- `.superimpose(f)`: stacks a transformed copy on the original.
- `.echo(times, time, feedback)` (const): `times` copies (at most 64), each later by `time`
  cycles and with gain multiplied by `feedback` once more.

### Randomness

All of these are seeded and keep every event; only the choice of which events change is
random.

- `.often(f)` (3/4), `.rarely(f)` (1/4), `.almostNever(f)` (1/10), `.almostAlways(f)` (9/10),
  `.always(f)` and `.never(f)`.
- `.someCyclesBy(p, f)` (p const, 0–1) and `.someCycles(f)`: decide once per cycle.
- `.shuffle(n)` (const): cuts each cycle into n slices and plays each slice once, in a
  seeded order. `.scramble(n)` picks a slice for each slot, so slices may repeat.
- `.undegradeBy(p)` (pattern): keeps a seeded share `p` of events, exactly the ones
  `degradeBy(p)` drops.

### Arithmetic

Arithmetic applies to plain numbers, to the MIDI value of notes, or else to `n`.

- `.sub(x)`, `.mul(x)`, `.div(x)`, `.mod(x)` (pattern). Division or modulo by zero leaves the
  value unchanged; `mod` always gives a result in [0, x).
- `.round()`, `.floor()`, `.ceil()`.
- `.toBipolar()` maps [0, 1] onto [−1, 1]; `.fromBipolar()` maps back.

### Tonal and controls

- `.octave(k)` (pattern): moves notes by k octaves.
- `.accent(rhythm)` (pattern): multiplies `gain` by 1.3 on events whose onset falls on a true
  step. Rests in the rhythm never drop events.

## Long-form composition (Tartlet L3)

These tools from [symphonic.md](symphonic.md) build pieces that unfold over many cycles.
Unless noted, arguments are constants.

### Form

`form(layout, ...parts)` plays sections in order and then repeats.

```js
const verse = n("0 2 4 2").scale("D:minor").s("triangle")
const chorus = n("<4 5> 7").scale("D:minor").s("sawtooth")
$: form("A@8 B@4 A'@8 B@4", verse, chorus)
$: form("A@4 B", s("bd*4"), s("cp")).once()
```

- The layout is a list of sections: a capital letter (A is the first part, B the second, …),
  optional primes, and an optional length in cycles after `@` (default 1). At most 256
  sections.
- Each section starts its part from local time zero, and events are clipped to the section.
- Primes (`A'`, `A''`) make seeded variants: the same part with different random draws.
- `.once()` plays the form a single time and then nothing. On anything but a form it gives
  `W-ARG-UNSUPPORTED`.
- `I-FORM-LENGTH` reports the total length. A section naming a missing part gives
  `E-ARG-MISSING`; a part never named gives `W-FORM-UNUSED`; a malformed layout gives
  `E-ARG-GRAMMAR` at the offending text.

### Shape over time

- `env(points, cycles)`: a breakpoint signal. Points are values with optional `@` weights for
  the segment that follows, joined by straight lines and stretched over `cycles` cycles, then
  repeated: `.gain(env("0 1@3 0", 16))`.
- `.enter(c)`: silent before cycle c. `.exit(c)`: silent from cycle c on.
- `.during(b, e, f, period?)`: applies `f` in cycles b ≤ c < e; with a period, the window
  repeats every `period` cycles.
- `.fadein(k)`: raises `gain` from 0 to full over the first k cycles of the piece.
- `.fadeout(k, at)`: lowers `gain` from full to 0 over k cycles, starting at cycle `at`.

### Motifs and imitation

- `.invert(axis?)`: mirrors values around an axis: 0 for degrees and numbers, middle C (60)
  for notes unless an axis is given.
- `.retro(w?)`: plays each window of w cycles backwards (default 1, the same as `rev`).
- `.sequence(step, copies)`: cycle c is raised by `step × (c mod copies)`; copies 1–1024.
- `.canon(voices, delay, interval?)`: stacks up to 16 copies, each later by `delay` cycles
  and higher by `interval`.
- `.prolation(r1, …, r6)`: stacks copies at the given positive speed ratios.
- `.fragment(f)`: repeats the opening fraction of each cycle, like `linger`.
- `.augment(f)` (pattern): plays f times slower, like `slow`.

### Generators

- `ints(name, steps?, a?, b?)`: a named integer sequence, `steps` values per cycle (1–1024,
  default 1), counted from the start of the piece. Sequences:

  | Name | Values |
    | --- | --- |
  | `ruler` | The number of times 2 divides i + 1: 0 1 0 2 0 1 0 3 … |
  | `thuemorse` | Parity of the bits of i: 0 1 1 0 1 0 0 1 … |
  | `norgard` | Nørgård's infinity series: 0 1 −1 2 1 0 −2 3 … |
  | `fib` | Fibonacci numbers modulo a (default 12). |
  | `sturm` | A Sturmian 0/1 sequence of slope a/b (defaults 1/2). |
  | `vdc` | The van der Corput sequence in base a (default 2), values in [0, 1). |
  | `prime` | 1 when i is prime, else 0. |
  | `collatz` | Collatz steps from i + 1 to 1 (capped at 1024). |
  | `digits` | The digits of 0 1 2 3 … written one after another, in base a (default 10). |

  Unknown names give `W-ARG-MODE` and are silent. Use the result as a value: `n(ints("norgard", 8))`.
- `sieve(expr, steps)`: a rhythm from residue classes over `steps` steps per cycle (1–1024).
  `m@r` keeps steps with remainder r modulo m (m from 1 to 1 000 000); `|` joins, `&`
  intersects, `-` complements, and parentheses group:
  `s("hh").struct(sieve("3@0 | 4@1", 12))`.
- `lsys(axiom, rules, generations, cycles?)`: a rewriting system. Rules look like
  `"a=a b, b=a"`; after `generations` steps (0–16) the symbols are spread evenly over
  `cycles` cycles (default 1). Numeric symbols become numbers, so `n(lsys("0", "0=0 2", 3))`
  works. Results longer than 2²⁰ symbols give `E-LIMIT-GROWTH`; choosing between rules with
  `|` is not supported.
- `row(pitches)`: a twelve-tone row of pitch classes, played like `n`. A constant row that is
  not a permutation of 0–11 gives `W-ARG-ROW` and plays as written.
- `.rowform(form)` (pattern): turns pitch classes into a row form: `P t` transposes by t,
  `I t` inverts, `R t` reverses, `RI t` does both, all modulo 12: `row("0 4 7").rowform("<P0 I5 R3>")`.

### Processes

- `.phase(step)`: cycle c is delayed by c × step, wrapped within the cycle, so a copy drifts
  away from the original and comes back.
- `.additive(n)`: cuts each cycle into n steps and plays one step more each cycle, stretched
  to fill it. `.subtractive(n)` plays one step fewer each cycle. n is 1–1024.
- `.converge(at, r1, …, r6)`: stacks copies at the given speed ratios, shifted so that they
  all reach the same point of the pattern at cycle `at`.
- `.permute(n, k)` (k pattern): cuts each cycle into n slices (2–1024) and plays them in the
  order of the k-th lexicographic permutation.
- `.ring(method, bells)`: cuts each cycle into `bells` slices (3–16) and plays them in
  successive rows of a change-ringing method. Only `plainhunt` exists; it repeats every
  2 × bells cycles. Unknown methods give `W-ARG-MODE`.

`sanity --cycles n` from the CLI reports how often each output repeats (`periods`).

## Sounds

The built-in general kit is synthesized, so it sounds the same everywhere:

- drums: `bd sd hh oh cp rim lt mt ht cr rd`;
- oscillators: `sine square triangle sawtooth`;
- noise: `white pink brown`;
- voices: `voice aah ooh hum whisper choir`;
- ambiences: `rain wind fire stream surf crowd`;
- foley: `drip click tick creak step`;
- creatures and machines: `bird insect engine`.

Common names from other ecosystems fall back to the nearest kit sound, with an
`I-RES-FALLBACK` note when the host checks resources. For example `808bd` and `kick` play
`bd`, `piano` and `rhodes` play `triangle`, `bass` and `pad` play `sawtooth`, `noise` plays
`white`, `vox` plays `voice` and `ocean` plays `surf`. Names with no match give
`W-RES-MISSING` and are silent.

A note event with no `s` plays on `triangle`. Drums, foley and ambiences are not pitched; `n`
on a kit sound has no audible effect, because the kit has one take per sound.

## Samples (Tartlet extension)

TS-90 to TS-94; see [samples.md](samples.md).

```js
sample("kick", "./drums/kick.wav")
samples("./keys/")
$: s("kick*4")
$: note("c4 e4 g4").s("rhodes")
```

Sounds declared with `sample(...)` or found in a bank declared with `samples(...)` play
through one of two interpreters:

- **Impulse** samples (single files, drums, hits) play the whole file from the onset. `n`
  picks a take, modulo the number of takes. `speed` sets the rate. `legato` cuts the sample
  short with a `release` fade.
- **Note** samples (bank entries of kind `note`) are pitched. The take whose zone holds the
  note and velocity is chosen, or else the one with the nearest root (ties go to the lower
  root), and it is transposed at most ±24 semitones. Several takes in one zone are chosen by
  a seeded draw (round robin). They follow the envelope, `legato`, loop points and `glide`.

A bank may set `gm: true`, so events with a General MIDI percussion `note` and no `s` play
the matching drum. Hosts load samples after checking. Events whose sample is still loading
are skipped, and files that break the sample standard (peak at −1 dBFS, no DC offset, no
leading silence, length caps) are normalised on load (`W-RES-FORMAT`). Missing files give
`W-RES-MISSING`, hash mismatches `W-RES-HASH`, and entries without a licence
`I-RES-LICENSE`. Names declared with `sample` are always known to the checker; names a bank
may provide are only known after loading, so they never warn.

## Randomness and determinism

Tartlet has no hidden randomness. Every random choice is a draw keyed by:

- the **root seed**, derived from the host's document id, blob index and the user seed (`seed` attribute or option,
  default `"default"`);
- the **node** making the choice (its id in the IR, salted by mini-notation position for `?`
  and `|`);
- the **time** of the event or cycle concerned.

Consequences:

- The same document, seed and window always give the same events.
- Appending a method (`.gain(.8)`) leaves earlier draws unchanged (X-36).
- Editing one output does not change another output's draws.
- Draws are keyed by the event's whole, so every fragment of an event agrees.
- `.seed("v2")` replaces the seed scope for its subtree; `form` primes do the same per
  section.

## Event values

Querying a program gives events with a whole, a part and a value. Values are control maps:

- `s` gives `{ s: "bd" }`, and `bd:3` gives `{ s: "bd", n: 3 }`.
- `note` gives `{ note: { kind: "midi", value: 48 } }`; `.scale` turns `n` into `note`.
- Every other control appears under its canonical name, as a number or string.

The core also adds seeds in [0, 1) that the audio adapter uses instead of rolling its own
dice: `vseed` on vocal events, `iseed` on events with `icorr`, `tseed` on textures and
granular events, `dseed` on events with a `spectral` effect, and `rseed` (round robin) when
the document declares samples.

## Limits

| Limit                                     | Default       | Diagnostic                                 |
|-------------------------------------------|---------------|--------------------------------------------|
| Source size                               | 65 536 bytes  | `E-LIMIT-SOURCE` (program rejected)        |
| Expression and mini-notation nesting      | 32 levels     | `E-LIMIT-DEPTH`                            |
| Mini-notation factors, replication, steps | 1024          | `E-LIMIT-MULTIPLIER`                       |
| Function expansion per statement          | 10 000 nodes  | `E-LIMIT-EXPAND` (track muted)             |
| Rewriting system length                   | 2²⁰ symbols   | `E-LIMIT-GROWTH` (track muted)             |
| Tempo                                     | 0.001–100 cps | `W-RANGE` (clamped)                        |
| Evaluation work per query window          | 200 000 steps | `E-LIMIT-DENSITY` (track muted at runtime) |
| Events per query window                   | 2048          | `E-LIMIT-DENSITY` (track muted at runtime) |

Runtime limits mute only the track that exceeds them.

## Diagnostics

Every diagnostic has an id, a severity and an effect:

- **error**: the subtree or track is muted, or the whole program is rejected. Other tracks
  keep playing. If nothing can play, `E-PROGRAM-EMPTY` is added.
- **warning**: the track plays; something is dropped, clamped or ignored.
- **info**: a note; nothing changes.

`tartlet check file` prints a repair payload that lists only what must be fixed, scoped to
the broken tracks or definitions; `--all` includes cosmetic notes and `--json` prints every
diagnostic.

| Area               | Ids                                                                                                                                                                                                                         |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Syntax             | `E-SYN-UNEXPECTED`, `E-SYN-UNTERMINATED`, `E-SYN-CHAR`, `E-SYN-EXPR`, `E-NOT-YET`                                                                                                                                           |
| Closed language    | `E-LX-IMPORT`, `E-LX-KEYWORD`, `E-LX-CONTROL`, `E-LX-MEMBER`, `E-LX-ASSIGN`, `E-LX-INTERP`, `E-LX-LAMBDA`, `E-LX-HOST`, `E-LX-PROTO`, `E-LX-SPREAD`, `E-LX-CALL`                                                            |
| Mini-notation      | `E-MINI-CHAR`, `E-MINI-UNEXPECTED`, `E-MINI-UNCLOSED`, `E-MINI-REPLICATE`, `E-MINI-FACTOR`, `E-MINI-WEIGHT`, `E-MINI-DEGRADE`, `E-MINI-EUCLID`, `E-MINI-INDEX`                                                              |
| Names              | `E-NAME-DUP`, `E-NAME-SHADOW`, `E-NAME-UNDEF`, `E-NAME-ERRORED`                                                                                                                                                             |
| Registry           | `E-REG-UNKNOWN` (unknown function, track muted), `W-REG-UNKNOWN` (likely control typo, dropped), `I-REG-ALIAS`                                                                                                              |
| Arguments          | `E-ARG-MISSING`, `E-ARG-TYPE`, `E-ARG-FUNCTION`, `E-ARG-DIVZERO`, `E-ARG-SCALE`, `E-ARG-GRAMMAR`, `E-CAP-PITCHED`, `W-ARG-EXTRA`, `W-RANGE`, `W-ARG-MODE`, `W-ARG-UNSUPPORTED`, `W-ARG-PHONEME`, `W-ARG-VOWEL`, `W-ARG-ROW` |
| Functions and form | `W-FN-UNUSED`, `W-FORM-UNUSED`, `I-FORM-LENGTH`                                                                                                                                                                             |
| Resources          | `E-RES-PATH`, `I-RES-DECLARED`, `I-RES-OVERRIDE`, `I-RES-FALLBACK`, `W-RES-MISSING`; from hosts: `W-RES-FORMAT`, `W-RES-HASH`, `I-RES-LICENSE`                                                                              |
| Limits             | `E-LIMIT-SOURCE`, `E-LIMIT-DEPTH`, `E-LIMIT-MULTIPLIER`, `E-LIMIT-EXPAND`, `E-LIMIT-GROWTH`, `E-LIMIT-DENSITY`                                                                                                              |
| Program            | `E-PROGRAM-EMPTY`, `I-TEMPO-OVERRIDE`                                                                                                                                                                                       |
| Advisories         | `I-EXT-HEADPHONES`, `I-EXT-PULSE`, `I-EXT-MONO`, `I-DSP-LATENCY`, `I-DSP-ORBIT`, `I-DSP-RENDER`                                                                                                                             |

Advisories are also summarised per output in the program (`advisories`: headphones and
pulse range), so hosts can warn before playback.
- `space`: `room`, `hall`, `plate`, `church`, `outdoor` or `model`. It picks the reverb
   character for the `orbit`; `room` and `size` still set the amount and length. `model`
   renders the response from a described space ([below](#acoustic-rendering-tartlet-extensions)).