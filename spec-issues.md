# Spec issues

Ambiguities found during implementation. None are resolved silently in code. Each code site
cites its ID.

TS-1 to TS-10 are seeded from plan.md §13 and still open. The T0 status of each:

- **TS-2:** T0 treats a standalone `.` as the T2 group separator and rejects it with
  `E-MINI-UNSUPPORTED`. `.5` lexes as a number.
- **TS-3:** adopted provisionally. `cat` lowers to `slowcat`, `seq` to `fastcat`, and the IR
  gains a `timecat` op.
- **TS-6:** adopted. A duplicate named label gives `E-NAME-DUP`, and `$` outputs stack.
- **TS-7:** adopted. The last tempo directive wins, with `I-TEMPO-OVERRIDE`.
- **TS-8:** adopted. Ranges are blob-relative.
- **TS-9:** adopted. `"! a"` produces `E-MINI-REPLICATE`.

## Found during T0

- **TS-11: scale root octave.** X-03 expects C, Eb, G, but no octave is specified. T0 uses
  octave 3 for a bare root (`C` = 48). Needs an oracle spec before T2.
- **TS-12: fragment consistency vs receiver structure.** §8.6 says a receiver event combines
  with each argument event active within it, splitting the part. So two fragments of one whole
  can carry different values, which contradicts §8.3 law 4. T0 follows §8.6. The law test
  exempts control merges until resolved.
- **TS-13: package graph.** `MiniNode.ast: MiniAst` (§9.2) makes `@tartlet/ir` depend on
  `@tartlet/mini` (type-only). §6.3 lists `ir → time` only. T0 adds the edge.
- **TS-14: nested alternation.** In `<a b>`, child _i_ is queried at cycle floor(k/n), so
  `<a <b c>>` gives a, b, a, c. Needs oracle confirmation.
- **TS-15: `MiniNode.textOffset`.** Provenance needs the string-content offset in the
  document. T0 adds `textOffset` (a UTF-16 index) to `MiniNode`. `Offset.col` is in UTF-16
  code units, and `Offset.byte` is UTF-8.
- **TS-16: multiple bare expressions.** §7.3 says "a bare expression, which is the output
  pattern". T0 stacks every bare top-level expression as an unlabelled output.

## Found during T1

- **TS-17: draw salt for `?`.** Two `?` operators in one string must draw independently.
  `MiniOp.degrade` gains an optional `at` (the string offset of the `?`), used as a salt.
  The draw is keyed by (node seed, salt, cycle, whole.begin, 0).
- **TS-18: seed chaining.** §8.4 writes node seed = hash(parent seed, node id). Chaining
  would reseed an inner `?` whenever a seeded transform is wrapped around it, which breaks
  §12.1 D ("edits outside a subtree leave its draws unchanged"). T1 uses
  hash(root seed, node id). Node ids are already structural and unique, so they carry the
  path. `.seed()` (T2) will need a decision here.
- **TS-19: Euclid rotation direction.** §7.2 says "optional rotation" without a direction.
  T1 rotates left: `(3,8,2)` gives onsets at 1/8, 1/2 and 3/4. Needs an oracle spec.
- **TS-20: `every` count.** Only a constant `n` is accepted in T1. Whether it is patternable
  is open.
- **TS-21: statement termination.** A statement must end at a newline, `;` or end of input.
  `s("a") s("b")` on one line is an error, which matches JavaScript.
- **TS-22: lambda parameter references.** §9.2 says a lambda body "contains a RefNode to
  param". T1 encodes this as `binding: "param:<name>"`. Ingestion validation treats the
  `param:` prefix as local.
- **TS-23: object literals.** §7.3 accepts plain objects as literals, but no L2 entry takes
  one yet. T1 emits `E-NOT-YET`.
- **TS-24: new diagnostic ids.** T1 adds the following ids, which are not listed in §7.3:
  - `E-LX-KEYWORD` for `function`, `class`, `new`, `async`, `await`, `var` and similar;
  - `E-LX-PROTO` for `__proto__`, `constructor` and `prototype`;
  - `E-LX-SPREAD`;
  - `E-LX-ASSIGN`;
  - `E-ARG-FUNCTION`;
  - `W-ARG-EXTRA`.
- **TS-25: program rejection.** When no output is playable and errors exist, the checker
  adds `E-PROGRAM-EMPTY` with effect `program-rejected` (§10.2 rule 6).
- **TS-26: Q-09 example.** `s("bd").mask("0")` cannot check cleanly in T1, because `mask`
  is a T2 transform and its name is an edit-distance-2 neighbour of `fast`. The S-row test
  uses `s("~ ~")` until `mask` lands.
