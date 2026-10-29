# Extensions: DSP filters, impulse responses and response curves

**Status: Part 1 (TS-77 to TS-80), Part 2 Tiers I0–I2 with latency compensation (TS-81 to
TS-85) and Part 3 (TS-86 to TS-89) are implemented; Tier I3 is a proposal.** See
[Implementation notes](#implementation-notes). Beyond Part 1, nothing on this page is
implemented except what other pages already list
as existing: the per-voice chain (low-pass with envelope, high-pass, `shape`, `crush`,
`vowel`, tremolo), the generated reverb impulse responses and `space` presets (TS-41, TS-69),
and the single-ear filters (TS-64). Each item that adds a control, a sound name or a
diagnostic needs a `TS-n` entry in `spec-issues.md`, registry entries marked as extensions,
and tests as described in [testing.md](testing.md).

Tartlet's audio side today is a fixed chain of familiar time-domain stages. This page proposes
three families of signal processing that sit behind most "produced" sound and most realistic
instruments:

1. [Frequency-domain filters](#part-1-frequency-domain-filters): shaping a sound by its
   spectrum, from simple equalisers to short-time Fourier processing.
2. [Impulse-response filters](#part-2-impulse-response-filters): convolution with a fixed
   response, for bodies, cabinets, rooms and exact linear-phase filters.
3. [Signal-level response curves](#part-3-signal-level-response-curves): memoryless transfer
   functions (waveshaping), level-dependent curves (dynamics) and the curves that map control
   values onto sound.

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints): the core
path stays pure, controls are data, randomness is decided in core, musical time is rational,
the safety chain cannot be bypassed and nothing is fetched. DSP adds these:

- **All DSP is audio-side.** Filters, kernels and curves live in `@tartlet/webaudio`. `core`
  carries only control values, and the checker validates constant values against closed sets
  and ranges.
- **Designs are named, not supplied.** A control value is a number, a string or a note. There
  are no arrays, coefficient lists or curve tables in the language. Every filter design,
  impulse response and transfer curve is selected by name from a closed set, or computed from
  a few clamped numbers by static code in `dsp.ts`.
- **No user-supplied coefficients.** IIR coefficients are only ever produced by static designs
  known to be stable. An `IIRFilterNode` is never built from document values, because one
  unstable pole turns into a full-scale signal the limiter has to fight.
- **Native nodes first.** `BiquadFilterNode`, `IIRFilterNode`, `ConvolverNode`,
  `WaveShaperNode`, `DynamicsCompressorNode`, `DelayNode` and `GainNode` cover most of this
  page. A worklet is justified only for short-time Fourier processing and gates.
- **Worklets are static source.** Spectral kernels are plain functions in a module that is
  unit-tested in Node and bundled as static worklet source at build time, loaded from a
  `blob:` URL (ADR-003). Nothing is generated at runtime from document text.
- **Generated, not fetched.** Impulse responses are generated deterministically from static
  code and constant seeds, like the reverb impulse responses (TS-41). Recorded responses come
  only from the host, through the same route as sample banks
  ([instruments.md](instruments.md#tier-6-samples-and-multisampling)).
- **Gain is bounded at every stage.** Each new stage has a documented maximum gain. Curves are
  gain-compensated, impulse responses are normalised, and boosts are capped, so no setting can
  push a voice far past the bus headroom before the compressor and limiter.
- **Latency is explicit.** Any stage that delays the signal (linear-phase FIR, short-time
  Fourier transform) declares its latency. The adapter compensates within a cap, and the
  checker reports the stage (see [Latency](#latency)). Silent drift is a bug.
- **Seeded where random.** Spectral effects that randomise phase or magnitude read a
  per-event seed drawn in core (internal name `dseed`, like `vseed` and `nseed`), so the same
  document and seed render identically on one engine.

## Where new stages sit

The per-voice chain keeps a fixed order. Users cannot reorder stages: an order would need a
list value, and a fixed order keeps documents comparable.

```
source
  → low-pass (with envelope) → high-pass                (exists)
  → EQ, band, notch, tilt, frequency shift               (Part 1, F0)
  → drive + curve, shape, crush                          (Part 3, C0; shape and crush exist)
  → vowel / formants                                     (exists)
  → body impulse response                                (Part 2, I1)
  → spectral stage                                       (Part 1, F1)
  → tremolo → panner → ear stage                         (exists)
  → sends to per-orbit buses: reverb, delay, spectral, cabinet
```

- Filters before the nonlinearity decide what is distorted. Filters after it decide what is
  heard. The fixed order puts EQ first, because "drive the mids harder" is the common case;
  post-distortion tone shaping is the job of the `cab` bus (Part 2, I2).
- Shared stages on per-`orbit` buses are paid once, like reverb and delay.

## Part 1: frequency-domain filters

### A little theory

- A linear filter can be described by its **magnitude response** (how much each frequency is
  boosted or cut) and its **phase response** (how much each frequency is delayed). The
  biquads Tartlet uses today are minimum-phase: little latency, but frequencies near the
  cutoff are delayed differently.
- **Shelves** raise or lower everything above or below a frequency. **Peaking** filters raise
  or lower a band around a centre. **Notches** remove a narrow band.
- **Tilt** rotates the whole spectrum around a pivot, in dB per octave. It is the same idea as
  noise colour ([noise.md](noise.md#tier-n0-noise-colours)), applied to any source.
- **Frequency shifting** (single-sideband) adds a fixed number of hertz to every partial.
  Unlike pitch shifting, it breaks harmonic ratios, so a harmonic tone becomes bell-like or
  metallic. It needs an analytic signal, which a pair of static all-pass networks (a Hilbert
  transformer) provides.
- **The short-time Fourier transform (STFT)** cuts a signal into overlapping windowed frames,
  transforms each one, edits magnitudes and phases per bin, and resynthesises by overlap-add.
  With a window that sums to a constant (Hann at 75% overlap), unedited frames reconstruct
  the input exactly, delayed by one frame.

### Tier F0: spectral shaping with native filters

| Control                 | Range               | Meaning                                                      |
| ----------------------- | ------------------- | ------------------------------------------------------------ |
| `lowshelf`, `highshelf` | −18–12 dB           | Shelf gain below 200 Hz and above 4 kHz.                     |
| `lsfreq`, `hsfreq`      | 20–20000 Hz         | Moves the shelf frequencies.                                 |
| `peak`                  | −18–12 dB           | Gain of a peaking band. 0 turns it off.                      |
| `peakfreq`, `peakq`     | 20–20000 Hz, 0.1–18 | Centre and narrowness of the peaking band.                   |
| `bandf`, `bandq`        | 20–20000 Hz, 0.1–30 | A band-pass. Off when `bandf` is absent.                     |
| `notch`, `notchq`       | 20–20000 Hz, 0.1–30 | A notch. Off when `notch` is absent.                         |
| `tilt`                  | −6–6 dB/oct         | Spectral tilt around a 1 kHz pivot. Loudness is compensated. |
| `fshift`                | −2000–2000 Hz       | Single-sideband frequency shift. 0 turns it off.             |
| `ringmod`, `ringmix`    | 0–4000 Hz, 0–1      | Ring modulation by a sine, and its wet share.                |

- Shelves, peaks, bands and notches are single `BiquadFilterNode`s. A stage is only created
  when its control is present, so existing documents pay nothing.
- Boosts stop at 12 dB, cuts go to −18 dB. Large boosts are the most common way to clip a
  voice before the bus.
- `tilt` is a small bank of shelving biquads, and shares its implementation with the proposed
  noise `color` control. `s("white").tilt(-3)` and `s("white").color(-3)` should sound alike;
  the TS entry decides whether `color` becomes an alias.
- `fshift` uses two `IIRFilterNode` all-pass chains with static coefficients designed in
  `dsp.ts` (a Hilbert pair, accurate from about 40 Hz to 15 kHz at 48 kHz), two oscillators in
  quadrature and a sum. The coefficients are constants, tested for stability in Node.
- `fshift` keeps the voice **pitched** for `E-CAP-PITCHED` (TS-35), but the docs say plainly
  that the result is inharmonic: `note("c4").fshift(50)` no longer sounds like a C.

### Tier F1: short-time spectral processing

One static worklet, `spectral`, implements a closed set of per-bin operations. It runs
per voice for short notes or, cheaper, on a per-`orbit` bus.

| Control    | Range            | Meaning                                                                |
| ---------- | ---------------- | ---------------------------------------------------------------------- |
| `spectral` | enum             | `none`, `freeze`, `blur`, `gate`, `robot`, `whisper`, `comb`, `shift`. |
| `samount`  | 0–1              | Strength of the selected operation.                                    |
| `sgate`    | −90–0 dB         | Threshold for `gate`: bins below it are removed (spectral denoise).    |
| `scomb`    | 20–2000 Hz       | Spacing for `comb`: keeps bins near multiples of this frequency.       |
| `sshift`   | −24–24 semitones | Bin shift for `shift`, a cheap and smeary pitch effect.                |
| `ssend`    | 0–1              | Send to the per-`orbit` spectral bus instead of a per-voice stage.     |

- **`freeze`** holds the magnitude of the frame at the onset and keeps resynthesising it, so a
  short sound becomes a drone that lasts as long as the event's whole. `samount` blends the
  live and frozen spectra.
- **`blur`** averages magnitudes over time with a one-pole per bin; `samount` sets the time
  constant.
- **`gate`** zeroes bins under `sgate`. It cleans noise beds and makes sparse, glassy textures.
- **`robot`** sets every bin's phase to zero, giving a buzzy monotone at the frame rate.
- **`whisper`** randomises phases. The phase sequence is generated from `dseed`, so it is
  reproducible; nothing in the worklet calls `Math.random`.
- **`comb`** keeps bins near multiples of `scomb` and turns any noise into a pitched buzz.
  It overlaps with pitched noise ([noise.md](noise.md#tier-n1-shaped-and-pitched-noise)); the
  TS entry should say which one a model should reach for.
- Frame size is fixed at 1024 samples with a Hann window and 75% overlap. Fixed sizes keep
  the cost and latency predictable; see [Latency](#latency).
- Voices with a spectral stage cost 8 units of the polyphony budget (TS-42). The bus form is
  paid once per `orbit`, which is why `ssend` exists.
- If the worklet is refused (ADR-003, risk R-3), the stage is bypassed with an info
  diagnostic at play time. Spectral effects have no reasonable native fallback.

## Part 2: impulse-response filters

### A little theory

- Any linear, time-invariant system is fully described by its **impulse response**: what comes
  out when a single click goes in. Convolving a sound with that response gives exactly what
  the system would do to it.
- Short responses (under about 50 ms) are heard as **colour**: a guitar body, a telephone, a
  speaker cabinet, a tube. Long ones are heard as **space**: rooms and halls.
- **Finite impulse response (FIR)** filters designed by windowing a sinc can have exactly
  linear phase: every frequency is delayed by the same amount, so transients keep their
  shape. The cost is latency equal to half the kernel length.

### Tier I0: designed FIR filters

| Control    | Range         | Meaning                                                |
| ---------- | ------------- | ------------------------------------------------------ |
| `fir`      | enum          | `none`, `lowpass`, `highpass`, `bandpass`, `bandstop`. |
| `firfreq`  | 20–20000 Hz   | Cutoff, or centre for the band designs.                |
| `firwidth` | 0.1–4 octaves | Bandwidth for the band designs.                        |
| `firlen`   | enum          | `short` (255 taps), `medium` (1023), `long` (4095).    |

- Kernels are designed in `dsp.ts` (windowed sinc with a Kaiser window) and loaded into a
  `ConvolverNode` with `normalize` off, since the design already has unit gain in the
  passband.
- Designing a kernel per event is wasteful. `firfreq` is quantised to quarter-tone steps for
  design purposes, and kernels are kept in a small cache in the engine (at most 32 entries,
  least recently used evicted). The quantisation is documented; the IR keeps the authored
  value.
- FIR is the right tool when transients matter (steep filtering of drums without smearing
  them). For everything else, the existing biquads are cheaper and have no latency, and the
  docs say so.

### Tier I1: generated body responses

`body` selects a short, generated response applied per voice:

| `body` value | Character                                                           |
| ------------ | ------------------------------------------------------------------- |
| `box`        | A small wooden box: a few low modes, quick decay.                   |
| `guitar`     | Air and top-plate modes near 100 and 200 Hz, a bright rattle.       |
| `violin`     | Dense modes from 300 Hz to 3 kHz, the "bridge hill" around 2.5 kHz. |
| `tube`       | A resonant cylinder; follows `bodysize`.                            |
| `can`        | Sparse, inharmonic metal modes.                                     |
| `phone`      | A narrow 300–3400 Hz band with mild distortion of the response.     |
| `radio`      | A small speaker: band-limited with a cone resonance.                |
| `megaphone`  | Horn resonances and a harsh upper midrange.                         |

| Control    | Range  | Meaning                                                |
| ---------- | ------ | ------------------------------------------------------ |
| `bodysize` | 0.25–4 | Scales mode frequencies down (larger) or up (smaller). |
| `bodymix`  | 0–1    | Wet share. Default 1.                                  |

- Responses are built in `dsp.ts` as sums of decaying sinusoids (modal synthesis) plus seeded
  noise from a constant seed, then normalised to unit energy. They are original designs from
  published acoustic descriptions, not captured recordings, and are identical on every
  machine.
- Responses are at most 100 ms long, so a per-voice `ConvolverNode` costs about 3 budget
  units. They are generated once per (`body`, quantised `bodysize`) pair and cached.
- This is the cheapest route from "a plucked oscillator" to "a plucked instrument" before any
  physical model in [instruments.md](instruments.md#tier-2-physical-and-modal-models) exists:
  `note("e3 g3 b3").s("triangle").decay(0.3).body("guitar")`.

### Tier I2: cabinets and shared responses

- **`cab`** (`none`, `small`, `open`, `closed`, `combo`, `stack`) is a generated speaker
  cabinet response on a per-`orbit` bus, placed after the drive stage of every voice that
  sends to it. Distortion without a cabinet sounds fizzy; this is the missing piece for
  guitar-like tones built from `curve`.
- **`space`** keeps its existing presets (TS-69). This page adds only `spacepre` (0–200 ms
  pre-delay) and `spacedamp` (0–1, high-frequency damping applied while generating the
  response), both quantised for the response cache.
- Long shared responses are capped at 10 s and generated lazily the first time an `orbit`
  needs them, so documents that never use them pay nothing.

### Tier I3: host-supplied responses

Recorded responses (a real church, a specific amplifier) follow the host-supplied bank design
in [instruments.md](instruments.md#tier-6-samples-and-multisampling).

- The document names a response: `.space("ir:stone_hall")` or `.body("ir:old_guitar")`. The
  `ir:` prefix marks a host resource, and `samples()`-style declarations list the bank.
- The host resolves names and hands back decoded audio. The embed never fetches.
- The bank manifest is validated as untrusted input, with `license` required per entry.
- Every host response is normalised to unit energy and trimmed to the same length caps as
  generated ones, so a hostile or badly recorded response cannot exceed the headroom.
- With a catalog that knows the bank, `W-RES-MISSING` and `I-RES-FALLBACK` work for response
  names as they do for sounds. An unresolved response falls back to the generated preset of
  the same family.

## Part 3: signal-level response curves

### A little theory

- A **transfer curve** maps each input sample value to an output value with no memory. A
  straight line does nothing. A curve that flattens near ±1 compresses peaks and adds odd
  harmonics (soft clipping). An asymmetric curve adds even harmonics.
- **Chebyshev polynomials** have a useful property: `T_k(cos θ) = cos(kθ)`. A full-scale sine
  through `T_k` comes out as exactly the k-th harmonic. At lower levels lower harmonics mix
  in, which makes the curve level-sensitive in a musical way.
- **Folding** reflects the signal back when it passes a threshold. It creates dense, bright
  spectra and aliases badly without oversampling.
- **Dynamics** are curves over level instead of over sample value: a compressor's static
  curve maps input level to output level above a threshold with a ratio and a knee; a gate
  maps quiet levels to silence.

### Tier C0: transfer curves

| Control    | Range    | Meaning                                                                            |
| ---------- | -------- | ---------------------------------------------------------------------------------- |
| `curve`    | enum     | `none`, `soft`, `hard`, `tanh`, `tube`, `fold`, `rect`, `half`, `cheby2`–`cheby7`. |
| `drive`    | 0–24 dB  | Gain into the curve.                                                               |
| `bias`     | −0.5–0.5 | Offset before the curve. Non-zero values add even harmonics.                       |
| `curvemix` | 0–1      | Wet share. Default 1.                                                              |

- Curves are computed once in `dsp.ts` as 4096-point tables and loaded into a
  `WaveShaperNode` with `oversample` set to `4x` for `fold` and the Chebyshev curves and
  `2x` for the others.
- Every curve is **gain-compensated**: the output is scaled so that a sine at a reference
  level has the same RMS with and without the curve at the given `drive`. Raising `drive`
  changes the timbre, not the loudness. Compensation factors are computed by static code and
  tested in Node.
- `bias` is followed by a DC blocker inside the stage, because an offset into an asymmetric
  curve produces DC. The master bus already blocks DC, but per-voice DC would waste headroom.
- `shape` keeps its current fixed curve and becomes, by definition, `curve("soft")` with a
  `drive` mapped from its 0–1 value. The TS entry records the mapping so existing documents
  sound the same.
- `cheby2` to `cheby7` are pitched harmonic exciters: `note("c3").s("sine").curve("cheby3")`
  sounds as G4 at full level.

### Tier C1: dynamics

| Control                     | Range     | Meaning                                                |
| --------------------------- | --------- | ------------------------------------------------------ |
| `comp`                      | −60–0 dB  | Threshold of a per-`orbit` compressor. 0 turns it off. |
| `compratio`                 | 1–20      | Ratio above the threshold.                             |
| `compknee`                  | 0–40 dB   | Width of the knee.                                     |
| `compattack`, `comprelease` | 0–1 s     | Time constants.                                        |
| `gate`                      | −90–0 dB  | Per-voice gate threshold. Off when absent.             |
| `gaterelease`               | 0.005–1 s | How fast the gate closes.                              |

- The compressor is a native `DynamicsCompressorNode` per `orbit`, before the sends to the
  master bus. It is the cheapest way to make a drum `orbit` sound glued together. The master
  compressor and limiter are unchanged and still follow it.
- Compressor settings are per `orbit`, not per event. When events on one `orbit` carry
  different constant settings, the last onset wins, and the checker notes it with
  `I-DSP-ORBIT` (benign), so the behaviour is not a surprise.
- The gate is a small worklet with a seed-free envelope follower. It mostly matters for
  reverb tails and noise beds.
- **Sidechain ducking** (one `orbit` lowering another) makes one output's sound depend on
  another's. Like the vocoder in [vocals.md](vocals.md#tier-v4-vocal-colour-on-any-source),
  it needs an ADR on cross-output routing before it is proposed in detail. Until then, a
  pattern-level approximation is `.gain("1 .6 .8 .6")` aligned with the kick.

### Tier C2: control response curves

Curves also map control values onto sound. These change no audio stage, only how a value is
interpreted.

- **Envelope shape.** `envcurve` (`lin`, `exp`, `log`) sets the segment shape of the amplitude
  envelope. Exponential releases sound natural; linear ones sound abrupt.
- **Velocity response.** `velcurve` (0.25–4) bends how `velocity` maps to level and timbre:
  above 1, soft notes get softer. It is applied in the adapter, after velocity-to-timbre.
- **Pattern-rate curves** belong in core and are proposed as `.curve(k)` in
  [noise.md](noise.md#tier-p0-distributions). That method works on control values before they
  reach the adapter. To avoid confusion between the `curve` control (a waveshaper) and the
  `.curve(k)` method (a value mapping), the TS entry should rename one of them; this page
  suggests `.bend(k)` for the method.

## Latency

Two families on this page delay the signal:

| Stage                | Latency at 48 kHz           |
| -------------------- | --------------------------- |
| `fir` `short`        | 127 samples, about 2.6 ms   |
| `fir` `medium`       | 511 samples, about 10.7 ms  |
| `fir` `long`         | 2047 samples, about 42.6 ms |
| `spectral` per voice | 1024 samples, about 21.3 ms |

- Per-voice stages are compensated by starting the voice early by the stage latency, the same
  mechanism the audio adapter uses for consonant leads (TS-46). The total early start of a
  voice is capped at 60 ms and by how early the event arrived. When the cap bites, the voice
  plays late by the difference, and the engine counts it.
- Bus stages (`ssend`, `cab`) are not compensated. Their latency acts as a short pre-delay on
  the wet signal, and the docs say so.
- The checker reports `I-DSP-LATENCY` for an output that uses a constant compensated stage,
  so hosts and the playground highlighting can account for it.

## Safety

- **Headroom.** Boosts are capped at 12 dB, curves are gain-compensated, impulse responses are
  normalised, and `drive` is capped at 24 dB. The master compressor and limiter still apply.
- **Stability.** Only static, tested IIR designs are ever instantiated. Biquad `Q` values are
  clamped at the adapter, as today.
- **Aliasing.** Folding and high-order Chebyshev curves always oversample. Aliasing is not a
  safety problem, but at high drive it produces piercing inharmonic tones that encourage
  turning the volume down and then up again.
- **NaN and denormals.** Worklet kernels flush denormals and run their output through the
  same NaN guard logic as the safety processor before it leaves the stage.
- **Endless sound.** `freeze` never outlives its event: the stage releases with the voice.

## Registry and language impact

- Every new name is a control. No new functions, syntax or mini-notation are needed.
- Enum values (`spectral`, `fir`, `firlen`, `body`, `cab`, `curve`, `envcurve`) are strings
  from closed sets. The checker validates constants and reports unknown ones with
  `W-ARG-MODE`, as for `earsplit` and `space` (TS-69).
- All names are Tartlet extensions with original descriptions. Common names from other
  ecosystems may become compatibility aliases (for example `distort` for `drive` with
  `curve("tanh")`), recorded in the TS entry.
- The system prompt should list the enums briefly, as it does for `timbre`.

## Diagnostics (proposed)

- `W-ARG-MODE`: an unknown constant `spectral`, `fir`, `firlen`, `body`, `cab`, `curve` or
  `envcurve` value. The default (`none`, `lin`) is used.
- `W-ARG-UNSUPPORTED` (from [instruments.md](instruments.md#diagnostics-proposed)): `scomb`
  without `spectral("comb")`, `firwidth` on a low-pass or high-pass design, or `bodysize`
  without `body`.
- `W-RES-HEAVY` (from [instruments.md](instruments.md#cost-budgeting)): an output with a
  per-voice spectral stage whose density is likely to exceed the cost budget.
- `W-RES-MISSING` and `I-RES-FALLBACK`: host impulse responses that a known catalog cannot
  resolve, or resolves to a generated preset.
- `I-DSP-LATENCY`: an output uses a stage whose latency is compensated by an early start.
  Benign and hidden from the repair payload.
- `I-DSP-ORBIT`: outputs on one `orbit` set different constant compressor settings; the last
  onset wins. Benign.
- `W-RANGE`: out-of-range constants, as for every control.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Core.** New controls get hand-written golden expectations like any control. `dseed` gets
  D rows: stable for a seed, different across seeds, unchanged when a method is appended.
  The enum validation gets X-style tests in `packages/check/test`.
- **Pure DSP in Node** (`packages/webaudio/test/dsp.test.ts`), with expectations derived from
  the designs:
  - FIR kernels: unit gain at DC for low-pass, at Nyquist for high-pass, symmetry (linear
    phase), and stop-band attenuation computed from the Kaiser parameters;
  - the Hilbert all-pass pair: all poles inside the unit circle, and a 90° phase difference
    within a stated tolerance across the documented band;
  - curve tables: odd symmetry where intended, outputs within [−1, 1], and the k-th
    Chebyshev curve turning a full-scale sine into its k-th harmonic, checked with a DFT;
  - gain compensation: equal RMS with and without each curve at reference level;
  - generated responses: unit energy, length caps respected, and byte-identical output on
    repeated generation;
  - the STFT kernel: analysis plus synthesis with no edits reconstructs a test signal,
    delayed by one frame, within 1e−6.
- **Audio.** Render with `OfflineAudioContext` in the Playwright suite and assert properties,
  never stored waveforms:
  - measured EQ, band and notch responses match their designs within a dB at a few test
    frequencies;
  - `fshift` moves every partial of a harmonic tone by the same number of hertz;
  - `tilt` changes the spectral slope by the requested amount and leaves RMS unchanged within
    a tolerance;
  - with latency compensation, onset energy lands within a millisecond of the scheduled time;
  - `body` and `cab` change the spectral centroid in the documented direction;
  - identical seeds render bit-identical buffers on one engine, the peak never exceeds the
    limiter ceiling, and no sample is NaN.
- **Expectations by reasoning.** Responses, slopes and thresholds come from filter design
  theory and acoustics, never from capturing the output of Tartlet or another
  implementation, as [testing.md](testing.md#rules-for-expectations) requires.

## Suggested order

1. F0 shelves, peak, band, notch and `tilt` (sharing code with noise `color`). Native nodes
   only, no latency.
2. C0 transfer curves with gain compensation, and the `shape` mapping TS entry.
3. I1 generated body responses, then I2 `cab` on the `orbit` bus. Together with C0 they cover
   a large share of "real instrument" tones cheaply.
4. C1 per-`orbit` compression, then C2 `envcurve` and `velcurve`.
5. `fshift` and `ringmod`.
6. Latency compensation in the adapter, then I0 FIR designs.
7. F1 spectral worklet, bus form (`ssend`) first, then per-voice.
8. I3 host-supplied responses (depends on ADR-004) and the gate worklet.
9. Research: the cross-output routing ADR for sidechain ducking, shared with the vocoder.

## Open questions

- Should the per-voice chain order stay fixed, or should a closed enum (for example
  `fxorder("eq-drive" | "drive-eq")`) allow the most common alternative?
- Should compressor settings be per `orbit`, as proposed, or should `orbit` gain a directive
  form (`orbit(2).comp(-12)`) so settings are not carried by events at all?
- Is a fixed 1024-sample spectral frame acceptable, or do `freeze` and `blur` need a larger
  frame option despite the latency?
- Should `tilt` and noise `color` be one control, or stay separate because they mean
  different things on noise and on tones?
- How should the `curve` control and the proposed `.curve(k)` method be disambiguated?
- Should user-defined curves or responses ever be allowed once list-typed parameters land,
  and if so with which validation (point count, monotonicity, output range)?
- Which stages are worth their bundle size in the core budget, and which should be optional
  modules loaded only when a document names them?

## Implementation notes

Where the Part 1 implementation differs from the proposals above:

- **`tilt`** is four high shelves an octave apart, from about 354 Hz to 2.8 kHz, so its total
  change is at most ±2 × slope (TS-77). Noise `color` is not implemented yet.
- **The notch** defaults to Q 4. `ringmix` defaults to 1.
- **`fshift`** is accurate (within 2°) from 300 Hz to 15 kHz at 48 kHz. The direction of the
  shift is derived from the network's phase response (TS-78).
- **The spectral worklet** source is composed from the kernel functions in `dsp.ts`, which are
  tested in Node (TS-79).
- **On a bus, `freeze`** re-arms when the bus mode changes. Stopping resets the buses.
- **Not implemented yet:**
  - latency compensation and `I-DSP-LATENCY`, so per-voice spectral stages play one frame late;
  - the play-time notice when the worklet is refused.
    Where the Part 2 implementation differs from the proposals above:
- **FIR stages** sit right after the high-pass. `firwidth` is quantised to quarter octaves for
  the kernel cache, and `firlen` defaults to `medium` (TS-81).
- **Body responses** are at most 100 ms and quantise `bodysize` to quarter-octave steps (TS-82).
- **Cabinets** sit in the dry path after placement, one convolver per orbit and cabinet; sends
  still tap the voice before the cabinet (TS-83).
- **`spacepre` and `spacedamp`** apply only to `space` presets (TS-84).
- **Latency compensation** now covers FIR stages and per-voice spectral stages, and
  `I-DSP-LATENCY` is reported (TS-85). This resolves the Part 1 deferral.
- **Not implemented yet:** host-supplied responses (Tier I3), which depend on ADR-004.
