// A tiny sound-effect helper on top of Tartlet. Each sound is a short Tartlet source: it is
// checked and compiled once, its first cycle is turned into a list of timed notes, and those
// notes are played through Tartlet's audio engine (with its non-bypassable safety chain).
import { check, locator } from '@tartlet/check';
import { compile, type ControlMap } from '@tartlet/core';
import type { Diagnostic } from '@tartlet/ir';
import { eq, rat, sub, toNumber } from '@tartlet/time';
import { AudioEngine } from '@tartlet/webaudio';

interface Hit {
  readonly value: ControlMap;
  /** Seconds after the trigger. */
  readonly at: number;
  /** Seconds. */
  readonly dur: number;
}

export interface Sound {
  readonly source: string;
  readonly hits: readonly Hit[];
  readonly diagnostics: readonly Diagnostic[];
}

const OPTS = { documentId: 'sfx-demo', blobIndex: '0' };
const MAX_CACHE = 256;

/** Checks and compiles a source, and lists the onsets of its first cycle in seconds. */
export function compileSound(source: string): Sound {
  const r = check(source, OPTS);
  const program = compile(r.program, { locate: locator(source), ...OPTS });
  const cps = toNumber(r.program.settings.cps);
  const hits: Hit[] = [];
  for (const ev of program.query({ begin: rat(0), end: rat(1) }, { provenance: false }).events) {
    const w = ev.whole;
    if (!w || !eq(w.begin, ev.part.begin)) continue;
    hits.push({ value: ev.value, at: toNumber(w.begin) / cps, dur: toNumber(sub(w.end, w.begin)) / cps });
  }
  hits.sort((a, b) => a.at - b.at);
  return { source, hits, diagnostics: r.diagnostics };
}

export class TartletSfx {
  #engine: AudioEngine | undefined;
  #starting: Promise<AudioEngine | undefined> | undefined;
  readonly #cache = new Map<string, Sound>();
  muted = false;

  /** True once the audio engine is running. */
  get ready(): boolean {
    return this.#engine !== undefined;
  }

  /** Starts the audio engine. The first call must come from a user gesture (click, tap or key). */
  start(): Promise<AudioEngine | undefined> {
    if (this.#engine) return Promise.resolve(this.#engine);
    this.#starting ??= AudioEngine.create().then(
      (engine) => {
        this.#engine = engine;
        return engine;
      },
      (err: unknown) => {
        console.warn('Tartlet audio is unavailable here.', err);
        this.#starting = undefined;
        return undefined;
      },
    );
    return this.#starting;
  }

  /** The compiled sound for a source, from the cache when possible. */
  sound(source: string): Sound {
    let s = this.#cache.get(source);
    if (!s) {
      if (this.#cache.size >= MAX_CACHE) this.#cache.clear();
      s = compileSound(source);
      this.#cache.set(source, s);
    }
    return s;
  }

  /** Plays a sound now. Call it from an event handler. */
  async play(source: string): Promise<Sound> {
    // Start the engine first, while the user gesture is still fresh.
    const started = this.muted ? Promise.resolve(this.#engine) : this.start();
    const sound = this.sound(source);
    if (this.muted) return sound;
    const engine = await started;
    if (!engine) return sound;
    const t0 = engine.ctx.currentTime + 0.02;
    for (const h of sound.hits) engine.play(h.value, t0 + h.at, h.dur);
    return sound;
  }

  stopAll(): void {
    this.#engine?.stopAll();
  }
}