- **TS-27: T0 test expectations corrected.** In X-07, `s(cat("a","b"))` plays a then b. In
  X-09, cycle 1 of `.slow("<1 2>")` holds one onset. Both follow from §8.6 window semantics.

## Found during T2

- **TS-28: seed scope.** This resolves TS-18 for `.seed()`. The query state carries a seed
  _scope_: the root seed, or `hash(root, "seed", x)` below `.seed(x)`. Seeded nodes do not
  reseed their children. They salt their own draws with their node id, so each draw is keyed
  by (scope, node id, …). An inner `.seed()` replaces the scope instead of chaining.
- **TS-29: polymeter step count.** Without `%n`, steps per cycle equal the total step weight
  of the first layer, so `@` and `!` count.
- **TS-30: random choice draws.** `MiniAst.choice` gains `at`, the offset of the first `|`.
  The draw is keyed by (scope, node id, `|at`, cycle). `|` binds looser than sequence and
  tighter than `,`.
- **TS-31: `.` grouping.** `.` is a separator only when it lexes as a standalone word.
  `.5` stays a number.
- **TS-32: `euclid` method vs mini `(k,n)`.** The method uses structure from the argument,
  which is struct semantics. The mini form squeezes the step body into each hit. They agree
  for single-event receivers (X-19 = M-19). This needs an oracle spec.
- **TS-33: signals.** A signal returns one whole-less event over the query span, valued at
  its start. Receivers sample it at each event's whole start. Continuous events are exempt
  from the span-splitting law.
- **TS-34: constant control arguments.** These use `fmap` instead of receiver-structure
  combination, so events that cross a cycle boundary are not split. This narrows TS-12 to
  patterned arguments.
- **TS-35: capability rule.** `scale` and `transpose` give `E-CAP-PITCHED` only when the
  receiver sets `s` and no `n` (for scale), `note` or `freq`. Lambda parameters are assumed
  pitched.
- **TS-36: `.label()` placement.** The checker reads `.label("x")` from the outermost chain
  and uses `x` as the output anchor. Named outputs (`x: …`) take precedence. `.label` adds
  no IR node.
- **TS-37: no oracle specs for T2 transforms.** `oracle/` is empty. `off`, `jux`, `ply`,
  `struct`, `mask` and the patterned-argument rules follow the §8.6 prose and §12.3
  assertions. They are provisional and must be reconciled when the specifications land.
- **TS-38: general kit size.** The initial kit has 11 synthesized drums plus 4 oscillators.
  Names outside the kit fall back by alias and keyword. Growth toward about 100 sounds
  waits for corpus frequency data.

## Found while completing L2

- **TS-39: `iter`, `iterBack` and `palindrome`.** X-22 says only "rotating start per cycle".
  `iter(n)` plays cycle c shifted earlier by (c mod n)/n. `iterBack(n)` shifts it later by
  the same amount. `palindrome()` plays odd cycles mirrored with `rev`. Each cycle mirrors its
  own cycle, so cycles are not reindexed as they are in alternation (TS-14). `n` must be a
  constant integer, as with `every` (TS-20). Values above 1024, or below 1, leave the pattern
  unchanged. This needs an oracle spec.

## Found while adding headphone features

- **TS-40: binaural and spatial controls.** These are Tartlet extensions (idea.md §7.4); no
  matrix row covers them. `binaural(hz)` makes an oscillator voice play `freq − hz/2` in the
  left ear and `freq + hz/2` in the right. Such voices bypass `pan` and HRTF placement, because
  both would blur the two-tone image the beat depends on. On drums, `binaural` has no audible
  effect. Any of `azimuth`, `elevation` or `distance` selects an HRTF panner with an inverse
  distance model: reference distance 1, no boost closer than that, and a maximum of 50.
  Azimuth 0 is straight ahead and 90 is to the right. The master safety chain keeps the stereo
  image, since its limiter applies one shared gain to both channels.

## Found while implementing Tier 0 and Tier 1 extensions

- **TS-41: making the carried controls audible.** These are audio-adapter interpretations;
  the IR keeps the authored values.
  - `decay` and `sustain` complete an ADSR amplitude envelope on oscillator and noise voices.
    `sustain` defaults to 1, so `decay` alone changes nothing. The synthesized drums keep
    their own envelopes.
  - `hcutoff` is a high-pass filter (Q 0.7) after the low-pass.
  - `speed` applies to the synthesized kit only. Its magnitude, clamped to [1/8, 8], scales
    pitch and divides decay times. Negative values do not reverse anything yet.
  - `shape` is a gain-compensated tanh waveshaper. `crush` is a stepped waveshaper curve with
    1–16 bits. Curves are interpolated, so high bit depths are approximate.
  - `vowel` is three parallel band-pass formants for `a e i o u`. Other strings are ignored.
  - `room` is a send level to a convolution reverb shared per `orbit` (0–15). `size` in [0, 1]
    picks the impulse length, 0.4 s to 4.4 s in steps of 0.4 s. The impulse is seeded decaying
    noise, identical everywhere. At most 8 reverb buses exist.
  - `delay` is a send level to a feedback delay shared per `orbit`. `delaytime` is in seconds
    (0.01–2, default 0.25), and `delayfeedback` defaults to 0.5 and is clamped to 0.95. The
    latest event on an orbit sets the bus parameters at its onset. Stopping cuts feedback.
  - Every bus feeds the master bus ahead of the safety chain.
