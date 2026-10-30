# Tartlet developer documentation

Start with the [project README](../README.md). Then read these in roughly this order:

1. [Getting started](getting-started.md): install, scripts, the quality gate, the CLI and
   deployment.
2. [Architecture](architecture.md): how source becomes sound, and the rules each layer follows.
3. [Package reference](packages.md): the public surface of every package.
4. [Language reference](language.md): what Tartlet accepts today.
5. [Diagnostics](diagnostics.md): the diagnostic catalogue and recovery policy.
6. [Testing](testing.md): how to write and run each kind of test.
7. [Embedding](embedding.md): hosting the player, loading samples and using the evaluators.
8. [Contributing](../CONTRIBUTING.md): process, clean-room rules and recipes for common changes.
9. [Instructions for AI agents](../AGENTS.md): the same rules condensed into one checklist.

Extension design notes. Each says at the top which parts are implemented:

- [Instruments and real-life sounds](instruments.md)
- [Voices](vocals.md)
- [Beyond binaural beats](binaural.md)
- [DSP filters, impulse responses and response curves](dsp.md)
- [Noise theory](noise.md)
- [WAV samples and interpreters](samples.md)
- [User functions and the standard library](language_extensions.md)
- [Genetic algorithms](genetics.md)
- [More ideas](claudes_ideas.md)

Normative sources:

- [`idea.md`](../idea.md) is the design and is the source of truth for behaviour.
- [`plan.md`](../plan.md) is the build plan and milestones.
- [`spec-issues.md`](../spec-issues.md) records every interpretation the implementation had to
  choose. Code cites these as `TS-n`.
- [`adr/`](adr/) holds architecture decision records.
- [`traceability.md`](traceability.md) maps requirements to tests.

When the docs and the code disagree, the code and its tests describe current behaviour.
`idea.md` describes intended behaviour. Report the gap in `spec-issues.md` or as an issue.
