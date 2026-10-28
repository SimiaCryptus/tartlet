# Session 0007: vocal sounds (docs/vocals.md, tiers V0–V4)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement docs/vocals.md
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/vocals.md,
  docs/instruments.md and Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none. The work is a Tartlet extension, designed from general acoustic
  phonetics: a source-filter voice, published average formant frequencies and spectral tilt.
  Interpretations are logged as TS-43 to TS-47.
- **Delivered:**
  - the singing-alphabet parser in `@tartlet/registry`;
  - vocal controls and sounds;
  - `vseed` in `@tartlet/core`;
  - the vocal model, consonants, `talk`, `overtone` and `ring` in `@tartlet/webaudio`;
  - `W-ARG-PHONEME` and `W-ARG-VOWEL`;
  - tests and a playground preset.
- **Resulting commits:** <fill in>