- **TS-42: synthesis building blocks.** Tartlet extensions where no matrix row exists.
  - `white`, `pink` and `brown` are kit sounds of kind `noise`: unpitched, with the ADSR
    envelope. Their buffers are generated from fixed seeds.
  - `lpenv` is in octaves. `lpattack`, `lpdecay`, `lpsustain` and `lprelease` shape it;
    `lprelease` defaults to `release`. `lpenv` without `cutoff` starts from 300 Hz.
  - `penv` is in semitones and settles linearly in cents over `pdecay` (default 0.1 s).
  - `vib` and `trem` are rates in hertz. `vibdepth` is in semitones (default 0.2) and
    `tremdepth` in [0, 1] (default 0.5). Each note starts its own LFO at phase zero.
  - `fm` is the modulation index and `fmh` the modulator ratio (default 1), with a sine
    modulator.
  - `pw` applies to `square` only, clamped to [0.01, 0.99]. One half is a plain square.
  - `unison` stacks 1–8 copies spread evenly over `detune` cents in total (default 12), each
    at level 1/√n.
  - `timbre` names a fixed harmonic table: `organ`, `hollow`, `bright`, `soft`, `reed` or
    `glass`. It overrides the waveform and `pw`. Unknown names are ignored.
  - `mono` is a line number, 0–64. A new note on a line fades out the previous one within
    10 ms, so on drums it acts as a choke group. `glide` slides from the previous pitch on the
    same line and has no effect without `mono` or after an unpitched note. Line state lives in
    the audio adapter, so the core stays pure. The scheduler therefore dispatches onsets in
    time order. Lines survive recompiles while playing and reset on stop.
  - Polyphony is budgeted by cost: each running oscillator or buffer source costs one, with
    64 in total. The oldest voices are stolen first.
  - `vibrato`, `tremolo` and `portamento` are compatibility aliases, and `fmi` is an alias
    of `fm`.

## Found while implementing vocals (docs/vocals.md)

- **TS-43: vocal sounds and formants.** Tartlet extensions; no matrix row covers them.
  - `voice`, `aah`, `ooh`, `hum`, `whisper` and `choir` are kit sounds of kind `voice`, built
    from native nodes, not a worklet. The glottal source is a periodic wave whose harmonic n
    has amplitude n^-(2 − effort). `effort` defaults to `velocity`, or 0.6.
  - Breath is pink noise through the formants. The default is 0.08 (`hum` 0.03), plus up to
    0.12 as effort falls. `whisper` is breath only.
  - Voices default to vibrato at 5.2 Hz, 0.15 semitones, fading in after `vibdel` (0.25 s).
    `hum` and `whisper` have none.
  - `jitter` and `shimmer` default to 0.1. They read one of four fixed-seed brown-noise beds,
    chosen by `vseed`.
  - `choir` defaults to `unison` 5, `detune` 14 cents, `scatter` 0.025 s and `width` 0.6.
    Each voice has its own vibrato rate and phase. The registry range of `unison` is now 1–16;
    oscillators still clamp to 8.
  - Formants: five resonances per vowel. F1–F3 come from adult averages, scaled by voice type
    (bass 0.9, tenor 1, alto 1.12, soprano 1.22, child 1.35). F4 and F5 are set per type, and
    the default type is tenor. `formant` shifts all five. `hum` uses a nasal bank.
  - Unknown vowels are sung as `ah`, also for `vowel` on oscillators. Oscillators now get five
    formants instead of three.
- **TS-44: `vseed`.** Core adds `vseed` to events whose `s` is a vocal sound or that carry
  `syl`. It is a draw keyed by (scope seed, output id, `whole.begin`, note, `s`). It is added at
  the output level, so an inner `.seed()` does not change it.
