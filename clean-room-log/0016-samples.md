# Session 0016: WAV samples, the collection and sample interpreters (docs/samples.md)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement docs/samples.md
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/samples.md and
  Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none relating to Strudel, TidalCycles or SuperDirt. The work is a
  Tartlet extension designed from the RIFF/WAVE layout, the General MIDI percussion map and the
  rules written in docs/samples.md. Interpretations are logged as TS-90 to TS-94.
- **Delivered:**
  - the `sample` directive, bank paths for `samples`, the path grammar and `E-RES-PATH`;
  - the `@tartlet/samples` package: WAV reader and writer, the sample standard, manifests, the
    impulse and note interpreters and host loading;
  - `rseed` in `@tartlet/core`, sample voices in `@tartlet/webaudio`, and `sample-base` and
    `resolveSample` in `@tartlet/element`;
  - `tartlet samples import | verify | list`;
  - tests.
- **Resulting commits:** <fill in>
