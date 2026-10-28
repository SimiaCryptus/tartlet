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
