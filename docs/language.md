# Language reference

This page describes what Tartlet accepts **today**. The registry
(`packages/registry/src/registry.ts`) is authoritative. `npx tsx packages/cli/src/main.ts prompt`
prints a summary generated from it. All prose here is original.

## Program structure

A document is a sequence of statements. Each statement ends at a newline, a `;` or the end of
input (TS-21). A method chain may continue on the next line when that line starts with `.`.

```js
// Comments: line and block comments are kept in the syntax tree.
setcpm(120 / 4); // tempo directive
const kick = s('bd*4'); // binding: evaluated once, must be declared before use
$: kick; // anonymous output; multiple $: outputs are stacked
hats: s('hh*8').gain(0.5); // named output; a duplicate name is E-NAME-DUP
s('cp').label('claps'); // a bare expression is also an output (TS-16)
```

Directives:

- `setcps(n)` sets the tempo in cycles per second.
- `setcpm(n)` sets the tempo in cycles per minute, so the cps is `n / 60`.
- `samples("…")` declares a sample bank. It is recorded in `program.resources`, but nothing
  fetches it yet.

The tempo argument must be a constant. It is clamped to [0.001, 100] cps. When several tempo
directives appear, the last one wins (TS-7). The default is 0.5 cps.

## Values and expressions

- **Numbers.** Arithmetic on constants with `+ - * /` and parentheses is folded exactly at check
  time. `1/8` is the rational 1/8, and constant bindings may be used in arithmetic.
- **Strings.** Single-quoted, double-quoted and backtick strings are all accepted. Backtick
  strings may span lines but may not use `${…}` interpolation. A string passed to a
  pattern-accepting parameter is parsed as mini-notation.
- **Booleans** are accepted. **Arrays** may appear only as the operand of a spread:
  `stack(...[a, b])`.
- **Lambdas.** `x => x.fast(2)`, `(x) => …` and `x => { return …; }` are accepted. The body must
  start from the parameter or be a registry call. Lambdas are lowered to IR and never run as
  JavaScript.
- **Function values.** A registered transform name such as `rev`, or a partial application such
  as `fast(2)`, may be passed wherever a function is expected.

Rejected constructs, with their diagnostics:

- `import` and `export`: `E-LX-IMPORT`.
- `function`, `class`, `new`, `async`, `await`, `var` and similar keywords: `E-LX-KEYWORD`.
- Loops, `if`, `switch`, `return` outside a lambda block, and the `?:` operator:
  `E-LX-CONTROL`.
- `a[b]`, and a member that is not called as a method: `E-LX-MEMBER`.
- Host names such as `window`, `fetch` and `globalThis`: `E-LX-HOST`.
- `__proto__`, `constructor` and `prototype`: `E-LX-PROTO`.
- Assignment: `E-LX-ASSIGN`.
- Spreading anything other than an array literal: `E-LX-SPREAD`.
- Object literals: `E-NOT-YET` (TS-23).

## Functions

A `const` binding whose value is a lambda names a function (TS-48). Its parameters may have
constant defaults.

```js
const chop = (x, n = 2) => x.ply(n).gain(0.8);
const beat = (k) => s('bd').euclid(k, 8);

$: s('hh*4').every(4, chop(3)); // as a function value; arguments follow the pattern
$: s('sd*2').apply(chop, 3); // through .apply
$: s('cp*2').chop(); // as a method
$: beat(5); // as a pattern builder
```

- Functions are expanded inline when the document is checked. Nothing runs as JavaScript.
- A function can only use names declared before it, so recursion is impossible.
- A parameter can be a function. Call it with `x.apply(f)`, not `f(x)` (`E-LX-CALL`).
- Names may not shadow built-in names (`E-NAME-SHADOW`).
- Errors inside a body are reported once at the definition, and every track that calls it is
  muted. Problems caused by one call are reported at that call.

## Mini-notation

Inside strings:

- `a b c` divides the cycle equally among the steps.
- `~` is a rest.
- `[a b]` is a subdivision: a group occupying one step.
- `<a b c>` is alternation: one item per cycle. Nested alternations advance, so `<a <b c>>`
  plays a b a c (TS-14).
