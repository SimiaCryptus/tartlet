// <tartlet-player> (idea.md §13.3). Check and query run in a worker by default (idea.md §11.3).
// The mixer and source view land in T3.
import type { Diagnostic, Program } from '@tartlet/ir';
import type { ControlMap } from '@tartlet/core';
import { Scheduler } from '@tartlet/schedule';
import { AudioEngine } from '@tartlet/webaudio';
import { InlineEvaluator, WorkerEvaluator, type CheckRequest, type Checked, type Evaluator } from '@tartlet/worker';

const STYLE = `
  :host { display: block; font: 14px system-ui, sans-serif; border: 1px solid #8884; border-radius: 8px; padding: 8px; }
  button { font: inherit; min-width: 3em; }
  .row { display: flex; gap: 8px; align-items: center; }
  ul { margin: 6px 0 0; padding-left: 1.2em; }
  .error { color: #b00020; } .warning { color: #8a5a00; } .info { color: #555; }
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
  readonly #status = document.createElement('span');
  readonly #list = document.createElement('ul');
  readonly #play = document.createElement('button');
  readonly #stop = document.createElement('button');

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    const row = document.createElement('div');
    row.className = 'row';
    this.#play.textContent = '▶';
    this.#play.setAttribute('aria-label', 'Play');
    this.#stop.textContent = '■';
    this.#stop.setAttribute('aria-label', 'Stop');
    this.#status.setAttribute('aria-live', 'polite');
    this.#play.addEventListener('click', () => {
      void this.play();
    });
    this.#stop.addEventListener('click', () => {
      this.stop();
    });
    row.append(this.#play, this.#stop, this.#status);
    root.append(row, this.#list);
  }

  connectedCallback(): void {
    if (this.#source === undefined) this.source = this.textContent ?? '';
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
    return this.#result?.diagnostics ?? [];
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
    this.dispatchEvent(new CustomEvent('diagnostics', { detail: this.diagnostics }));
  }

  /** Must be called from a user gesture. */
  async play(): Promise<void> {
    const result = this.#result;
    if (!result || this.#scheduler?.running) return;
    try {
      this.#engine ??= await AudioEngine.create();
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
    this.#status.textContent = 'Playing';
  }

  stop(): void {
    this.#scheduler?.stop();
    this.#scheduler = undefined;
    this.#engine?.stopAll();
    if (this.#result) this.#render();
  }

  #render(): void {
    const r = this.#result;
    if (!r) return;
    const ok = r.program.outputs.filter((o) => o.status === 'ok').length;
    this.#status.textContent = `Ready: ${String(ok)} of ${String(r.program.outputs.length)} tracks playable`;
    this.#play.disabled = ok === 0;
    this.#list.replaceChildren(
      ...r.diagnostics.map((d) => {
        const li = document.createElement('li');
        li.className = d.severity;
        li.textContent = `${d.id} (line ${String(d.range.start.line + 1)}): ${d.message}`;
        return li;
      }),
    );
  }
}

export function defineTartletPlayer(): void {
  if (!customElements.get('tartlet-player')) customElements.define('tartlet-player', TartletPlayerElement);
}
