# Extensions: going beyond binaural beats

**Status: implemented.** This covers the checker advisories (TS-61), Tier B0 (TS-62) and
Tiers B1–B4 (TS-64 to TS-68). It sits alongside the conventional binaural beat (`binaural`)
and HRTF placement (`azimuth`, `elevation`, `distance`) from TS-40. Two items are deferred:
`note`-driven dichotic pitch, and sweeps inside one note. See
[Implementation notes](#implementation-notes).

Headphones give each ear its own signal, and the auditory system compares the two in
detail. Conventional music mostly avoids this, because the effects disappear on speakers,
break when an earbud falls out, and vary between listeners. Meditation, study and ambient
music are different. Listeners usually wear headphones for long stretches, and the music can
be built around the effect instead of hiding it.

The aim is to treat the two ears as two separate instruments, not just as a stereo image:
shift pitch, time, phase, filtering and correlation between them, and pattern all of it with
the existing algebra.

## What exists today

- `binaural` (0–40 Hz): an oscillator voice plays one tone per ear, detuned by ± half the
  value. Headphones hear a beat at that rate. Binaural voices ignore `pan`.
- `azimuth`, `elevation` and `distance`: any of them places the voice with an HRTF panner
  instead of `pan`.
- `pan`: equal-power placement, 0 left and 1 right.

All three are per-event controls. Patterned values are sampled at the receiver's onsets
(TS-33), so they change between notes, not during them.

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints): the core
path stays pure, controls are data, randomness is decided in core, musical time is rational,
the safety chain cannot be bypassed and nothing is fetched. Headphone work adds these:

- **The ear stage is audio-side.** Interaural processing lives in `@tartlet/webaudio`, after
  the per-voice effects and the panner, and before the master bus. `core` only carries the
  control values.
- **Native nodes first.** Everything below can be built from `ChannelSplitter`,
  `ChannelMerger`, `DelayNode`, `BiquadFilter` (including `allpass`), `GainNode` and
  oscillators. A worklet is only justified for continuous modulation inside a note.
- **Interaural level differences are capped.** A large, sustained imbalance between the ears
  is uncomfortable and can mislead a listener about their own hearing. Each ear's level is
  clamped, and the master limiter still applies to both channels.
- **No health claims.** The evidence for brainwave entrainment is weak and mixed. The
  registry, the docs and the system prompt describe what a control does to the sound, never
  what it does to the listener's mind or health.
