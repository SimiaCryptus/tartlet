# Language reference

This page describes what Tartlet accepts **today**. The registry
(`packages/registry/src/registry.ts`) is authoritative. `npx tsx packages/cli/src/main.ts prompt`
prints a short summary generated from it. All prose here is original.

Names marked "Tartlet extension" are not part of the Strudel language family. Most extension
names are registry level L3, so they are left out of the generated system prompt.

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

### Directives

- `setcps(n)` sets the tempo in cycles per second. `setcpm(n)` sets it in cycles per minute,
  so the cps is `n / 60`. The argument must be a constant. It is clamped to [0.001, 100] cps.
  When several tempo directives appear, the last one wins (TS-7). The default is 0.5 cps.
- `samples("keys/")` or `samples("strings.json")` declares a sample bank from the host's sample
  collection: a directory ending in `/` (which holds a `manifest.json`) or a `.json` manifest
  (TS-90). A spec containing `:`, such as `samples("github:user/repo")`, is recorded as a
  remote bank and never fetched (X-31).
- `sample("kick", "./drums/kick.wav")` binds one WAV file to a sound name (Tartlet extension).
  Sound names start with a letter, then letters, digits, `_` or `-`. A name that matches a kit
  sound replaces it in this document (`I-RES-OVERRIDE`).

