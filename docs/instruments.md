# Extensions: modelling instruments and real-life sounds

Today Tartlet plays a small synthesized kit (`bd sd hh oh cp rim lt mt ht cr rd`), four basic
oscillators, three noise sources, and the headphone extension from TS-40. **Tier 0 and Tier 1
are implemented** (TS-41, TS-42); the remaining tiers are proposals. This page collects ideas for
closing the gap between "a pattern of beeps" and "something that sounds like a marimba in a
wooden room, in the rain".

## Constraints

Every proposal must respect the existing rules. If one cannot, it needs an ADR first.

- **The core path stays pure.** New instruments are audio-side. `core` only carries control
  values. Anything that needs a DOM, `AudioContext` or timers belongs in `@tartlet/webaudio`.
- **Controls are data.** A control value is a number, a string or `{ kind: 'midi', value }`.
  No callbacks, no objects that encode behaviour, no code in strings.
- **Randomness is decided in core.** Humanisation, round-robin and variation must use
  counter-based `draw(...)` keyed by node id, cycle and `whole.begin`, so the same document
  and seed always sound the same. The audio adapter receives the result as plain controls; it
  never rolls its own dice.
- **Musical time is rational.** Anything that moves an event in musical time (strum, swing)
  is a core transform on rationals. Sub-scheduling jitter that is not musical time (for
  example a few milliseconds of `nudge`) may be seconds, applied by the scheduler.
- **The safety chain is non-bypassable.** Every new voice, model and effect connects to the
  bus before the compressor and the limiter. Parameters are clamped at the adapter, as today.
