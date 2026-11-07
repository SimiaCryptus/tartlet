// Rendering, caching and rate-limiting of acoustic responses (docs/acoustic_rendering.md).
// Renders run in a static render worker; if workers are refused, they run on the main thread
// between audio callbacks. Playback never waits: callers use a fallback until a render is ready.
import {
  CAVITY_MAX_SECONDS,
  SPACE_MAX_SECONDS,
  acousticKey,
  acousticSeed,
  safeRender,
  type AcousticParams,
} from './acoustics';

export type RenderKind = 'voice' | 'orbit';
export interface RenderedResponse {
  readonly key: string;
  readonly params: AcousticParams;
  readonly data: Float32Array<ArrayBuffer>;
}
/** At most this many renders start per second; later requests use the nearest cached response. */
export const MAX_RENDER_STARTS = 3;
const CACHE_SIZE: Readonly<Record<RenderKind, number>> = { voice: 32, orbit: 8 };

interface Outcome {
  readonly data: Float32Array<ArrayBuffer>;
  readonly ok: boolean;
}
interface Job {
  readonly params: AcousticParams;
  readonly seconds: number;
  readonly seed: number;
  readonly resolve: (o: Outcome) => void;
}

function onMainThread(job: Job, sampleRate: number): void {
  setTimeout(() => {
    job.resolve(safeRender(job.params, sampleRate, job.seconds, job.seed));
  }, 0);
}

function isReply(v: unknown): v is { id: number; ok: boolean; data: Float32Array } {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { id?: unknown; ok?: unknown; data?: unknown };
  return typeof r.id === 'number' && typeof r.ok === 'boolean' && r.data instanceof Float32Array;
}

export class AcousticRenders {
  /** Requests answered by a nearby or generated response because the exact one was not ready. */
  substitutions = 0;
  /** Renders that failed or produced non-finite samples. */
  failures = 0;
  readonly #caches: Readonly<Record<RenderKind, Map<string, RenderedResponse>>> = {
    voice: new Map<string, RenderedResponse>(),
    orbit: new Map<string, RenderedResponse>(),
  };
  readonly #pending = new Set<string>();
  readonly #inflight = new Set<Promise<void>>();
  #starts: number[] = [];
  #worker: Worker | null | undefined;
  #seq = 0;
  readonly #jobs = new Map<number, Job>();
  readonly #sampleRate: number;
  readonly #clock: () => number;
  readonly #useWorker: boolean;

  constructor(sampleRate: number, opts: { readonly clock?: () => number; readonly worker?: boolean } = {}) {
    this.#sampleRate = sampleRate;
    this.#clock = opts.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.#useWorker = opts.worker !== false;
  }

  /** The cached response for `p`, or undefined after requesting its render. */
  lookup(kind: RenderKind, p: AcousticParams): RenderedResponse | undefined {
    const key = `${kind}:${acousticKey(p)}`;
    const cache = this.#caches[kind];
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    this.#request(kind, key, p);
    return undefined;
  }

  /** The cached response of the same shape and material closest to `p`. */
  nearest(kind: RenderKind, p: AcousticParams): RenderedResponse | undefined {
    let best: RenderedResponse | undefined;
    let bd = Infinity;
    for (const e of this.#caches[kind].values()) {
      const q = e.params;
      if (q.shape !== p.shape || q.material !== p.material) continue;
      const d =
        Math.abs(Math.log2(q.size / p.size)) +
        Math.abs(q.ratio - p.ratio) +
        Math.abs(q.hole - p.hole) +
        Math.abs(q.src - p.src) +
        Math.abs(q.mic - p.mic);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Resolves once every started render has finished. */
  async idle(): Promise<void> {
    while (this.#inflight.size > 0) await Promise.all([...this.#inflight]);
  }

  #request(kind: RenderKind, key: string, p: AcousticParams): void {
    if (this.#pending.has(key)) return;
    const now = this.#clock();
    this.#starts = this.#starts.filter((t) => now - t < 1000);
    if (this.#starts.length >= MAX_RENDER_STARTS) return;
    this.#starts.push(now);
    this.#pending.add(key);
    const seconds = kind === 'voice' ? CAVITY_MAX_SECONDS : SPACE_MAX_SECONDS;
    const done = this.#run(p, seconds, acousticSeed(p)).then((o) => {
      this.#pending.delete(key);
      if (!o.ok) {
        this.failures++;
        return;
      }
      const cache = this.#caches[kind];
      cache.set(key, { key, params: p, data: o.data });
      while (cache.size > CACHE_SIZE[kind]) {
        const first = cache.keys().next();
        if (first.done) break;
        cache.delete(first.value);
      }
    });
    this.#inflight.add(done);
    void done.finally(() => this.#inflight.delete(done));
  }

  #run(p: AcousticParams, seconds: number, seed: number): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const job: Job = { params: p, seconds, seed, resolve };
      const w = this.#ensureWorker();
      if (!w) {
        onMainThread(job, this.#sampleRate);
        return;
      }
      const id = ++this.#seq;
      this.#jobs.set(id, job);
      w.postMessage({ id, params: p, sampleRate: this.#sampleRate, seconds, seed });
    });
  }

  #ensureWorker(): Worker | null {
    if (this.#worker !== undefined) return this.#worker;
    if (!this.#useWorker || typeof Worker === 'undefined') {
      this.#worker = null;
      return null;
    }
    try {
      const w = new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module' });
      w.addEventListener('message', (e: MessageEvent<unknown>) => {
        this.#onReply(e.data);
      });
      w.addEventListener('error', (e) => {
        e.preventDefault();
        this.#dropWorker();
      });
      this.#worker = w;
    } catch {
      this.#worker = null;
    }
    return this.#worker;
  }

  #onReply(v: unknown): void {
    if (!isReply(v)) return;
    const job = this.#jobs.get(v.id);
    if (!job) return;
    this.#jobs.delete(v.id);
    job.resolve({ data: new Float32Array(v.data), ok: v.ok });
  }

  /** A refused or crashed worker: its jobs and all later ones run on the main thread. */
  #dropWorker(): void {
    this.#worker?.terminate();
    this.#worker = null;
    const jobs = [...this.#jobs.values()];
    this.#jobs.clear();
    for (const j of jobs) onMainThread(j, this.#sampleRate);
  }
}
