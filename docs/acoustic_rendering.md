# Extensions: acoustic rendering of impulse responses

**Status: implemented** for Tiers A1 and A2; Tier A0 waits for listening tests. It builds on the generated body
responses (Tier I1, TS-82), the `space` presets (TS-69) and the latency and caching rules in
[dsp.md](dsp.md). Each item that adds a control, an enum value or a diagnostic needs a `TS-n`
entry in `spec-issues.md`, registry entries marked as extensions, and tests as described in
[testing.md](testing.md).

Rich impulse responses are what turn "a plucked oscillator" into "a guitar" and "a dry
sound" into "a sound in a stone room". Today Tartlet has two ways to get them:

- **generated presets** (`body`, `cab`, `space`), hand-designed sums of decaying modes and
  seeded noise. They are cheap, but each is a single fixed character;
- **host-supplied recordings** (Tier I3, still a proposal). They sound real, but they are
  data-heavy, must be captured, licensed and hosted, and cannot be varied.

This page proposes a third way: **render the impulse response from a description of the
space**. A document names a simple cavity, its size, its material and where the source and
the listener sit. Static code in `@tartlet/webaudio` computes how sound travels in that
cavity, band by band across the spectrum, and synthesises the response. No file is captured
or fetched; a few constants describe the whole space.

