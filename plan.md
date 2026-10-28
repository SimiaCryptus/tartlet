# Tartlet Reference Implementation: Project Plan

_Targets: the Tartlet design document (`idea.md`)_
_Stack: TypeScript, Vite, PWA. It deliberately mirrors `tools/Markdown2/plan.md`._
_Primary consumer: Markdown2, through a `text/vnd.tartlet` handler_

## 1. Purpose and Scope

We are building the Tartlet runtime described in `idea.md`, plus a standalone **playground** app for demos and testing.

Tartlet has two audiences, and they pull in slightly different directions:

- **Markdown2 is the first host.** `@markdown2/handlers` embeds Tartlet as the handler for `text/vnd.tartlet` (and the legacy alias `text/x-strudel`). Markdown2's constraints therefore bind Tartlet:
  - its initial-JS budget
  - its sandboxed-iframe handler model
  - its fail-closed rendering rule
  - its strict CSP with no `unsafe-eval`
- **Tartlet stands alone.** It must not depend on Markdown2. The core path (`time → mini → syntax → check → core`) runs in Node, Deno, workers and browsers, with no DOM or Web Audio dependency.

The Markdown2 dependency direction is therefore strictly one-way. Markdown2 depends on a small, host-neutral Tartlet embed package. Tartlet never imports anything from `@markdown2/*`.

### In scope

1. **The runtime packages** listed in `idea.md` §6.3, from `@tartlet/time` to `@tartlet/element`.
2. **`@tartlet/embed`.** This is a self-contained, sandbox-ready bundle with a versioned `postMessage` protocol. Any host that isolates handlers in opaque-origin iframes can load it, and Markdown2 is the first.
3. **`@tartlet/cli`** (`tartlet check | ir | events | sanity | render | corpus`). It is the headless reference for the corpus harness and for server-side tooling.
4. **`apps/playground`.** This is Tartlet's own demo and test UI, as an installable, offline-capable PWA. See §7.
5. **The conformance suite** (`idea.md` §12): language-neutral fixtures, a runner, law and determinism property tests, and the corpus and repair harness.
6. **The clean-room process artifacts:** `CLEAN_ROOM.md`, the clean-room log, oracle specifications and the provenance records required by `idea.md` §4.

### Out of scope for 1.0

- Everything listed under "Beyond 1.0" in `idea.md` §14, including the formatter, two-way piano-roll editing, notation, MIDI import and the MCP tool surface.
- The Markdown2-side handler shim. It lives in `@markdown2/handlers`. We supply the protocol, types, a reference shim in the playground and integration tests (§8). Markdown2 owns the shim's code.
- Any built-in sample asset without an Apache-compatible license and a manifest entry.

## 2. Guiding Constraints

