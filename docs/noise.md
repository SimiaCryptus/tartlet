# Extensions: noise theory

**Status: proposal.** Tartlet has three noise sound names today (`white`, `pink` and `brown`,
TS-42) and four random signals (`rand`, `irand`, `perlin`, and the seeded mini-notation `?` and
`|`). Everything else on this page is a proposal. Each item needs a `TS-n` entry in
`spec-issues.md`, registry entries marked as extensions, and tests as described in
[testing.md](testing.md).

The oscillators, kit and voices are organised tone generators: they start from a periodic
wave and shape it. Real sound is mostly not periodic. Breath, bows, cymbals, rain, consonants,
tape hiss, a room's air and the small wobble of every acoustic instrument are noise, and
noise has its own theory: colour (how energy is spread over frequency), distribution (how
values are spread over amplitude), density (how often things happen) and correlation (how
much one moment predicts the next). The same four ideas apply in two places:

1. **audio-rate noise**, inside a voice, which is a sound;
2. **pattern-rate noise**, between events, which is a compositional tool.

Tartlet currently treats the first as three fixed sound names and the second as a uniform
`rand`. This page proposes making both into a small, coherent, deterministic toolkit.

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints): the core
path stays pure, controls are data, randomness is decided in core, musical time is rational,
the safety chain cannot be bypassed and nothing is fetched. Noise adds these:

- **All noise is pseudo-random and reproducible.** Audio-rate noise reads fixed-seed noise
  beds generated from static code, selected and offset by a per-event seed drawn in core
  (like `vseed` for voices, internal name `nseed`). The same document and seed render
  identically on one engine. Nothing calls `Math.random`, `crypto` or any host entropy.