```js
// proposed syntax: not accepted today

// A small spruce box with a sound hole: a plucked instrument body.
$: note('e3 g3 b3 e4').s('triangle').decay(0.3)
     .cavity('box').cavsize(0.45).material('spruce').cavhole(0.3);

// The same pattern in a modelled concrete hall.
$: s('cp*2').space('model').spaceshape('box').spacesize(18).spacemat('concrete').room(0.5);
```

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints) and the
[DSP constraints](dsp.md#constraints): the core path stays pure, controls are data,
randomness is decided in core or by constant seeds, the safety chain cannot be bypassed and
nothing is fetched. Acoustic rendering adds these:

- **Geometry is named, not supplied.** There are no meshes, vertex lists or wall tables in the
  language. A cavity is one shape from a closed set, described by a few clamped numbers.
  Arbitrary geometry would need list values and unbounded computation.
- **Materials are named, not supplied.** Absorption and scattering coefficients come from a
  static table in `dsp.ts`, written from published typical values with their sources
  recorded in the code. A document picks a material by name.
- **Rendering cost is bounded by constants.** The number of rays, the reflection order, the
  histogram length and the number of modes are fixed caps in static code. No document value
  can raise them. A render costs at most a known amount of work, whatever the parameters.
- **Rendering is deterministic.** Ray directions come from a counter-based generator seeded
  by a hash of the quantised parameters, never from `Math.random`. The same parameters give
  byte-identical responses on one engine. Arithmetic uses a fixed operation order; small
- **Renders are cached and rate-limited.** Parameters are quantised for the cache, as for
cross-engine differences are accepted. Ordinary floating point is used; identical output
across engines is not a goal (see [Decisions](#decisions)).
  `body` and `fir`. A patterned control cannot trigger an unbounded stream of renders.
- **The core never renders.** `core` carries the control values; the checker validates
- **Responses are prerendered.** A response is computed ahead of playback from constant
   parameters and then used as a fixed filter. Nothing is ray-traced in real time.
- **Positions are static.** Source and listener positions (`cavsrc`, `cavmic`, `spacesrc`)
   take constants only, because every new position would be a new render. A sound cannot
   move inside a cavity.
  enums and ranges. All geometry, ray tracing and synthesis live in `@tartlet/webaudio`
  (`dsp.ts` for pure code, unit-tested in Node).
- **Gain is bounded.** Every rendered response is normalised to unit energy and trimmed to the
  same length caps as generated ones (100 ms per voice, 10 s per `orbit`).

## A little theory

- **Geometric acoustics.** At high frequencies, sound behaves like rays: it travels in
  straight lines at about 343 m/s and loses energy at each wall according to the wall's
  absorption coefficient α, which depends on frequency. Tracing many rays from a source and
  counting the energy that reaches a small detector around the listener gives an **energy
  histogram** over time, one per frequency band.
- **The image-source method.** In a rectangular box, each reflection path is equivalent to a
  straight path from a mirrored copy of the source. Early reflections in a box can therefore
  be computed exactly: delay = distance / c, level from distance and the walls hit.
- **Diffuse decay.** After the early reflections, reflections pile up into a dense,
  exponentially decaying tail. Its decay time follows, roughly, the Eyring formula
  `T60 = 0.161 · V / (−S · ln(1 − ᾱ))` for volume V, surface S and mean absorption ᾱ.
- **Modes.** Below the **Schroeder frequency**, `f_s ≈ 2000 · √(T60 / V)`, the ray picture
  fails and the cavity is dominated by its standing waves. For a box of sides `Lx, Ly, Lz`,
  the mode frequencies are `f = (c/2) · √((l/Lx)² + (m/Ly)² + (n/Lz)²)`. Small cavities,
  such as instrument bodies, live almost entirely below `f_s`, so for them modes matter more
  than rays.
- **Helmholtz resonance.** A cavity with an opening resonates at
  `f = (c / 2π) · √(A / (V · L))`, for opening area A and effective neck length L. This is
  the "air mode" of a guitar body, near 100 Hz.
- **Air absorption.** In large rooms, air absorbs high frequencies over distance. It is a
  per-band loss that grows with path length.

Rendering therefore combines three parts: exact early reflections, a ray-traced diffuse tail
per band, and analytic modes at low frequencies.

## The rendering pipeline

All steps are pure functions in `dsp.ts`, from quantised parameters to a sample array.

1. **Shape.** Build the cavity from its shape, size and aspect ratio. Shapes are analytic, so
   ray intersections are exact closed-form computations.
2. **Bands.** Work in eight octave bands, 63 Hz to 8 kHz. Each material has α and a
   scattering coefficient per band.
3. **Early reflections.** For `box`, run the image-source method up to order 3. For the other
   shapes, take the first reflections from the ray tracer. The result is a list of
   discrete taps, each with a delay and a per-band gain.
4. **Diffuse tail.** Trace a fixed number of rays (proposed: 4096) from the source position,
   with specular or scattered reflection chosen by a seeded draw against the scattering
   coefficient. Each ray carries per-band energy and stops when every band has fallen by
   60 dB or the reflection order cap (proposed: 64) is reached. Energy crossing the
   listener's detector sphere is accumulated into 1 ms bins per band.
5. **Modes.** Below `f_s`, add analytic modes up to a fixed count (proposed: 64): box modes
   from the formula above, cylinder and sphere modes from static tables of Bessel zeros.
   Each mode is a decaying sinusoid whose decay comes from the material's low-band α and
   whose level depends on the source and listener positions. With an opening, add the
   Helmholtz resonance.
6. **Synthesis.** For each band, shape seeded noise with a band-pass filter and multiply it
   by the square root of that band's energy envelope. Sum the bands, the early taps (each
   filtered by its per-band gain) and the modes. Crossfade the modal part into the diffuse
   part around `f_s`.
7. **Finish.** Remove DC, normalise to unit energy, apply a short fade at the trim point, and
   trim where the response falls 60 dB below its peak or at the length cap.

The noise seed and the ray seed are both derived from `hash64` of the quantised parameters
and a constant, so they never depend on the document, the event or the time.

## Tier A0: the renderer

The pipeline above, with no new controls. It is first used to **re-derive** the existing
`body` presets as documented parameter sets (for example `guitar` as a spruce box of a given
size with a sound hole), so the renderer can be tested against characters the project
already knows.

The goal is for the `body` presets to become named parameter sets over the renderer,
replacing the current hand-designed library. The switch still needs a TS entry. The
hand-designed responses stay the default until listening and property tests show that the
rendered sets are at least as good.

## Tier A1: per-voice cavities

A small cavity applied per voice, in the slot of the body stage (see
[Where new stages sit](dsp.md#where-new-stages-sit)). When both `body` and `cavity` are set,
`cavity` wins and the checker reports `W-ARG-UNSUPPORTED` on `body`.

| Control      | Range         | Meaning                                                             |
| ------------ | ------------- | ------------------------------------------------------------------- |
| `cavity`     | enum          | `none`, `box`, `cylinder`, `sphere`, `tube` (open cylinder).        |
| `cavsize`    | 0.05–2 m      | Largest inside dimension.                                           |
| `cavratio`   | 0.1–1         | Ratio of the smaller dimensions to the largest. Default 0.5.        |
| `material`   | enum          | `spruce`, `maple`, `wood`, `metal`, `glass`, `plastic`, `skin`, `felt`. |
| `cavhole`    | 0–1           | Opening size as a share of one face. 0 is closed. Adds the air mode. |
| `cavsrc`     | 0–1           | Source position along the main axis. Default 0.3. Constant only.    |
| `cavmic`     | 0–1           | Listener position along the main axis. Default 0.7. Outside the hole when `cavhole` > 0. Constant only. |
| `cavmix`     | 0–1           | Wet share. Default 1.                                               |

- Responses are capped at 100 ms, so a per-voice `ConvolverNode` costs about 3 budget units,
  like `body` (TS-42).
- For cavities this small, `f_s` sits high, so most of the response is modal. The ray
  tracer contributes the bright rattle above it.
- `tube` with `cavhole(1)` gives pipe and bottle resonances; `note`-tracking pipes are a
  physical-model job ([instruments.md](instruments.md#tier-2-physical-and-modal-models)), not
  this one.

## Tier A2: modelled spaces

A new `space` value, `model`, renders the `orbit`'s reverb response instead of choosing a
generated preset. `room` and `size` keep setting the wet level and scaling the length, and
`spacepre` and `spacedamp` still apply (TS-84).

| Control      | Range        | Meaning                                                          |
| ------------ | ------------ | ---------------------------------------------------------------- |
| `spaceshape` | enum         | `box`, `cylinder`, `dome` (half sphere), `corridor` (long box).  |
| `spacesize`  | 2–100 m      | Largest inside dimension.                                        |
| `spaceratio` | 0.1–1        | Ratio of the smaller dimensions to the largest. Default 0.6.     |
| `spacemat`   | enum         | `concrete`, `stone`, `brick`, `plaster`, `wood`, `glass`, `carpet`, `curtain`, `snow`. |
| `spacesrc`   | 0–1          | Source distance from the listener, as a share of the size. Constant only. |

- Air absorption applies, and `distance` (TS-70) keeps shifting the dry/wet balance on top.
- Compressor-style "last onset wins" rules apply: an `orbit` has one modelled space at a
  time, and the checker notes disagreement between tracks with `I-DSP-ORBIT`.

## Rendering, caching and fallback

- **Quantisation.** For the cache, sizes are quantised to quarter-octave steps, ratios and
  positions to steps of 1/8, and `cavhole` to steps of 1/8. Materials and shapes are enums.
  The IR keeps the authored values.
- **Cache.** At most 32 per-voice and 8 per-`orbit` responses, least recently used evicted,
  as for FIR kernels.
- **Rate limit.** At most a few renders are started per second. A request beyond that uses
  the nearest cached response, so a patterned `cavsize` sweeps through cached shapes rather
  than stalling.
- **Until a render is ready**, the voice uses the nearest generated preset (`body` for
  cavities, the matching `space` preset for spaces), and the engine counts the substitution,
  like `skippedSamples`. Playback never waits for a render.

## Safety

- **Headroom.** Unit-energy normalisation and length caps, as for every response. `cavmix`
  and `room` keep their ranges, and the master compressor and limiter still apply.
- **Resonant peaks.** Low-absorption materials (`metal`, `glass`) give long, narrow modes
  that can ring loudly at one frequency. Mode decay times are floored by a minimum α per band,
  and each mode's level is capped relative to the response's total energy.
- **Compute.** All loop bounds are constants. A hostile document can at worst cause cache
  churn, which the rate limit bounds.
- **NaN and denormals.** Rendered arrays are checked for non-finite values before they reach
  a `ConvolverNode`; a bad render is replaced by the fallback preset and counted.

## Registry and language impact

- Every new name is a control, and `model` is a new value of the existing `space` enum. No
  new functions, syntax or mini-notation are needed.
- Enum values (`cavity`, `material`, `spaceshape`, `spacemat`) are closed string sets in
  `@tartlet/registry`, like `BODY_NAMES`. Unknown constants give `W-ARG-MODE`.
- All names are Tartlet extensions at level L3 with original descriptions.

## Diagnostics (proposed)

- `W-ARG-MODE`: an unknown constant `cavity`, `material`, `spaceshape` or `spacemat`. The
  default (`none`, `wood`, `box`, `plaster`) is used.
- `W-ARG-UNSUPPORTED`: cavity controls without a known `cavity`, space model controls without
- `I-DSP-RENDER`: benign. A track uses a constant rendered response; the first notes may use
  the fallback preset while it renders. Hidden from the repair payload.
- `I-DSP-ORBIT`: tracks on one `orbit` set different constant space models.
- `W-RANGE`: out-of-range constants, as for every control.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Core.** New controls get hand-written golden expectations like any control. Enum
- **Pure DSP in Node** (`packages/webaudio/test/dsp.test.ts`), with expectations computed by
  hand from the formulas, never captured from the renderer:
  - image-source tap delays in a box equal path length / 343 m/s for hand-worked source and
    listener positions;
  - box mode frequencies match the formula (a 1 m cube's first axial mode at 171.5 Hz);
  - the Helmholtz frequency matches `(c / 2π) · √(A / (V · L))` for a stated geometry;
  - with α = 0 and no air absorption, traced rays lose no energy before the order cap;
  - for a uniform, diffuse box, the measured T60 of the rendered response lies within a
    stated tolerance of the Eyring value;
  - more absorptive materials give shorter decays in every band;
  - responses have unit energy, respect the length caps, contain no NaN, and are
    byte-identical on repeated rendering;
  - the work counter of a render never exceeds the constant cap for any parameter set.
- **Audio.** Render with `OfflineAudioContext` in the Playwright suite and assert properties,
  never stored waveforms:
  - spectral peaks of a cavity response sit near its lowest mode frequencies;
  - `cavhole` adds a peak near the Helmholtz frequency;
  - `felt` and `carpet` lower the spectral centroid and shorten the tail compared with
    `metal` and `concrete`;
  - identical seeds render bit-identical buffers on one engine, the peak never exceeds the
    limiter ceiling, and no sample is NaN.
- **Expectations by reasoning.** Frequencies, decay times and directions of change come from
  acoustics, as [testing.md](testing.md#rules-for-expectations) requires.

## Suggested order

1. The material table with recorded sources, and the analytic mode and Helmholtz code, with
   Node tests. Small and useful on its own.
2. Image-source early reflections for `box`.
3. The ray tracer and per-band histograms, then noise-shaped synthesis.
4. The render worker, cache, rate limit and fallback in the engine.
5. Tier A1: `cavity` and its controls, with a TS entry for its interaction with `body`.
6. Tier A0: re-derive the `body` presets as parameter sets, compare them, and replace the
    hand-designed library once they are at least as good.
7. Tier A2: `space("model")`, with air absorption.


## Decisions

- **Numerics.** Rendered responses need not be identical across engines. The renderer uses
   ordinary floating point with a fixed operation order. Byte-identical results are promised
   on one engine only.
- **`body` presets.** They will become named parameter sets over the renderer and replace
   the current hand-designed library. The switch is gated by Tier A0's listening and
   property tests (see [Tier A0](#tier-a0-the-renderer)).
- **Shapes.** A closed set of analytic shapes is enough to start. Composite shapes (for
   example a box with a neck) can be added later if needed.
- **Positions.** Source and listener positions are static constants. Moving sources would
   mean a new render for every position, which is too costly and complex for now.
- **Where rendering runs.** Responses are prerendered in a separate render worker, never in
   the evaluation worker and never in real time.
- **Cavity versus physical models.** A prerendered cavity is a fixed linear filter. String
   and body coupling and nonlinearities belong to later work (see [Later](#later)).

## Later

These ideas are out of scope for this proposal and are listed so the design does not rule
them out:

- **Composite shapes**, such as a box with a neck, still closed and named, with a few extra
   clamped parameters.
- **Coupling and nonlinearity.** Simple, tunable controls layered on the prerendered filter,
   for example feedback between a voice and its cavity's air mode, or a soft saturation of
   strong modes. Each would need its own proposal, and its cost must stay bounded by
   constants. Full string and body energy exchange stays with the physical models in
   [instruments.md](instruments.md#tier-2-physical-and-modal-models).
- **Moving sources.** If positions ever become patternable, a language provision such as a
   small fixed set of interpolated precomputed positions would be needed. Free movement is
   not planned.
- Responses are capped at 10 s and prerendered as soon as evaluation reveals the `orbit`'s
   constant space parameters, ahead of the first note that needs them.
- **When it runs.** Renders are prerendered. As soon as evaluation produces a constant
   parameter set, the engine queues its render, so most responses are ready before playback
   reaches them. Real-time ray tracing is never attempted.
- **Where it runs.** A per-voice render takes on the order of milliseconds; a large space
   can take far longer. Renders always run in a separate static render worker loaded from a
   `blob:` URL (ADR-003). They never run in the evaluation worker, which stays free of
   `webaudio`, and never on the audio thread. If workers are refused, renders run on the
   main thread in small idle-time slices.
   `space("model")`, `body` on a track that also sets `cavity`, or a patterned value for
   `cavsrc`, `cavmic` or `spacesrc` (the default is used).
   validation and the constant-only rule for positions get X-style tests in
   `packages/check/test`.