import type { TimeSpan } from '@tartlet/time';
import { EvalCore } from './core';
import type { CheckRequest, Checked, Evaluator, QueryReply, RequestBody, Response } from './protocol';

/** Same-thread evaluation. It is the fallback when workers are unavailable (plan.md R-3). */
export class InlineEvaluator implements Evaluator {
  readonly #core = new EvalCore();
  check(req: CheckRequest): Promise<Checked> {
    try {
      return Promise.resolve(this.#core.check(req));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  query(span: TimeSpan, provenance: boolean): Promise<QueryReply> {
    try {
      return Promise.resolve(this.#core.query(span, provenance));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  dispose(): void {
    /* nothing to release */
  }
}

interface Pending {
  readonly resolve: (r: Response) => void;
  readonly reject: (e: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Worker-hosted evaluation with a watchdog (idea.md §11.3). A request that exceeds its time
 * budget terminates the worker. A fresh worker is spawned and re-checked with the last source.
 */
export class WorkerEvaluator implements Evaluator {
  #worker: Worker;
  #seq = 0;
  readonly #pending = new Map<number, Pending>();
  #last: CheckRequest | undefined;
  #healthy = false;
  #failures = 0;
  #broken = false;
  #disposed = false;

  constructor(
    private readonly factory: () => Worker,
    private readonly timeouts: { readonly check: number; readonly query: number } = { check: 5000, query: 2000 },
  ) {
    this.#worker = this.#spawn();
  }

  #spawn(): Worker {
    const w = this.factory();
    w.addEventListener('message', (e: MessageEvent<Response>) => {
      this.#onMessage(e.data);
    });
    w.addEventListener('error', (e) => {
      e.preventDefault();
      this.#restart(new Error('The Tartlet worker failed to start or crashed.'));
    });
    return w;
  }

  #onMessage(r: Response): void {
    const p = this.#pending.get(r.id);
    if (!p) return;
    this.#pending.delete(r.id);
    clearTimeout(p.timer);
    this.#healthy = true;
    this.#failures = 0;
    if (r.type === 'error') p.reject(new Error(r.message));
    else p.resolve(r);
  }

  #restart(err: Error): void {
    this.#worker.terminate();
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.#pending.clear();
    if (this.#disposed) return;
    this.#failures++;
    if (this.#failures >= 3 || (!this.#healthy && this.#failures >= 2)) {
      this.#broken = true;
      return;
    }
    this.#worker = this.#spawn();
    if (this.#last) this.#send({ type: 'check', ...this.#last }, this.timeouts.check).catch(() => undefined);
  }

  #send(body: RequestBody, timeout: number): Promise<Response> {
    if (this.#broken || this.#disposed) return Promise.reject(new Error('The Tartlet worker is unavailable.'));
    const id = ++this.#seq;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#restart(new Error('The Tartlet worker exceeded its time budget and was restarted.'));
      }, timeout);
      this.#pending.set(id, { resolve, reject, timer });
      this.#worker.postMessage({ ...body, id });
    });
  }

  async check(req: CheckRequest): Promise<Checked> {
    this.#last = req;
    const r = await this.#send({ type: 'check', ...req }, this.timeouts.check);
    if (r.type !== 'checked') throw new Error('Unexpected worker reply.');
    return { program: r.program, diagnostics: r.diagnostics };
  }

  async query(span: TimeSpan, provenance: boolean): Promise<QueryReply> {
    const r = await this.#send({ type: 'query', begin: span.begin, end: span.end, provenance }, this.timeouts.query);
    if (r.type !== 'events') throw new Error('Unexpected worker reply.');
    return { events: r.events, muted: r.muted };
  }

  dispose(): void {
    this.#disposed = true;
    this.#worker.terminate();
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Evaluator disposed.'));
    }
    this.#pending.clear();
  }
}
