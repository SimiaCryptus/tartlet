// <tartlet-player> (idea.md §13.3). Check and query run in a worker by default (idea.md §11.3).
// The mixer and source view land in T3.
import type { Diagnostic, Program, ResourceDecl } from '@tartlet/ir';
import type { ControlMap } from '@tartlet/core';
import { SampleLibrary, loadSamples, sampleResources, type FetchBytes, type HostDiagnostic } from '@tartlet/samples';
import { Scheduler } from '@tartlet/schedule';
import { AudioEngine } from '@tartlet/webaudio';
import { InlineEvaluator, WorkerEvaluator, type CheckRequest, type Checked, type Evaluator } from '@tartlet/worker';

// Hosts can theme the player by setting the --tt-* custom properties on the element.
const STYLE = `
  :host {
    --tt-accent: #e8505b;
    --tt-accent-2: #f9a26c;
    --tt-bg: #ffffff;
    --tt-fg: #2a1e1a;
    --tt-muted: #8b7b72;
    --tt-border: #eadfd7;
    --tt-error: #c62839;
    --tt-warning: #b26a00;
    --tt-info: #4f6d8a;
    display: block;
    font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: var(--tt-fg);
    background: var(--tt-bg);
    border: 1px solid var(--tt-border);
    border-radius: 16px;
    padding: 14px 16px;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --tt-bg: #221c20;
      --tt-fg: #f4ece6;
      --tt-muted: #a8988f;
      --tt-border: #3a3035;
      --tt-error: #ff6b7a;
      --tt-warning: #f0b45a;
      --tt-info: #8fb3d6;
    }
  }
  .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  button {
    font: inherit; width: 44px; height: 44px; border-radius: 50%;
    border: 1px solid var(--tt-border); background: var(--tt-bg); color: var(--tt-fg);
    cursor: pointer; display: inline-grid; place-items: center;
    transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;
  }
  button.play {
    width: 52px; height: 52px; font-size: 18px; color: #fff; border: none;
    background: linear-gradient(135deg, var(--tt-accent), var(--tt-accent-2));
    box-shadow: 0 8px 18px -8px var(--tt-accent);
  }
  button:hover:not(:disabled) { transform: translateY(-1px); }
  button:active:not(:disabled) { transform: scale(.96); }
  button:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
  button:focus-visible { outline: 3px solid var(--tt-accent-2); outline-offset: 2px; }
  .status { flex: 1 1 12em; font-weight: 600; }
  :host([playing]) .status { color: var(--tt-accent); }
  .meter {
    display: flex; align-items: center; gap: 8px; color: var(--tt-muted);
    font-size: 12px; font-variant-numeric: tabular-nums;
  }
  progress {
    width: 120px; height: 6px; border: none; border-radius: 3px; overflow: hidden;
    appearance: none; background: var(--tt-border); accent-color: var(--tt-accent);
  }
  progress::-webkit-progress-bar { background: var(--tt-border); }
  progress::-webkit-progress-value { background: var(--tt-accent); }
  progress::-moz-progress-bar { background: var(--tt-accent); }
  ul { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
  ul:empty { display: none; }
  li {
    padding: 6px 10px; border-radius: 8px; border-left: 3px solid;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  li code { font: 600 12px ui-monospace, monospace; margin-right: 6px; }
  .error { color: var(--tt-error); }
  .warning { color: var(--tt-warning); }
  .info { color: var(--tt-info); }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

function createEvaluator(): Evaluator {
  if (typeof Worker === 'undefined') return new InlineEvaluator();
  try {
    return new WorkerEvaluator(() => new Worker(new URL('./eval-worker.ts', import.meta.url), { type: 'module' }));
  } catch {
    return new InlineEvaluator();
  }
}

export class TartletPlayerElement extends HTMLElement {
  #source: string | undefined;
  #result: Checked | undefined;
  #gen = 0;
  #evaluator: Evaluator = createEvaluator();
  #engine: AudioEngine | undefined;
  #scheduler: Scheduler<ControlMap> | undefined;
  #raf = 0;
  /**
   * Host hook for samples (docs/samples.md §1.3): bytes for a path relative to the host's root,
   * or null. Set it before `source`. Without it, `sample-base` is used.
   */
  resolveSample: ((path: string) => Promise<ArrayBuffer | null>) | undefined = undefined;
  #library = new SampleLibrary();
  #samplesKey = '';
  #hostDiagnostics: readonly Diagnostic[] = [];
  #loading = 0;
  readonly #status = document.createElement('span');
  readonly #list = document.createElement('ul');
  readonly #play = document.createElement('button');
  readonly #stop = document.createElement('button');
  readonly #progress = document.createElement('progress');
  readonly #cycle = document.createElement('span');

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    const row = document.createElement('div');
    row.className = 'row';
    this.#play.className = 'play';
    this.#play.textContent = '▶';
    this.#play.setAttribute('aria-label', 'Play');
    this.#play.disabled = true;
    this.#stop.textContent = '■';
    this.#stop.setAttribute('aria-label', 'Stop');
    this.#stop.disabled = true;
    this.#status.className = 'status';
    this.#status.setAttribute('aria-live', 'polite');
    this.#status.textContent = 'Checking…';
    this.#progress.max = 1;
    this.#progress.value = 0;
    this.#progress.setAttribute('aria-label', 'Position in cycle');
    this.#cycle.textContent = 'cycle 0';
    const meter = document.createElement('div');
    meter.className = 'meter';
    meter.append(this.#progress, this.#cycle);
    this.#play.addEventListener('click', () => {
      void this.play();
    });
    this.#stop.addEventListener('click', () => {
      this.stop();
    });
    row.append(this.#play, this.#stop, this.#status, meter);
    root.append(row, this.#list);
  }

  connectedCallback(): void {
    if (this.#source === undefined) this.source = this.textContent;
  }

  disconnectedCallback(): void {
    this.stop();
  }

  get source(): string {
    return this.#source ?? '';
  }

  /** Checking has no side effects and plays no audio (idea.md §13.2). */
  set source(v: string) {
    this.#source = v;
    const gen = ++this.#gen;
    void this.#runCheck(v, gen);
  }

  get program(): Program | undefined {
    return this.#result?.program;
  }

  get diagnostics(): readonly Diagnostic[] {
    return [...(this.#result?.diagnostics ?? []), ...this.#hostDiagnostics];
  }

  /** True while the transport is running. */
  get playing(): boolean {
    return this.#scheduler?.running ?? false;
  }

  async #runCheck(source: string, gen: number): Promise<void> {
    const seed = this.getAttribute('seed');
    const req: CheckRequest = {
      source,
      documentId: this.getAttribute('document-id') ?? 'inline',
      blobIndex: this.getAttribute('blob-index') ?? '0',
      ...(seed ? { seed } : undefined),
    };
    let r: Checked;
    try {
      r = await this.#evaluator.check(req);
    } catch (e) {
      if (this.#evaluator instanceof InlineEvaluator) {
        console.error(e);
        return;
      }
      console.warn('Tartlet worker unavailable; evaluating on this thread instead.', e);
      this.#evaluator.dispose();
      this.#evaluator = new InlineEvaluator();
      r = await this.#evaluator.check(req);
    }
    if (gen !== this.#gen) return;
    this.#result = r;
    this.#scheduler?.setCps(r.program.settings.cps);
    if (!this.#scheduler?.running) this.#render();
    else this.#renderList();
    this.dispatchEvent(new CustomEvent('diagnostics', { detail: this.diagnostics }));
    void this.#loadSamples(r.program.resources);
  }

  /** Must be called from a user gesture. */
  async play(): Promise<void> {
    const result = this.#result;
    if (!result || this.#scheduler?.running) return;
    // Hosts may cancel this to show a warning first, for example for steady pulsing (TS-61).
    const detail = { advisories: result.program.advisories ?? [] };
    if (!this.dispatchEvent(new CustomEvent('beforeplay', { cancelable: true, detail }))) return;
    try {
      this.#engine ??= await AudioEngine.create();
      this.#engine.setLibrary(this.#library);
    } catch (e) {
      this.#status.textContent = 'Audio is unavailable here, so playback is refused without the safety chain.';
      console.error(e);
      return;
    }
    const engine = this.#engine;
    this.#scheduler = new Scheduler<ControlMap>({
      query: async (span) => (await this.#evaluator.query(span, false)).events,
      onEvent: (ev, t, d) => {
        engine.play(ev.value, t, d);
      },
      onError: (e) => {
        console.warn(e);
      },
      now: () => engine.ctx.currentTime,
      cps: result.program.settings.cps,
    });
    this.#scheduler.start();
    this.#status.textContent = `Playing${this.#hint()}`;
    this.#play.disabled = true;
    this.#stop.disabled = false;
    this.toggleAttribute('playing', true);
    cancelAnimationFrame(this.#raf);
    this.#raf = requestAnimationFrame(this.#tick);
    this.dispatchEvent(new CustomEvent('statechange', { detail: { playing: true } }));
  }

  stop(): void {
    const wasPlaying = this.playing;
    this.#scheduler?.stop();
    this.#scheduler = undefined;
    this.#engine?.stopAll();
    cancelAnimationFrame(this.#raf);
    this.#progress.value = 0;
    this.#cycle.textContent = 'cycle 0';
    this.#stop.disabled = true;
    this.removeAttribute('playing');
    if (this.#result) this.#render();
    if (wasPlaying) this.dispatchEvent(new CustomEvent('statechange', { detail: { playing: false } }));
  }

  readonly #tick = (): void => {
    const s = this.#scheduler;
    if (!s?.running) return;
    const pos = Math.max(0, s.position());
    const whole = Math.floor(pos);
    this.#cycle.textContent = `cycle ${String(whole)}`;
    this.#progress.value = pos - whole;
    this.#raf = requestAnimationFrame(this.#tick);
  };

  #render(): void {
    const r = this.#result;
    if (!r) return;
    const ok = r.program.outputs.filter((o) => o.status === 'ok').length;
    this.#status.textContent = `Ready: ${String(ok)} of ${String(r.program.outputs.length)} tracks playable${this.#hint()}${this.#loadingNote()}`;
    this.#play.disabled = ok === 0;
    this.#renderList();
  }
  /** A status suffix when some output depends on headphones (TS-61). */
  #hint(): string {
    return this.#result?.program.advisories?.some((a) => a.headphones) === true ? ' · Best on headphones' : '';
  }
  #loadingNote(): string {
    return this.#loading > 0 ? ` · Loading ${String(this.#loading)} sample${this.#loading === 1 ? '' : 's'}…` : '';
  }
  /** A fetcher confined to `sample-base` on this origin, or the host hook (TS-91). */
  #fetcher(base: string | null): FetchBytes | undefined {
    const hook = this.resolveSample;
    if (hook) return hook;
    if (base === null) return undefined;
    let root: URL;
    try {
      root = new URL(base, document.baseURI);
    } catch {
      return undefined;
    }
    return async (path) => {
      const url = new URL(path, root);
      if (url.origin !== location.origin || !url.href.startsWith(root.href)) return null;
      try {
        const res = await fetch(url);
        return res.ok ? await res.arrayBuffer() : null;
      } catch {
        return null;
      }
    };
  }
  async #loadSamples(resources: readonly ResourceDecl[]): Promise<void> {
    const list = sampleResources(resources);
    const base = this.getAttribute('sample-base');
    const key = JSON.stringify([base, list.map((r) => [r.kind, r.name ?? '', r.spec, r.range.start.line])]);
    if (key === this.#samplesKey) return;
    this.#samplesKey = key;
    const library = new SampleLibrary();
    this.#library = library;
    this.#engine?.setLibrary(library);
    const toDiag = (h: HostDiagnostic): Diagnostic => ({
      id: h.id,
      severity: h.severity,
      message: h.message,
      range: h.resource.range,
      effect: 'none',
    });
    const fetchBytes = this.#fetcher(base);
    if (list.length === 0 || !fetchBytes) {
      this.#setHostDiagnostics(
        list.map((r) =>
          toDiag({
            id: 'W-RES-MISSING',
            severity: 'warning',
            message: 'This page does not load samples, so this sample is silent.',
            resource: r,
          }),
        ),
      );
      return;
    }
    this.#loading = list.length;
    if (!this.playing) this.#render();
    const { diagnostics } = await loadSamples(list, fetchBytes, { library });
    if (this.#library !== library) return;
    this.#loading = 0;
    this.#setHostDiagnostics(diagnostics.map(toDiag));
  }
  #setHostDiagnostics(ds: readonly Diagnostic[]): void {
    if (ds.length === 0 && this.#hostDiagnostics.length === 0) {
      if (!this.playing) this.#render();
      return;
    }
    this.#hostDiagnostics = ds;
    if (this.playing) this.#renderList();
    else this.#render();
    this.dispatchEvent(new CustomEvent('diagnostics', { detail: this.diagnostics }));
  }

  #renderList(): void {
    const r = this.#result;
    if (!r) return;
    this.#list.replaceChildren(
      ...this.diagnostics.map((d) => {
        const li = document.createElement('li');
        li.className = d.severity;
        const code = document.createElement('code');
        code.textContent = d.id;
        li.append(code, `line ${String(d.range.start.line + 1)}: ${d.message}`);
        return li;
      }),
    );
  }
}

export function defineTartletPlayer(): void {
  if (!customElements.get('tartlet-player')) customElements.define('tartlet-player', TartletPlayerElement);
}
