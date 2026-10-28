# Session 0009: standard library (docs/language_extensions.md Part 2)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement Part 2 of docs/language_extensions.md
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md,
  docs/language_extensions.md and Tartlet's own code. No other material was retrieved or
  supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** each transform was written from the one-line purpose in the proposal
  and composed from the existing algebra in `pattern.ts`, which has filters, per-cycle
  selection and span maps. Where the proposal is silent, the reading chosen is logged in
  TS-53 to TS-60. I did not consult any upstream implementation.
- **Delivered:**
  - L3 registry entries;
  - new primitives in `@tartlet/core`: `within`, `chunk`, `whenCycle`, `zoom`, `linger`,
    `segment`, `pressBy`, `swingBy`, `shuffle` and `sampleOnset`;
  - `run` and `irand` lowering in `@tartlet/check`;
  - `legato` and `nudge` in `@tartlet/webaudio`;
  - more scales;
  - tests, laws and a playground preset.
- **Resulting commits:** <fill in>