- `a, b` plays its parts simultaneously, at the top level or inside brackets.
- `a*n` and `a/n` speed up or slow down a step. The factor may itself be a pattern: `a*<2 3>`.
- `a!n` replicates a step n times. A bare `a !` repeats the previous step, and a bare `!` at
  the start is an error (TS-9).
- `a@n` gives a step a relative weight of n.
- `a?` drops events at random with probability 0.5. `a?0.3` drops with probability 0.3.
- `a(k,n)` and `a(k,n,r)` play a Euclidean rhythm. Every argument may be a pattern, and the
  rotation goes left (TS-19).
- `{a b c, d e}` is a polymeter. Steps per cycle default to the total weight of the first layer
  (TS-29). `{…}%n` sets the steps per cycle explicitly.
- `a | b` picks one option per cycle with a seeded draw. `|` binds looser than a sequence and
  tighter than `,` (TS-30).
- `a . b c` uses a standalone `.` to separate equal groups. `.5` remains a number (TS-31).
- `bd:3` selects a sample index.

Atoms are runs of letters, digits and `# . - _ ^ '`. Note names are `c d e f g a b` with
optional accidentals `#`/`s` (sharp) or `b`/`f` (flat) and an optional octave. A bare note
defaults to octave 3, so `c3` = MIDI 48. Factors, replication counts, polymeter steps and
Euclidean step counts are capped at 1024. Nesting is capped at 32 levels.

## Constructors

- `s(pat)` (alias `sound`) chooses the sound. Atoms are sample names, and `name:i` sets `n`.
- `note(pat)` takes note names or MIDI numbers and produces `note: { kind: 'midi', value }`.
- `n(pat)` and every other control can also start a pattern.
- `stack(...)` layers its arguments. `cat(...)` / `slowcat(...)` play one argument per cycle.
  `seq(...)` / `fastcat(...)` squeeze all arguments into each cycle.
- `silence` is a pattern with no events.
- Signals produce values in [0, 1]:
  - `sine` and `cosine`;
  - `saw` and `isaw`;
  - `tri` and `square`;
  - `rand`, which is seeded.

  A receiver samples a signal at its own onsets (TS-33).

## Controls

Every control accepts a constant or a pattern. The first name listed is canonical.

- Sound and pitch: `s` / `sound`, `note`, `n`, `freq`.
- Level and position: `gain` (0–1.5), `velocity` (0–1), `pan` (0 left, 1 right).
- Samples: `speed`.
- Filters:
  - `cutoff` / `lpf` (20–20000 Hz);
  - `resonance` / `lpq`;
  - `hcutoff` / `hpf`.
- Envelope: `attack`, `decay`, `sustain`, `release`.
- Effects:
  - `room` (compatibility alias `reverb`) and `size`;
  - `delay`, `delaytime`, and `delayfeedback` (compatibility alias `feedback`);
  - `shape`, `crush`, `vowel`;
  - `orbit`.
- Headphones (Tartlet extension, TS-40):
  - `binaural` (0–40 Hz): an oscillator voice plays one tone per ear, detuned by ±half the
    value, so headphones hear a beat at that rate. Binaural voices ignore panning.
  - `azimuth` (−180–180°, 0 ahead, 90 right), `elevation` (−90–90°) and `distance`
    (0.5–50, 1 is the reference): any of them places the sound with HRTF instead of `pan`.
- Synthesis (Tartlet extensions, TS-42):
  - filter envelope: `lpenv` (octaves, −8–8), `lpattack`, `lpdecay`, `lpsustain`,
    `lprelease`;
  - pitch envelope: `penv` (semitones) and `pdecay` (seconds);
  - `vib` (alias `vibrato`) and `vibdepth`; `trem` (alias `tremolo`) and `tremdepth`;
  - `fm` / `fmi` (index) and `fmh` (modulator ratio);
  - `pw`: pulse width of square voices;
  - `unison` (1–8 copies) and `detune` (total spread in cents);
  - `timbre`: `organ`, `hollow`, `bright`, `soft`, `reed` or `glass`;
  - `mono` (line number) and `glide` (alias `portamento`, seconds): a new note on a mono line
    ends the previous one, and `glide` slides into it.
