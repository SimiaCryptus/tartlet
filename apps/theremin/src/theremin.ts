import { check, locator } from '@tartlet/check';
import { compile, type CompiledProgram, type ControlMap, type Event } from '@tartlet/core';
import type { Diagnostic } from '@tartlet/ir';
import { freqToMidi, midiToFreq, parseScale, quantizeMidi } from '@tartlet/registry';
import { Scheduler } from '@tartlet/schedule';
import { rat, type Rational, type TempoPoint, type TimeSpan } from '@tartlet/time';
import { AudioEngine } from '@tartlet/webaudio';

export interface VoiceHandle {
  update(controls: Readonly<Record<string, unknown>>, time?: number, tau?: number): void;
  noteOff(time?: number): void;
}

export interface ThereminOptions {
  readonly fMin?: number;
  readonly fMax?: number;
  readonly cutoffMin?: number;
  readonly cutoffMax?: number;
  readonly maxGain?: number;
  readonly tau?: number;
  readonly scale?: string;
  readonly waveform?: string;
  readonly vibratoRate?: number;
  readonly vibratoDepth?: number;
  readonly resonance?: number;
  readonly room?: number;
  readonly size?: number;
  readonly delay?: number;
  readonly delayTime?: number;
  readonly delayFeedback?: number;
  readonly pan?: number;
  readonly attack?: number;
  readonly release?: number;
}

export interface ThereminState {
  readonly x: number;
  readonly y: number;
  readonly rawFreq: number;
  readonly freq: number;
  readonly midi: number;
  readonly noteName: string;
  readonly gain: number;
  readonly cutoff: number;
  readonly active: boolean;
  readonly hold: boolean;
  readonly muted: boolean;
  readonly quantized: boolean;
  readonly scale: string;
}

export interface PitchMapping {
  readonly rawFreq: number;
  readonly freq: number;
  readonly midi: number;
  readonly quantized: boolean;
}

type NoteOnEngine = AudioEngine & {
  noteOn?: (controls: Readonly<Record<string, unknown>>, time: number) => VoiceHandle | undefined;
};

type QueryWithControls = (
  span: TimeSpan,
  opts: { readonly provenance: boolean; readonly controls: ReadonlyMap<string, unknown> },
) => { readonly events: readonly Event<ControlMap>[] };

const COMPILE_OPTS = { documentId: 'theremin', blobIndex: '0' };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Exponential pitch mapping `fMin * (fMax / fMin) ** x` with optional scale quantization. */
export function mapPitch(x: number, fMin: number, fMax: number, scaleSpec?: string): PitchMapping {
  const cx = clamp(x, 0, 1);
  const lo = Math.max(20, fMin);
  const hi = Math.max(lo, fMax);
  const rawFreq = lo * (hi / lo) ** cx;
  const rawMidi = freqToMidi(rawFreq);
  const trimmed = scaleSpec?.trim() ?? '';
  const scale = trimmed.length > 0 ? parseScale(trimmed) : null;
  if (!scale) {
    return { rawFreq, freq: rawFreq, midi: rawMidi, quantized: false };
  }
  const quantizedMidi = quantizeMidi(rawMidi, scale);
  return {
    rawFreq,
    freq: midiToFreq(quantizedMidi),
    midi: quantizedMidi,
    quantized: true,
  };
}

/** Perceptual ~40 dB logarithmic gain curve that tapers cleanly to 0 at `y = 0`. */
export function mapGain(y: number, maxGain = 0.85): number {
  const cy = clamp(y, 0, 1);
  if (cy <= 0 || maxGain <= 0) return 0;
  return maxGain * ((10 ** (2 * (cy - 1)) - 0.01) / 0.99);
}

/** Exponential low-pass filter cutoff mapping across the vertical axis. */
export function mapCutoff(y: number, cutoffMin = 250, cutoffMax = 8000): number {
  const cy = clamp(y, 0, 1);
  const lo = clamp(cutoffMin, 20, 20000);
  const hi = clamp(cutoffMax, lo, 20000);
  return lo * (hi / lo) ** cy;
}