- **TS-45: the singing alphabet.**
  - Vowels are `a e i o u ae ah aw eh er ih oh oo uh`. `ee ou ue ai oa` are read as `i oo oo e
oh`.
  - Consonants are `p t k b d g f s sh h v z th m n ng l r w y`.
  - A syllable has at most two onset and two coda consonants, at most 16 characters, with
    longest-match tokenisation. `_` joins vowels inside a syllable (`mi_a_u`); they are glided
    evenly across the note.
  - A lone `_` holds the previous vowel of the mono line, or the default vowel.
  - Consonants sound only on vocal sounds. On other sounds `syl` drives the formants only.
- **TS-46: consonant timing.**
  - The audio adapter, not the scheduler, starts onset consonants before the onset, in
    seconds. The lead is capped at 60 ms and by how early the event arrived.
  - When the lead is shortened, the consonants are compressed, at most to a quarter, and may
    overlap the vowel.
  - `l r w y` add no lead: they are formant transitions starting at the beat.
  - Coda consonants are placed at the end of the note.
- **TS-47: colour controls and deferrals.**
  - `talk` defaults to 1 when a vowel or syllable is given on a non-voice sound.
  - `overtone` is a peaking filter (Q 40, +20 dB) at harmonic 4–16 of the note.
  - `ring` is a peaking filter at 2.8 kHz, scaled by voice type, with up to +10 dB.
  - Deferred: recorded voice banks (V5), the vocoder, `W-ARG-UNSUPPORTED`, `W-RES-HEAVY`,
    `I-RES-CONSENT` and `I-RES-MODEL`.

## Found while implementing user functions (docs/language_extensions.md Part 1)

- **TS-48: function bindings and call forms.** `const f = (x, n = 2) => body` defines a
  function. It can be passed where a function is expected (`.every(4, f)`), partially applied
  (`.every(4, f(3))` fills the parameters after the pattern), called through `.apply(f, …)`,
  called as a method (`p.f(3)`) or called as a builder (`f(3)`). A named function's body may be
  any pattern expression. Inline lambdas keep the old rule and take exactly one parameter.
  Calls are expanded inline at check time, so the IR never contains user functions. A
  parameter's kind follows its uses: an argument is lowered at each use in the caller's
  context. Defaults must be constants.
