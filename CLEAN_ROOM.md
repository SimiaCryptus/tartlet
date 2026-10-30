# Clean-room protocol

Legal review of this protocol is complete and approved.

## Taint policy

- Banned from every working context while implementing: the source code and test files of
  Strudel, TidalCycles and SuperDirt. This includes copied, translated, paraphrased and
  "rewritten differently" material.
- Permitted references: `idea.md`, `plan.md`, `oracle/*.md`, `@tartlet/registry`, conformance
  fixtures, and Tartlet's own code. Public documentation may be consulted for behaviour only.
  Its prose, examples and tests are never copied in.
- A contributor who has studied upstream internals is excluded from the matching module. Record
  exclusions below.

## Oracle protocol

1. An analyst who does not implement the module runs a reference runtime strictly as a black
   box and records observed timings.
2. The analyst writes neutral specification prose in `oracle/<topic>.md`.
3. Implementers read only that prose. Observations are never bulk-copied into fixtures.

## AI provenance protocol

- Limited inputs, as above.
- Every session is logged in `clean-room-log/` (`pnpm cleanroom:log`).
- Cross-model regeneration is required for `@tartlet/mini` (T1 exit) and `@tartlet/core`
  (T2 exit), and for any disputed module.
- Human review checks for verbatim or near-verbatim upstream expression before merge.

## Roles

| Role               | Assignee | Exclusions                          |
| ------------------ | -------- | ----------------------------------- |
| Oracle analyst     | TBD      | must not implement `mini` or `core` |
| Front-end lead     | TBD      |                                     |
| Core lead          | TBD      |                                     |
| Audio and app lead | TBD      |                                     |

## Module record

| Module                                                                                         | Phase           | Implementer (session) | References                                       | Oracle specs                           | Regeneration check                         |
| ---------------------------------------------------------------------------------------------- | --------------- | --------------------- | ------------------------------------------------ | -------------------------------------- | ------------------------------------------ |
| time, mini, syntax, ir, registry, random, check, core, schedule, webaudio, element, playground | T0 (disposable) | AI session 0001       | idea.md, plan.md                                 | none                                   | n/a (T0 is rewritten or re-reviewed in T1) |
| mini, syntax, check, registry, random, core, ir (codec), schedule, worker, element, cli        | T1              | AI session 0002       | idea.md, plan.md, spec-issues.md, own T0 code    | none (TS-14, TS-19 await oracle specs) | `mini` regeneration pending (T1 exit)      |
| mini, core, check, registry, ir (codec), resources, webaudio, cli                              | T2, partial     | AI session 0003       | idea.md, plan.md, spec-issues.md, own T0/T1 code | none (TS-37: T2 oracle specs missing)  | `core` regeneration pending (T2 exit)      |
| core, registry (L2 completion: X-22)                                                           | T3, partial     | AI session 0004       | idea.md, plan.md, spec-issues.md, own code       | none (TS-39 awaits an oracle spec)     | covered by the pending `core` regeneration |
| registry, webaudio (binaural and spatial controls)                                             | T3, partial     | AI session 0005       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-40)        | n/a (outside `mini` and `core`)            |
| registry, resources, schedule, webaudio (Tier 0 and Tier 1 synthesis)                          | T3, partial     | AI session 0006       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-41, TS-42) | n/a (outside `mini` and `core`)            |
| registry, check, core (vseed), resources, webaudio (vocals V0–V4)                              | T3, partial     | AI session 0007       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-43–TS-47)  | covered by the pending `core` regeneration |
| syntax, check, ir, registry (user functions, language_extensions Part 1)                       | T3, partial     | AI session 0008       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-48–TS-52)  | n/a (outside `mini` and `core`)            |
| registry, check, core, webaudio (standard library, language_extensions Part 2)                 | T3, partial     | AI session 0009       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-53–TS-60)  | covered by the pending `core` regeneration |
| registry, check, core (iseed), webaudio (binaural.md Tiers B1–B4)                              | T3, partial     | AI session 0011       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-64–TS-68)  | covered by the pending `core` regeneration |
| registry, resources, check, core (tseed), webaudio (instruments.md Tiers 5 and 7)              | T3, partial     | AI session 0012       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-69–TS-76)  | covered by the pending `core` regeneration |
| registry, check, core (dseed), webaudio (dsp.md Part 1)                                        | T3, partial     | AI session 0013       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-77–TS-80)  | covered by the pending `core` regeneration |
| registry, check, webaudio (dsp.md Part 2)                                                      | T3, partial     | AI session 0014       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-81–TS-85)  | n/a (outside `mini` and `core`)            |
| registry, check, webaudio (dsp.md Part 3)                                                      | T3, partial     | AI session 0015       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-86–TS-89)  | n/a (outside `mini` and `core`)            |
| ir, registry, check, core (rseed), samples, webaudio, element, cli (samples.md)                | T3, partial     | AI session 0016       | idea.md, plan.md, spec-issues.md, own code       | none (Tartlet extension, TS-90–TS-94)  | covered by the pending `core` regeneration |
