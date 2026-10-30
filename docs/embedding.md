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
- `sample-base` is the root, on the page's own origin, from which declared samples are loaded
  (see [Samples](#samples)).

Properties and methods:

- `source` (get and set). Setting it starts a background check, which has no side effects and
  plays nothing. If `source` was not set before the element connects, the initial value is its
  text content.
- `program` holds the latest checked IR, including `program.advisories`.
- `diagnostics` holds the checker's diagnostics followed by host diagnostics from sample
  loading.
- `playing` is true while the transport runs.
- `resolveSample`: an optional host hook, `(path) => Promise<ArrayBuffer | null>`. Set it
  before `source`.
- `play()` must be called from a user gesture. It creates the audio engine with its safety
  chain. If the engine cannot be created, playback is refused.
- `stop()` stops the transport and silences every voice.

Events:

- `diagnostics` fires after every check and after samples load. `detail` is the diagnostics
  array.
- `statechange` fires when playback starts or stops. `detail` is `{ playing }`.
- `beforeplay` fires before playback starts and is cancelable. `detail` is
  `{ advisories }`. Hosts can cancel it to show a warning first, for example when an output
  pulses steadily between 3 and 30 Hz (TS-61), and call `play()` again after the listener
  agrees. The playground shows its warning once per session.

While a source is playing, re-checking it (for example after an edit) updates the tempo and the
diagnostics list without stopping playback. The next query window uses the new program.

### Status line

The status region shows "Ready: N of M tracks playable", "Playing", "Best on headphones" when
an output uses headphone-only controls, and "Loading N samples…" while samples load.

### Theming

The element's shadow DOM reads these custom properties, which can be set on the element:
`--tt-accent`, `--tt-accent-2`, `--tt-bg`, `--tt-fg`, `--tt-muted`, `--tt-border`,
`--tt-error`, `--tt-warning` and `--tt-info`. It follows `prefers-color-scheme` and
`prefers-reduced-motion`.

### Accessibility

The play and stop buttons are native buttons with labels. A polite live region announces the
status. Hosts that animate in time with the music should keep flashes below 3 per second when
`I-EXT-PULSE` is present.

## Samples

Documents declare samples with `sample("name", "./path.wav")` and `samples("bank/")`. The
checker only validates the paths. After each check the element loads the declared resources,
in parallel with playback:

1. If `resolveSample` is set, the element calls it with each path relative to the host's root.
   The host returns the bytes, or `null`. The host decides where those bytes come from and must
   never resolve outside its own root.
2. Otherwise, if `sample-base` is set, the element fetches from that base, resolved against
   `document.baseURI`. Requests that would leave the base or the page's origin return nothing.
3. Otherwise nothing is loaded, and each declaration gets `W-RES-MISSING`.

Loading problems are reported as host diagnostics (`W-RES-MISSING`, `W-RES-FORMAT`,
`W-RES-HASH`, `I-RES-LICENSE`). Events whose sample is still loading are skipped. Manifests are
validated as untrusted input, files are checked against their SHA-256 hash, and files that
break the sample standard are normalised on load. See [samples.md](samples.md).

For headless use, call `loadSamples(program.resources, fetchBytes)` from `@tartlet/samples` and
pass the library to `AudioEngine.setLibrary`.

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

The element needs at least:

```
default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self';
connect-src 'self'; object-src 'none'; base-uri 'none'
```

- `blob:` in `script-src` is needed because the safety, spectral and gate worklets load from
  `blob:` URLs built from static source (ADR-003).
- `connect-src 'self'` covers samples loaded through `sample-base`.
- `unsafe-eval` and `unsafe-inline` scripts are never needed. The element uses constructable
  stylesheets.

The playground's production CSP (in `apps/playground/vite.config.ts`) adds more for its own
features: `style-src 'unsafe-inline'` for the Monaco editor, `media-src blob:` for ringtone
previews, and `connect-src` entries for the optional AI assistant and mounted albums.

## Sandboxed iframes (Markdown2)

The planned `@tartlet/embed` package and its `postMessage` protocol are specified in `plan.md`
§5 and §8, and in ADR-004. They are not implemented yet. Until they land, hosts that sandbox
handlers must load the element inside their own frame.