- **TS-49: call ids and seeds.** A call's id is `hash(receiver or anchor, "user", name,
defHash)`. `defHash` hashes the definition without layout. Method ids inside the expansion
  are salted with that call id. Appending at the call site and moving or reformatting the
  definition keep draws. Renaming the function or editing its body changes them.
- **TS-50: diagnostics in definitions.** Each definition is checked once with placeholder
  parameters. Those diagnostics carry `definition` and are reported once. A broken function
  mutes its callers with `E-NAME-ERRORED`. A diagnostic produced inside a body during
  expansion is dropped if the definition check already reported it. Otherwise it is moved to
  the call site, with a `related` range into the body. Identical diagnostics are reported once.
  The repair payload names the function and summarises tracks muted only by `E-NAME-ERRORED`.
- **TS-51: names.** No binding, function or pattern, may use a registry name
  (`E-NAME-SHADOW`). Calling a parameter or a pattern binding is `E-LX-CALL`. A lambda
  parameter that would collide with an enclosing lambda parameter in the expanded IR is
  renamed `name$k`, so arguments never capture the body's parameters.
- **TS-52: expansion budget.** `maxExpandedNodes` (default 10 000) bounds the pattern nodes one
  statement produces while expanding calls, counting the full size of reused receivers. Going
  over it gives `E-LIMIT-EXPAND`. On an output, only that output is muted. In a definition,
  the definition is marked broken.

## Found while adding headphone safety and per-ear controls (docs/binaural.md)

- **TS-61: advisories.** The checker records, per playable output, whether it uses
  headphone-only controls (`binaural`, `azimuth`, `elevation`, `distance`, `earsh`, `itd`,
  `ild`, `iphase`, `earswap`) and the lowest and highest constant pulse rates. Only `binaural`
  counts as a pulse today. Rates come from constants and from the number atoms of mini-notation
  strings; signals are not counted. Bindings are followed. The facts go in the optional
  `Program.advisories`, which the codec decodes as untrusted input. `I-EXT-HEADPHONES` and
  `I-EXT-PULSE` (a rate in 3–30 Hz) are info notes, hidden from the repair payload. The element
  fires a cancelable `beforeplay` event; the playground cancels it to show a warning once per
  session, and stops its logo animation while a pulsing sketch is loaded.
- **TS-62: per-ear controls.** `itd`, `ild` and `earswap` act in an ear stage after the panner
  or HRTF, using a splitter, per-ear delay and gain, and a merger. `ild` keeps total power
  constant and is capped at 12 dB; `itd` is capped at 40 ms. `earswap` swaps the ears when it is
  at least one half. `earsh` and `iphase` apply to oscillator voices only and make them two-tone
  voices like `binaural`, which bypass pan and HRTF. `iphase` delays the right ear by that
  fraction of the right ear's period, which is exact for steady tones and approximate under glide
  or vibrato. The controls are L3, so they stay out of the system prompt.
- **TS-63: swing correction.** `swingBy` worked on `fast(n)` and squeezed back with `slow(n)`,
  which is backwards. It now works on `slow(n)`, so each slice is one inner cycle.

## Found while completing docs/binaural.md (Tiers B1–B4)

- **TS-64: per-ear filters, band split and correlation.**
  - `lcutoff`, `rcutoff`, `lhcutoff` and `rhcutoff` are biquads (Q 0.7) on one channel of the ear
    stage, after the panner and before `itd`.
  - `earsplit("bands")` puts a Linkwitz–Riley crossover in the ear stage at `splitfreq` (default
    1000 Hz, clamped to 100–8000): low-pass on the left, high-pass on the right. Any source works.
  - `icorr` (default 1) applies to noise voices. Each ear mixes a shared bed and its own bed with
    gains √icorr and √(1 − icorr). The beds are offsets of one third of the buffer apart in the
    fixed-seed noise buffer, starting at an offset drawn from `iseed`.
  - Core adds `iseed` to events that carry `icorr`. It is keyed by (scope seed, output id,
    `whole.begin`, `s`) and added at the output level, like `vseed` (TS-44).
  - Noise voices with `icorr` below 1 or with `dichotic` are two-ear voices. Like `binaural`
    voices, they bypass `pan` and HRTF, because panning a stereo input mixes the ears. The ear
    stage still applies.
- **TS-65: `earsplit("harmonics")`.** Applies to oscillator voices. Alternate _non-zero_ partials
  of the voice's partial table go left and right, instead of strictly odd and even, so
  `square`, `triangle` and `sine` do not leave one ear silent. For `sawtooth` this is odd and
  even. The table is the `timbre` table when one is set, and otherwise the basic waveform. `pw`
  is ignored. Both halves share one scale, so the fused sound has the level of the whole wave.
  It combines with `binaural`, `earsh`, `iphase`, `irate` and `unison`.
- **TS-66: dichotic pitch.** The right ear of a noise voice passes through an all-pass biquad
  at `dichotic` Hz with Q `dichoticq` (default 10). Non-zero values below 100 are raised to 100,
  and values are capped at 2000. The `note`-driven variant is deferred.
- **TS-67: pulses.**
  - `isochronic` (0–40 Hz) multiplies any voice by a softened square: four odd harmonics with a
    sinc roll-off, swinging between 1 − `isodepth` and 1. `isodepth` defaults to 1. It is not a
    headphone control.
  - `irate` (0–10 Hz) is added to the binaural beat of oscillator voices, so a full rotation per
    second equals a 1 Hz beat. It does not apply to noise or dichotic voices. This resolves the
    conflict in docs/binaural.md in favour of the W-ARG-UNSUPPORTED rule.
  - `binaural`, `isochronic` and `irate` all count as pulse rates for advisories (TS-61).
  - In-note sweeps remain patterns of short notes, using `segment` (TS-55).
- **TS-68: new notes and warnings.**
  - `I-EXT-MONO` fires when a constant `iphase` is at least 150°. "Sustained" is not checked.
  - `W-ARG-UNSUPPORTED` fires only when every sound name in the track is known and of the wrong
    kind:
    - `iphase`, `irate` or a constant `earsplit("harmonics")` on tracks with only noise and drums;
    - `dichotic` or `icorr` on tracks with only oscillators.
      Fallback names, voices and tracks without `s` are not judged.
  - `W-ARG-MODE` fires for an unknown constant `earsplit` mode; `none` is used.
  - The checker reads sound kinds from `@tartlet/registry`. A conformance test keeps them in
    step with `@tartlet/resources`.

## Found while implementing space and textures (docs/instruments.md Tiers 5 and 7)

- **TS-69: space presets.** `space` names a reverb character: `room`, `hall`, `plate`, `church`
  or `outdoor`. Each space has its own impulse length, predelay, darkening tail and density
  (`outdoor` is sparse echoes). Impulses are seeded and generated once per (orbit, space, size
  step). Without `space`, the TS-41 reverb is unchanged. An unknown constant space gives
  `W-ARG-MODE`.
- **TS-70: distance and early reflections.** With `distance` above 1 the dry path gains an air
  low-pass from 20 kHz down to about 1.6 kHz at 50, and the reverb send rises by up to 0.5. Any
  reverb send also feeds a shared early-reflection bus of delayed, filtered, panned taps,
  spread by `size`. The bus uses the `room` taps when no space is set; `plate` has none.
- **TS-71: movement smoothing.** The audio adapter keeps the last position per (orbit, sound
  name). A new placed voice that starts less than 2 s later ramps from that position to its own
  over `posglide` seconds (default 0.05). The ramp is a straight line between Cartesian
  positions, not an arc. Positions reset on stop.
- **TS-72: occlusion.** `occlude` adds a low-pass (20 kHz × 0.02^o) and a level drop
  (1 − o/2) closest to the bus, so sends are muffled too.
- **TS-73: ambiences.** `rain`, `wind`, `fire`, `stream`, `surf` and `crowd` are kit sounds of
  kind `ambience`. They are built from fixed-seed noise beds and seeded micro-event schedules.
  - Events are automation on a few long-running sources, so each costs one to three voices.
  - `intensity` (0–1, default 0.5) scales strength. `density` overrides the event or gust rate
    per second.
  - They default to attack 0.3 s and release 0.6 s, so long notes become beds.
  - Core adds `tseed` to texture events and to events with `grain`. It is keyed by (scope
    seed, output id, `whole.begin`, `s`) at the output level, like `vseed`.
- **TS-74: foley.** `drip`, `click`, `tick`, `creak` and `step` are one-shots of kind `foley`.
  Like drums they respond to `speed`, and `tseed` varies each hit by up to ±6 %. `click` is no
  longer a fallback for `rim`.
- **TS-75: granular playback.**
  - `grain` (ms), `gdensity`, `gjitter` and `gpos` apply to oscillator and noise sounds only,
    since no recorded banks exist yet. Oscillators are rendered once per pitch as a
    band-limited buffer.
  - Grains use triangular windows, with positions and times drawn from `tseed`. At most 256
    grains play per note.
  - A voice costs its expected overlap, not its grain count.
  - On drums, voices and textures, `grain` is ignored without a warning.
- **TS-76: creatures and machines.** `bird` plays FM chirps with seeded pitch sweeps, `insect`
  a noise band pulsing at two rates, and `engine` a pulse train through three resonant bands.
  `note` or `freq` sets the chirp pitch, band centre or pulse rate when given.

## Found while implementing frequency-domain filters (docs/dsp.md Part 1)

- **TS-77: native spectral shaping.** These are audio-adapter interpretations; the IR keeps the
  authored values.
  - In signal order after the high-pass: low shelf, high shelf, peak, band, notch, tilt,
    frequency shift, ring modulation, then `shape` and `crush`. A stage exists only when its
    control is present and non-zero.
  - The shelves default to 200 Hz and 4 kHz. The peak defaults to 1 kHz with Q 1, the band to
    Q 1 and the notch to Q 4. Boosts stop at 12 dB, cuts at −18 dB.
  - `tilt` is four high shelves an octave apart, from about 354 Hz to 2.8 kHz, each with the
    slope as its gain, plus a makeup gain that keeps 1 kHz at its level. Outside that range the
    response is flat, so the total change is at most ±2 × slope. Noise `color` is not added yet.
  - `ringmod` multiplies by a sine started with the voice. `ringmix` defaults to 1 and does
    nothing without `ringmod`.
- **TS-78: frequency shift.** `fshift` uses a published 90° phase-difference network: two chains
  of four all-pass sections in z², with the first chain delayed by one sample. The coefficients
  are constants, and the direction of the shift comes from the network's computed phase
  response, not from an assumption. Accuracy is tested from 300 Hz to 15 kHz at 48 kHz (within
  2°). The voice stays pitched for `E-CAP-PITCHED`, although the result is inharmonic.
- **TS-79: spectral processor.**
  - One static worklet with frame size 1024, hop 256 and Hann analysis and synthesis windows.
    Output lags input by exactly one frame. Its source is composed from the self-contained kernel
    functions in `dsp.ts`, which are tested in Node; nothing is built from document content.
  - Defaults: `samount` 1, `sgate` −40 dB (relative to a full-scale sine), `scomb` 110 Hz,
    `sshift` 0.
  - `freeze` holds the loudest of the first four sounding frames and resynthesises it with
    bin-centre phases. A per-voice freeze fades out over about 50 ms once its input is gone. On a
    bus it re-arms whenever the bus mode changes, and stopping resets every bus to `none`.
  - `blur` smooths magnitudes with a one-pole whose coefficient is 0.99 × `samount`. `comb` keeps
    bins within a quarter of a harmonic of multiples of `scomb`. `shift` moves magnitudes to
    rounded scaled bins.
  - A per-voice stage costs 8 extra polyphony units. With `ssend` above zero the event sends to a
    bus per orbit instead (at most 4 buses), and the latest onset on the orbit sets the settings.
  - Latency compensation is deferred: per-voice spectral stages play about 21 ms late, and
    `I-DSP-LATENCY` is not reported yet. If the worklet is refused, spectral settings are
    ignored; the play-time info diagnostic is deferred.
- **TS-80: spectral seed and checks.**
  - Core adds `dseed` to events whose `spectral` is a string other than `none`. It is keyed by
    (scope seed, output id, `whole.begin`, `s`) at the output level, like `vseed` (TS-44), and
    seeds the `whisper` phases.
  - An unknown constant `spectral` mode gives `W-ARG-MODE`; `none` is used.
  - `scomb`, `sgate` and `sshift` give `W-ARG-UNSUPPORTED` when every `spectral` value of the
    track is known and none of them is their mode. Non-constant `spectral` patterns are not
    judged.
  - `peak`, `notch`, `tilt` and the other new names are reserved. The America album's festival
    sketch renamed its `peak` binding to `drop`.

## Found while implementing impulse-response filters (docs/dsp.md Part 2)

- **TS-81: FIR designs.** `fir` selects `lowpass`, `highpass`, `bandpass` or `bandstop`; `none`
  turns it off. Kernels are Kaiser-windowed sincs (beta 6, about 63 dB of stop-band attenuation)
  of 255, 1023 or 4095 taps (`firlen` short, medium or long; default medium). High-pass and
  band-stop use spectral inversion; band-pass is the difference of two low-passes at `firfreq`
  divided and multiplied by 2^(`firwidth`/2), normalised to unit gain at the centre. For the cache,
  `firfreq` is rounded to the nearest quarter-tone and `firwidth` to quarter octaves; the IR keeps
  the authored values. At most 32 kernels are cached. The stage sits right after the high-pass and
  costs 1, 2 or 4 polyphony units.
- **TS-82: body responses.** `body` names `box`, `guitar`, `violin`, `tube`, `can`, `phone`,
  `radio` or `megaphone`. Each is a sum of decaying sinusoids plus seeded noise, at most 100 ms
  long and normalised to unit energy, generated from constant seeds. `bodysize` divides every
  mode frequency (quantised to quarter-octave steps) and `bodymix` (default 1) is the wet share.
  The stage sits after the vowel colour and before the spectral stage, and costs 3 units.
- **TS-83: cabinets.** `cab` names `small`, `open`, `closed`, `combo` or `stack`: a generated
  response (impulse plus short noise tail and two resonances through a high-pass and two
  low-passes), at most 50 ms, unit energy. One convolver per (orbit, cabinet), at most 8, sits in
  the dry path after placement and the ear stage, so stereo placement survives. Reverb and delay
  sends still tap the voice before the cabinet.
- **TS-84: space tails and checks.** `spacepre` (ms, in 10 ms steps) and `spacedamp` (in 0.1
  steps) override the predelay and damping of a `space` preset; without a known `space` they do
  nothing. Unknown constant `fir`, `firlen`, `body` and `cab` values give `W-ARG-MODE`.
  `W-ARG-UNSUPPORTED` fires for `firwidth` when every constant `fir` is neither band design,
  for `bodysize` and `bodymix` without a non-`none` body, and for `spacepre` and `spacedamp`
  without a known space. Non-constant owner patterns are not judged. Recorded responses (Tier I3)
  are deferred until ADR-004.
- **TS-85: latency compensation.** A voice with a FIR stage, or a per-voice spectral stage
  (no `ssend`), starts early by the stage latency: (taps − 1)/2 samples, plus one STFT frame.
  The early start is capped at 60 ms and by how early the event arrived; when it is cut short,
  the voice plays late by the difference and the engine counts it. Bus stages are not
  compensated. `I-DSP-LATENCY` (info) marks tracks with a constant compensated stage; this
  resolves the deferrals in TS-79.

## Found while implementing response curves (docs/dsp.md Part 3)

- **TS-86: transfer curves.** `curve` names `soft` (cubic soft clip), `hard`, `tanh`, `tube`
  (negative half compressed harder), `fold` (triangle fold), `rect`, `half` or `cheby2` to
  `cheby7`; `none` turns it off.
  - The table is f(g·u + `bias`) − f(`bias`), with g from `drive` (0–24 dB, quantised to
    0.5 dB) and `bias` quantised to 0.05, normalised to full scale. The IR keeps the authored
    values.
  - A makeup gain restores the RMS of a sine at peak 0.5, clamped to 0.25–4. Even Chebyshev
    curves at drive 0 give a quieter sine of the same RMS, plus DC.
  - Asymmetric curves, and any non-zero `bias`, are followed by a 10 Hz high-pass.
  - `fold` and the Chebyshev curves oversample 4x, the others 2x.
  - The stage sits after the frequency shift and ring modulation and before `shape`.
  - `shape` keeps its own fixed curve, so existing documents sound the same; the mapping to
    `curve("soft")` is deferred.
  - The proposed pattern method `.curve(k)` (docs/noise.md) is reserved as `.bend(k)`.
- **TS-87: dynamics.**
  - A voice with `comp` below zero sends its dry path through a `DynamicsCompressorNode` per
    `orbit` (at most 8) that feeds the master bus. Reverb, delay and spectral sends are not
    compressed. Defaults: ratio 4, knee 6 dB, attack 3 ms, release 250 ms. The latest onset on
    the orbit sets the settings.
  - `gate` (dB) is a per-voice worklet, closest to the sink, built from `gateBlock` in
    `dsp.ts`: a peak follower with a 50 ms release opens the gate within about 1 ms and closes
    it over `gaterelease` (default 0.1 s). It costs 2 polyphony units. If the worklet is
    refused, `gate` is ignored.
- **TS-88: control curves.**
  - `envcurve` bends the amplitude envelopes of oscillator, noise, voice and texture voices:
    each changing segment becomes 8 linear pieces following 1 − e^(−5x) (`exp`) or its mirror
    (`log`). Breakpoints keep their times and levels.
  - `velcurve` (0.25–4, default 1) raises velocity to that power before it sets the level.
    Effort and other timbre mappings still read the raw velocity.
- **TS-89: checks.**
  - Unknown constant `curve` or `envcurve` values give `W-ARG-MODE`; `none` and `lin` are used.
  - `drive`, `bias` and `curvemix` give `W-ARG-UNSUPPORTED` when every constant `curve` of the
    track is `none` or absent. Non-constant `curve` patterns are not judged.
  - `I-DSP-ORBIT` (info) marks a track whose constant compressor settings differ from an earlier
    track on the same constant orbit (default 0).

## Found while implementing samples (docs/samples.md)

- **TS-90: sample directives and paths.**
  - `sample(name, path)` binds one `.wav` file. `samples(path)` declares a bank: a directory
    ending in `/` (its `manifest.json`) or a `.json` manifest.
  - Paths follow the closed grammar of docs/samples.md §1.2. The rules live in `@tartlet/ir`
    (`isSamplePath`), so the checker and `decodeProgram` share them.
  - A `samples()` argument containing `:` is still a declared remote bank that is never fetched,
    as before (X-31). It is not `E-RES-PATH`.
  - The path is stored in `ResourceDecl.spec`; `kind` is `wav` or `bank`, and `wav` has `name`.
  - Sound names start with a letter, then letters, digits, `_` or `-`.
  - A single-file sample is played by the impulse interpreter.
- **TS-91: loading.**
  - Hosts load samples; the core never does. `<tartlet-player>` uses `resolveSample`, or else
    `sample-base` on the page's own origin; without either, nothing loads and each declaration
    gets `W-RES-MISSING`. Host diagnostics are appended to the element's diagnostics.
  - While a single-file sample is loading, events naming it are skipped and counted.
  - With a catalog, declared sample names are known sounds. Once any bank is declared, names
    outside the kit get neither `I-RES-FALLBACK` nor `W-RES-MISSING`, because bank names are only
    known after loading.
- **TS-92: the sample standard.**
  - The peak must be within 0.5 dB of -1 dBFS, channel means within 0.005, and leading silence
    (below -60 dBFS) at most 1 ms. Length caps are 30 s (impulse) and 120 s (note).
  - Hosts normalise files that break the standard on load and report `W-RES-FORMAT`. Loop points
    are not shifted by trimming; imported files are already standard.
  - Files at rates other than 44.1 or 48 kHz are resampled by the audio source; the importer
    notes `I-RES-RATE`.
- **TS-93: interpreters.**
  - Core adds `rseed`, a draw keyed by (scope, output id, `whole.begin`, `s`), to events of
    programs that declare a `wav` or `bank`. The note interpreter uses it for round robin.
  - Zone ties go to the lower root; transposition is capped at ±24 semitones.
  - Negative `speed` plays at its magnitude; `W-RANGE` for it is deferred.
  - The General MIDI map applies to events with `note` and no `s` when a bank sets `gm: true`;
    entries with their own `gm` note always apply.
- **TS-94: the importer.**
  - `samples import` guesses zones from `name_<note>[_v<k>]` file names and prints every guess.
    Roots split the keyboard at midpoints; velocity layers split [0, 1] evenly.
  - Output is normalised 24-bit PCM. `collection/index.json` lists the banks.
  - Deferred: content-addressed uploads, `samples verify` in `pnpm check`, and MIDI file import.