| Constraint                                              | Consequence for the implementation                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idea.md` is the source of truth                        | Every normative rule and matrix row is linked to a test ID. Ambiguities go to `spec-issues.md` (§13 of this plan) and are never resolved silently in code.                                                                                                              |
| Clean-room, Apache-2.0 from commit zero (`idea.md` §4)  | Implementers work only from `idea.md`, oracle specifications, the registry and the conformance tests. Every session is logged. No upstream source, tests or doc prose enters the repository or anyone's working context.                                                |
| Parsed, never evaluated (`idea.md` §5.2 #1)             | No `eval`, `new Function`, `setTimeout(string)` or runtime code generation anywhere. This includes dependencies, so runtime-codegen schema validators are excluded. Lint enforces it statically, and the playground's CSP without `unsafe-eval` enforces it at runtime. |
| Determinism (`idea.md` §8.4)                            | No `Math.random`, `Date.now` or `performance.now` in the core path. Lint bans them there. Seeds are explicit inputs.                                                                                                                                                    |
| Exact time (`idea.md` §8.1)                             | Floats appear only in `@tartlet/schedule` and `@tartlet/webaudio`. A lint rule bans `number`-typed time fields in core packages.                                                                                                                                        |
| No prototype reachable from data (`idea.md` §6.2)       | All name-keyed tables use `Map` or `Object.create(null)`. Z-07 and Z-10 tests fuzz `__proto__` and `constructor` at every entry point.                                                                                                                                  |
| A bad lead line never kills the drums (`idea.md` §10.2) | Every failure path is tested for output isolation. A property test asserts that muting one output never changes another output's events.                                                                                                                                |
| Fit inside Markdown2                                    | The core is under 40 kB gzip. The full player is lazy-loaded and never counts against Markdown2's 100 kB initial budget. Everything works inside `<iframe sandbox="allow-scripts">` with no `allow-same-origin`.                                                        |

## 3. Technology Stack

The stack matches Markdown2's wherever possible, so the two projects share tooling, CI patterns and reviewers.

### Language and tooling

- **Runtime and tools:** Node 22 LTS, pnpm 9 workspaces, ESM only.
- **TypeScript 5.6+** with the same settings as Markdown2:
  - `strict`
  - `noUncheckedIndexedAccess`
  - `exactOptionalPropertyTypes`
  - `verbatimModuleSyntax`
  - `isolatedDeclarations` for library packages
- **Lint and format:**
  - ESLint flat config with `typescript-eslint` `strictTypeChecked`
  - `eslint-plugin-security` on all core-path packages
  - `no-eval`, `no-implied-eval` and `no-new-func`, plus a local rule banning the `Function` identifier and `import()` of non-literal specifiers
  - local rules: no `Math.random` or wall-clock APIs in the core path, no float time fields in core packages, no `{}` literals used as dictionaries in the registry and IR
  - `eslint-plugin-import` boundaries that encode the package dependency graph (§4)
  - Prettier
- **Build:**
  - Vite 6 for the playground and the embed bundle
  - `tsup` or `tsc -b` for libraries, emitting ESM and `.d.ts`
  - `size-limit` in CI for bundle budgets
- **Testing:**
  - Vitest for unit tests and the conformance runner, with Vitest browser mode for audio tests
  - `fast-check` for pattern laws, determinism, fuzzing and isolation properties
  - Playwright for end-to-end tests on Chromium, Firefox and WebKit
  - `@axe-core/playwright` for accessibility checks
- **Release and maintenance:** Changesets, Renovate and GitHub Actions. DCO sign-off is checked in CI.

### Parsing

- **Hand-written lexers and recursive-descent parsers** for both mini-notation and the expression language. There are no parser generators. This decision is recorded as ADR-001. The reasons are:
  - We need exact byte ranges, comment retention and error recovery at statement and argument boundaries (`idea.md` §10.2). Hand-written parsers make these easy to control.
  - Generated parsers add bundle weight and dependencies to the core budget.
  - A closed grammar is small enough to own, and owning it makes the clean-room record simple.
- The expression parser treats string literals in pattern-accepting positions as opaque until lowering. Lowering hands them to `@tartlet/mini` with a base offset, so mini ASTs keep string-relative offsets (`idea.md` §7.2).

### Core runtime

- **Rationals:** an in-house implementation with a small-integer fast path that overflows to `bigint` (`idea.md` §8.1). A differential property test checks it against a naive `bigint` reference implementation on every operation.
- **Hashing:** an in-house, synchronous 64-bit hash over canonical byte strings, for node ids and seed paths. It is not `SubtleCrypto`, which is async and unavailable in some contexts. Golden vectors are pinned in fixtures, so ids are identical across engines.
- **PRNG:** an in-house counter-based generator keyed by seed path, with no hidden state (`idea.md` §8.4).
- **IR validation:** the schema is authored as JSON Schema 2020-12 and published. Runtime validation uses either a hand-written validator or validators precompiled at build time. Nothing generates code at runtime. Acyclicity and `Rational` checks are hand-written.

### Workers and audio

- **Workers:** Comlink-wrapped dedicated Web Workers host check, compile and query (`@tartlet/worker`). Every request carries an `AbortSignal`. A watchdog terminates and respawns the worker when a budget-exceeding query fails to yield.
- **Web Audio:**
  - Oscillators and sample playback use native nodes.
  - The **master-bus brickwall limiter, DC blocker and NaN/Infinity guard** run in an `AudioWorklet`, so they are exact and cannot be bypassed (`idea.md` §11.5). `DynamicsCompressorNode` is not used as the limiter.
  - Worklet and worker modules load from `blob:` URLs generated inside the embedding context, so they work in opaque-origin iframes. See risk R-3 in §12.
- **Offline rendering:** `OfflineAudioContext` in Vitest browser mode and Playwright, for A-kind tests. Node has no Web Audio, so the CLI's `render` command reports events and sanity analysis only. WAV output in the CLI is a stretch goal.
- **MIDI:** Web MIDI for live output (Phase 3). SMF export is written in-house (Phase 4).

### UI and PWA (playground and element)

- **`<tartlet-player>`:** a framework-free custom element with shadow DOM and native controls (`idea.md` §13.3). It has no Preact dependency, so hosts do not pay for one.
- **Playground UI:** Preact with `@preact/signals`, matching Markdown2. The UI is thin, and all logic lives in packages.
- **Editor:** CodeMirror 6 with a Tartlet language extension:
  - highlighting for the expression language, plus nested mini-notation highlighting inside strings
  - diagnostics with safe-fix actions
  - registry-driven autocompletion
  - provenance highlighting
- **PWA:** `vite-plugin-pwa` (Workbox). The manifest declares `file_handlers` for `.tartlet`, `.strudel` and `.md` (the last read for `text/vnd.tartlet` blobs), plus `share_target`.
- **Storage:** IndexedDB via `idb` for sketches, settings and corpus runs. There is no remote storage.

### Rendering security

- The playground ships the same headers Markdown2 requires:
  - a strict CSP with no `unsafe-inline` and no `unsafe-eval`
  - `require-trusted-types-for 'script'`
  - COOP `same-origin`
- A `connect-src` allowlist gates `samples()` fetches. The resolver's own allowlist is the primary control, and the CSP is defence in depth.
- The embed bundle assumes it runs in an opaque origin with no network. All resources arrive over `postMessage` (§8).

## 4. Repository Layout

```text
tartlet/
├─ packages/
│  ├─ time/          @tartlet/time        Rational, TimeSpan, span arithmetic, JSON tuple codec
│  ├─ mini/          @tartlet/mini        mini-notation lexer, parser, AST
│  ├─ syntax/        @tartlet/syntax      expression lexer/parser, syntax tree, sugar desugaring
│  ├─ ir/            @tartlet/ir          IR types, JSON Schema, ingestion validation, migrations
│  ├─ registry/      @tartlet/registry    entries, aliases, compat aliases, levels, capabilities
│  ├─ check/         @tartlet/check       lowering, name resolution, limits, diagnostics, repair payload
│  ├─ random/        @tartlet/random      seed paths, counter-based PRNG
│  ├─ core/          @tartlet/core        pattern algebra, structure rules, IR compiler, budgets
│  ├─ resources/     @tartlet/resources   resolver interface, built-in resolvers, fallback mapper
│  ├─ kit/           @tartlet/kit         general kit: synthesized and CC0 sounds + license manifest
│  ├─ worker/        @tartlet/worker      worker host, budget enforcement, watchdog
│  ├─ schedule/      @tartlet/schedule    transport, lookahead scheduler, clock mapping
│  ├─ webaudio/      @tartlet/webaudio    synths, sample player, buses, safety worklet
│  ├─ midi/          @tartlet/midi        Web MIDI output, SMF export
│  ├─ view/          @tartlet/view        piano roll, visualizer, source highlighting
│  ├─ element/       @tartlet/element     <tartlet-player>
│  ├─ embed/         @tartlet/embed       sandbox bundle + postMessage protocol types
│  ├─ codemirror/    @tartlet/codemirror  language support
│  ├─ conformance/   @tartlet/conformance fixtures, schema, runner, law/determinism properties
│  └─ cli/           @tartlet/cli         tartlet check | ir | events | sanity | render | corpus
├─ apps/
│  └─ playground/    Vite + Preact PWA (demo and test UI, §7)
├─ corpus/           prompts, generated outputs + metadata, classification runs (not published to npm)
├─ oracle/           oracle specifications (neutral prose, one file per topic, analyst-authored)
├─ docs/             architecture, ADRs, language guide, generated registry reference
├─ idea.md           the design document
├─ plan.md           this file
├─ CLEAN_ROOM.md     protocol, gate status, module → implementer → references table
├─ clean-room-log/   one entry per implementation session
└─ spec-issues.md    ambiguities found during implementation
```

The dependency direction is strictly one-way. It is the `idea.md` §6.3 graph, plus these additions:

```text
time ← mini ← syntax ─┐
time ← ir ← registry ─┼─ check ─┐
time ← random ────────┘         ├─ worker ─┐
time, ir, registry, random ← core ┘          ├─ element ← embed
ir ← resources ← kit                        │
core ← schedule ← webaudio (+ resources) ───┤
core ← midi, view ──────────────────────────┘
syntax, registry ← codemirror
all ← conformance, cli, apps/playground
```

`time`, `mini`, `syntax`, `ir`, `registry`, `check`, `random` and `core` have **no DOM dependency** and must run in Node and in workers. CI runs their test suites in Node, Deno and a browser worker.

## 5. Key Interfaces (Draft)

The IR, event, pattern, diagnostic and registry types are defined normatively in `idea.md` §§8–10. They are not repeated here. This section covers the host-facing surface that `idea.md` leaves open.

```ts
// @tartlet/check: pure, synchronous, no I/O
export interface CheckOptions {
  readonly documentId: string; // seed input, see §8.3 of this plan
  readonly blobIndex: string; // stable blob identity within the document
  readonly seed?: string; // user seed; "default" when absent
  readonly limits?: Partial<LimitsConfig>;
  readonly catalog?: SoundCatalog; // enables resource diagnostics before playback
}

