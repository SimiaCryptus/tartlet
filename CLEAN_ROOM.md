# Clean-room protocol

This document is maintained by humans. Implementers, whether human or AI, do not adjudicate it.
Task assignment implies that the applicable gate is cleared (idea.md §4, rule 8).

## Gate status

| Gate | Scope                                                                                  | Status                        | Recorded by | Date |
| ---- | -------------------------------------------------------------------------------------- | ----------------------------- | ----------- | ---- |
| G-A  | Counsel approves this protocol (taint policy, oracle protocol, AI provenance protocol) | **PENDING: submit in week 1** |             |      |
| G-B  | Pre-1.0 review of the compatibility surface, corpus process and records                | not started                   |             |      |

**No T1 code merges before G-A is recorded as approved.** T0 (Phase 0) work does not wait.

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

| Module                                                                                         | Phase                                        | Implementer (session) | References                                       | Oracle specs                           | Regeneration check                         |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------- | ------------------------------------------------ | -------------------------------------- | ------------------------------------------ |
| time, mini, syntax, ir, registry, random, check, core, schedule, webaudio, element, playground | T0 (disposable)                              | AI session 0001       | idea.md, plan.md                                 | none                                   | n/a (T0 is rewritten or re-reviewed in T1) |
| mini, syntax, check, registry, random, core, ir (codec), schedule, worker, element, cli        | T1 (**awaiting G-A; do not merge**)          | AI session 0002       | idea.md, plan.md, spec-issues.md, own T0 code    | none (TS-14, TS-19 await oracle specs) | `mini` regeneration pending (T1 exit)      |
| mini, core, check, registry, ir (codec), resources, webaudio, cli                              | T2, partial (**awaiting G-A; do not merge**) | AI session 0003       | idea.md, plan.md, spec-issues.md, own T0/T1 code | none (TS-37: T2 oracle specs missing)  | `core` regeneration pending (T2 exit)      |
