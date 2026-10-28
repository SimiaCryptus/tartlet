# Session 0010: headphone advisories and per-ear controls

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement steps 1 and 2 of docs/binaural.md, and fix the swing test
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/binaural.md and
  Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none. The controls are Tartlet extensions designed from general
  psychoacoustics (interaural time, level and phase differences). Interpretations are logged as
  TS-61 to TS-63. The swing fix follows from the TS-54 prose and the hand-written expectation.
- **Delivered:**
  - `Program.advisories`, `I-EXT-HEADPHONES` and `I-EXT-PULSE` in `@tartlet/check` and `@tartlet/ir`;
  - the `beforeplay` event and headphone hint in `@tartlet/element`, and the playground warning;
  - `earsh`, `itd`, `ild`, `iphase` and `earswap` in the registry and `@tartlet/webaudio`;
  - the `swingBy` correction in `@tartlet/core`;
  - conformance tests.
- **Resulting commits:** <fill in>