- **Pattern-rate noise is query-local.** A signal's value at time `t` must be computable from
  `t`, the scope and the node id alone, with bounded work. This is what keeps the span
  splitting and containment laws true and the query budget honest. It rules out naive
  cumulative processes; see [Walks and memory](#walks-and-memory).
- **Colour and distribution are separate controls.** A pink noise can be Gaussian or uniform;
  a uniform random melody can be white or 1/f. Names never conflate the two.
- **Loudness is normalised per colour.** Switching `white` to `violet` must not jump in level.
  Each colour is scaled to a documented RMS before the voice's `gain`, and the master limiter
  still applies.
- **Signals and sounds keep separate names.** `pink` is a sound name used in `s("pink")`. A
  pattern-rate signal with a pink spectrum gets a different identifier (`pinkrand`), so models
  do not confuse `s("pink")` with `.pan(pink)`.

## A little theory

The proposals map onto these ideas.

- **Colour** is the slope of the power spectrum, in dB per octave:

  | Colour | Slope        | Character                                             |
  | ------ | ------------ | ----------------------------------------------------- |
  | violet | +6 dB/oct    | Hiss with no body. Differentiated white noise.        |
  | blue   | +3 dB/oct    | Bright, airy. Also good dither: little low energy.    |
  | white  | 0            | Equal energy per hertz. Sounds bright to the ear.     |
  | pink   | −3 dB/oct    | Equal energy per octave. Sounds balanced; "1/f".      |
  | brown  | −6 dB/oct    | Rumble, surf, distant thunder. Integrated white.      |
  | grey   | loudness-eq. | White shaped by an equal-loudness curve. Sounds flat. |

- **Velvet noise** is a sparse train of ±1 impulses at random positions, one per short grid
  cell. Above about 1500 impulses per second it sounds as smooth as white noise, at a tiny
  fraction of the cost, which makes it useful for reverbs and decorrelation.
- **Dust** is velvet noise at low density: individual clicks and crackles. Vinyl, fire, rain
  on a window and Geiger counters are dust with different densities and filters.
- **Distribution** is the histogram of values: uniform (`rand`), Gaussian (sums of many small
  causes), exponential (waiting times between independent events), Cauchy-like heavy tails
  (mostly small, occasionally huge).
- **Correlation** is how much a value predicts the next one. White sequences have none, brown
  sequences are dominated by it, and pink sequences sit between: they are correlated at
  every timescale at once. Several published analyses of melody and loudness in recorded
  music report spectra close to 1/f; Tartlet does not depend on that claim, but pink
  sequences are a well-known middle ground between "too random" and "too predictable".
- **Pitched noise** is narrow-band noise. As the band narrows, noise turns into a whistling
  tone with an unstable pitch: wind in wires, a breathy flute, a bowed cymbal.
- **Noise as modulation** is the source of most "aliveness". A slightly noisy pitch, amplitude
  or cutoff is the difference between a synth and an instrument. The voice controls `jitter`
  and `shimmer` (TS-43 to TS-47) already do this for one sound.

## Tier N0: noise colours

Extend the noise sound names and add a continuous colour control.

| Name or control | Kind        | Meaning                                                           |
| --------------- | ----------- | ----------------------------------------------------------------- |
| `blue`          | sound       | +3 dB/oct noise.                                                  |
| `violet`        | sound       | +6 dB/oct noise.                                                  |
| `grey`          | sound       | White noise through a fixed, static equal-loudness curve.         |
| `velvet`        | sound       | Sparse ±1 impulses. Uses `density` (default 2000 Hz).             |
| `color`         | −6–6 dB/oct | Continuous slope applied to any noise sound, relative to its own. |

- All colours are built from one white bed with native nodes: pink and blue from a small bank
  of shelving biquads, brown and violet from a one-pole integrator or differentiator. `color`
  sets the shelves, so `s("white").color(-3)` approximates `s("pink")`.
- Beds are generated once from a constant seed at engine start, like the generated reverb
  impulse responses (TS-41), and are identical on every machine.
- Each colour is normalised to the same RMS, so `.s("<white pink brown>")` changes timbre,
  not level.

## Tier N1: shaped and pitched noise

| Name or control | Range        | Meaning                                                                   |
| --------------- | ------------ | ------------------------------------------------------------------------- |
| `note` on noise | MIDI         | Centres a resonant band-pass on the note. Off when `note` is absent.      |
| `band`          | 0–1          | Band narrowness for pitched noise. 0 is wide hiss, 1 is a near-tone.      |
| `dust`          | sound        | Sparse clicks. Uses `density` (0.1–500 Hz) and the usual filters.         |
| `crackle`       | sound        | Dust with seeded, varying click amplitudes and widths (fire, vinyl).      |
| `snh`           | 10–20000 Hz  | Sample-and-hold rate: steps the noise into a stair-stepped "digital" bed. |
| `density`       | 0.1–20000 Hz | Impulse rate for `velvet`, `dust` and `crackle`.                          |

- Pitched noise makes noise voices **pitched** when `note` is present. This touches
  `E-CAP-PITCHED` (TS-35) and needs a TS entry: `s("pink").note("c4").band(0.9).scale(...)`
  should be accepted, while `s("pink").scale(...)` without `note` keeps the error. The same
  entry settles the `note`-driven dichotic pitch question in
  [binaural.md](binaural.md#tier-b2-dichotic-pitch).
- Click positions in `dust` and `crackle` are audio-side and come from the `nseed` bed, not
  from musical time. For clicks that should land on the grid, write a pattern instead:
  `s("dust*16?0.7")` (see [Tier P3](#tier-p3-stochastic-structure)).

## Tier N2: noise inside tones

Generic per-voice noise modulation, available on every source, not only `voice`.

| Control     | Range       | Meaning                                                        |
| ----------- | ----------- | -------------------------------------------------------------- |
| `pnoise`    | 0–100 cents | Random pitch wander.                                           |
| `anoise`    | 0–1         | Random amplitude roughness.                                    |
| `cnoise`    | 0–4 octaves | Random cutoff wander around `cutoff`.                          |
| `noiserate` | 0.1–50 Hz   | How fast the wander moves. Low is drift, high is roughness.    |
| `noisemix`  | 0–1         | Mixes band-limited noise that tracks the note into the source. |
| `chiff`     | 0–1         | A short noise burst at the attack (pipe chiff, pick, hammer).  |

- The wander signals are smoothed noise (value noise through a one-pole), read from beds
  chosen by `nseed`. Each voice starts at its own offset, so two simultaneous notes never
  wander in lockstep.
- `noisemix` and `chiff` cover most of the "real instrument" gap for flutes, pipes, plucks and
  hammers cheaply, before any physical model in
  [instruments.md](instruments.md#tier-2-physical-and-modal-models) exists.
- On `voice`, `pnoise` and `anoise` are aliases for the existing `jitter` and `shimmer`
  scaling, so the two families do not diverge.

## Tier P0: distributions

Pattern-rate signals, all seeded with counter-based draws and sampled at the receiver's
onsets (TS-33). Each value is a pure function of (scope, node id, cycle, position), so the
laws hold unchanged.

| Signal         | Values | Meaning                                                                  |
| -------------- | ------ | ------------------------------------------------------------------------ |
| `rand`         | [0, 1) | Exists. Uniform.                                                         |
| `gauss`        | [0, 1] | Bell-shaped around 0.5 (mean of four draws, so bounded, never infinite). |
| `exprand`      | [0, 1) | Mostly small, occasionally near 1. Inverse transform of one draw.        |
| `.curve(k)`    | method | Bends a [0, 1] signal: `k > 1` favours low values, `k < 1` high ones.    |
| `.quantize(n)` | method | Snaps a [0, 1] signal to `n` evenly spaced levels.                       |

- `gauss` uses the Irwin–Hall mean of four draws instead of Box–Muller, so it is bounded,
  needs no logarithms and stays inside [0, 1] for `.range`.
- Distributions compose with existing helpers: `n(gauss.range(0, 7).quantize(8)).scale(...)`
  is a melody that prefers the middle of the scale.

## Tier P1: coloured sequences

| Signal      | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `pinkrand`  | 1/f sequence: correlated at every timescale.                                |
| `brownrand` | Strongly correlated: each value stays near the last.                        |
| `bluerand`  | Anti-correlated: avoids repeating nearby values (good for "fair" shuffles). |
| `perlin`    | Exists. Smooth interpolation between per-cycle draws.                       |

- `pinkrand` uses the Voss–McCartney construction: the sum of `k` uniform values, where value
  `j` is redrawn every `2^j` steps. Each value is `draw(scope, nodeId, j, floor(t·2^(k−j)))`,
  a pure function of time, so it is query-local and lawful. `k` defaults to 8 and is a
  constant argument: `pinkrand` or `pinkrand(12)`.
- `brownrand` is the same construction with weights falling as `2^−j`, which approximates a
  −6 dB/oct sequence without a cumulative sum.
- `bluerand` is the difference of two adjacent white draws, rescaled to [0, 1).
- The step grid is one value per cycle by default. Combine with `.fast(n)` or `.segment(n)`
  for finer steps.

## Walks and memory

A true random walk (`x[k] = x[k−1] + step`) or a Markov chain depends on every earlier step.
Querying cycle 10 000 would cost 10 000 draws, and the cost grows with time, which breaks the
query budget and makes behaviour depend on how far into a piece you seek. Tartlet therefore
does not offer unbounded memory. Proposed alternatives:

- **Multi-octave noise** (`brownrand`, `perlin`) gives walk-like contours with constant cost.
- **Bounded walks** reset on a fixed period: `.walk(step, period)` restarts at `0.5` every
  `period` cycles (a constant, capped at 64), so a query costs at most `period · steps` draws.
  The reset is audible as a phrase boundary, which is often musically desirable anyway.
- **Markov chains** follow the same rule: `markov(table, period)` with a constant transition
  table (needs list-typed parameters, see
  [language_extensions.md](language_extensions.md#26-language-features-the-library-needs))
  and a capped period. Each state is recomputed from the last reset.

Both bounded forms need a TS entry describing the reset point and the cost charged to
`budget.steps`.

## Tier P3: stochastic structure

Noise can decide _when_ things happen, not only what values they have.

- **`.poisson(rate)`**: events at random positions with an average of `rate` per cycle,
  quantised to a rational grid (default 1/64 cycle) so musical time stays exact. Each grid
  cell decides independently with a seeded draw, which makes the construction local.
- **`.jitterBy(amount)`**: moves each onset by a seeded rational offset up to `amount` cycles,
  clipped so that it never crosses the next onset. Unlike the scheduler's `nudge`, this is
  musical time and obeys the laws.
- **`.densityBy(signal)`**: keeps each event with probability given by a signal, so a
  pattern thins and thickens with `perlin` or `pinkrand`. It generalises `degradeBy` to
  patterned probabilities.
- **Clouds.** `s("dust").poisson("<4 16 64>").pan(rand).speed(gauss.range(0.5, 2))` is
  already a stochastic texture in the sense of granular and "cloud" composition. Recipes
  like this belong in the playground examples.

## Recipes

```js
// proposed syntax: blue, band, chiff, pinkrand and poisson are not accepted today

// Wind in wires: pitched pink noise that wanders slowly.
$: s('pink').note('<a4 c5 g4>').band(0.85).cnoise(0.5).noiserate(0.3).slow(2);

// A breathy flute line without a physical model.
$: note('e4 g4 a4 b4').s('sine').noisemix(0.2).chiff(0.4).pnoise(8);

// A 1/f melody: correlated at every timescale, never quite repeating.
$: n(pinkrand.range(0, 12).quantize(13).segment(8)).scale('D:dorian').s('triangle');

// Fire: crackle over a brown-noise bed.
$: s('brown').slow(8).gain(0.3).cutoff(400);
$: s('crackle').density(6).hcutoff(800).gain(rand.range(0.4, 0.9));

// Rain: a cloud of short clicks with random pan and pitch.
$: s('dust').poisson(48).pan(rand).speed(gauss.range(0.8, 1.6)).room(0.4);
```

## Safety

- **Level.** Broadband noise at high level is fatiguing and can mask the limiter's work.
  Colours are normalised to an RMS below the tone voices' typical level, and `gain` keeps its
  usual 0–1.5 range. The master limiter ceiling applies.
- **Impulses.** `velvet`, `dust` and `crackle` have high crest factors. Their impulse
  amplitude is scaled so that a single click cannot exceed the bus headroom before the
  compressor.
- **Low rumble.** `brown` and negative `color` put energy below what small speakers can
  reproduce. A fixed 20 Hz high-pass on every noise voice keeps that energy from eating
  headroom invisibly.

## Diagnostics (proposed)

- `W-ARG-UNSUPPORTED` (from [instruments.md](instruments.md#diagnostics-proposed)): `band`,
  `color` or `snh` on a non-noise sound, or `density` on a sound that has no impulses.
- `E-CAP-PITCHED`: unchanged for noise voices without `note`; accepted with it (TS entry
  above).
- `E-ARG-TYPE`: a patterned `period` for `.walk` or `markov`, or a patterned octave count for
  `pinkrand`.
- `W-RANGE`: out-of-range constants, as for every control.
- `I-NOISE-RESET`: a bounded walk or chain resets more often than its receiver has onsets, so
  it behaves like plain `rand`. Benign and hidden from the repair payload.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Core.** Every new signal and transform joins `SOURCES` in `laws.test.ts`; query-locality
  is exactly what the span-splitting law checks. D rows for each: stable for a seed,
  different across seeds, unchanged when a method is appended. Additional property tests,
  with expectations derived from the constructions rather than captured output:
  - `gauss` and `exprand` stay in their documented ranges;
  - over a fixed seed and 10⁴ samples, histograms pass a loose goodness-of-fit check against
    the intended distribution;
  - the spectral slope of a long `pinkrand` sequence is near −3 dB/oct, `brownrand` near
    −6 and `bluerand` positive;
  - the cost of querying cycle `c` of `.walk` does not grow with `c`;
  - `.poisson` onsets are rational, lie on the grid, and their mean count per cycle is near
    `rate`; `.jitterBy` never reorders onsets.
- **Audio.** Render with `OfflineAudioContext` in the Playwright suite and assert properties,
  never stored waveforms:
  - each colour's measured slope is within a tolerance of its table value, and `color`
    moves the slope by the requested amount;
  - all colours have the same RMS within a tolerance;
  - pitched noise has a spectral peak at the note's frequency whose prominence rises with
    `band`;
  - `dust` click counts per second track `density`;
  - `pnoise` widens the measured pitch spread without moving its centre;
  - identical seeds render bit-identical buffers on one engine, the peak never exceeds the
    limiter ceiling, and no sample is NaN.
- **Expectations by reasoning.** Slopes, distributions and thresholds come from signal theory
  and musical reasoning, never from capturing the output of Tartlet or another
  implementation, as [testing.md](testing.md#rules-for-expectations) requires.

## Suggested order

1. N0: `blue`, `violet`, `grey` and per-colour normalisation. Native nodes only.
2. P0: `gauss`, `exprand`, `.curve` and `.quantize`. Small, pure and immediately useful.
3. P1: `pinkrand`, `brownrand`, `bluerand`.
4. N2: `pnoise`, `anoise`, `cnoise`, `noisemix` and `chiff` on every source.
5. N1: pitched noise (with its `E-CAP-PITCHED` TS entry), `dust`, `crackle`, `velvet`, `snh`.
6. P3: `.poisson`, `.jitterBy`, `.densityBy`, plus recipes in the playground.
7. Bounded `.walk` and `markov`, once list-typed parameters land.

## Open questions

- Should `color` replace the fixed colour names entirely, leaving only `noise` as a sound
  name? Fixed names are easier for models; a slope is more expressive.
- Should pattern-rate noise default to one value per cycle, or to one value per receiver
  onset? Per-cycle is lawful and simple; per-onset is what users often expect.
- Is the Voss–McCartney octave count a user concern, or should `pinkrand` hide it?
- Should bounded walks reset at a fixed period, or at boundaries chosen by another pattern
  (for example section changes from `arrange`)?
- Should `nseed` share its draw with `vseed` on voices, so a voice and its noise layer vary
  together, or stay independent?
- Does `.jitterBy` belong here, in [instruments.md](instruments.md#tier-3-performance-and-articulation)
  next to `humanize`, or should the two be one transform?
