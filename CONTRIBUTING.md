# Contributing to Tartlet

Thank you for helping. Please read this whole page before your first change. Tartlet's license
depends on a strict clean-room process.
AI coding agents should also read [`AGENTS.md`](AGENTS.md), which condenses these rules and the
project conventions into one checklist.


## Clean-room rules (mandatory)

The full policy is in `idea.md` §4 and [`CLEAN_ROOM.md`](CLEAN_ROOM.md). In short:

1. **Never** fetch, open, search for or paste source code or tests from Strudel, TidalCycles or
   SuperDirt. Do not ask anyone to supply them.
2. Work only from these references: `idea.md`, `plan.md`, `spec-issues.md`, `oracle/*.md`, the
   registry, the conformance tests and Tartlet's own code. Public documentation may inform your
   understanding of behaviour, but never copy its prose, examples or tests into the repository.
3. If you notice yourself recalling a specific upstream implementation, set it aside and write
   the code fresh from the specification. Note this in your log entry.
4. Registry descriptions, docs and presets must be original prose.
5. If you have studied upstream internals, do not implement the matching Tartlet module. Tell a
   maintainer so the exclusion can be recorded.

### Logging a session

Every implementation session, human or AI, gets a log entry:

```sh
pnpm cleanroom:log "Model or name, version" "task description" "idea.md, plan.md, spec-issues.md"
```

This creates `clean-room-log/NNNN-<task>.md` from the template. Fill in any recollection notes
and the resulting commits, and update the module record in `CLEAN_ROOM.md`.

## Workflow

1. Open or claim an issue. Larger changes should name the `idea.md` section and matrix rows
   they implement.
2. Make the change, including tests that are written by hand (see [testing](docs/testing.md)).
3. Run `pnpm check` and fix everything it reports. Run `pnpm format` for Markdown.
4. Commit with a DCO sign-off: `git commit -s`. CI rejects pull requests that contain a commit
   without one.
5. In the pull request description, list the matrix rows covered and any `TS-n` you added, and
   link your clean-room log entry.

### Definition of done

These items come from `plan.md` §14:

- Matrix rows are implemented and covered by hand-written tests, and the laws still hold.
- Ambiguities are recorded in `spec-issues.md` and cited at the code sites.
- Registry entries have original descriptions, a level, a determinism flag and a `since`
  version.
- There is no new `any`, and there are no lint or type errors.
- The feature can be exercised in the playground where that applies.

## Recipes

### Adding a transform

1. **Registry.** Add an entry to `ENTRIES` in `packages/registry/src/registry.ts`, using the
   `t2(...)` helper or a new phase helper. Declare its parameters. `patternable: true` lets the
   checker lower a string argument as mini-notation. Function parameters use `FN`. Mark random
   transforms `'seeded'`.
2. **Checker.** Usually nothing is needed. Entries in the `transform` category are lowered
   generically into `TransformNode`s by `Lowerer.method` and `lowerArgs`. Add special cases
   only for capability or argument checks.
3. **Core.** Add a `case` to `transform(...)` in `packages/core/src/compile.ts`:
   - use `numArg` for numeric arguments that may be patterns;
   - use `constNum` for arguments that must be constants;
   - use `applyFn` for function arguments;
   - pass `id` (or `fid` for the function copy) as the random salt.

   Build the transform from the algebra in `pattern.ts`. Add a new primitive there only if the
   existing ones cannot express it, and keep the laws.

4. **Tests.** Add an E-kind conformance test and, if the transform is seeded, a D-kind test. If
   it changes time structure, add a law source to `laws.test.ts`.
5. **Prompt.** `systemPrompt()` picks up the new name automatically. Check that its token-size
   test still passes.

### Adding a control

Add `control('id', ['id', 'alias'], kind, 'Original description.', { range, compat })` to
`ENTRIES`. Lowering and compilation are generic: the value is merged into the event's
`ControlMap` under the canonical id. To make the control audible, read it in
`AudioEngine.play`, and clamp it there.

### Adding a compatibility alias

Add the borrowed name to the entry's `compatAliases`, through the `compat` option for controls.
It resolves with an `I-REG-ALIAS` note.

### Adding a kit sound

1. Add the name to `DRUMS` in `packages/resources/src/index.ts` and to `DRUM_SOUNDS` in
   `packages/registry/src/sounds.ts`; a conformance test keeps the two lists equal. The
   manifest entry follows automatically, and every asset must have a license and provenance.
2. Synthesize the sound in `AudioEngine.drum` in `packages/webaudio/src/engine.ts`. Return a
   `Spec` of unstarted sources and an end time, and scale pitch and decay by the `speed`
   ratio `sp`.
3. Map common borrowed names to it in `ALIASES` or `HEURISTICS`.
4. Update the drum list in `systemPrompt()` and in the playground cheat sheet.

Recorded assets must be CC0 or otherwise Apache-compatible, with their provenance recorded.

### Adding mini-notation syntax

Change the lexer and parser in `packages/mini`, the `MiniAst` types, the IR codec's `mini`
decoder in `packages/ir/src/codec.ts`, `compileMini` in `packages/core/src/mini.ts`, and
`checkResources` in `packages/check/src/check.ts` if the new node can contain atoms. Add parser
tests, event tests and a law source.

## Code style

- TypeScript strict mode, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Prettier (120 columns, single quotes, trailing commas). Run `pnpm fix` to apply it.
- Core path rules: no DOM, no wall clock, no `Math.random`, no `{}` dictionaries, and musical
  time is always `Rational`. Lint enforces these rules, so do not disable them.
- Comments cite `idea.md §x` or `TS-n` where a rule comes from.