Sample paths are relative to the host's root, ASCII only and at most 256 bytes. Absolute paths,
URL schemes, backslashes, empty segments and `..` are rejected with `E-RES-PATH`. The checker
never reads files: hosts load samples (see [embedding.md](embedding.md#samples)).

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
- Calling a parameter or a pattern binding: `E-LX-CALL`.
- Object literals: `E-NOT-YET` (TS-23).

## Functions

A `const` binding whose value is a lambda names a function (TS-48, Tartlet extension). Its
parameters may have constant defaults.

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
- Names may not shadow built-in names (`E-NAME-SHADOW`). This includes every registry name,
  extension controls such as `peak`, `gate`, `body` and `space`, and library names such as
  `swing` or `run`.
- An unused parameter gives `W-FN-UNUSED`.
- Errors inside a body are reported once at the definition, and every track that calls it is
  muted with `E-NAME-ERRORED`. Problems caused by one call are reported at that call.
- Expansion is capped by `maxExpandedNodes` (10 000 by default, `E-LIMIT-EXPAND`).

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

- `s(pat)` (alias `sound`) chooses the sound. Atoms are sound names, and `name:i` sets `n`.
- `note(pat)` takes note names or MIDI numbers and produces `note: { kind: 'midi', value }`.
- `n(pat)` and every other control can also start a pattern.
- `stack(...)` layers its arguments. `cat(...)` / `slowcat(...)` play one argument per cycle.
  `seq(...)` / `fastcat(...)` squeeze all arguments into each cycle.
- `run(n)` counts 0 … n−1 across each cycle (L3).
- `silence` is a pattern with no events.
- Signals produce values in [0, 1]:
  - `sine` and `cosine`;
  - `saw` and `isaw`;
  - `tri` and `square`;
  - `rand`, which is seeded;
  - `perlin`, smooth seeded noise (L3);
  - `irand(n)`, seeded whole numbers below n (L3).

  A receiver samples a signal at its own onsets (TS-33). Use `.segment(n)` to turn a signal
  into n steps per cycle.

## Controls

Every control accepts a constant or a pattern. The first name listed is canonical. A constant
outside a control's range gives `W-RANGE`: the IR keeps the authored value, and the audio
adapter clamps it.

- Sound and pitch: `s` / `sound`, `note`, `n`, `freq`.
- Level and position: `gain` (0–1.5), `velocity` (0–1), `pan` (0 left, 1 right).
- Samples: `speed` (its magnitude, 1/8 to 8; negative values are not reversed yet).
- Filters: `cutoff` / `lpf` (20–20000 Hz), `resonance` / `lpq`, `hcutoff` / `hpf`.
- Envelope: `attack`, `decay`, `sustain` (defaults to 1, so `decay` alone changes nothing),
  `release`.
- Effects:
  - `room` (compatibility alias `reverb`) and `size`: a convolution reverb shared per `orbit`;
  - `delay`, `delaytime` (seconds) and `delayfeedback` (compatibility alias `feedback`): a
    feedback delay shared per `orbit`;
  - `shape`, `crush` and `vowel`;
  - `orbit` (0–15).
- Note length and timing (L3, TS-59): `legato` (alias `clip`) scales how long a note sounds;
  `nudge` moves it by a few seconds of real time.

### Synthesis (Tartlet extensions, TS-41, TS-42)

- Noise sounds: `white`, `pink`, `brown`.
- Filter envelope: `lpenv` (octaves, −8–8), `lpattack`, `lpdecay`, `lpsustain`, `lprelease`.
- Pitch envelope: `penv` (semitones) and `pdecay` (seconds).
- `vib` (alias `vibrato`) and `vibdepth`; `trem` (alias `tremolo`) and `tremdepth`.
- `fm` / `fmi` (index) and `fmh` (modulator ratio).
- `pw`: pulse width of square voices.
- `unison` (1–8 copies on oscillators) and `detune` (total spread in cents).
- `timbre`: `organ`, `hollow`, `bright`, `soft`, `reed` or `glass`.
- `mono` (line number) and `glide` (alias `portamento`, seconds): a new note on a mono line
  ends the previous one, and `glide` slides into it. On drums, `mono` acts as a choke group.

### Voices (Tartlet extensions, TS-43 to TS-47; see [vocals.md](vocals.md))

- Sounds: `voice`, `aah`, `ooh`, `hum`, `whisper`, `choir`.
- `syl`: a phonetic syllable such as `la`, `shee` or `mi_a_u`. A lone `_` holds the vowel. The
  alphabet has the vowels `a e i o u ae ah aw eh er ih oh oo uh` (and `ee` for `i`) and the
  consonants `p t k b d g f s sh h v z th m n ng l r w y`. It is a singing alphabet, not
  spelling.
- `vowel`, `voicetype` (bass, tenor, alto, soprano, child), `formant` (semitones), `ring` and
  `vglide` (seconds, on a mono line).
- On voices: `breath`, `effort` (defaults to `velocity`), `jitter`, `shimmer`, `scoop`,
  `vibdel` and `fry`. On `choir`: `unison` (up to 16), `scatter` and `width`.
- `talk`: how strongly a vowel or syllable shapes a non-voice sound. `overtone`: boosts one
  harmonic (4–16).

### Headphones (Tartlet extensions, TS-40, TS-62, TS-64 to TS-67; see [binaural.md](binaural.md))

- `binaural` (0–40 Hz): an oscillator voice plays one tone per ear, detuned by ±half the value,
  so headphones hear a beat at that rate.
- `azimuth` (−180–180°, 0 ahead, 90 right), `elevation` (−90–90°) and `distance` (0.5–50, 1 is
  the reference): any of them places the sound with HRTF instead of `pan`.
- Per-ear controls: `earsh` (−100–100 cents), `itd` (−40–40 ms), `ild` (−12–12 dB), `iphase`
  (0–180°, oscillators only) and `earswap` (0 or 1).
- `lcutoff`, `rcutoff`, `lhcutoff`, `rhcutoff`: filters on one ear only, in hertz.
- `earsplit`: `harmonics` (oscillators), `bands` or `none`; `splitfreq` sets the crossover for
  `bands`.
- `icorr` (0–1, noise only): how alike the two ears are.
- `dichotic` (100–2000 Hz, noise only) and `dichoticq` (1–50): a faint pitch heard only between
  the ears.
- `isochronic` (0–40 Hz) and `isodepth` (0–1): loudness pulses, also heard on speakers.
- `irate` (0–10 Hz, oscillators only): rotates the phase between the ears.

Two-ear voices (`binaural`, `earsh`, `iphase`, `earsplit("harmonics")`, `icorr` below 1,
`dichotic`) ignore `pan` and HRTF placement. A constant pulse rate between 3 and 30 Hz
(`binaural`, `isochronic` or `irate`) gives `I-EXT-PULSE`, and hosts may warn before playback.

### Space and textures (Tartlet extensions, TS-69 to TS-76)

- `space`: `room`, `hall`, `plate`, `church` or `outdoor`. It picks the reverb character for
  the `orbit`; `room` and `size` still set the amount and length.
- `occlude` (0–1): muffles and softens a sound behind a wall.
- `distance` above 1 also darkens the sound and sends more of it to the reverb.
- `posglide` (0–2 s): a placed sound glides from the previous note's position.
- Ambiences: `rain wind fire stream surf crowd`, controlled by `intensity` (0–1) and `density`
  (events per second). Use long notes for beds, for example `s("rain").slow(8)`.
- Foley: `drip click tick creak step`. Creatures and machines: `bird insect engine`.
- Granular playback on oscillators and noise: `grain` (length in ms), `gdensity` (grains per
  second), `gjitter` (0–1) and `gpos` (0–1).

### Spectral shaping (Tartlet extensions, TS-77 to TS-80)

- Equalisers: `lowshelf` and `highshelf` (−18–12 dB, at 200 Hz and 4 kHz; `lsfreq` and
  `hsfreq` move them), `peak` (−18–12 dB) with `peakfreq` and `peakq`, `bandf` with `bandq`
  keeps a band, `notch` with `notchq` removes one, and `tilt` (−6–6 dB per octave around
  1 kHz).
- `fshift` (−2000–2000 Hz) moves every partial by the same number of hertz, so harmonic tones
  turn bell-like.
- `ringmod` (0–4000 Hz) and `ringmix` (0–1) multiply the sound by a sine.
- `spectral` works on the spectrum of short slices: `freeze`, `blur`, `gate`, `robot`,
  `whisper`, `comb`, `shift` or `none`. `samount` (0–1) sets the strength, `sgate` the gate
  level in dB, `scomb` the comb spacing in hertz and `sshift` the shift in semitones. `ssend`
  (0–1) sends to one spectral effect shared by the orbit instead of one per note.

### Impulse responses (Tartlet extensions, TS-81 to TS-85)

- `fir`: a linear-phase filter, `lowpass`, `highpass`, `bandpass`, `bandstop` or `none`, with
  `firfreq` (hertz), `firwidth` (octaves, band designs only) and `firlen` (`short`, `medium` or
  `long`). It delays the sound slightly; playback starts the voice early to compensate
  (`I-DSP-LATENCY`).
- `body`: a generated resonant body, `box`, `guitar`, `violin`, `tube`, `can`, `phone`,
  `radio`, `megaphone` or `none`. `bodysize` (0.25–4) makes it larger or smaller; `bodymix`
  (0–1) sets the wet share.
- `cab`: a speaker cabinet shared by the orbit, `small`, `open`, `closed`, `combo`, `stack` or
  `none`. It suits sounds driven by `shape` or `curve`.
- `spacepre` (0–200 ms) and `spacedamp` (0–1) reshape the tail of a `space` preset.

### Response curves and dynamics (Tartlet extensions, TS-86 to TS-89)

- `curve`: a transfer curve, `soft`, `hard`, `tanh`, `tube`, `fold`, `rect`, `half`, `cheby2`
  to `cheby7` or `none`. A loud sine through `chebyN` comes out as its Nth harmonic.
- `drive` (0–24 dB) pushes the sound into the curve. Loudness is compensated, so more drive
  changes the colour, not the volume. `bias` (−0.5–0.5) adds even harmonics; `curvemix` (0–1)
  sets the wet share. `shape` keeps its own fixed curve.
- `comp` (−60–0 dB, 0 is off): the threshold of a compressor shared by the orbit, with
  `compratio` (1–20, default 4), `compknee` (0–40 dB, default 6), `compattack` (default 3 ms)
  and `comprelease` (default 250 ms). The latest onset on the orbit sets the settings, and
  `I-DSP-ORBIT` notes when tracks disagree.
- `gate` (dB): silences a voice whenever it falls below the threshold; `gaterelease`
  (0.005–1 s, default 0.1) sets how fast it closes.
- `envcurve`: the amplitude envelope shape, `lin`, `exp` or `log`.
- `velcurve` (0.25–4): bends how velocity maps to loudness; above 1 soft notes get softer.

Unknown constant values of enum controls (`earsplit`, `space`, `spectral`, `fir`, `firlen`,
`body`, `cab`, `curve`, `envcurve`) give `W-ARG-MODE`, and the default is used. Controls that
the track's sounds or modes ignore give `W-ARG-UNSUPPORTED`.

## Transforms

- `.fast(f)`, `.slow(f)`: change speed. The factor may be a pattern.
- `.early(c)`, `.late(c)`: shift in time by a number of cycles. The amount may be a pattern.
- `.rev()`: mirrors each cycle.
- `.every(n, f)` (alias `firstOf`): applies `f` on cycles 0, n, 2n and so on. `n` must be a
  constant (TS-20).
- `.iter(n)`, `.iterBack(n)`: start each cycle one nth further along, or back (TS-39). `n` must
  be a constant.
- `.palindrome()`: forwards on even cycles, backwards on odd ones.
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
- `.scale("Root:name")`: turns `n` degrees into notes. A bare root is in octave 3, so
  `C:minor` degree 0 is 48 (TS-11). Scales: major / ionian, minor / aeolian, dorian, phrygian,
  lydian, mixolydian, locrian, harmonic minor, melodic minor, major pentatonic, minor
  pentatonic, blues, chromatic, whole tone, augmented, diminished, phrygian dominant, lydian
  dominant, hungarian minor, hirajoshi, in sen and egyptian. Scale names ignore case, spaces,
  hyphens and underscores (TS-60).
- `.seed(x)`: pins every random choice below this point to a named variation (TS-28).
- `.label("name")`: names the output, and gives the same id as the `name: …` form (TS-36).
- `.apply(f, …args)`: hands the pattern to a function (TS-48).

`.scale`, `.transpose` and `.octave` on a receiver that plays only samples give
`E-CAP-PITCHED` (TS-35).

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
- Randomness, all seeded:
  - `.often(f)`, `.rarely(f)`, `.almostNever(f)`, `.almostAlways(f)`, `.always(f)` and
    `.never(f)`;
  - `.someCyclesBy(p, f)` and `.someCycles(f)`: decide once per cycle;
  - `.shuffle(n)` (each slice once) and `.scramble(n)` (slices may repeat);
  - `.undegradeBy(p)`: keeps a share `p` of events.
- Arithmetic: `.sub`, `.mul`, `.div` and `.mod` (patternable), `.round()`, `.floor()` and
  `.ceil()`; `.toBipolar()` and `.fromBipolar()` for signals.
- Tonal: `.octave(k)` moves notes by octaves.
- Controls: `.accent(rhythm)` makes events louder on true steps.

## Sounds

The built-in general kit is synthesized, so it sounds the same everywhere:

- drums: `bd sd hh oh cp rim lt mt ht cr rd`;
- oscillators: `sine square triangle sawtooth`;
- noise: `white pink brown`;
- voices: `voice aah ooh hum whisper choir`;
- ambiences: `rain wind fire stream surf crowd`;
- foley: `drip click tick creak step`;
- creatures and machines: `bird insect engine`.

Common names from other ecosystems fall back to the nearest kit sound, with an `I-RES-FALLBACK`
note. For example `808bd` plays `bd`, `piano` and `rhodes` play `triangle`, and `ocean` plays
`surf`. A note event with no `s` plays on `triangle`. Drums, foley and ambiences are not
pitched; `n` on a kit sound has no audible effect, because the kit has one take per sound.

## Samples (Tartlet extension, TS-90 to TS-94; see [samples.md](samples.md))

Sounds declared with `sample(...)` or found in a bank declared with `samples(...)` play through
one of two interpreters:

- **Impulse** samples (single files, drums, hits) play the whole file from the onset. `n`
  picks a take, modulo the number of takes. `speed` sets the rate. `legato` cuts the sample
  short with a `release` fade.
- **Note** samples (bank entries of kind `note`) are pitched. The take whose zone holds the
  note and velocity is chosen, or else the one with the nearest root, and it is transposed at
  most ±24 semitones. Several takes in one zone are chosen by a seeded draw (round robin). They
  follow the envelope, `legato`, loop points and `glide`.

A bank may set `gm: true`, so events with a General MIDI percussion `note` and no `s` play the
matching drum. Hosts load samples after checking. Events whose sample is still loading are
skipped, and files that break the sample standard are normalised on load (`W-RES-FORMAT`).