- **Warnings are the host's job, but the checker supplies the facts.** The checker reports
  which outputs depend on headphones and which contain fast rhythmic pulsing, so that a host
  can show its warnings before playback (see [Safety](#safety)).
- **Mono fold-down is documented, not prevented.** Some effects cancel or change completely
  on speakers or in mono. That is part of the point. The docs say so for each control, and
  the checker can note it.
- **Seeded decorrelation.** Independent per-ear noise uses fixed-seed noise beds selected by
  a per-event seed drawn in core (like `vseed` for voices), so the same document and seed
  render identically on one engine.

## A little perception

The proposals map onto these effects. All of them need headphones.

- **Binaural beats.** Two close tones, one per ear, are heard as one tone that beats at the
  difference frequency. The beat is created in the brain, not in the air.
- **Interaural time difference (ITD).** Under about 0.7 ms, a delay between the ears moves the
  sound sideways. From about 1 ms to 30 ms, the sound stays on the leading side but grows wider
  (the precedence or Haas effect). Beyond that, it splits into an echo.
- **Interaural phase.** A tone in phase in both ears sits in the centre of the head. In
  opposite phase (antiphasic), it seems diffuse and "inside" or "around" the head, and it
  cancels in mono.
- **Interaural correlation.** Identical noise in both ears is a point in the middle.
  Independent noise in each ear is wide and enveloping. Between the two, the image spreads.
- **Dichotic pitch.** Feed the same noise to both ears and shift the phase of one ear in a
  narrow band. Neither ear alone hears a tone, but together they hear a faint pitch at that
  band (Huggins pitch).
- **Spectral fusion.** Send part of a sound's spectrum to each ear, for example odd harmonics
  left and even harmonics right. The brain fuses them into one sound, which neither ear hears
  on its own.
- **Dichotic illusions.** Alternating high and low tones between the ears can be heard as a
  single tone that jumps from ear to ear in a way that does not match the signal (the octave
  illusion). Two interleaved melodies split across the ears can regroup by pitch (the scale
  illusion). These need only patterns and hard panning.

## Tier B0: per-ear pitch, time, level and phase

Static per-event offsets between the ears. All values are clamped at the adapter.

| Control   | Range          | Meaning                                                                         |
| --------- | -------------- | ------------------------------------------------------------------------------- |
| `earsh`   | −100–100 cents | Raises the right ear and lowers the left by half the value each.                |
| `itd`     | −40–40 ms      | Delays one ear. Positive values delay the left ear, so the sound leans right.   |
| `ild`     | −12–12 dB      | Level difference. Positive is louder on the right. Total loudness is preserved. |
| `iphase`  | 0–180°         | Phase offset between the ears for oscillator voices. 180 is antiphasic.         |
| `earswap` | 0 or 1         | Swaps the two ears after every other ear stage. Patterned, it makes "ear hops". |

- `binaural` is defined in Hz and gives a beat whose rate does not depend on pitch. `earsh`
  is defined in cents and keeps the same relative shift at every pitch. At small values it is
  heard as a slow, pitch-dependent beat. Larger values are heard as a widened, chorused tone.
  Both may be combined.
- `itd` uses one `DelayNode` per voice, created with a maximum of 50 ms. Values under 1 ms
  move the image. Values from 1 to 30 ms widen it. The docs describe these regions so that
  users and models pick sensible values.
- `iphase` applies to periodic voices only. Noise voices use `icorr` instead (Tier B1).
- `ild` is capped well below full one-sided panning. Use `pan` for hard placement.
- With `azimuth` set, the ear stage runs after the HRTF panner, so `itd` and `ild` add to the
  HRTF's own cues. With `binaural` set, each ear's oscillator already exists, and `earsh` and
  `iphase` are applied directly to them.

## Tier B1: per-ear filtering and correlation

| Control                | Range       | Meaning                                                                                     |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `lcutoff`, `rcutoff`   | 20–20000 Hz | A low-pass on one ear only.                                                                 |
| `lhcutoff`, `rhcutoff` | 20–20000 Hz | A high-pass on one ear only.                                                                |
| `icorr`                | 0–1         | Interaural correlation for noise voices. 1 is shared noise, 0 is independent noise per ear. |
| `earsplit`             | enum        | Splits the spectrum between the ears: `none`, `harmonics`, `bands`.                         |
| `splitfreq`            | 100–8000 Hz | Crossover frequency for `earsplit: bands`.                                                  |

- Single-ear filters produce a sound that is dark in one ear and bright in the other. With a
  slowly patterned cutoff, the brightness seems to wander inside the head even though nothing
  is panned.
- `icorr` blends a shared noise bed with an independent bed per ear. Both beds are chosen by
  the event's seed. `white`, `pink`, `brown` and the procedural textures in
  [instruments.md](instruments.md#tier-7-real-world-sound-textures) benefit most.
- `earsplit: harmonics` builds two periodic waves from the voice's partial table, odd
  partials on the left and even partials on the right, so it needs a periodic source.
  `earsplit: bands` uses a complementary low-pass and high-pass pair at `splitfreq`, so it
  works on any source. Both fuse into one sound on headphones and sound complete in mono.

## Tier B2: dichotic pitch

| Control     | Range       | Meaning                                                               |
| ----------- | ----------- | --------------------------------------------------------------------- |
| `dichotic`  | 100–2000 Hz | Centre of the phase-shifted band on a noise voice. 0 turns it off.    |
| `dichoticq` | 1–50        | Narrowness of the band. Higher is narrower and gives a clearer pitch. |

- Implementation: the same noise feeds both ears, and one ear passes through a biquad
  `allpass` at `dichotic` with Q `dichoticq`. The magnitude spectrum is identical in both
  ears, so each ear alone hears plain noise.
- `dichotic` is pitched in a narrow sense: it is a frequency, not a note. A follow-up could
  let `note` drive it on noise voices, so that `note("c4 e4 g4").s("pink").dichotic(1)` plays a
  melody heard only between the ears. That needs a TS entry about how `note` maps onto a noise
  voice, and how `E-CAP-PITCHED` treats it (TS-35).
- The effect is faint and varies between listeners. The docs say so plainly.

## Tier B3: rhythmic and moving interaural effects

- **`isochronic`** (0–40 Hz) and **`isodepth`** (0–1): amplitude pulsing of the voice at a
  fixed rate. Unlike a binaural beat, it is audible in both ears and on speakers, so it is a
  useful comparison and fallback. It counts as pulsing for [Safety](#safety).
- **`irate`** (0–10 Hz): continuously rotates the interaural phase of an oscillator voice.
  A full rotation per second is equivalent to a 1 Hz binaural beat, but `irate` also applies to
  `earsplit` and `dichotic` voices, where `binaural` cannot. It is one per-voice LFO, like
  `vib`, so it starts in phase with each note.
- **Slow sweeps** of `itd`, `ild` or the single-ear cutoffs inside one note need in-note
  control, which TS-33 does not allow yet. Until that lands, sweeps are written as patterns
  of short notes, for example `.itd(sine.range(-0.5, 0.5).segment(16))` once `segment`
  exists ([language_extensions.md](language_extensions.md#21-time-and-structure)). The open
  question in [instruments.md](instruments.md#open-questions) about continuous control
  applies here too.

## Tier B4: recipes for dichotic illusions

These need no new machinery beyond B0. They are documentation and playground examples.

```js
// Octave illusion: each ear hears the opposite octave on every step.
$: note('c5 c4').s('sine').pan(1);
$: note('c4 c5').s('sine').pan(0);

// A wide, still bed: decorrelated pink noise with a slow single-ear filter drift.
$: s('pink').slow(8).icorr(0.2).lcutoff('<800 1200 600>').gain(0.4);

// A drone that sits "inside" the head: antiphasic, slightly shifted between the ears.
$: note('c2').s('sawtooth').iphase(180).earsh(6).slow(4);

// Precedence widening on a pluck, leaning right.
$: note('e3 g3 b3 d4').s('triangle').itd(12);
```

- The scale illusion is two `$:` outputs, each hard-panned, whose notes alternate ears on
  every step. It can be written with `pan` today.
- Each recipe states what it sounds like in mono. The antiphasic drone, for example, nearly
  disappears.

## Safety

The effects on this page are subtle, but long listening sessions, rhythmic pulsing and
headphones all deserve care.

- **Seizure warning.** Rhythmic stimulation from about 3 to 30 Hz can, rarely, contribute to
  seizures in susceptible people. The risk is much better established for flashing light than
  for sound, so visual output matters most:
  - the playground and `<tartlet-player>` must not flash, pulse or animate in step with a
    beat, `isochronic` or `irate` rate in that range;
  - they already follow `prefers-reduced-motion`, and should additionally keep event
    highlighting below 3 flashes per second whenever pulsing controls are present;
  - hosts should show a warning before playing documents that use pulsing controls. The
    playground shows it once per session.
- **Hearing.** The master limiter ceiling applies to both ears. `ild` is capped. The docs
  recommend low volume for long sessions, since a quiet, steady sound invites turning it up.
- **Headphones.** The effects only work on headphones. The element's status region says
  "Best on headphones" when an output uses headphone-only controls. Nothing tries to detect
  headphones.
- **No claims.** No preset, example or description promises focus, sleep, relaxation or any
  other effect on the listener.

### Advisory facts from the checker

The checker records, per output, whether it uses headphone-only controls and the range of
constant pulse rates it contains (`binaural`, `isochronic`, `irate`). A host reads these to
decide what to show. This adds an optional `advisories` field to `Program`, which needs a TS
entry and an IR codec update (`tartlet/1` stays readable; decoding treats the field as
untrusted like everything else).

## Diagnostics (proposed)

- `I-EXT-HEADPHONES`: an output uses controls that only work on headphones.
- `I-EXT-MONO`: a constant setting that largely cancels in mono, such as `iphase` near 180
  on a sustained voice.
- `I-EXT-PULSE`: an output pulses at a constant rate between 3 and 30 Hz. Benign and hidden
  from the repair payload; it exists for hosts.
- `W-ARG-UNSUPPORTED` (from [instruments.md](instruments.md#diagnostics-proposed)):
  `iphase`, `irate` or `earsplit: harmonics` on a noise or drum voice, or `dichotic` and
  `icorr` on a periodic voice.
- `W-RANGE`: out-of-range constants, as for every control.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Core.** New controls get hand-written golden expectations like any control. The per-event
  seed used by `icorr` gets D rows: stable for a seed, different across seeds, and unchanged
  when a method is appended. The advisory facts get X-style tests in `packages/check/test`.
- **Audio.** Render with `OfflineAudioContext` in the Playwright suite and assert properties,
  never stored waveforms:
  - the peak of the left/right cross-correlation sits at the requested `itd`;
  - the measured fundamentals of the two ears differ by the requested `earsh`, within a cent;
  - the left/right level difference matches `ild`, and total power is unchanged;
  - with `iphase(180)`, the mono sum of a sine voice is near silence;
  - a single-ear cutoff changes the spectral centroid of that ear only;
  - interaural coherence falls as `icorr` falls;
  - with `dichotic`, both ears have the same magnitude spectrum within a tolerance, and the
    interaural phase difference peaks near the requested frequency;
  - `earsplit` channels sum back to the unsplit voice's spectrum;
  - identical seeds render bit-identical buffers on one engine, the peak never exceeds the
    limiter ceiling, and no sample is NaN.
- **Expectations by reasoning.** Thresholds come from psychoacoustics and signal reasoning,
  never from capturing the output of Tartlet or another implementation, as
  [testing.md](testing.md#rules-for-expectations) requires.

## Suggested order

1. Checker advisories, `I-EXT-HEADPHONES`, `I-EXT-PULSE` and the playground warning. Safety
   comes before new effects.
2. B0: `earsh`, `itd`, `ild`, `iphase` and `earswap`. Cheap, native nodes only.
3. B1: single-ear filters and `icorr`, then `earsplit`.
4. B4: the recipe set in the playground examples, with mono notes.
5. B3: `isochronic` and `irate`.
6. B2: `dichotic`, then the `note`-driven variant.
7. In-note sweeps, once continuous control is settled for instruments and voices.

## Open questions

- Should `earsh` and `binaural` stay separate, or should one control accept either Hz or
  cents through a unit suffix? Separate names are clearer for models.
- Is `advisories` the right shape for host warnings, or should hosts derive them from the
  diagnostics alone?
- Should the playground's pulse warning be dismissible permanently, per document or per
  session?
- How far should `itd` go? 40 ms keeps it in widening territory; longer delays turn into the
  shared `delay` bus, which already exists.
- Should hosts be able to disable headphone-only controls entirely, for example on a page
  likely to be played on speakers?
- Can dichotic pitch carry a melody clearly enough to be worth a `note` mapping, or does it
  stay a texture?

## Implementation notes

Where the implementation differs from the proposals above:

- **`earsplit("harmonics")`** alternates the non-zero partials, not strictly odd and even
  partials. This keeps both ears busy for `square`, `triangle` and `sine` (TS-65).
- **Noise with `icorr` below 1, or with `dichotic`,** bypasses `pan` and HRTF, like other
  two-ear voices (TS-64).
- **`irate`** applies to oscillator voices only, by adding to the binaural beat. On noise and
  drums it gives `W-ARG-UNSUPPORTED` (TS-67).
- **`isochronic`** uses a softened square to avoid clicks. `isodepth` defaults to 1.
- **`I-EXT-MONO`** fires for a constant `iphase` of at least 150°.
- **`W-ARG-UNSUPPORTED`** fires only when every sound name in the track is known (TS-68).
  An unknown `earsplit` mode gives `W-ARG-MODE`.
- **The recipes** are in the playground preset "Ear tricks".
- **Not implemented yet:** the `note`-driven dichotic pitch, and sweeps inside one note.