- Voices (Tartlet extensions, TS-43 to TS-47; see [vocals.md](vocals.md)):
  - `syl`: a phonetic syllable such as `la`, `shee` or `mi_a_u`. A lone `_` holds the vowel.
    The alphabet has the vowels `a e i o u ae ah aw eh er ih oh oo uh` (and `ee` for `i`) and
    the consonants `p t k b d g f s sh h v z th m n ng l r w y`.
  - `vowel`, `voicetype` (bass, tenor, alto, soprano, child), `formant` (semitones), `ring`
    and `vglide` (seconds, on a mono line);
  - `breath`, `effort` (defaults to `velocity`), `jitter`, `shimmer`, `scoop`, `vibdel` and
    `fry` on voices; `unison`, `scatter` and `width` on `choir`;
  - `talk`: how strongly a vowel or syllable shapes a non-voice sound. `overtone`: boosts one
    harmonic (4–16).

A constant outside a control's range gives `W-RANGE`. The IR keeps the authored value, and the
audio adapter clamps it. Every control is audible (TS-41). `n` only selects a scale degree:
the general kit has one take per sound, so sample variants do not change the sound yet.
`room` and `delay` send to reverb and delay buses shared per `orbit`; `delaytime` is in seconds.

## Transforms

- `.fast(f)`, `.slow(f)`: change speed. The factor may be a pattern.
- `.early(c)`, `.late(c)`: shift in time by a number of cycles. The amount may be a pattern.
- `.rev()`: mirrors each cycle.
- `.every(n, f)` (alias `firstOf`): applies `f` on cycles 0, n, 2n and so on. `n` must be a
  constant (TS-20).
- `.off(c, f)`: layers a copy shifted by `c`, with `f` applied to the copy.
- `.jux(f)`: plays the original at `pan` 0 and the transformed copy at `pan` 1.
- `.ply(n)`: repeats each event n times within its own whole.
- `.struct(rhythm)`: takes its rhythm from the truthy steps of `rhythm`.
- `.mask(rhythm)`: silences the pattern wherever `rhythm` is falsy. `0`, `~`, `f`, `false` and
  the empty string are falsy.
- `.euclid(k, n, r?)`: keeps the hits of a Euclidean rhythm. All arguments must be constants.
- `.degradeBy(p)`: drops events with probability `p`. `.degrade()` uses p = 0.5.
- `.sometimesBy(p, f)`: applies `f` to a seeded share `p` of events. `p` must be a constant.
  `.sometimes(f)` uses p = 0.5. No events are lost either way.
- `.add(x)`: adds to notes, `n`, or plain numbers. `.transpose(x)` adds to notes only. Both
  accept a pattern.
- `.range(lo, hi)`: maps values in [0, 1] onto [lo, hi]. Use it with signals.
- `.scale("Root:name")`: turns `n` degrees into notes. Available scales:
  - major / ionian and minor / aeolian;
  - dorian, phrygian, lydian, mixolydian and locrian;
  - harmonic minor and melodic minor;
  - major pentatonic and minor pentatonic;
  - blues and chromatic.

  A bare root is in octave 3, so `C:minor` degree 0 is 48 (TS-11).

- `.seed(x)`: pins every random choice below this point to a named variation (TS-28).
- `.label("name")`: names the output, and gives the same id as the `name: …` form (TS-36).

`.scale` and `.transpose` on a receiver that plays only samples give `E-CAP-PITCHED` (TS-35).

## Library (Tartlet L3)

These come from the standard library proposal (TS-53 to TS-60). Constant-only arguments are
marked "const".

