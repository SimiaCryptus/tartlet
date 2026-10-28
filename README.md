# Tartlet

**A deterministic, sandbox-safe music runtime for documents.**

Tartlet plays compositions written in the Strudel language family: mini-notation strings such as
`"bd*2 [~ bd] sd ~"` plus a chain of methods such as `.gain(.8).room(.3)`. It never evaluates
the source as JavaScript. Text is parsed into a closed expression language, lowered to a typed
Music IR and compiled into pure pattern queries over exact rational time.

It was built so that compositions written by language models can live safely inside documents.
The first host is the Markdown2 renderer. Tartlet does not depend on it.

```js
setcpm(92 / 4);

$: s('bd*2 [~ bd] sd ~, hh*8').gain(0.8);
$: note('<d2 d2 f2 c2>').s('sawtooth').lpf(600).release(0.2);
$: n('<0 2 4 6>').scale('D:minor').s('triangle').room(0.4).slow(2);
```

## Why Tartlet

- **Nothing is executed.** No `eval`, `new Function` or string timers anywhere. Lint enforces
  this, and so does the playground's CSP, which has no `unsafe-eval`.
- **Deterministic.** The same document, blob and seed always produce the same events. Random
  choices come from explicit seed paths, never from `Math.random`.
- **Exact time.** Musical time is rational. It becomes floating-point seconds only at the
  scheduler.
- **Graceful degradation.** A broken track is muted. The other tracks keep playing. Diagnostics
  carry precise ranges, a muting effect, optional safe fixes and a compact repair payload for
  models.
- **Embeddable.** The core path (`time → mini → syntax → check → core`) has no DOM or Web Audio
  dependency. It runs in Node, Deno, workers and browsers.
- **Safe audio.** A master-bus limiter and a NaN/Infinity guard sit beneath every composition.
  Documents cannot bypass them.
- **Apache-2.0, clean-room.** See [`CLEAN_ROOM.md`](CLEAN_ROOM.md).

## Status

Pre-release. The phases are defined in [`plan.md`](plan.md).

- **T0 (vertical spike):** complete. The playground plays the `idea.md` §13.1 example.
- **T1 (real front end):** implemented. This includes the full expression parser, the checker,
  the IR codec and validation, seeds, limits, the worker host and the CLI with its corpus
  harness.
- **T2 (coverage drive):** partially implemented. This includes the T2 transforms, polymeter,
  random choice, signals, the resource catalog and the synthesized general kit.

Open interpretation questions are tracked in [`spec-issues.md`](spec-issues.md).

## Quick start

Requirements: Node ≥ 22 and pnpm 9 (`corepack enable`).

```sh
pnpm install
pnpm test                      # unit, conformance and property tests
pnpm --filter playground dev   # open the playground
pnpm check                     # full quality gate: format, lint, typecheck, test, build
```

## Using it from code

```ts
import { check, locator } from '@tartlet/check';
import { compile } from '@tartlet/core';
import { rat } from '@tartlet/time';

const source = '$: s("bd*4")\n$: note("<c3 e3>").s("triangle")';
const result = check(source, { documentId: 'doc-1', blobIndex: '0' });
const program = compile(result.program, { locate: locator(source), documentId: 'doc-1', blobIndex: '0' });
const { events } = program.query({ begin: rat(0), end: rat(1) }, { provenance: true });
```

To use it in a page:

```html
<tartlet-player document-id="doc-1" blob-index="0">$: s("bd*4, hh*8")</tartlet-player>
<script type="module">
  import { defineTartletPlayer } from '@tartlet/element';
  defineTartletPlayer();
</script>
```

## Documentation

- [Getting started](docs/getting-started.md): setup, scripts, the CLI, Deno and deployment
- [Architecture](docs/architecture.md): pipeline, layer contracts, time, seeds and the
  dependency graph
- [Package reference](docs/packages.md): what each `@tartlet/*` package exports
- [Language reference](docs/language.md): mini-notation and the supported functions
- [Diagnostics](docs/diagnostics.md): every diagnostic id and the recovery policy
- [Testing](docs/testing.md): test kinds, fixtures, property tests and the corpus harness
- [Embedding](docs/embedding.md): `<tartlet-player>`, evaluators, theming and CSP
- [Contributing](CONTRIBUTING.md): the clean-room rules, adding functions and DCO sign-off
- [Design document](idea.md) and [project plan](plan.md)
- [ADRs](docs/adr/) and [traceability](docs/traceability.md)

## Repository map

- `packages/`: the runtime libraries, shipped as TypeScript source (`exports` points at
  `src/index.ts`)
- `apps/playground/`: the Vite demo app, deployed to S3 and CloudFront by `deploy.sh`
- `corpus/`: prompt generation and model-output collection for coverage measurement
- `oracle/`: neutral behavioural specifications written by the oracle analyst (empty so far)
- `clean-room-log/`: one provenance entry per implementation session
- `e2e/`: Playwright tests for the playground
- `terraform/`: hosting infrastructure for the playground
- `docs/`: developer documentation and ADRs

## License and disclaimer

Licensed under Apache-2.0. Every commit carries a DCO sign-off (`git commit -s`).

"Strudel" is named only to describe language compatibility. Tartlet is not affiliated with or
endorsed by the Strudel project. Tartlet contains no Strudel, TidalCycles or SuperDirt code.
Source and issues: https://github.com/SimiaCryptus/tartlet
