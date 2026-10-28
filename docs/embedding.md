# Embedding Tartlet

## The custom element

```ts
import { defineTartletPlayer, type TartletPlayerElement } from '@tartlet/element';
defineTartletPlayer(); // registers <tartlet-player> if not already defined
```

```html
<tartlet-player document-id="my-doc" blob-index="intro" seed="v1"> $: s("bd*4, hh*8") </tartlet-player>
```

Attributes. They are read on every check:

- `document-id` and `blob-index` are seed inputs. Keep them stable across edits. The defaults
  are `inline` and `0`.
- `seed` is an optional user seed. When it is absent, the seed is `"default"`.

Properties and methods:

- `source` (get and set). Setting it starts a background check, which has no side effects and
  plays nothing. If `source` was not set before the element connects, the initial value is its
  text content.
- `program` and `diagnostics` hold the latest check result.
- `playing` is true while the transport runs.
- `play()` must be called from a user gesture. It creates the audio engine with its safety
  chain. If the engine cannot be created, playback is refused.
- `stop()` stops the transport and silences every voice.

Events:

- `diagnostics` fires after every check. `detail` is the diagnostics array.
- `statechange` fires when playback starts or stops. `detail` is `{ playing }`.

While a source is playing, re-checking it (for example after an edit) updates the tempo and the
diagnostics list without stopping playback. The next query window uses the new program.

### Theming

The element's shadow DOM reads these custom properties, which can be set on the element:
`--tt-accent`, `--tt-accent-2`, `--tt-bg`, `--tt-fg`, `--tt-muted`, `--tt-border`,
`--tt-error`, `--tt-warning` and `--tt-info`. It follows `prefers-color-scheme` and
`prefers-reduced-motion`.

### Accessibility

The play and stop buttons are native buttons with labels. A polite live region announces the
status, for example "Ready: 3 of 3 tracks playable".

## Evaluation and workers

The element evaluates in a module worker (`eval-worker.ts`) through `WorkerEvaluator`. If
workers are unavailable, or the worker fails, it falls back to `InlineEvaluator` and logs a
warning. The watchdog terminates a worker whose check exceeds 5 s or whose query exceeds 2 s,
then respawns it.

You can use the evaluators directly:

```ts
import { WorkerEvaluator } from '@tartlet/worker';
const ev = new WorkerEvaluator(() => new Worker(new URL('./my-worker.ts', import.meta.url), { type: 'module' }));
const { program, diagnostics } = await ev.check({ source, documentId: 'd', blobIndex: '0' });
const { events, muted } = await ev.query({ begin: rat(0), end: rat(1) }, false);
```

The worker entry is two lines:

```ts
import { startWorkerHost } from '@tartlet/worker';
startWorkerHost(self);
```

## Headless use

For servers, tests and analysis, use the core path directly. It needs no DOM:

```ts
const r = check(source, { documentId, blobIndex, catalog: createCatalog() });
const p = compile(r.program, { locate: locator(source), documentId, blobIndex });
const report = sanity(p); // silent outputs, density, pitch range
const { events, byOutput, muted } = p.query(span, { provenance: true });
```

When `provenance` is true, each event's `origin` provenance points at the exact mini-notation
atom that produced it.

Pass the same `documentId` and `blobIndex` to `check` and `compile`. `compile` derives the root
seed from them, so random draws depend on both.

## Content Security Policy

The playground's production CSP shows the minimum a host needs:

```
default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self';
connect-src 'self'; object-src 'none'; base-uri 'none'
```

- `blob:` in `script-src` is needed because the safety worklet loads from a `blob:` URL built
  from static source (ADR-003).
- `unsafe-eval` and `unsafe-inline` are never needed. The element uses constructable
  stylesheets.

## Sandboxed iframes (Markdown2)

The planned `@tartlet/embed` package and its `postMessage` protocol are specified in `plan.md`
§5 and §8, and in ADR-004. They are not implemented yet. Until they land, hosts that sandbox
handlers must load the element inside their own frame.
