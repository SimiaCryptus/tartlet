// <tartlet-player> (idea.md §13.3). Check and query run in a worker by default (idea.md §11.3).
// The mixer and source view land in T3.
import type { Diagnostic, Program, ResourceDecl } from '@tartlet/ir';
import type { ControlMap } from '@tartlet/core';
import { SampleLibrary, loadSamples, sampleResources, type FetchBytes, type HostDiagnostic } from '@tartlet/samples';
import { Scheduler, cycleToTime } from '@tartlet/schedule';
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

/** Seconds the transport keeps running after a `song(…, "once")` ends, so releases ring out. */
const END_GRACE = 2;
type ParamPatch = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;
type NoiseKind = 'white' | 'pink' | 'brown';
function isMapPatch(p: ParamPatch): p is ReadonlyMap<string, unknown> {
  return p instanceof Map;
}
/** Entries of a parameter patch, keeping `undefined` values (they delete the parameter). */
function patchEntries(p: ParamPatch): [string, unknown][] {
  return isMapPatch(p) ? [...p] : Object.entries(p);
}
interface VoiceHandle {
  controls: Record<string, unknown>;
  update(controls: Partial<ControlMap>, glideSeconds?: number): void;
  release(): void;
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const fin = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
function fillNoiseBuffer(kind: NoiseKind, out: Float32Array, seed: number): void {
  let s = seed | 0;
  const rand = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rand();
    if (kind === 'white') {
      out[i] = w;
    } else if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      out[i] = brown * 3.5;
    }
  }
}

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
  #params = new Map<string, unknown>();
  #voices = new Map<string, VoiceHandle>();
  #pendingNotes = new Map<string, symbol>();
  #voiceGen = 0;
  #liveBus: AudioNode | undefined;
  #liveBusCtx: AudioContext | undefined;
  #noiseBeds = new Map<NoiseKind, AudioBuffer>();
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
  /** Current live parameter overrides. */
  get params(): ReadonlyMap<string, unknown> {
    return new Map(this.#params);
  }
  /** Sets a single live parameter, forwarding it to the evaluator, scheduler, and active live voices. */
  setParam(name: string, value: number | string | boolean): void {
    this.#params.set(name, value);
    this.#forwardParams();
    const patch: Partial<ControlMap> = { [name]: value };
    for (const voice of this.#voices.values()) voice.update(patch);
  }
  /** Merges multiple live parameters, forwarding updates to the evaluator, scheduler, and active live voices. */
  setParams(params: ParamPatch): void {
    const patch: Record<string, unknown> = {};
    let hasPatch = false;
    for (const [k, v] of patchEntries(params)) {
      if (v === undefined) this.#params.delete(k);
      else this.#params.set(k, v);
      patch[k] = v;
      hasPatch = true;
    }
    this.#forwardParams();
    if (hasPatch) {
      for (const voice of this.#voices.values()) voice.update(patch);
    }
  }
  /** Starts or retriggers a held live voice identified by `id`. Must be called from a user gesture. */
  async noteOn(id: string, controls: ControlMap): Promise<boolean> {
    const token = Symbol(id);
    const gen = this.#voiceGen;
    this.#pendingNotes.set(id, token);
    const engine = await this.#ensureEngine();
    if (!engine || gen !== this.#voiceGen || this.#pendingNotes.get(id) !== token) {
      if (this.#pendingNotes.get(id) === token) this.#pendingNotes.delete(id);
      return false;
    }
    this.#pendingNotes.delete(id);
    const existing = this.#voices.get(id);
    if (existing) {
      this.#voices.delete(id);
      existing.release();
    }
    const merged: Record<string, unknown> = {};
    for (const [k, v] of this.#params) merged[k] = v;
    for (const [k, v] of Object.entries(controls)) {
      if (v === undefined) Reflect.deleteProperty(merged, k);
      else merged[k] = v;
    }
    const handle = this.#createVoice(engine, merged);
    if (!handle) return false;
    this.#voices.set(id, handle);
    return true;
  }
  /** Updates controls on an active held voice, optionally gliding over `glideSeconds`. */
  updateVoice(id: string, controls: Partial<ControlMap>, glideSeconds?: number): void {
    this.#voices.get(id)?.update(controls, glideSeconds);
  }
  /** Releases a single held live voice identified by `id`. */
  noteOff(id: string): void {
    this.#pendingNotes.delete(id);
    const voice = this.#voices.get(id);
    if (!voice) return;
    this.#voices.delete(id);
    voice.release();
  }
  /** Releases all currently held live voices. */
  releaseAll(): void {
    this.#voiceGen++;
    this.#pendingNotes.clear();
    for (const voice of this.#voices.values()) voice.release();
    this.#voices.clear();
  }
  #forwardParams(): void {
    const snapshot = new Map(this.#params);
    this.#evaluator.setParams(snapshot).catch((e: unknown) => {
      console.warn(e);
    });
    this.#scheduler?.setControls(snapshot);
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
      if (this.#params.size > 0) this.#forwardParams();
      r = await this.#evaluator.check(req);
    }
    if (gen !== this.#gen) return;
    this.#result = r;
    this.#scheduler?.setTempo(r.program.settings.cps, r.program.settings.tempoMap ?? []);
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
    const engine = await this.#ensureEngine();
    if (!engine) return;
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
      tempo: result.program.settings.tempoMap ?? [],
    });
    if (this.#params.size > 0) this.#scheduler.setControls(this.#params);
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
    this.releaseAll();
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
    const song = this.#result?.program.settings.song;
    const engine = this.#engine;
    if (song?.once === true && engine && engine.ctx.currentTime > cycleToTime(s.mapping, song.cycles) + END_GRACE) {
      this.stop();
      return;
    }
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
  async #ensureEngine(): Promise<AudioEngine | undefined> {
    if (this.#engine) {
      this.#engine.setLibrary(this.#library);
      if (this.#engine.ctx.state === 'suspended') {
        try {
          await this.#engine.ctx.resume();
        } catch (e) {
          console.error(e);
          return undefined;
        }
      }
      return this.#engine;
    }
    try {
      this.#engine = await AudioEngine.create();
      this.#engine.setLibrary(this.#library);
      return this.#engine;
    } catch (e) {
      this.#status.textContent = 'Audio is unavailable here, so playback is refused without the safety chain.';
      console.error(e);
      return undefined;
    }
  }
  #getLiveBus(engine: AudioEngine): AudioNode {
    if (this.#liveBus && this.#liveBusCtx === engine.ctx) return this.#liveBus;
    const ctx = engine.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.7;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      bus.connect(comp).connect(ctx.destination);
    } else {
      bus.connect(ctx.destination);
    }
    this.#liveBus = bus;
    this.#liveBusCtx = ctx;
    this.#noiseBeds.clear();
    return bus;
  }
  #noiseBuffer(ctx: AudioContext, kind: NoiseKind): AudioBuffer {
    const hit = this.#noiseBeds.get(kind);
    if (hit) return hit;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 2, sr);
    const seed = kind === 'white' ? 0x2545f491 : kind === 'pink' ? 0x1b873593 : 0x7feb352d;
    fillNoiseBuffer(kind, buf.getChannelData(0), seed);
    this.#noiseBeds.set(kind, buf);
    return buf;
  }
  #createVoice(engine: AudioEngine, initial: Record<string, unknown>): VoiceHandle | undefined {
    const note = initial.note as { kind?: string; value?: unknown } | undefined;
    const midi = note?.kind === 'midi' ? fin(note.value, NaN) : NaN;
    const hz = num(initial.freq);
    const sound =
      typeof initial.s === 'string' ? initial.s : Number.isFinite(midi) || hz !== undefined ? 'triangle' : undefined;
    if (sound === undefined) return undefined;
    const freqOf = (c: Record<string, unknown>): number => {
      const f = num(c.freq);
      if (f !== undefined) return clamp(f, 1, 20000);
      const n = c.note as { kind?: string; value?: unknown } | undefined;
      const m = n?.kind === 'midi' ? fin(n.value, 57) : 57;
      return clamp(440 * 2 ** ((m - 69) / 12), 1, 20000);
    };
    const levelOf = (c: Record<string, unknown>): number => {
      const vel = clamp(fin(c.velocity, 1), 0, 1);
      const gain = clamp(fin(c.gain, 1), 0, 1.5);
      const velcurve = clamp(fin(c.velcurve, 1), 0.25, 4);
      return gain * vel ** velcurve * 0.3;
    };
    const ctx = engine.ctx;
    const now = ctx.currentTime;
    const attack = clamp(fin(initial.attack, 0.005), 0.001, 5);
    const decay = clamp(fin(initial.decay, 0.05), 0.001, 5);
    const sustain = clamp(fin(initial.sustain, 1), 0, 1);
    const peak = levelOf(initial);
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(peak, now + attack);
    envGain.gain.linearRampToValueAtTime(peak * sustain, now + attack + decay);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = clamp(fin(initial.cutoff, 20000), 20, 20000);
    lpf.Q.value = clamp(fin(initial.resonance, 0.7), 0.0001, 20);
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = clamp(fin(initial.hcutoff, 20), 20, 20000);
    hpf.Q.value = 0.7;
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(fin(initial.pan, 0.5), 0, 1) * 2 - 1;
    const noiseKind = sound === 'white' || sound === 'pink' || sound === 'brown' ? sound : undefined;
    let source: OscillatorNode | AudioBufferSourceNode;
    let osc: OscillatorNode | undefined;
    if (noiseKind) {
      const bufSrc = ctx.createBufferSource();
      bufSrc.buffer = this.#noiseBuffer(ctx, noiseKind);
      bufSrc.loop = true;
      source = bufSrc;
    } else {
      osc = ctx.createOscillator();
      osc.type =
        sound === 'sine' || sound === 'triangle' || sound === 'sawtooth' || sound === 'square' ? sound : 'triangle';
      osc.frequency.value = freqOf(initial);
      const detune = num(initial.detune);
      if (detune !== undefined) osc.detune.value = clamp(detune, -1200, 1200);
      source = osc;
    }
    source.connect(envGain).connect(lpf).connect(hpf).connect(panner).connect(this.#getLiveBus(engine));
    source.start(now);
    let released = false;
    const controls: Record<string, unknown> = { ...initial };
    const ramp = (param: AudioParam, target: number, glide: number, exp = false): void => {
      const t = ctx.currentTime;
      param.cancelScheduledValues(t);
      if (glide > 0) {
        const cur = param.value;
        param.setValueAtTime(exp ? Math.max(1e-4, cur) : cur, t);
        if (exp && target > 0) param.exponentialRampToValueAtTime(target, t + glide);
        else param.linearRampToValueAtTime(target, t + glide);
      } else {
        param.setValueAtTime(target, t);
      }
    };
    return {
      controls,
      update: (patch, glideSeconds) => {
        if (released) return;
        const entries = Object.entries(patch);
        if (entries.length === 0) return;
        for (const [k, v] of entries) {
          if (v === undefined) Reflect.deleteProperty(controls, k);
          else controls[k] = v;
        }
        const glide = glideSeconds !== undefined && Number.isFinite(glideSeconds) ? Math.max(0, glideSeconds) : 0;
        if (osc) {
          if ('s' in patch && typeof controls.s === 'string') {
            const next = controls.s;
            if (next === 'sine' || next === 'triangle' || next === 'sawtooth' || next === 'square') {
              osc.type = next;
            }
          }
          if ('freq' in patch || 'note' in patch) {
            ramp(osc.frequency, freqOf(controls), glide, true);
          }
          if ('detune' in patch) {
            ramp(osc.detune, clamp(fin(controls.detune, 0), -1200, 1200), glide);
          }
        }
        if ('gain' in patch || 'velocity' in patch || 'velcurve' in patch || 'sustain' in patch) {
          ramp(envGain.gain, levelOf(controls) * clamp(fin(controls.sustain, 1), 0, 1), glide);
        }
        if ('cutoff' in patch) {
          ramp(lpf.frequency, clamp(fin(controls.cutoff, 20000), 20, 20000), glide, true);
        }
        if ('resonance' in patch) {
          ramp(lpf.Q, clamp(fin(controls.resonance, 0.7), 0.0001, 20), glide);
        }
        if ('hcutoff' in patch) {
          ramp(hpf.frequency, clamp(fin(controls.hcutoff, 20), 20, 20000), glide, true);
        }
        if ('pan' in patch) {
          ramp(panner.pan, clamp(fin(controls.pan, 0.5), 0, 1) * 2 - 1, glide);
        }
      },
      release: () => {
        if (released) return;
        released = true;
        const t = ctx.currentTime;
        const rel = clamp(fin(controls.release, 0.08), 0.01, 8);
        envGain.gain.cancelScheduledValues(t);
        envGain.gain.setValueAtTime(envGain.gain.value, t);
        envGain.gain.linearRampToValueAtTime(0, t + rel);
        try {
          source.stop(t + rel + 0.02);
        } catch {
          /* already stopped */
        }
        source.onended = () => {
          source.disconnect();
          envGain.disconnect();
          lpf.disconnect();
          hpf.disconnect();
          panner.disconnect();
        };
      },
    };
  }
}

export function defineTartletPlayer(): void {
  if (!customElements.get('tartlet-player')) customElements.define('tartlet-player', TartletPlayerElement);
}
