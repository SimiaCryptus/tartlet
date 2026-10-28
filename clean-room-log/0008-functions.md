# Session 0008: user-defined functions (docs/language_extensions.md Part 1)

- **Model and version:** Claude (Anthropic); exact version: <fill in, as reported by the host>
- **Date:** <fill in>
- **Task:** implement Part 1 of docs/language_extensions.md
- **Input documents:** idea.md, plan.md, spec-issues.md, CLEAN_ROOM.md,
  docs/language_extensions.md and Tartlet's own code. No other material was retrieved or
  supplied.
- **Upstream material retrieved:** none.
- **Recollection notes:** none. This is a Tartlet extension in the checker and parser,
  designed from the proposal: inline expansion with a substitution environment, a separate
  check of each definition with placeholder parameters, and structural call ids.
  Interpretations are logged as TS-48 to TS-52.
- **Delivered:** multi-parameter lambdas with defaults in `@tartlet/syntax`; function bindings,
  `.apply`, user methods and builders in `@tartlet/check`; `maxExpandedNodes` and
  `Diagnostic.definition` in `@tartlet/ir`; `E-NAME-SHADOW`, `E-LX-CALL`, `E-LIMIT-EXPAND`
  and `W-FN-UNUSED`; tests and docs.
- **Resulting commits:** <fill in>
