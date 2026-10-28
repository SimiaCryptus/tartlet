# Session 0006: Tier 0 and Tier 1 synthesis extensions

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement Tier 0 and Tier 1 of docs/extensions.md
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md, docs/extensions.md and
  Tartlet's own code. No other material was retrieved or supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none. The controls are audio-adapter work outside `mini` and `core`,
  designed from general synthesis and acoustics knowledge: ADSR envelopes, Fourier series for
  pulse waves, two-operator FM, formant filters and seeded noise. Control names follow the
  proposals in docs/extensions.md. Interpretations are logged as TS-41 and TS-42.
- **Delivered:**
  - controls `lpenv`, `lpattack`, `lpdecay`, `lpsustain`, `lprelease`, `penv`, `pdecay`, `vib`,
    `vibdepth`, `trem`, `tremdepth`, `fm`, `fmh`, `pw`, `unison`, `detune`, `timbre`, `glide`
    and `mono`;
  - `white`, `pink` and `brown` noise sounds;
  - audible `decay`, `sustain`, `hcutoff`, `speed`, `shape`, `crush`, `vowel`, `room`, `size`,
    `delay`, `delaytime` and `delayfeedback`;
  - DSP unit tests, conformance tests and a playground preset.
- **Resulting commits:** <fill in>
