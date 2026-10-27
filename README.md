# Tartlet

A deterministic, sandbox-safe music runtime for documents. It plays Strudel-compatible
source without evaluating code. See `idea.md` for the design and `plan.md` for the build plan.

Status: **T0 vertical spike.** The core path parses, checks, compiles and queries. The
playground plays the `idea.md` §13.1 example.

~~~sh
pnpm install
pnpm test
pnpm --filter playground dev
~~~

**Nominative-use disclaimer.** "Strudel" is named only to describe language compatibility.
Tartlet is not affiliated with or endorsed by the Strudel project. Tartlet contains no
Strudel, TidalCycles or SuperDirt code. See `CLEAN_ROOM.md`.

Licensed under Apache-2.0. Every commit carries a DCO sign-off.