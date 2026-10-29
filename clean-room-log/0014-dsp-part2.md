# Session 0014: impulse-response filters (docs/dsp.md Part 2)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement Part 2 of docs/dsp.md (Tiers I0 to I2) and latency compensation
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/dsp.md and
  Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none relating to Strudel, TidalCycles or SuperDirt. The work is a
  Tartlet extension designed from general signal processing: Kaiser-windowed sinc FIR design,
  spectral inversion, modal synthesis of resonant bodies and simple cabinet filtering.
  Interpretations are logged as TS-81 to TS-85.
- **Delivered:**
  - registry entries for `fir`, `firfreq`, `firwidth`, `firlen`, `body`, `bodysize`, `bodymix`,
    `cab`, `spacepre` and `spacedamp`, and their value lists;
  - `W-ARG-MODE`, `W-ARG-UNSUPPORTED` and `I-DSP-LATENCY` rules in `@tartlet/check`;
  - FIR kernels, body and cabinet responses, space tail overrides and latency compensation in
    `@tartlet/webaudio`;
  - DSP and conformance tests, and the "Bodies and cabinets" preset.
- **Resulting commits:** <fill in>
