# Instructions for AI coding agents

This page is for AI agents (and humans working like them) who implement, test or document
Tartlet. It condenses the rules from `idea.md` §1.1 and §4, [`CLEAN_ROOM.md`](CLEAN_ROOM.md) and
[`CONTRIBUTING.md`](CONTRIBUTING.md) into one checklist. When this page and those documents
disagree, those documents win.

## 1. Clean-room rules (mandatory)

- Work only from these inputs: `idea.md`, `plan.md`, `spec-issues.md`, `oracle/*.md`, the
  registry (`packages/registry`), the conformance tests and Tartlet's own code and docs.
- Never fetch, open, search for or paste source code or test files from Strudel, TidalCycles or
  SuperDirt, and never ask anyone to supply them.
- If you notice that you are recalling a specific upstream implementation, set it aside and
  write the code from the spec. Note it in your log entry.
- Registry descriptions, docs, presets, album sketches and comments are original prose. Do not
  copy prose, examples or tests from public documentation.
- Expected values in tests are written by hand from the spec, an oracle specification or
  musical reasoning. Never generate an expectation by running Tartlet (or anything else) and
  copying its output.
- Log every session: `pnpm cleanroom:log "<model and version>" "<task>" "<inputs>"`, then fill
  in the recollection notes, what you delivered and the commits. Add a row to the module record
  in `CLEAN_ROOM.md`.

Training exposure is not a reason to decline a task; the provenance protocol handles it.

## 2. Orientation

- The pipeline is `syntax → check → IR → core → schedule → webaudio`. See
  [`docs/architecture.md`](docs/architecture.md).
- Packages ship as TypeScript source. There is no library build.
- Every interpretation the code had to choose is a `TS-n` entry in `spec-issues.md`, and code
  cites it in a comment. Read the relevant entries before changing behaviour.
- Design notes for extensions live in `docs/`: `instruments.md`, `vocals.md`, `binaural.md`,
  `dsp.md`, `noise.md`, `samples.md`, `language_extensions.md`, `genetics.md` and
  `claudes_ideas.md`. Each says at the top which parts are implemented.

## 3. Commands

- `pnpm test` runs every test once. `pnpm vitest run -t "M-19"` runs matching tests.
- `pnpm lint`, `pnpm typecheck` and `pnpm format` (Prettier also formats Markdown).
- `pnpm check` is the full gate: format, lint, typecheck, test with coverage, build. Run it
  before you finish. It writes `reports/check-summary.json`.
- `npx tsx packages/cli/src/main.ts check <file>` prints the repair payload for a sketch, and
  `sanity <file>` reports silent or muted tracks.

## 4. Hard rules enforced by lint and types

- Nothing is evaluated: no `eval`, `new Function`, string timers or non-literal `import()`.
- The core path (`time`, `mini`, `syntax`, `ir`, `registry`, `check`, `random`, `core`,
  `resources`) has no DOM, no wall clock, no `Math.random` and no timers.
- Musical time is `Rational`. Properties named `begin`, `end`, `cycle`, `whole` or `part` are
  never `number` in packages that carry time.
- Dictionaries are `Map` or `Object.create(null)`. Empty `{}` literals are banned in the core
  path, and no name from a document may reach `__proto__`, `constructor` or `prototype`.
- Each package may import only what its `deps(...)` entry in `eslint.config.js` allows.
- Randomness uses counter-based draws from `@tartlet/random`, keyed by seed scope, node id and
  event position. The audio adapter never rolls its own dice; core hands it a seed control.

## 5. Workflow

1. Find the `idea.md` section, matrix row or design note your task implements.
2. If the spec is silent or ambiguous, choose an interpretation, add the next free `TS-n` to
   `spec-issues.md` (TS-95 at the time of writing; check the file) and cite it at the code site
   and in the test name.
3. Implement it. Recipes for transforms, controls, aliases, kit sounds and mini-notation syntax
   are in [`CONTRIBUTING.md`](CONTRIBUTING.md).
4. Write hand-made tests: E-kind for events, D-kind for anything seeded, X-kind for
   diagnostics, and a law source in `laws.test.ts` for anything that changes time structure.
5. Update the docs: `docs/language.md` for new names, `docs/diagnostics.md` for new ids,
   `docs/packages.md` for new exports, and `docs/traceability.md` for new requirement families.
6. Run `pnpm check` and fix everything it reports.
7. Finish the clean-room log entry and `CLEAN_ROOM.md` row.

## 6. Gotchas

- `noUncheckedIndexedAccess`: `arr[i]` is `T | undefined`. Use `?? fallback` or a guard.
- `exactOptionalPropertyTypes`: build optional fields with conditional spreads,
  `...(x !== undefined ? { x } : undefined)`.
- New registry names are reserved: a document can no longer use them as binding names
  (`E-NAME-SHADOW`). Check the bundled albums and presets for collisions.
- `systemPrompt()` is generated from the registry, and its test caps it below 260 words.
  Extension entries should be level `L3` so they stay out of it.
- Every playground preset must check cleanly and play on every track (`presets.test.ts`).
  Album sketches in `apps/playground/albums/` are not tested automatically; check them with the
  CLI.
- A sound added to the kit must be added to both `@tartlet/resources` and the sound lists in
  `@tartlet/registry`; a conformance test compares them.
- Prettier formats Markdown. Avoid hand-aligned tables in new docs, or run `pnpm format`.

## 7. Writing music in Tartlet

When you write presets, album sketches or examples:

- Start from the vocabulary in [`docs/language.md`](docs/language.md) and the existing albums.
  The playground assistant's system prompt (`apps/playground/src/assistant.ts`) is a compact
  summary of the rules models most often break.
- Prefer named tracks, one per line, with comments that explain what each part does.
- Keep levels gentle (gain at or below 1, 0.3 to 0.6 for dense layers).
- Avoid steady pulsing between 3 and 30 Hz unless the piece is about it, and never describe a
  sketch as having health, sleep or focus effects on the listener; describe the sound.
- Run `tartlet check` and `tartlet sanity` on every sketch before committing it.

## 8. Report when you finish

List the matrix rows or design-note tiers covered, the `TS-n` entries added, the tests added,
the docs updated and your clean-room log entry.
