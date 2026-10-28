# Session 0011: complete docs/binaural.md (Tiers B1–B4)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement the remaining tiers of docs/binaural.md
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/binaural.md and
  Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none. These are Tartlet extensions designed from general
  psychoacoustics and signal processing: per-ear filters, Linkwitz–Riley crossovers, correlated
  noise mixing, all-pass dichotic pitch, Fourier series and amplitude pulses. Interpretations
  are logged as TS-64 to TS-68.
- **Delivered:**
  - registry entries for `lcutoff`, `rcutoff`, `lhcutoff`, `rhcutoff`, `icorr`, `earsplit`,
    `splitfreq`, `dichotic`, `dichoticq`, `isochronic`, `isodepth` and `irate`, plus sound-kind
    lists;
  - `iseed` in `@tartlet/core`;
  - `I-EXT-MONO`, `W-ARG-UNSUPPORTED` and `W-ARG-MODE`, with extended pulse and headphone facts,
    in `@tartlet/check`;
  - the ear stage, two-ear noise, harmonic splits and isochronic pulses in `@tartlet/webaudio`;
  - DSP and conformance tests, and the "Ear tricks" playground preset.
- **Resulting commits:** <fill in>
