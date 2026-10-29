# Session 0013: frequency-domain filters (docs/dsp.md Part 1)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement Part 1 of docs/dsp.md (Tiers F0 and F1)
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/dsp.md and
  Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none relating to Strudel, TidalCycles or SuperDirt. The work is a
  Tartlet extension designed from general signal processing: biquad equalisers, shelving tilt,
  a published 90° all-pass phase-difference network for single-sideband shifting, ring
  modulation, and a short-time Fourier transform with Hann windows and overlap-add.
  Interpretations are logged as TS-77 to TS-80.
- **Delivered:**
  - registry entries for the shaping and spectral controls, and `SPECTRAL_MODES`;
  - `dseed` in `@tartlet/core`;
  - `W-ARG-MODE` and `W-ARG-UNSUPPORTED` rules for spectral controls in `@tartlet/check`;
  - shaping stages, the frequency shifter, the spectral worklet and per-orbit spectral buses in
    `@tartlet/webaudio`;
  - DSP and conformance tests, and the "Spectral lab" preset.
- **Resulting commits:** <fill in>