/** Formats a MIDI note number as a pitch label (e.g. `69` -> `"A4"`). */
export function midiToNoteName(midi: number): string {
  if (!Number.isFinite(midi)) return '—';
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[pc] ?? 'C'}${String(octave)}`;
}

/** Continuous WebAudio voice fallback when `AudioEngine.noteOn` is unavailable. */
function createFallbackVoice(ctx: AudioContext, initial: Readonly<Record<string, unknown>>, time: number): VoiceHandle {
  const osc = ctx.createOscillator();
  const waveform = typeof initial.s === 'string' ? initial.s : 'sine';
  if (waveform === 'sine' || waveform === 'triangle' || waveform === 'sawtooth' || waveform === 'square') {
    osc.type = waveform;
  } else {
    osc.type = 'sine';
  }
  const initFreq = typeof initial.freq === 'number' && Number.isFinite(initial.freq) ? initial.freq : 440;
  osc.frequency.setValueAtTime(clamp(initFreq, 20, 20000), time);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const initCutoff = typeof initial.cutoff === 'number' && Number.isFinite(initial.cutoff) ? initial.cutoff : 2000;
  filter.frequency.setValueAtTime(clamp(initCutoff, 20, 20000), time);
  const initQ = typeof initial.resonance === 'number' && Number.isFinite(initial.resonance) ? initial.resonance : 1;
  filter.Q.setValueAtTime(clamp(initQ, 0.0001, 20), time);

  const amp = ctx.createGain();
  const attack =
    typeof initial.attack === 'number' && Number.isFinite(initial.attack) ? clamp(initial.attack, 0.002, 2) : 0.015;
  const release =
    typeof initial.release === 'number' && Number.isFinite(initial.release) ? clamp(initial.release, 0.01, 2) : 0.06;
  const initGain =
    typeof initial.gain === 'number' && Number.isFinite(initial.gain) ? clamp(initial.gain, 0, 1.5) : 0.3;
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(initGain * 0.35, time + attack);

  const panner = ctx.createStereoPanner();
  const initPan =
    typeof initial.pan === 'number' && Number.isFinite(initial.pan) ? clamp(initial.pan, 0, 1) * 2 - 1 : 0;
  panner.pan.setValueAtTime(initPan, time);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  const initVib = typeof initial.vib === 'number' && Number.isFinite(initial.vib) ? clamp(initial.vib, 0, 30) : 0;
  const initVibDepth =
    typeof initial.vibdepth === 'number' && Number.isFinite(initial.vibdepth)
      ? clamp(initial.vibdepth, 0, 12) * 100
      : 0;
  lfo.frequency.setValueAtTime(Math.max(0.1, initVib), time);
  lfoGain.gain.setValueAtTime(initVib > 0 ? initVibDepth : 0, time);
  lfo.connect(lfoGain).connect(osc.detune);

  osc.connect(filter).connect(amp).connect(panner).connect(ctx.destination);
  osc.start(time);
  lfo.start(time);

  let released = false;

  return {
    update(controls, at = ctx.currentTime, tau = 0.015): void {
      if (released) return;
      const t = Math.max(at, ctx.currentTime);
      const tc = Math.max(0.001, tau);
      if (typeof controls.freq === 'number' && Number.isFinite(controls.freq)) {
        osc.frequency.setTargetAtTime(clamp(controls.freq, 20, 20000), t, tc);
      }
      if (typeof controls.gain === 'number' && Number.isFinite(controls.gain)) {
        amp.gain.setTargetAtTime(clamp(controls.gain, 0, 1.5) * 0.35, t, tc);
      }
      if (typeof controls.cutoff === 'number' && Number.isFinite(controls.cutoff)) {
        filter.frequency.setTargetAtTime(clamp(controls.cutoff, 20, 20000), t, tc);
      }
      if (typeof controls.resonance === 'number' && Number.isFinite(controls.resonance)) {
        filter.Q.setTargetAtTime(clamp(controls.resonance, 0.0001, 20), t, tc);
      }
      if (typeof controls.pan === 'number' && Number.isFinite(controls.pan)) {
        panner.pan.setTargetAtTime(clamp(controls.pan, 0, 1) * 2 - 1, t, tc);
      }
      if (typeof controls.vib === 'number' && Number.isFinite(controls.vib)) {
        lfo.frequency.setTargetAtTime(clamp(controls.vib, 0.1, 30), t, tc);
      }
      if (typeof controls.vibdepth === 'number' && Number.isFinite(controls.vibdepth)) {
        const vibRate = typeof controls.vib === 'number' ? controls.vib : lfo.frequency.value;
        lfoGain.gain.setTargetAtTime(vibRate > 0 ? clamp(controls.vibdepth, 0, 12) * 100 : 0, t, tc);
      }
    },
    noteOff(at = ctx.currentTime): void {
      if (released) return;
      released = true;
      const t = Math.max(at, ctx.currentTime);
      amp.gain.cancelScheduledValues(t);
      amp.gain.setTargetAtTime(0, t, Math.max(0.005, release / 3));
      const stopAt = t + release + 0.08;
      try {
        osc.stop(stopAt);
      } catch {
        /* already stopped */
      }
      try {
        lfo.stop(stopAt);
      } catch {
        /* already stopped */
      }
    },
  };
}

/**
 * Manages a continuous single-voice theremin via `AudioEngine` and an optional
 * `Scheduler` + `CompiledProgram` accompaniment driven by live `param(...)` controls.
 */
export class ThereminController {
  #engine: AudioEngine | undefined;
  #starting: Promise<AudioEngine | undefined> | undefined;
  #voice: VoiceHandle | undefined;
  #scheduler: Scheduler<ControlMap> | undefined;
  #program: CompiledProgram | undefined;
  #cps: Rational = rat(1, 2);
  #tempo: readonly TempoPoint[] = [];

  #x = 0.5;
  #y = 0.5;
  #pointerActive = false;
  #hold = false;
  #muted = false;

  #fMin: number;
  #fMax: number;
  #cutoffMin: number;
  #cutoffMax: number;
  #maxGain: number;
  #tau: number;
  #scale: string;
  #waveform: string;
  #vibratoRate: number;
  #vibratoDepth: number;
  #resonance: number;
  #room: number;
  #size: number;
  #delay: number;
  #delayTime: number;
  #delayFeedback: number;
  #pan: number;
  #attack: number;
  #release: number;

  constructor(opts: ThereminOptions = {}) {
    this.#fMin = opts.fMin ?? 110;
    this.#fMax = opts.fMax ?? 1760;
    this.#cutoffMin = opts.cutoffMin ?? 250;
    this.#cutoffMax = opts.cutoffMax ?? 8000;
    this.#maxGain = opts.maxGain ?? 0.85;
    this.#tau = opts.tau ?? 0.015;
    this.#scale = opts.scale ?? '';
    this.#waveform = opts.waveform ?? 'sine';
    this.#vibratoRate = opts.vibratoRate ?? 5.5;
    this.#vibratoDepth = opts.vibratoDepth ?? 0.12;
    this.#resonance = opts.resonance ?? 1.5;
    this.#room = opts.room ?? 0.2;
    this.#size = opts.size ?? 0.4;
    this.#delay = opts.delay ?? 0;
    this.#delayTime = opts.delayTime ?? 0.25;
    this.#delayFeedback = opts.delayFeedback ?? 0.35;
    this.#pan = opts.pan ?? 0.5;
    this.#attack = opts.attack ?? 0.015;
    this.#release = opts.release ?? 0.08;
  }

  get ready(): boolean {
    return this.#engine !== undefined;
  }

  get active(): boolean {
    return this.#pointerActive || this.#hold;
  }

  get hold(): boolean {
    return this.#hold;
  }

  get muted(): boolean {
    return this.#muted;
  }

  get accompanimentRunning(): boolean {
    return this.#scheduler?.running === true;
  }

  get state(): ThereminState {
    return this.computeState();
  }

  /** Starts and memoizes `AudioEngine.create()`. Must be called from a user gesture on first run. */
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

  pointerDown(x: number, y: number): void {
    this.#pointerActive = true;
    this.#x = clamp(x, 0, 1);
    this.#y = clamp(y, 0, 1);
    this.syncAccompanimentControls();
    if (!this.#muted) {
      void this.ensureVoice();
    }
  }

  pointerMove(x: number, y: number): void {
    this.#x = clamp(x, 0, 1);
    this.#y = clamp(y, 0, 1);
    const st = this.computeState();
    this.syncAccompanimentControls(st);
    if (this.#voice && this.#engine && !this.#muted) {
      this.#voice.update(this.modulationControls(st), this.#engine.ctx.currentTime, this.#tau);
    }
  }

  pointerUp(): void {
    this.#pointerActive = false;
    if (!this.#hold) {
      this.releaseVoice();
    }
    this.syncAccompanimentControls();
  }

  setHold(hold: boolean): void {
    this.#hold = hold;
    if (hold && !this.#muted) {
      void this.ensureVoice();
    } else if (!hold && !this.#pointerActive) {
      this.releaseVoice();
    }
    this.syncAccompanimentControls();
  }

  toggleHold(): boolean {
    this.setHold(!this.#hold);
    return this.#hold;
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    if (muted) {
      this.releaseVoice();
      this.#engine?.stopAll();
    } else if (this.active) {
      void this.ensureVoice();
    }
    this.syncAccompanimentControls();
  }

  setConfig(patch: Partial<ThereminOptions>): void {
    if (patch.fMin !== undefined) this.#fMin = patch.fMin;
    if (patch.fMax !== undefined) this.#fMax = patch.fMax;
    if (patch.cutoffMin !== undefined) this.#cutoffMin = patch.cutoffMin;
    if (patch.cutoffMax !== undefined) this.#cutoffMax = patch.cutoffMax;
    if (patch.maxGain !== undefined) this.#maxGain = patch.maxGain;
    if (patch.tau !== undefined) this.#tau = clamp(patch.tau, 0.001, 0.25);
    if (patch.scale !== undefined) this.#scale = patch.scale;
    if (patch.waveform !== undefined) this.#waveform = patch.waveform;
    if (patch.vibratoRate !== undefined) this.#vibratoRate = patch.vibratoRate;
    if (patch.vibratoDepth !== undefined) this.#vibratoDepth = patch.vibratoDepth;
    if (patch.resonance !== undefined) this.#resonance = patch.resonance;
    if (patch.room !== undefined) this.#room = patch.room;
    if (patch.size !== undefined) this.#size = patch.size;
    if (patch.delay !== undefined) this.#delay = clamp(patch.delay, 0, 1);
    if (patch.delayTime !== undefined) this.#delayTime = clamp(patch.delayTime, 0.01, 2);
    if (patch.delayFeedback !== undefined) this.#delayFeedback = clamp(patch.delayFeedback, 0, 0.95);
    if (patch.pan !== undefined) this.#pan = patch.pan;
    if (patch.attack !== undefined) this.#attack = patch.attack;
    if (patch.release !== undefined) this.#release = patch.release;

    const st = this.computeState();
    this.syncAccompanimentControls(st);
    if (this.#voice && this.#engine && !this.#muted) {
      this.#voice.update(this.modulationControls(st), this.#engine.ctx.currentTime, this.#tau);
    }
  }

  /** Immediately silences the theremin voice, clears hold, and stops all scheduled audio. */
  panic(): void {
    this.#pointerActive = false;
    this.#hold = false;
    this.releaseVoice();
    this.#scheduler?.stop();
    this.#engine?.stopAll();
    this.syncAccompanimentControls();
  }

  /** Compiles a Tartlet accompaniment program once; never called during `pointerMove`. */
  setAccompaniment(source: string): readonly Diagnostic[] {
    const r = check(source, COMPILE_OPTS);
    this.#program = compile(r.program, { locate: locator(source), ...COMPILE_OPTS });
    const settings = r.program.settings as { readonly cps: Rational; readonly tempo?: readonly TempoPoint[] };
    this.#cps = settings.cps;
    this.#tempo = settings.tempo ?? [];
    this.#scheduler?.setTempo(this.#cps, this.#tempo);
    return r.diagnostics;
  }

  async startAccompaniment(source?: string): Promise<boolean> {
    if (source !== undefined) {
      this.setAccompaniment(source);
    }
    const engine = await this.start();
    if (!engine || !this.#program) return false;
    this.#scheduler ??= new Scheduler<ControlMap>({
      query: (span, controls) => {
        const program = this.#program;
        if (!program) return [];
        const compiled = program as unknown as { readonly query: QueryWithControls };
        return compiled.query(span, { provenance: false, controls }).events;
      },
      onEvent: (ev, time, duration) => {
        if (!this.#muted) {
          this.#engine?.play(ev.value, time, duration);
        }
      },
      now: () => this.#engine?.ctx.currentTime ?? 0,
      cps: this.#cps,
      tempo: this.#tempo,
    });
    this.#scheduler.setTempo(this.#cps, this.#tempo);
    this.syncAccompanimentControls();
    this.#scheduler.start();
    return true;
  }

  stopAccompaniment(): void {
    this.#scheduler?.stop();
  }

  dispose(): void {
    this.panic();
  }

  private computeState(): ThereminState {
    const pitch = mapPitch(this.#x, this.#fMin, this.#fMax, this.#scale);
    const gain = this.#muted ? 0 : mapGain(this.#y, this.#maxGain);
    const cutoff = mapCutoff(this.#y, this.#cutoffMin, this.#cutoffMax);
    return {
      x: this.#x,
      y: this.#y,
      rawFreq: pitch.rawFreq,
      freq: pitch.freq,
      midi: pitch.midi,
      noteName: midiToNoteName(pitch.midi),
      gain,
      cutoff,
      active: this.active,
      hold: this.#hold,
      muted: this.#muted,
      quantized: pitch.quantized,
      scale: this.#scale,
    };
  }

  private buildNoteControls(st: ThereminState): Record<string, unknown> {
    return {
      s: this.#waveform,
      freq: st.freq,
      gain: st.gain,
      cutoff: st.cutoff,
      resonance: this.#resonance,
      pan: this.#pan,
      vib: this.#vibratoRate,
      vibdepth: this.#vibratoDepth,
      attack: this.#attack,
      release: this.#release,
      room: this.#room,
      size: this.#size,
      delay: this.#delay,
      delaytime: this.#delayTime,
      delayfeedback: this.#delayFeedback,
      orbit: 0,
    };
  }

  private modulationControls(st: ThereminState): Record<string, unknown> {
    return {
      freq: st.freq,
      gain: st.gain,
      cutoff: st.cutoff,
      resonance: this.#resonance,
      pan: this.#pan,
      vib: this.#vibratoRate,
      vibdepth: this.#vibratoDepth,
    };
  }

  private async ensureVoice(): Promise<void> {
    if (this.#voice) {
      if (this.#engine && !this.#muted) {
        this.#voice.update(this.modulationControls(this.computeState()), this.#engine.ctx.currentTime, this.#tau);
      }
      return;
    }
    const engine = this.#engine ?? (await this.start());
    // Re-check after the await: another call may have created a voice meanwhile.
    if (!engine || this.hasVoice() || this.#muted || !this.active) return;
    const st = this.computeState();
    const controls = this.buildNoteControls(st);
    const now = engine.ctx.currentTime;
    const noteOnEngine = engine as NoteOnEngine;
    if (typeof noteOnEngine.noteOn === 'function') {
      this.#voice = noteOnEngine.noteOn(controls, now);
    } else {
      this.#voice = createFallbackVoice(engine.ctx, controls, now);
    }
  }

  private releaseVoice(): void {
    const voice = this.#voice;
    if (!voice) return;
    this.#voice = undefined;
    voice.noteOff();
  }
  /** Read through a method so TypeScript does not carry stale narrowing across `await`. */
  private hasVoice(): boolean {
    return this.#voice !== undefined;
  }

  private syncAccompanimentControls(st: ThereminState = this.computeState()): void {
    if (!this.#scheduler) return;
    this.#scheduler.updateControls({
      x: st.x,
      y: st.y,
      freq: st.freq,
      gain: st.gain,
      cutoff: st.cutoff,
      active: st.active ? 1 : 0,
    });
  }
}