export interface CheckResult {
  readonly program: Program; // always produced, possibly with all outputs muted
  readonly diagnostics: readonly Diagnostic[];
  readonly tree: SyntaxTree; // source-preserving, for edits and highlighting
}

export function check(source: string, opts: CheckOptions): CheckResult;
export function repairPayload(result: CheckResult, opts?: { includeBenign?: boolean }): string;
export function applyFix(source: string, fix: Fix): string;
```

```ts
// @tartlet/core
export function compile(program: Program): CompiledProgram; // validated IR only

export interface CompiledProgram {
  readonly outputs: ReadonlyMap<OutputId, Pattern<Controls>>;
  query(span: TimeSpan, opts: { provenance: boolean; limits?: Partial<LimitsConfig> }): QueryResult;
}

export interface QueryResult {
  readonly events: readonly Event<Controls>[];
  readonly muted: ReadonlyMap<OutputId, Diagnostic>; // e.g. E-LIMIT-DENSITY, per output
}
```

```ts
// @tartlet/embed: protocol v1, every message carries { v: 1, id }
export type HostToEmbed =
  | {
      type: 'init';
      source: string;
      documentId: string;
      blobIndex: string;
      seed?: string;
      mode: 'read-only' | 'editable';
      views: readonly View[];
      theme?: ThemeTokens;
    }
  | { type: 'source'; source: string } // host-side edit
  | { type: 'resource'; requestId: string; bytes: ArrayBuffer | null; mediaType?: string }
  | { type: 'command'; command: 'play' | 'stop' | 'seek'; cycle?: RationalJson };