- Time and structure:
  - `.within(b, e, f)`: applies `f`, keeping what it plays between b and e of each cycle
    (const, 0–1).
  - `.chunk(n, f)` and `.chunkBack(n, f)`: apply `f` to a moving 1/n of each cycle.
  - `.lastOf(n, f)`: applies `f` on the last cycle of each group of n.
  - `.zoom(b, e)`, `.compress(b, e)`, `.fastGap(f)` and `.linger(f)`: reshape each cycle.
  - `.segment(n)`: samples a pattern or signal into n steps per cycle.
  - `.hurry(f)`: `fast` plus a matching `speed`.
  - `.swingBy(a, n)` and `.swing(n)`: delay every second subdivision.
  - `.brak()`, `.press()` and `.pressBy(r)`.
  - `.superimpose(f)`: stacks a transformed copy. `.echo(times, time, feedback)`: fading
    delayed copies.
  - `run(n)`: the numbers 0 … n−1 in each cycle, for example `n(run(8)).scale("C:major")`.
- Randomness, all seeded:
  - `.often(f)`, `.rarely(f)`, `.almostNever(f)`, `.almostAlways(f)`, `.always(f)` and
    `.never(f)`;
  - `.someCyclesBy(p, f)` and `.someCycles(f)`: decide once per cycle;
  - `.shuffle(n)` (each slice once) and `.scramble(n)` (slices may repeat);
  - `.undegradeBy(p)`: keeps a share `p` of events;
  - signals: `irand(n)` (whole numbers below n) and `perlin` (smooth noise).
- Arithmetic: `.sub`, `.mul`, `.div` and `.mod` (patternable), `.round()`, `.floor()` and
  `.ceil()`; `.toBipolar()` and `.fromBipolar()` for signals.
- Tonal: `.octave(k)` moves notes by octaves.
- Controls: `legato` (alias `clip`) scales note length; `nudge` moves notes in seconds;
  `.accent(rhythm)` makes events louder on true steps.
  More scales: whole tone, augmented, diminished, phrygian dominant, lydian dominant, hungarian
  minor, hirajoshi, in sen and egyptian. Scale names ignore case, spaces, hyphens and
  underscores. Library names are reserved: they cannot be used as binding names.

## Sounds

The built-in general kit is synthesized:

- drums: `bd sd hh oh cp rim lt mt ht cr rd`;
- oscillators: `sine square triangle sawtooth`;
- noise: `white pink brown`.

Common names from other ecosystems fall back to the nearest kit sound, with an `I-RES-FALLBACK`
note. For example `808bd` plays `bd`, and `piano` and `rhodes` play `triangle`. A note event
with no `s` plays on `triangle`.

- voices: `voice aah ooh hum whisper choir`.

  - per-ear controls (TS-62): `earsh` (−100–100 cents), `itd` (−40–40 ms), `ild` (−12–12 dB),
    `iphase` (0–180°, oscillators only) and `earswap` (0 or 1).
  - more headphone controls (TS-64 to TS-67, see [binaural.md](binaural.md)):
    - `lcutoff`, `rcutoff`, `lhcutoff`, `rhcutoff`: filters on one ear only, in hertz;
    - `earsplit`: `harmonics` (oscillators), `bands` or `none`; `splitfreq` sets the crossover
      for `bands`;
    - `icorr` (0–1, noise only): how alike the two ears are;
    - `dichotic` (100–2000 Hz, noise only) and `dichoticq` (1–50): a faint pitch heard only
      between the ears;
    - `isochronic` (0–40 Hz) and `isodepth` (0–1): loudness pulses, also heard on speakers;
    - `irate` (0–10 Hz, oscillators only): rotates the phase between the ears.

## Space and textures (Tartlet extensions, TS-69 to TS-76)

- `space`: `room`, `hall`, `plate`, `church` or `outdoor`. It picks the reverb character for
  the `orbit`; `room` and `size` still set the amount and length.
- `occlude` (0–1): muffles and softens a sound behind a wall.
- `distance` above 1 also darkens the sound and sends more of it to the reverb.
- `posglide` (0–2 s): a placed sound glides from the previous note's position.
- Ambiences: `rain wind fire stream surf crowd`, controlled by `intensity` (0–1) and `density`
  (events per second). Use long notes for beds, for example `s("rain").slow(8)`.
- Foley: `drip click tick creak step`. Creatures and machines: `bird insect engine`.
- Granular playback on oscillators and noise:
  - `grain`: grain length in ms;
  - `gdensity`: grains per second;
  - `gjitter`: how far grains wander, 0–1;
  - `gpos`: where grains are read from, 0–1.
