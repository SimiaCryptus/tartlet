# Extensions: voices and vocality-type sounds

This page collects proposals for sounds that read as _vocal_: sung vowels, choirs, syllables,
whispers, talkbox and overtone effects, recorded vocal chops, and creature calls. **Tiers V0–V4
are implemented** (TS-43 to TS-47); V5 (recorded voices) and the vocoder remain proposals. See
[Implementation notes](#implementation-notes). It extends the Voice row of
[instruments.md](instruments.md#tier-2-physical-and-modal-models) and follows every
constraint listed there.

What exists today:

- `vowel` (`a e i o u`) runs a source through parallel formant band-passes (TS-41).
- `timbre("reed")`, `pw`, `vib`/`vibdepth`, `unison`/`detune` and `glide` on `mono` lines
  (TS-42) are the building blocks a voice needs.
- `s("sawtooth").note("c3 e3 g3").vowel("<a o>").vib(5).vibdepth(0.2)` already gives a
  recognisably vocal "aah/ooh" pad.

The goal is to get from "a filtered sawtooth" to "a small choir singing _la lu_", while keeping
the language closed and the output deterministic.

## Extra constraints for voices

These come on top of the [instrument constraints](instruments.md#constraints).

- **No platform speech synthesis.** `speechSynthesis` and similar host APIs are rejected
  outright. They bypass the Web Audio graph and therefore the safety chain. They cannot be
  scheduled against the audio clock, and they sound different on every platform and voice
  pack. They also hand document text to a host service.
- **No fetched or bundled TTS models.** Neural or concatenative text-to-speech is far outside
  the core budget, and its output cannot be reasoned about for tests. Voices are synthesized
  from small static tables, or they come from host-supplied banks (Tier V5).
- **Lyrics are data from a closed alphabet.** Syllables are short ASCII strings parsed by a
  hand-written, closed phoneme grammar (ADR-001 style). They are never interpreted as
  spelling and never passed to any host API. Arbitrary text and Unicode are rejected.
- **No identifiable people.** There are no presets named after singers and no voice cloning.
  Recorded voice banks must carry license and consent metadata (Tier V5).
- **Micro-variation is seeded.** Jitter, shimmer, vibrato phase and choir scatter matter a
  lot for vocal realism. Core draws one per-event seed with `draw(...)` and passes it as a
  plain control (`vseed`, internal). The worklet derives its audio-rate noise from that
  value, so the same document and seed render identically on one engine.
- **Consonant timing is not musical time.** Singers start consonants _before_ the beat, so
  that the vowel lands on it. That lead is a few tens of milliseconds, applied in seconds by
  the scheduler like `nudge`. It needs its own TS entry and a hard cap (Tier V3).

## What makes a sound vocal

This is a short summary of the acoustics. The proposals below map onto it.

- **Source and filter.** The vocal folds produce a pulse train (the _glottal source_). The
  vocal tract filters it through resonances called _formants_. F1 and F2 decide which vowel
  you hear. F3 to F5 carry voice type and "ring".
- **Spectral tilt and breath.** Soft singing has a steep spectral tilt and audible aspiration
  noise. Loud singing is brighter and cleaner. Velocity should drive both.
- **Instability.** Real voices have small cycle-to-cycle pitch jitter, amplitude shimmer,
  slow drift, and vibrato around 5–7 Hz that fades in after the note starts.
- **Transitions.** Notes are often approached with a scoop from below. Formants glide between
  vowels instead of switching (coarticulation).
- **Consonants.** These are short noise bursts, fricative noise bands, nasal murmurs and
  formant transitions around the vowel.
- **Ensembles.** A choir is many slightly different voices. Pitch spread, timing scatter and
  unsynchronised vibrato are what make it sound like a choir rather than a chorus effect.

## Tier V0: richer vowels with the existing filter

This is pure adapter work, plus registry entries. It applies to any pitched source, so
`s("sawtooth")`, `s("square")` and FM voices all benefit.

| Control     | Proposal                                                                         |
| ----------- | -------------------------------------------------------------------------------- |
| `vowel`     | Extend the closed set: `a e i o u` plus `ae ah aw eh er ih oh oo uh`.            |
| `voicetype` | Enum `bass tenor alto soprano child` selecting the formant table (F1–F5, Q).     |
| `formant`   | Formant shift in semitones (−12–12), independent of pitch. "Size" of the throat. |
| `vglide`    | Seconds to glide formants from the previous vowel on the same `mono` line.       |
| `ring`      | Boost around 3 kHz (the singer's formant), 0–1.                                  |

- Formant tables are static data in `@tartlet/webaudio`. They are written from published
  acoustic averages and documented in the source, not captured from another implementation.
- `vowel` stays a string control. An unknown constant vowel gets a checker warning (see
  [Diagnostics](#diagnostics-proposed)) and falls back to `ah`.
- `vglide` reuses the "previous note on a mono line" definition from TS-42, so it needs no new
  continuity rule.

## Tier V1: a glottal voice source

This tier adds a sound name, `voice`, backed by a static worklet that implements a glottal
pulse model, aspiration noise and the V0 formant bank. Like every Tier 2 model in
`instruments.md`, it is a sound name and not a new function: `note("c4 e4").s("voice")`.

| Control   | Range    | Meaning                                                      |
| --------- | -------- | ------------------------------------------------------------ |
| `breath`  | 0–1      | Aspiration noise mixed with the voiced source.               |
| `effort`  | 0–1      | Spectral tilt and pulse sharpness. Defaults to `velocity`.   |
| `jitter`  | 0–1      | Cycle-to-cycle pitch irregularity (scaled to a few cents).   |
| `shimmer` | 0–1      | Cycle-to-cycle amplitude irregularity.                       |
| `scoop`   | −12–0 st | Start below the note and rise into it over the first ~80 ms. |
| `vibdel`  | 0–2 s    | Delay before `vib` fades in. Reuses `vib` and `vibdepth`.    |
| `fry`     | 0–1      | Irregular, subharmonic pulses for vocal fry and growl.       |

- `voice` is **pitched**, so `.scale`, `.transpose` and `glide` work, and `E-CAP-PITCHED`
  behaviour is unchanged (TS-35).
- Related sound names are presets over the same model: `aah`, `ooh`, `hum` (closed mouth,
  nasal formant) and `whisper` (`breath` 1, no voicing).
- If the worklet is refused (ADR-003, risk R-3), `voice` falls back to a Tier 1 patch: a
  `square` with `pw` around 0.15, plus `pink` noise, through the V0 formant bank. An info
  diagnostic is reported at play time.
- Velocity-to-timbre (instruments Tier 3) is the single most important mapping here. A soft
  `voice` should be breathy and dark, and a loud one should be bright.

## Tier V2: choirs and ensembles

`choir` is a sound name that runs several `voice` instances per event.

- It reuses `unison` (1–8, raised to 16 for `choir`) and `detune` (spread in cents) from
  TS-42 instead of inventing new names.
- `scatter` (0–60 ms) staggers voice onsets. Like the consonant lead, this is seconds and not
  musical time. Per-voice offsets, vibrato rates and phases come from the event's seeded
  `vseed`.
- `width` (0–1) spreads voices across the stereo field, or around the head when `azimuth` is
  set (TS-40).
- Section writing uses ordinary patterns: one output per section, each with its own
  `voicetype`, or `chord(...)`/`.voicing()` from instruments Tier 3 once that lands.
- Every voice in a choir counts against the cost budget (TS-42). A 16-voice choir chord is
  expensive, and the checker should say so (`W-RES-HEAVY`).

## Tier V3: syllables and phonemes

This is the largest step, and it is where most of the open questions are.

### The `syl` control

`syl` carries one syllable per event as a string. Because strings passed to pattern
parameters are mini-notation, syllables pattern like any other control:

```js
// proposed syntax — not accepted today
$: note('c4 d4 e4 [g4 e4]').s('voice').syl('la la li [lu _]');
```

- **One syllable per event**, aligned through the usual structure rules: a patterned `syl`
  uses `appLeft`, so the receiver's notes keep their wholes.
- **`_` continues the previous vowel** (melisma). The voice holds or glides its vowel and
  plays no new onset consonant. `_` is already a legal atom character.
- **`~` stays a rest**, with no change to mini-notation.
- On non-voice sources, `syl` drives the formant filter only (see `talk` in Tier V4).

### A closed phoneme alphabet

Syllables are written phonetically in plain ASCII, not in English spelling. A syllable is:

```
syllable := onset? nucleus coda?
onset    := consonant (consonant)?          // at most two, e.g. "st", "pl"
nucleus  := vowel                           // the V0 vowel set
coda     := consonant (consonant)?
```

| Class      | Symbols (proposed) | Rendering                                    |
| ---------- | ------------------ | -------------------------------------------- |
| Plosives   | `p t k b d g`      | Silence or voice bar, burst, formant locus   |
| Fricatives | `f s sh h v z th`  | Band-limited noise, voiced for `v z`         |
| Nasals     | `m n ng`           | Low murmur formant with a damped upper range |
| Liquids    | `l r`              | Short formant transitions into the vowel     |
| Glides     | `w y`              | Rapid glide from `oo`/`ee` into the nucleus  |

- The grammar is greedy and longest-match (`sh` before `s`), hand-written, and closed. The
  parser is pure and lives in the core path, next to the tonal helpers in
  `@tartlet/registry`, so the checker can validate every constant syllable. The rendering
  tables live in `@tartlet/webaudio`.
- There are no spelling rules. `"hel lo"` is read phonetically, which happens to work, but
  `"through"` would not. The docs will say plainly that this is a singing alphabet, not
  text-to-speech.

### Timing

- **Onset consonants lead the beat.** They are scheduled before the event's onset so that the
  vowel starts on the beat. The lead is capped (proposed: 60 ms). That is well inside the
  scheduler's 100 ms lookahead, so no scheduler change beyond an early-start offset is
  needed. The very first event of playback may have its lead shortened.
- **Coda consonants sit at the release**, inside the event's duration. `legato` (instruments
  Tier 3) decides where that is.
- This needs a TS entry. It is the first case where a sound starts audibly before the
  event's `whole.begin`, and the visual highlighting in the playground must not suggest
  otherwise.

## Tier V4: vocal colour on any source

- **`talk`** (0–1) applies `vowel`/`syl` formant tracks to any pitched source at the given
  intensity, like a talkbox: `s("sawtooth").note("c2*8").syl("wa wa wo wi").talk(1)`.
- **`overtone`** (harmonic number 4–16) adds a very narrow resonant peak that follows the note,
  for throat- and overtone-singing effects over a `hum` drone.
- **`whisper`** (the sound name from V1), or `breath(1)` on `voice`, turns any melody into
  breath.
- **Vocoder.** A true vocoder needs one output to modulate another. Tartlet has no
  cross-output routing, so this is research. A possible shape is a per-`orbit` analysis bus,
  analogous to the shared reverb and delay, with a `vocsend` control on the modulator. It
  needs an ADR, because it is the first feature that makes one output's sound depend on
  another's.

## Tier V5: recorded voices

Recorded voices follow the host-supplied bank design in
[instruments.md](instruments.md#tier-6-samples-and-multisampling). Voices add three
requirements.

- **Consent metadata.** A voice bank manifest entry needs `license` and a `consent` field
  stating that the performer agreed to this use. A bank without it still loads, and the
  checker reports it (`I-RES-CONSENT`) when a catalog knows the bank.
- **Vocal chops.** `s("vox:3").speed(...)` works as soon as banks work. Note that `speed`
  shifts formants with pitch (the "chipmunk" effect), and the docs should say so.
- **Formant-preserving shift.** Applying `formant` to samples needs a phase-vocoder or
  PSOLA-style worklet. It is expensive, so it is marked research and costed accordingly.

## Non-human vocality

Many creature sounds are vocal in structure: a source, a moving formant and a pitch
contour. Once V0 and V1 exist, they mostly fall out of patterns, and they complement the
textures in [instruments Tier 7](instruments.md#tier-7-real-world-sound-textures):

```js
// proposed syntax — a "meow" from a vowel glide and a pitch envelope
$: note('g4').s('voice').syl('mi_a_u').vglide(0.15).penv(5).pdecay(0.3);
```

Dedicated presets (`bird`, `frog`, `howl`) can come later as named parameter sets over the
same model. They need no new machinery.

## Registry and language impact

- Every new name is a control or a sound name. No new functions or syntax are needed, and
  mini-notation is unchanged.
- Control values stay data. `vowel`, `voicetype` and `syl` are strings from closed sets. All
  other new controls are clamped numbers.
- Tartlet-only names (`syl`, `talk`, `effort`, `scoop`, `vglide`, `fry`, `scatter`) are marked
  as extensions, like `binaural`. Descriptions are original.
- The system prompt (`tartlet prompt`) should list the phoneme alphabet briefly. Models will
  otherwise write English spelling in `syl`.

## Diagnostics (proposed)

- `W-ARG-PHONEME`: a constant syllable does not parse in the phoneme alphabet. The vowel `ah`
  is substituted and the track plays. A fix is offered when one edit makes it valid.
- `W-ARG-VOWEL`: an unknown constant `vowel` or `voicetype`. The default is used.
- `W-ARG-UNSUPPORTED` (from `instruments.md`): `syl` on a drum or noise sound, which has no
  formant filter to drive.
- `I-RES-CONSENT`: a known voice bank has no consent metadata.
- `W-RES-HEAVY` (from `instruments.md`): large choirs.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Core.** The phoneme parser gets P-style unit tests: valid syllables, longest match,
  rejection of non-ASCII and over-long clusters. `syl`, `vowel` and `voicetype` events get
  hand-written golden expectations like any control. The seeded `vseed` gets D rows: stable
  for a seed, different across seeds, unaffected by appended methods.
- **Audio.** Render with `OfflineAudioContext` in the Playwright suite and assert properties,
  never stored waveforms:
  - for each vowel, the two strongest spectral-envelope peaks fall near the F1 and F2 values
    in the documented table, within a tolerance;
  - `formant` moves those peaks without changing the measured fundamental;
  - an onset consonant's energy begins before the scheduled onset, and never earlier than
    the cap;
  - spectral tilt flattens as `effort` or `velocity` rises, and noise energy rises with
    `breath`;
  - a `choir` render is bit-identical for identical seeds on one engine;
  - the peak never exceeds the limiter ceiling, and no sample is NaN.
- **Expectations by reasoning.** Formant targets come from published acoustic phonetics, and
  behavioural thresholds come from musical reasoning ("a louder voice is brighter"), as
  [testing.md](testing.md#rules-for-expectations) requires.

## Suggested order

1. V0: the extended vowel table, `voicetype`, `formant`, `ring` and `vglide`. Low risk, and
   useful on every existing oscillator.
2. V1: the `voice` worklet and its Tier 1 fallback, with velocity-to-effort.
3. V2: `choir`, reusing `unison`/`detune`, plus `scatter`.
4. V3: the phoneme grammar in the core path, `syl`, and the consonant-lead TS entry.
5. V4: `talk`, `overtone` and `whisper`.
6. V5: recorded voice banks with consent metadata (depends on ADR-004).
7. Research: the vocoder ADR, and formant-preserving sample shifts.

## Open questions

- Should the consonant lead stay in seconds, or become an explicit rational offset that the
  playground can visualise?
- Which alphabet should Tartlet use: an ARPAbet-like subset, an X-SAMPA subset, or its own?
  How do we keep it from being English-only?
- How should `syl` behave under `ply`, `fast` and `off`? Should a duplicated event repeat its
  syllable, or should duplicates become `_`?
- Should `voice` default to a voice type at all, or should it require `voicetype` and avoid
  implying a default gender?
- Is a per-orbit analysis bus (for the vocoder) an acceptable first step towards
  cross-output routing, or should outputs remain fully independent?
- Where is the line between a "singing alphabet" and text-to-speech? At what point would
  requests for intelligible speech need a separate, optional package?

## Implementation notes

Where the implementation differs from the proposals above:

- **No worklet.** The voice is built from native nodes. The glottal source is a periodic wave
  whose high harmonics fall off more steeply at low effort. Jitter and shimmer read fixed-seed
  noise beds chosen by `vseed`. The ADR-003 fallback is therefore not needed.
- **Consonant lead.** The audio adapter applies the lead, not the scheduler. It is capped at
  60 ms and by how early the event arrived (TS-46).
- **Vowels inside one syllable.** `_` joins vowels inside one syllable (`mi_a_u`). The vowels
  glide evenly across the note (TS-45).
- **Not implemented yet:** recorded voice banks, the vocoder, formant-preserving sample
  shifts, `W-ARG-UNSUPPORTED`, `W-RES-HEAVY`, `I-RES-CONSENT` and `I-RES-MODEL` (TS-47).