export type EmbedToHost =
  | { type: 'ready'; protocol: 1; tartletVersion: string }
  | { type: 'diagnostics'; diagnostics: readonly Diagnostic[]; payload: string }
  | { type: 'patch'; source: string; edits: readonly TextEdit[] } // editable mode only
  | { type: 'resource-request'; requestId: string; name: string; index: number }
  | { type: 'resize'; height: number }
  | { type: 'summary'; text: string }; // a11y summary from the sanity check
```

Protocol rules:

- The embed never fetches. Every resource goes through `resource-request`, and the host applies its own policy, including Markdown2's `uri` policy and grants.
- Messages are validated on both sides with the same hand-written validators. Unknown message types are ignored and logged.
- `play` is honoured only if the embed itself received a user gesture, or if the host's `allow="autoplay"` delegation is present.

## 6. Milestones

The milestones follow the `idea.md` §14 phases, re-expressed in the Markdown2 plan's format. Each ends with its exit criteria green in CI. Week numbers are aligned to the Markdown2 plan, so integration points land when Markdown2 is ready for them (§8).

### G0: Foundations (week 1, in parallel with T0)

- Clean-room log template and a session-logging script, recording model, version, task, inputs and commits.
- Monorepo, TypeScript project references, lint (including the eval, randomness and boundary rules), Vitest and CI matrix (Node 22, Deno, Playwright on three engines).
- Conformance skeleton: fixture JSON Schema, runner and one passing smoke fixture.
- **Corpus v0:** 500+ original prompts written, and the first multi-model generation run stored with metadata in `corpus/`.
- Role assignments recorded, including the oracle analyst, who does not implement `mini` or `core` (§11).
- ADR-001 (hand-written parsers), ADR-002 (fast-path rationals), ADR-003 (worker and worklet architecture in opaque origins), ADR-004 (embed protocol).
- **Exit:** `pnpm test` and `pnpm build` pass in CI. Corpus v0 is committed.

### T0: Vertical Spike (day 1–week 1, `idea.md` Phase 0)

- `time`, minimal `mini` (M-01–M-12, M-24, M-26, M-27, M-29), a minimal expression parser and minimal `core`, as listed in `idea.md` Phase 0.
- A scheduler, built-in oscillators and synthesized `bd`, `sd` and `hh`.
- A master limiter and NaN guard from the first audible commit.
- A bare `<tartlet-player>`, and a bare playground page that plays the `idea.md` §13.1 example.
- **Exit:** the §13.1 example plays in the playground. The T0 matrix rows pass. The no-eval lint rule is active.
  - T0 code is explicitly disposable. Every T0 module is re-reviewed or rewritten under the full protocol in T1.

### T1: Real Front End (weeks 2–3, `idea.md` Phase 1)

- The full L2 parser with error recovery, a source-preserving tree and the sugar layer (X-34, X-35).
- Lowering, IR schema, `RationalJson` codec and ingestion validation (Z-10).
- Registry v1, with original descriptions and the compatibility alias table.
- The checker: rejection rules Z-01–Z-07, suggestions, subtree muting, the repair payload and safe fixes.
- Mini-notation M-13–M-20 and M-30.
- `random`, seed paths and bottom-up node ids (X-23, X-36).
- `LimitsConfig`, `QueryBudget` and the rational fast path (Z-08, Z-09).
- Worker-hosted evaluation by default, with the watchdog.
- The audio safety floor: clamps, default envelopes and 64-voice stealing.
- Corpus harness v1 in the CLI: classification plus the event-sanity check (S rows, Q-09).
- System prompt draft v1, generated from the registry.
- **Exit:**
  - the Phase 1 coverage target in `idea.md` §12.5 is met
  - all R rows pass
  - pattern laws hold under 10⁴ randomized spans per construct
  - the cross-model regeneration check for `mini` is done and recorded in `CLEAN_ROOM.md`

### T2: Coverage Drive (weeks 4–6, `idea.md` Phase 2)

- Oracle specifications for the §8.6 structure rules, `off`, `jux`, `ply`, `struct`, `mask`, patterned transform arguments and polymeter. These are written by the analyst **before** the matching implementation tasks are assigned.
- Transforms X-11–X-21 and X-28, mini-notation M-21–M-28, and capabilities (Q-03).
- The resource resolver with embedded, package, allowlist and fallback stages, plus `samples()` policy (X-31, Q-05).
- `@tartlet/kit` with about 100 sounds and a license manifest checked in CI, plus the fallback mapper (Q-08).
- `.seed()` and `.label()` (X-32, X-33).
- **`@tartlet/embed` v1 and the protocol freeze candidate.** This is delivered to Markdown2 in time for its M3 handler work (weeks 6–8).
- The first repair-benchmark run.
- **Exit:**
  - the Phase 2 coverage and repair targets are met, and corpus results are published in the playground dashboard
  - the cross-model regeneration check for `core` is done
  - the embed passes the opaque-origin integration suite (§8.4)

### T3: Projections, Sound and Accessibility (weeks 6–8, `idea.md` Phase 3)

- An audio quality pass: ADSR, filters, per-orbit reverb and delay buses, panning and the sample player.
- Offline rendering and A-kind tests.
- The piano roll and visualizer with two-way provenance highlighting (V rows).
- Web MIDI output.
- The full player UI: mixer with heuristic labels, distinct mute states, safe-fix buttons, debounced live editing, a singleton audio coordinator and editable mode.
- Accessibility: native controls, keyboard transport and `aria-live` summaries.
- **Exit:**
  - a blind listening check on corpus pieces finds no timing or mixing defects
  - keyboard-only and screen-reader walkthroughs pass in the playground **and** inside the Markdown2 sandbox

### T4: Musical Depth (weeks 8–10, `idea.md` Phase 4, the release valve)

- Tonal L3 (T-01, T-02), `chop` and `slice` (T-03), and `section` / `arrange` (T-04).
- The deep analysis adapter, SMF export and the structured edit API.
- If T2 coverage is behind, these items move to 1.1 by an explicit maintainer decision recorded in `docs/`, and 1.0 ships without them.

### T5: Hardening and 1.0 (weeks 10–12, `idea.md` Phase 5)

- Freeze IR `tartlet/1` and embed protocol v1, and ship migration scaffolding.
- Performance budgets:
  - core under 40 kB gzip
  - `<tartlet-player>` with WebAudio under 120 kB gzip, lazy-loaded
  - query cost per 100 ms window is p99 under 2 ms on the corpus on mid-range hardware, with provenance off
- Fuzzing of the lexers, parsers, IR ingestion and embed protocol, seeded from fixtures and the corpus.
- A security review covering the threat model, the CSP and Trusted Types audit, prototype-pollution review and sandbox review.
- Documentation: the language guide, the generated registry reference, the published system prompt and an integration guide for hosts.
- The clean-room record completed.
- **Exit:** the 1.0 coverage targets are met, no high-severity findings remain open, and Markdown2 ships the blob type on by default.

## 7. The Playground (Demo and Test UI)

The playground is Tartlet's own application. It serves three purposes: it is a public demo, a development tool, and a test harness that Playwright drives. It consumes only published package APIs, so if the playground can do something, any host can.

### 7.1 Views

| View                     | Purpose                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Editor + player**      | CodeMirror with diagnostics, safe fixes and autocompletion, plus `<tartlet-player>` with mixer, piano roll and transport. This is the default demo surface.                                                                                      |
| **IR inspector**         | Collapsible tree of the `Program`, with node ids, types, aliases and ranges. Selecting a node highlights its source range. Shows the IR diff between edits, so id stability can be checked by eye.                                               |
| **Event inspector**      | Query any rational span and seed, with provenance on or off. Shows a table of whole, part, value and provenance, and can export the result as a draft fixture for hand review. It never writes golden files automatically.                       |
| **Determinism lab**      | Runs the same source under two seeds, or before and after an edit, and highlights events whose random draws changed. This makes D-kind failures visible.                                                                                         |
| **Conformance browser**  | Lists every matrix row (M, X, T, Q, Z) with status, interpretation notes and linked oracle specification. Each row can be opened in the editor.                                                                                                  |
| **Corpus dashboard**     | Shows classification buckets per model and per level, the frequency-ranked registry misses, which form the L3 backlog, sample-name fallbacks and repair-benchmark results. It reads `tartlet corpus` output files and never calls models itself. |
| **Repair loop viewer**   | Shows the source, the exact repair payload and, for recorded benchmark runs, the model's revision with a per-track diff that confirms working tracks were untouched.                                                                             |
| **Sandbox harness**      | Mounts `@tartlet/embed` inside `<iframe sandbox="allow-scripts">` through a reference host shim. It mirrors Markdown2's handler host and uses the same headers. A protocol log shows every message.                                              |
| **Limits and abuse lab** | Preloaded Z-row inputs, a live budget meter and the worker watchdog state. It demonstrates that hostile input cannot freeze the page.                                                                                                            |

### 7.2 Behaviour

- Sketches persist in IndexedDB. Share links encode source in the URL fragment, compressed. There is no server.
- The playground opens `.md` files and lists their `text/vnd.tartlet` blobs. It uses `@markdown2/parser` only as a dev dependency of `apps/playground`. No Tartlet package depends on it.
- The playground runs offline after first load, with the general kit precached.
- Playwright suites cover:
  - edit → diagnostics → safe fix → play
  - offline reload
  - sandbox-harness playback
  - the keyboard-only transport
  - the abuse lab, checking that the page stays responsive at all times

## 8. Markdown2 Integration

### 8.1 Division of responsibility

| Concern                                                                                           | Owner                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Recognising the blob, decoding bytes (`utf-8`, `base64`, `gzip`), grants and fail-closed fallback | Markdown2                                                                                                     |
| UTF-8 validity of the decoded payload                                                             | Markdown2 handler shim. Invalid input means the node is `failed`, which matches Markdown2 spec question 3.    |
| Handler registration for `text/vnd.tartlet` and `text/x-strudel` (exact types, no sniffing)       | Markdown2 (`@markdown2/handlers/tartlet.ts`)                                                                  |
| Sandboxed iframe, `postMessage` transport, `allow="autoplay"` delegation                          | Markdown2 handler host                                                                                        |
| Everything inside the iframe: check, worker, scheduling, audio, UI                                | Tartlet (`@tartlet/embed`)                                                                                    |
| Resource policy for `samples()` URLs and embedded attachments                                     | Markdown2. It answers `resource-request` messages with bytes or `null`, applying its `uri` policy and grants. |
| Persisting editable-mode patches                                                                  | Markdown2. It receives `patch` messages and decides whether to save.                                          |

### 8.2 Embedded resources

- Sibling resources with `rel="attachment"` in the same Markdown2 document are offered to the embed as the **embedded** resolver stage (`idea.md` §11.2, stage 1).
- The host shim maps an attachment's `filename` attribute to the sound name requested.
- An attachment that is `locked` or `failed` is reported to the embed as unavailable, never as bytes.

### 8.3 Seed identity

`idea.md` §8.4 derives the root seed from `(document id, blob index, user seed)`. Markdown2's `NodeId` is a structural path, so inserting a resource earlier in the document would shift it and silently reshuffle every later blob's randomness.

Proposed rule, logged as TS-1 in §13:

- **blob index** is the blob's `id` attribute if present.
- Otherwise it is the ordinal of the blob among `text/vnd.tartlet` resources with the same `token`.
- Otherwise it is the structural `NodeId`.

The handler shim passes this value in `init`. Hosts that care about stability should set `id`.

### 8.4 Integration tests

- Tartlet CI runs the sandbox harness under Markdown2's exact CSP and iframe attributes on all three engines. It verifies:
  - worker and `AudioWorklet` start from `blob:` URLs
  - playback after a gesture inside the frame
  - no network access
  - protocol round-trips
- Markdown2 CI pins a published `@tartlet/embed` version and runs its own handler fixtures. Protocol changes are versioned (`v` field), and a host must refuse an embed whose major protocol version it does not know.
- Diagnostic line numbers in the repair payload are **blob-relative**. The shim maps them to document lines for Markdown2's diagnostics panel.

### 8.5 Timeline alignment

| Tartlet            | Markdown2     | Handoff                                                                        |
| ------------------ | ------------- | ------------------------------------------------------------------------------ |
| T0 (week 1)        | M0            | Agree on ADR-004 (embed protocol) jointly.                                     |
| T2 (weeks 4–6)     | M2            | Embed v1 and protocol freeze candidate delivered by end of week 6.             |
| T3 (weeks 6–8)     | M3 (handlers) | Markdown2 builds the shim against embed v1. Joint sandbox tests.               |
| T4–T5 (weeks 8–12) | M4–M5         | Editable-mode patches feed Markdown2's editor. Joint a11y and security review. |
| 1.0 (week 12)      | M6 (week 14)  | Markdown2 0.2 ships with the blob type on by default.                          |

## 9. Testing Strategy

| Layer                                                      | Tooling                                                                           | Coverage target                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Unit (`time`, `mini`, `syntax`, `check`, `core`, `random`) | Vitest in Node, Deno and a worker                                                 | ≥ 95% branches                                         |
| Conformance matrix (`idea.md` §12.2–12.4)                  | Fixture runner                                                                    | 100% of rows scheduled for the current phase           |
| Pattern laws (L)                                           | fast-check, 10⁴ spans per construct in CI, 10⁶ nightly                            | All four laws, every registered transform              |
| Determinism (D)                                            | fast-check edit generators: appended methods, edits to unrelated subtrees         | Zero changed draws outside the edited subtree          |
| Output isolation                                           | fast-check: inject a fault into one output                                        | Other outputs' events are byte-identical               |
| Rational differential                                      | fast-check vs a naive `bigint` reference                                          | Identical results on every operation                   |
| Rejection and fuzz (R)                                     | fast-check plus a corpus-seeded mutator over lexer, parser, IR and embed protocol | No crash, no hang beyond budget, no host API reachable |
| Audio (A)                                                  | Vitest browser mode with `OfflineAudioContext`                                    | Onsets within one sample, non-silent, master ≤ 0 dBFS  |
| Corpus and repair                                          | `tartlet corpus` in CI on every release, nightly on `main`                        | `idea.md` §12.5 targets                                |
| E2E                                                        | Playwright (3 engines)                                                            | Playground flows and sandbox harness                   |
| Accessibility                                              | axe plus manual screen-reader passes                                              | WCAG 2.2 AA                                            |

Fixtures are language-neutral JSON: source, span, seed, options and expected events in `RationalJson`, plus an `interpretation` field and an optional `oracle` reference. Every expectation is **written by hand** (`idea.md` §12.1). The event inspector can draft a fixture, but a human must review and commit it, and the commit message must state the source of the expectation. Every normative statement in `idea.md` gets a requirement ID, for example `R-8.3-span-split`. `docs/traceability.md` maps IDs to tests, and CI fails if a MUST has no test.

## 10. Security and Clean-Room Checklist (tracked per milestone)

- [ ] No `eval`, `Function`, string timers or runtime codegen in any shipped bundle. Lint is green, and a CSP without `unsafe-eval` passes in the playground.
- [ ] No identifier in source or IR can resolve to `__proto__`, `constructor` or `prototype` (Z-07, Z-10).
- [ ] Static limits are enforced before compilation, and query budgets during every query. The watchdog kills runaway workers.
- [ ] The embed performs no network access. All resources arrive through the host.
- [ ] Audio cannot start without a user gesture. The limiter and NaN guard cannot be bypassed by any document.
- [ ] Every kit asset has a manifest entry with license and provenance, and CI fails otherwise.
- [ ] No upstream source, tests or documentation prose appears in the repository. Registry descriptions are original.
- [ ] Every implementation session has a clean-room log entry, and `CLEAN_ROOM.md` maps each module to its implementers and references.
- [ ] Oracle specifications are authored by a session that does not implement the corresponding module.
- [ ] The nominative-use disclaimer appears in the README, the playground's about page and package metadata. No package name contains "strudel".

## 11. Team and Roles

This plan assumes 2–3 engineers plus AI implementation sessions working under the `idea.md` §4 provenance protocol.

- **Oracle analyst.** Runs the reference runtime as a black box and writes `oracle/` specifications. This role **never** implements `mini` or `core`. It may be an AI session, but not the same session that implements the module the specification covers.
- **Front-end lead:** `mini`, `syntax`, `check`, `registry`, the diagnostics and repair payload, and `codemirror`.
- **Core lead:** `time`, `random`, `core`, `worker` and the law and determinism suites.
- **Audio and app lead:** `schedule`, `webaudio`, `kit`, `element`, `embed`, `view`, the playground, accessibility and the Markdown2 integration.
- **Shared:** corpus generation and review, T5 hardening, documentation and clean-room record keeping.

A contributor who has studied upstream internals is assigned only to packages outside the matching module. `CLEAN_ROOM.md` records these exclusions.

## 12. Risks and Mitigations

This table covers plan-level risks. Product-level risks are in `idea.md` §15.

| ID  | Risk                                                                                               | Impact                                                 | Mitigation                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-2 | Oracle specifications arrive late for T2 transforms.                                               | Implementers guess, causing semantic drift             | Analyst starts in week 2 and works in corpus-frequency order. A transform is not assigned until its specification is merged.                                                                     |
| R-3 | Workers or `AudioWorklet` fail to start from `blob:` URLs in opaque-origin iframes on some engine. | Embed unusable in Markdown2                            | Test in T0 on all three engines (ADR-003). Fallback: evaluate on the iframe's main thread with tighter budgets. The iframe is already isolated from the host page, so the host stays responsive. |
| R-4 | Autoplay policy blocks audio in the sandboxed frame despite a gesture in the host.                 | Play button does nothing                               | Require `allow="autoplay"` delegation in the shim. The embed renders its own play control, so the gesture lands inside the frame.                                                                |
| R-5 | Core bundle exceeds 40 kB because of the registry.                                                 | Markdown2 budget pressure                              | Store registry descriptions in a separate lazy chunk used only by tooling. The runtime registry carries signatures only.                                                                         |
| R-6 | The rational fast path diverges from `bigint` semantics.                                           | Wrong timings at edge cases                            | Differential property tests on every operation. Denominator ceiling enforced.                                                                                                                    |
| R-7 | Seed instability from Markdown2 structural ids.                                                    | "Same document sounds different" after unrelated edits | §8.3 rule, documented guidance to set `id`, and a D-kind test inside the Markdown2 integration suite.                                                                                            |
| R-8 | Corpus generation costs or model access limits.                                                    | Thin frequency data                                    | Budget the generation runs up front. Keep the corpus incremental. Prioritise breadth of prompts over samples per prompt.                                                                         |
| R-9 | Plan and phase overlap, as T2 and T3 share week 6.                                                 | Slip                                                   | T4 is the release valve, as in `idea.md`. The audio quality pass may start in week 5 because it touches disjoint packages.                                                                       |

## 13. Known Spec Questions (seed for `spec-issues.md`)

1. **TS-1: Seed identity inside hosts.** What counts as "blob index" when the host's natural id is structural? See §8.3. Proposed: prefer an explicit `id` attribute, then a type-scoped ordinal.
2. **TS-2: `.` grouping vs decimal numbers.** M-27 accepts `.5` as a number atom, and M-28 uses a lone `.` as a group separator. Proposed: `.` is a separator only when surrounded by whitespace. Otherwise it is part of a numeric atom.
3. **TS-3: `cat`, `seq` and `timecat` in the IR.** `CombineNode.op` lists `slowcat`, `fastcat`, `polymeter` and `arrange`, and mentions `timecat` weights, but `timecat` has no op. Proposed: `cat` → `slowcat`, `seq` → `fastcat`, and add a `timecat` op that uses `weights`.
4. **TS-4: `n` overloading.** `n` is a sample index with `s`, and a scale degree with `scale`. Which capability does a bare `n("0 2")` with no `s` provide? Proposed: a numeric pattern that becomes `pitched` only after `scale`, with `sample` inferred only when an `s` control is present.
5. **TS-5: Provenance vs "every event is traceable".** `idea.md` §6.2 requires traceability, while §8.3 allows empty provenance when collection is off. Proposed: traceability is guaranteed whenever `provenance: true`, and audio ticks are exempt.
6. **TS-6: Label syntax collision.** `name: expr` named outputs look like JavaScript labels, and `$:` repeats. Are duplicate named labels an error, or are they stacked? Proposed: duplicate `$` outputs are stacked, and a duplicate named label produces `E-NAME-DUP` on the second occurrence.
7. **TS-7: Tempo directive conflicts.** Multiple `setcps` / `setcpm` calls, or a `// @tempo` header that disagrees with a directive. Proposed: the last directive wins, the header is ignored when any directive exists, and `I-TEMPO-OVERRIDE` is emitted.
8. **TS-8: Diagnostic coordinates in hosts.** `SourceRange` is defined in document coordinates, but a blob is a substring of a host document. Proposed: Tartlet emits blob-relative ranges, and hosts translate them (§8.4).
9. **TS-9: Bare `!` at sequence start.** Is `"! a"` valid? Proposed: it is malformed, producing `E-MINI-REPLICATE` with the step dropped.
10. **TS-10: Kit sound identity across versions.** "Sounds the same tomorrow" conflicts with improving kit sounds between releases. Proposed: kit assets are versioned, `Program.resources` records the kit version, and changes are announced in release notes. Pinning older kits is deferred.

## 14. Definition of Done (per feature)

- All requirement IDs and matrix rows for the feature are implemented, with linked hand-written tests passing in Node, Deno and all three browser engines where applicable.
- Law, determinism and isolation properties are green for every new registry entry.
- A clean-room log entry is recorded. `CLEAN_ROOM.md` is updated with the module, implementer, references and any oracle specification used.
- A registry entry exists with an original description, level, determinism flag and `since` version. The generated reference and system prompt have been rebuilt.
- The public API is documented with TSDoc, and its behaviour is described in terms of `idea.md` sections.
- No new `any`. No ESLint or type errors. Bundle budgets are respected.
- The feature is visible and exercisable in the playground. Playwright coverage is added for any UI-facing change.
- Affected security checklist items are re-verified. A changeset is added.
