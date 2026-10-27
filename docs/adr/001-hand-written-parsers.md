# ADR-001: Hand-written lexers and recursive-descent parsers

**Status:** accepted (G0)

Both grammars are closed and small. We need exact ranges, comment retention, and recovery at
statement and argument boundaries. We also need no codegen dependencies in the core budget.
Hand-written parsers give all of this and keep the clean-room record simple: every line is
ours.