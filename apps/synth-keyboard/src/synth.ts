import { check, locator } from '@tartlet/check';
import { compile, type CompiledProgram, type ControlMap } from '@tartlet/core';
import type { Diagnostic } from '@tartlet/ir';
import { SCALES, degreeToMidi, parseScale } from '@tartlet/registry';
import { Scheduler } from '@tartlet/schedule';
import { fromFloat, rat, type Rational, type TempoPoint } from '@tartlet/time';
import { AudioEngine } from '@tartlet/webaudio';

export interface VoiceHandle {
  update(controls: ControlMap, time?: number): void;
  release?(time?: number): void;
  noteOff?(time?: number): void;
  stop?(time?: number): void;
}

export interface SynthParams {
  s: string;
  gain: number;
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  detune: number;
  unison: number;
  shape: number;
  lpenv: number;
  room: number;
  size: number;
  delay: number;
  delaytime: number;
  delayfeedback: number;
  pan: number;
}

export const DEFAULT_SYNTH_PARAMS: Readonly<SynthParams> = {
  s: 'sawtooth',
  gain: 0.45,
  cutoff: 3200,
  resonance: 1.5,
  attack: 0.015,
  decay: 0.15,
  sustain: 0.75,
  release: 0.25,
  detune: 10,
  unison: 2,
  shape: 0,
  lpenv: 0,
  room: 0.2,
  size: 0.35,
  delay: 0,
  delaytime: 0.25,
  delayfeedback: 0.4,
  pan: 0.5,
};

export interface ScaleState {
  readonly spec: string | null;
  readonly root: number;
  readonly intervals: readonly number[];
}