- **Nothing is fetched from document content.** Sample banks and impulse responses either are
  generated deterministically from static code or come from the host (see
  [Samples](#tier-6-samples-and-multisampling)). This keeps the CSP in
  [embedding.md](embedding.md#content-security-policy) unchanged.
- **Worklets are static source.** Physical models that need sample-accurate DSP ship as
  static worklet modules loaded from `blob:` URLs (ADR-003). They are never generated from
  document text.
- **Budgets are explicit.** Polyphony is capped (64 today). Expensive voices must count for
  more than cheap ones (see [Cost budgeting](#cost-budgeting)).
- **The registry is the source of truth.** Tartlet-only names are marked as extensions, like
  `binaural`. Where another ecosystem already has a common name, it may be a compatibility
  alias, but the description stays original.

## Tier 0: make the existing controls audible

**Status: implemented (TS-41).** `crush` uses a stepped waveshaper curve instead of a worklet.
`delaytime` is in seconds.

The cheapest wins. The names already exist in the registry and pass through events.

| Control                               | Proposal                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `decay`, `sustain`                    | Full ADSR on the amplitude envelope (today only `attack` and `release`).  |
| `hcutoff`                             | A high-pass biquad after the low-pass.                                    |
| `speed`                               | Playback rate for samples; pitch ratio for the synthesized kit.           |
| `shape`                               | Waveshaper with a fixed, bounded curve; gain-compensated.                 |
| `crush`                               | Bit-depth reduction in a static worklet.                                  |
| `vowel`                               | Parallel formant band-passes for `a e i o u`.                             |
| `room`, `size`                        | Shared convolution reverb per `orbit`, with a generated impulse response. |
| `delay`, `delaytime`, `delayfeedback` | Shared feedback delay per `orbit`; feedback clamped below 0.95.           |

Generated impulse responses use exponentially decaying noise seeded from a constant, so they
are identical on every machine and need no download.

## Tier 1: synthesis building blocks

**Status: implemented (TS-42).** `lpenv` is in octaves. `glide` works on lines named by
`mono`; on drums, `mono` acts as a choke group. Polyphony is budgeted by cost, as proposed
under [Cost budgeting](#cost-budgeting).

Generic tools that make many instruments possible without a dedicated model.

- **Noise sources.** Add `white`, `pink` and `brown` as oscillator names. They are the raw
  material for breath, bow, wind, cymbals and rain.
- **Filter envelope.** `lpenv` (depth in semitones or octaves), with `lpattack`, `lpdecay`,
  `lpsustain` and `lprelease`. Most "plucked" and "brassy" character comes from this.
- **Pitch envelope.** `penv` (semitones) and `pdecay`. Needed for toms, kicks, zaps and
  struck metal.
- **Vibrato and tremolo.** `vib` (rate in Hz) with `vibdepth` (semitones), and `trem` with
  `tremdepth`. Per-voice LFOs, so they start in phase with each note.
- **FM.** `fm` (modulation index) and `fmh` (harmonicity ratio). Two-operator FM covers bells,
  electric piano and metallic percussion cheaply.
- **Pulse width.** `pw` for `square`; a source of reedy and nasal tones.
- **Unison.** `unison` (1–8 voices) and `detune` (cents). Each extra voice counts against the
  cost budget.
- **Named timbres.** `timbre("organ" | "hollow" | "bright" …)` selecting a fixed additive
  partial table. Partials are static data in the engine, not user-supplied arrays, so the
  closed language does not grow array values.
- **Glide.** `glide` (seconds) together with `mono: 1`, so consecutive notes in one output
  slide instead of retriggering. This is the first feature that needs per-output voice
  continuity in the engine; it needs a TS entry about what "previous note" means across
  stacked layers.

## Tier 2: physical and modal models

Real instruments are mostly excitation plus resonance. Each model is a static worklet and is
exposed as a **sound name** in the resources catalog, not as a new function. That keeps the
language unchanged: `s("marimba")` or `note("c e g").s("pluck")`.

| Family          | Sound names (proposed)              | Technique                          | Extra controls                     |
| --------------- | ----------------------------------- | ---------------------------------- | ---------------------------------- |
| Plucked strings | `pluck`, `guitar`, `harp`, `koto`   | Karplus–Strong / digital waveguide | `damping`, `brightness`, `pickpos` |
| Struck bars     | `marimba`, `vibes`, `glock`, `xylo` | Modal resonator bank, ratio tables | `hardness`, `ring`                 |
| Bells and metal | `bell`, `gong`, `tine`              | Inharmonic modal bank or FM        | `hardness`, `ring`, `inharm`       |
| Membranes       | `tabla`, `conga`, `frame`, kit v2   | Modal membrane + noise excitation  | `tension`, `tone`, `snappy`        |
| Blown           | `flute`, `clarinet`, `pan`          | Waveguide with noise breath        | `breath`, `pressure`               |
| Bowed           | `cello`, `fiddle`                   | Bowed waveguide (research)         | `pressure`, `bowpos`               |
| Keyboard        | `piano`, `epiano`                   | Hammer + coupled strings; FM tine  | `hardness`, `pedal`                |
| Voice           | `choir`, `voice`                    | Glottal pulse + formant filters    | `vowel`, `formant`                 |

- The resources fallback table should then map `piano → piano`, `rhodes → epiano`,
  `guitar → pluck` and so on instead of everything landing on `triangle`. `I-RES-FALLBACK`
  still reports any approximation.
- Models must declare whether they are **pitched**, so `.scale` and `.transpose` keep
  producing `E-CAP-PITCHED` on unpitched receivers (TS-35).
- Blown and bowed models want **continuous control** (pressure that changes during a note).
  Signals already sample at onsets (TS-33). A follow-up could let a control be sampled at
  audio-control rate inside a note; that is a new structure rule and needs its own TS entry.
- If an engine refuses the worklet (ADR-003, risk R-3), models fall back to a Tier 1 patch
  that approximates them, with an info diagnostic at play time.
- Voices, choirs, syllables and other vocal sounds are discussed in detail in
  [vocals.md](vocals.md).

## Tier 3: performance and articulation

Real players are never perfectly regular, and the same key sounds different played softly or
hard. Most of this is core work and fits the existing algebra.

- **Velocity to timbre.** Each instrument maps `velocity` to brightness, attack noise and
  hammer hardness, not just loudness. This is the single biggest realism gain per line of
  code.
- **`legato`.** Duration as a fraction of the whole (`0.5` staccato, `1.2` overlapping). Pure
  `fmap` in core; the scheduler uses it to compute release time.
- **`.strum(t)`.** Offsets the simultaneous notes of each onset by `t` cycles in pitch order.
  Rational and deterministic, so laws and golden tests apply.
- **`.swing(amount, div?)`.** Delays every second subdivision; a time transform built from
  `compress`.
- **`.humanize(time, vel)`.** Seeded per-event offsets: velocity jitter as a control, and
  timing jitter as a `nudge` control in seconds applied by the scheduler, so musical time
  stays exact. Covered by D rows like the other random transforms.
- **Round-robin and variation.** `vary` (0–1) asks a model or kit sound for a seeded
  micro-variation on each hit, so a repeated `hh*16` stops sounding like a machine gun. For
  sample banks, `.rr()` picks among multiple takes with a seeded draw.
- **Articulations.** An enumerated string control `artic` (`legato`, `stacc`, `accent`,
  `mute`, `harm`). Instruments interpret what they support and ignore the rest, with a
  warning from the checker when a constant articulation is never supported by the sound.
- **Sustain pedal.** A `pedal` control combined with `appLeft`. The engine extends releases
  while the pedal is truthy for that output.
- **Chords.** `chord("Cm7")` and `.voicing()` as tonal helpers in the registry, so a single
  pattern step can produce a voiced chord for `piano` or `strum`.

## Tier 4: tuning

Many real-world instruments are not 12-tone equal tempered.

- `cents` control: a fine pitch offset per event.
- `tuning("12tet" | "just:C" | "pythag:D" | "31edo" | "slendro" …)`: a directive or transform
  mapping MIDI-like note numbers to frequencies through a static table.
- `a4` directive: the reference frequency (default 440).
- Fractional notes: today `note` is `{ kind: 'midi', value }`. Allowing non-integer `value`
  (or a rational) needs a TS entry and an IR codec update, including the denominator ceiling.

## Tier 5: space and environment

TS-40 already places voices with HRTF. Realism also depends on the room and the air.

- **Space presets.** `space("room" | "hall" | "plate" | "church" | "outdoor")` choosing a
  generated impulse response per `orbit`; `room` and `size` scale the wet level and length.
- **Distance cues.** Extend `distance` with air absorption (low-pass that falls with
  distance) and a dry/wet balance that shifts toward the reverb as sources move away.
- **Early reflections.** A few delayed, filtered taps derived from `size`, for a sense of
  walls without full convolution cost.
- **Movement smoothing.** When `azimuth` comes from a signal, ramp between successive values
  instead of jumping, so a source sweeping around the head does not click.
- **Occlusion.** `occlude` (0–1): a low-pass and level drop for a sound behind a wall or in
  the next room.

## Tier 6: samples and multisampling

Recorded samples remain the most direct route to real sounds. `samples()` is declared today
but nothing is fetched.

- **Host-supplied banks.** The document only names banks. The host resolves them, through the
  planned `resource-request` message (ADR-004) or a host callback for the element, and hands
  back decoded audio. The embed never fetches.
- **Manifest.** A bank manifest is JSON validated as untrusted input, with the same rules as
  IR ingestion (no prototype keys, bounded nesting). Each entry has a name, a license, and
  optional zones.
- **Zones.** Root note, note range, velocity range and round-robin group. The engine picks the
  nearest zone for a note and velocity and pitch-shifts with `speed`.
- **Loops.** Loop start and end points for sustained instruments, so a `cello` sample can hold
  as long as the event's whole.
- **Checker integration.** With a catalog that knows the bank, `W-RES-MISSING` and
  `I-RES-FALLBACK` work for sample names exactly as they do for kit names.

## Tier 7: real-world sound textures

Ambient sound is mostly shaped noise plus sparse random events, which fits Tartlet's seeded
patterns well.

- **Procedural ambiences.** Sound names such as `rain`, `wind`, `fire`, `stream`, `surf` and
  `crowd`, built from filtered noise beds plus seeded micro-events (drops, crackles, gusts).
  Controls: `intensity` and `density`. Long notes (`s("rain").slow(8)`) become beds.
- **Pattern-driven textures.** Because events are seeded, users can already write
  `s("drip*16?0.7").pan(rand).gain(rand.range(0.2, 0.6))`. A good set of short synthesized
  "foley" one-shots (`drip`, `click`, `tick`, `creak`, `step`) multiplies what that can do.
- **Granular playback.** `grain` (size in ms), `gdensity`, `gjitter` and `gpos` on samples,
  for turning a short recording into a texture. Jitter uses seeded draws handed down as
  controls.
- **Creature and machine sounds.** Simple models for birdsong (FM chirps with pitch
  envelopes), insects (amplitude-modulated noise bands) and engines (pulse trains through
  resonant filters) as stretch goals.

## Cost budgeting

A polyphony cap of 64 treats a sine and a bowed waveguide alike. Proposal:

- Each sound declares a cost: basic oscillator 1, unison n, noise bed 2, modal model 4,
  waveguide 6. Shared effects (reverb, delay per `orbit`) are paid once.
- The engine caps total cost rather than voice count, stealing the oldest voices first.
- `sanity` can estimate cost per cycle from events and sound names, and the checker can warn
  (`W-RES-HEAVY`, proposed) when an output is likely to exceed the budget on its own.

## Diagnostics (proposed)

- `W-RES-HEAVY`: an output's estimated voice cost is likely to exceed the engine budget.
- `W-ARG-UNSUPPORTED`: a constant articulation or model control that the chosen sound never
  uses.
- `I-RES-MODEL`: a sound name resolves to a physical model, with its cost.
- `E-CAP-PITCHED`: extended to cover `glide`, `tuning` and `chord` on unpitched receivers.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Core.** New controls and transforms get hand-written golden expectations like everything
  else. `strum`, `swing`, `humanize` and `rr` get D rows (stable for a seed, different across
  seeds, unaffected by appending methods). New constructs join the `SOURCES` list in
  `laws.test.ts` where they affect timing.
- **Audio.** Render short phrases with `OfflineAudioContext` in the Playwright suite and
  assert properties, never stored waveforms:
  - peak never exceeds the limiter ceiling and no sample is NaN;
  - the measured fundamental is within a few cents of the requested note and tuning;
  - spectral centroid rises with `velocity` and `brightness`;
  - decay time grows with `ring` and shrinks with `damping`;
  - identical seeds render bit-identical buffers on one engine.
- **Expectations by reasoning.** Thresholds come from acoustics and musical reasoning (for
  example "a harder mallet is brighter"), not from capturing the output of Tartlet or another
  implementation, consistent with [testing.md](testing.md#rules-for-expectations).

## Suggested order

1. Tier 0: make carried controls audible. Low risk, high value.
2. Noise, filter and pitch envelopes, FM, `legato` and velocity-to-timbre.
3. `pluck` and the modal bar family, plus the fallback table update.
4. `strum`, `swing`, `humanize`, `vary`.
5. Space presets and distance cues.
6. Host-supplied sample banks with zones (depends on ADR-004).
7. Procedural ambiences and granular playback.
8. Tuning systems and fractional notes; blown and bowed models.

## Open questions

- Should instrument-specific controls live in the global registry, or should the registry
  gain a notion of controls scoped to a sound family?
- How should continuous, in-note control (breath, bow pressure) interact with the onset
  sampling rule of TS-33?
- Is per-output voice continuity (`glide`, `mono`, `pedal`) compatible with recompiling the
  program while it plays, as the element does today?
- What is the right cost unit, and should hosts be able to lower the budget for weak devices?
- Which models are worth their bundle size in the core budget, and which should be optional
  packages loaded only when a document names them?
