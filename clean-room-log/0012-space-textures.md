# Session 0012: space, environment and sound textures (docs/instruments.md Tiers 5 and 7)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement Tier 5 and Tier 7 of docs/instruments.md
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/instruments.md and
  Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none. The work consists of Tartlet extensions, designed from general
  acoustics and synthesis:
  - decaying noise impulse responses and early reflections;
  - air absorption;
  - filtered noise beds with Poisson event timing;
  - FM chirps, amplitude-modulated noise bands and pulse trains;
  - windowed granular playback.

  Interpretations are logged as TS-69 to TS-76.

- **Delivered:**
  - in the registry: `space`, `occlude`, `posglide`, `intensity`, `density`, `grain`,
    `gdensity`, `gjitter` and `gpos`, plus lists of texture sounds and spaces;
  - texture sounds in `@tartlet/resources`;
  - `tseed` in `@tartlet/core`;
  - space validation in `@tartlet/check`;
  - in `@tartlet/webaudio`: space impulses, early reflections, distance cues, movement
    smoothing, occlusion, ambiences, foley, creatures and granular playback;
  - DSP and conformance tests, and the "Field recording" preset.
- **Resulting commits:** <fill in>