export interface BackingResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export const SCALE_NAMES: readonly string[] = [...SCALES.keys()];

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const CHROMATIC_INTERVALS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const COMPILER_OPTS = { documentId: 'synth-keyboard', blobIndex: '0' };

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[pc] ?? 'C'}${String(octave)}`;
}

function startSustainedVoice(engine: AudioEngine, controls: ControlMap, now: number): VoiceHandle | undefined {
  const noteOn = (engine as unknown as { readonly noteOn?: unknown }).noteOn;
  if (typeof noteOn === 'function') {
    return (noteOn as (c: ControlMap, time?: number) => VoiceHandle | undefined).call(engine, controls, now);
  }
  // Fallback when running against an AudioEngine build without sustained noteOn support.
  engine.play(controls, now, 8);
  return {
    update: () => undefined,
    release: () => undefined,
  };
}

function releaseVoiceHandle(handle: VoiceHandle, at?: number): void {
  if (typeof handle.release === 'function') {
    if (at !== undefined) handle.release(at);
    else handle.release();
  } else if (typeof handle.noteOff === 'function') {
    if (at !== undefined) handle.noteOff(at);
    else handle.noteOff();
  } else if (typeof handle.stop === 'function') {
    if (at !== undefined) handle.stop(at);
    else handle.stop();
  }
}

export class SynthController {
  #engine: AudioEngine | undefined;
  #starting: Promise<AudioEngine | undefined> | undefined;
  readonly #active = new Map<string, VoiceHandle>();
  readonly #pending = new Map<string, number>();
  readonly #params: Record<string, unknown> = { ...DEFAULT_SYNTH_PARAMS };
  #scale: { readonly root: number; readonly intervals: readonly number[] } | null = parseScale('C4:major');
  #scaleSpec: string | null = 'C4:major';
  #baseMidi = 60;
  #octaveOffset = 0;
  #muted = false;

  #program: CompiledProgram | undefined;
  #cps: Rational = rat(1, 2);
  #tempo: readonly TempoPoint[] = [];
  #scheduler: Scheduler<ControlMap> | undefined;
  #backingSource = '';

  get ready(): boolean {
    return this.#engine !== undefined;
  }

  get engine(): AudioEngine | undefined {
    return this.#engine;
  }

  get active(): ReadonlyMap<string, VoiceHandle> {
    return this.#active;
  }

  get muted(): boolean {
    return this.#muted;
  }

  set muted(value: boolean) {
    this.#muted = value;
    if (value) {
      this.allNotesOff();
      this.#engine?.stopAll();
    }
  }

  get params(): Readonly<Record<string, unknown>> {
    return this.#params;
  }

  get scale(): ScaleState {
    if (!this.#scale) {
      return { spec: null, root: this.#baseMidi, intervals: CHROMATIC_INTERVALS };
    }
    return { spec: this.#scaleSpec, root: this.#scale.root, intervals: this.#scale.intervals };
  }

  get octaveOffset(): number {
    return this.#octaveOffset;
  }

  get backingRunning(): boolean {
    return this.#scheduler?.running ?? false;
  }

  /** Starts the audio engine once; concurrent calls share the same initialization promise. */
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

  setScale(spec: string | null): boolean {
    if (spec === null || spec.trim() === '' || spec.trim().toLowerCase() === 'unlocked') {
      this.#scale = null;
      this.#scaleSpec = null;
      return true;
    }
    const parsed = parseScale(spec);
    if (!parsed) return false;
    this.#scale = parsed;
    this.#scaleSpec = spec;
    this.#baseMidi = parsed.root;
    return true;
  }

  setOctaveOffset(offset: number): number {
    this.#octaveOffset = Math.max(-4, Math.min(4, Math.trunc(offset)));
    return this.#octaveOffset;
  }

  shiftOctave(delta: number): number {
    return this.setOctaveOffset(this.#octaveOffset + delta);
  }

  /** Resolves a zero-based keyboard index to a MIDI note using the active scale and octave shift. */
  resolveKeyMidi(degreeIndex: number): number {
    const shift = this.#octaveOffset * 12;
    if (this.#scale) {
      return degreeToMidi(degreeIndex, this.#scale) + shift;
    }
    return this.#baseMidi + degreeIndex + shift;
  }

  /** Updates synth parameters and propagates changes immediately to all held voices and the backing scheduler. */
  updateParams(patch: Readonly<Record<string, unknown>>): void {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        Reflect.deleteProperty(this.#params, key);
      } else {
        this.#params[key] = value;
        clean[key] = value;
      }
    }
    for (const handle of this.#active.values()) {
      handle.update(clean);
    }
    this.#scheduler?.updateControls(patch);
  }

  setParam(name: string, value: unknown): void {
    this.updateParams({ [name]: value });
  }

  noteOn(keyId: string, midi: number): void {
    if (!Number.isFinite(midi)) return;
    if (this.#active.has(keyId)) {
      this.noteOff(keyId);
    }
    this.#pending.set(keyId, midi);
    if (this.#engine) {
      this.#triggerVoice(this.#engine, keyId, midi);
      return;
    }
    void this.start().then((engine) => {
      if (!engine) {
        this.#pending.delete(keyId);
        return;
      }
      const pendingMidi = this.#pending.get(keyId);
      if (pendingMidi !== undefined && !this.#active.has(keyId)) {
        this.#triggerVoice(engine, keyId, pendingMidi);
      }
    });
  }

  noteOff(keyId: string): void {
    this.#pending.delete(keyId);
    const handle = this.#active.get(keyId);
    if (!handle) return;
    this.#active.delete(keyId);
    releaseVoiceHandle(handle, this.#engine?.ctx.currentTime);
  }

  allNotesOff(): void {
    this.#pending.clear();
    const now = this.#engine?.ctx.currentTime;
    for (const handle of this.#active.values()) {
      releaseVoiceHandle(handle, now);
    }
    this.#active.clear();
  }

  stopAll(): void {
    this.allNotesOff();
    this.stopBacking();
    this.#engine?.stopAll();
  }

  loadBacking(source: string): BackingResult {
    this.#backingSource = source;
    const checked = check(source, COMPILER_OPTS);
    this.#program = compile(checked.program, { locate: locator(source), ...COMPILER_OPTS });
    const settings = checked.program.settings as {
      readonly cps: Rational;
      readonly tempo?: readonly TempoPoint[];
    };
    this.#cps = settings.cps;
    this.#tempo = settings.tempo ?? [];
    if (this.#scheduler) {
      this.#scheduler.setTempo(this.#cps, this.#tempo);
    }
    const hasError = checked.diagnostics.some((d) => d.severity === 'error');
    return { ok: !hasError, diagnostics: checked.diagnostics };
  }

  async startBacking(source?: string): Promise<BackingResult> {
    let result: BackingResult = { ok: true, diagnostics: [] };
    if (source !== undefined) {
      result = this.loadBacking(source);
    } else if (!this.#program && this.#backingSource) {
      result = this.loadBacking(this.#backingSource);
    }
    const engine = await this.start();
    if (!engine || !this.#program) return result;
    if (this.#scheduler?.running) {
      this.#scheduler.stop();
    }
    const scheduler = new Scheduler<ControlMap>({
      query: (span, controls) => {
        if (!this.#program) return [];
        return this.#program.query(span, { provenance: false, controls }).events;
      },
      onEvent: (ev, time, duration) => {
        if (this.#muted) return;
        engine.play(ev.value, time, duration);
      },
      onError: (err: unknown) => {
        console.warn('Backing track error:', err);
      },
      now: () => engine.ctx.currentTime,
      cps: this.#cps,
      ...(this.#tempo.length > 0 ? { tempo: this.#tempo } : {}),
    });
    scheduler.setControls(this.#params);
    this.#scheduler = scheduler;
    scheduler.start();
    return result;
  }

  stopBacking(): void {
    this.#scheduler?.stop();
    this.#scheduler = undefined;
  }

  setBackingCps(cps: number): void {
    if (!Number.isFinite(cps) || cps <= 0) return;
    this.#cps = fromFloat(cps, 1000);
    this.#scheduler?.setCps(this.#cps);
  }

  #triggerVoice(engine: AudioEngine, keyId: string, midi: number): void {
    this.#pending.delete(keyId);
    if (this.#muted) return;
    const controls: ControlMap = {
      ...this.#params,
      note: { kind: 'midi', value: midi },
    };
    const handle = startSustainedVoice(engine, controls, engine.ctx.currentTime);
    if (handle) {
      this.#active.set(keyId, handle);
    }
  }
}
