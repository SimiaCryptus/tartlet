// Clip pitch detection, resampling and retuning for calibrated musical use.
// Pure, deterministic DSP in @tartlet/samples: no DOM or Web Audio required.
import { normalize, type SampleKind } from './normalize';
import type { WavData } from './wav';

export const DEFAULT_CLIP_SAMPLE_RATE = 48000;
const MIN_PITCH_HZ = 50;
const MAX_PITCH_HZ = 2000;
const YIN_THRESHOLD = 0.15;
const MIN_CLARITY = 0.75;
const LANCZOS_A = 3;
const MIN_PITCH_RATIO = 0.25;
const MAX_PITCH_RATIO = 4;

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export interface PitchEstimate {
  /** Detected fundamental frequency in Hz, or null when unpitched. */
  readonly hz: number | null;
  /** Periodicity confidence in [0, 1]. Higher means clearer pitch. */
  readonly clarity: number;
  /** Nearest concert-pitch MIDI note (0–127) when pitched, or null. */
  readonly midi: number | null;
  /** Deviation in cents from the nearest concert-pitch semitone (A4 = 440 Hz). */
  readonly cents: number;
}

export interface ClipCalibration {
  readonly sourceSampleRate: number;
  readonly sampleRate: number;
  readonly detectedHz: number | null;
  readonly clarity: number;
  /** Calibrated root MIDI note (0–127), or null for unpitched impulses. */
  readonly root: number | null;
  /** Pitch shift applied in cents to bring the clip to concert pitch. */
  readonly retuneCents: number;
  /** Output samples per input sample: (sampleRate / sourceSampleRate) / pitchRatio. */
  readonly resampleRatio: number;
  readonly kind: SampleKind;
}

export interface CalibrateOptions {
  /** Target sample rate in Hz (default 48000). */
  readonly targetSampleRate?: number;
  /** Optional target MIDI note (0–127) to retune to; defaults to the nearest concert semitone. */
  readonly targetRoot?: number;
  /** Optional kind override; defaults to 'note' for pitched clips and 'impulse' for unpitched clips. */
  readonly kind?: SampleKind;
  /** Apply DC removal, leading-silence trim and -1 dBFS peak normalisation (default true). */
  readonly normalize?: boolean;
  /** Retune pitched clips to concert pitch A4 = 440 Hz (default true). */
  readonly retune?: boolean;
}

export interface CalibratedClip {
  readonly wav: WavData;
  readonly calibration: ClipCalibration;
}

/** Concert-pitch frequency in Hz for a MIDI note (A4 = MIDI 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Continuous MIDI note number for a frequency in Hz. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Human-readable note name for a MIDI note, e.g. 60 → "C4", 69 → "A4". */
export function midiToNoteName(midi: number): string {
  const m = Math.round(midi);
  const name = NOTE_NAMES[((m % 12) + 12) % 12] ?? 'C';
  const octave = Math.floor(m / 12) - 1;
  return `${name}${String(octave)}`;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function toMono(wav: WavData): Float32Array {
  const nCh = wav.channels.length;
  const frames = wav.channels[0]?.length ?? 0;
  if (nCh === 0 || frames === 0) return new Float32Array(0);
  if (nCh === 1) return wav.channels[0] ?? new Float32Array(0);
  const mono = new Float32Array(frames);
  const inv = 1 / nCh;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (const ch of wav.channels) s += ch[i] ?? 0;
    mono[i] = s * inv;
  }
  return mono;
}

interface YinFrame {
  readonly hz: number;
  readonly clarity: number;
}

/** Runs YIN on a single window starting at `offset`. */
function yinWindow(
  mono: Float32Array,
  offset: number,
  win: number,
  minLag: number,
  maxLag: number,
  sr: number,
): YinFrame | null {
  let energy = 0;
  for (let i = 0; i < win; i++) {
    const v = mono[offset + i] ?? 0;
    energy += v * v;
  }
  if (Math.sqrt(energy / win) < 0.01) return null;

  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let diff = 0;
    for (let j = 0; j < win; j++) {
      const d = (mono[offset + j] ?? 0) - (mono[offset + j + tau] ?? 0);
      diff += d * d;
    }
    runningSum += diff;
    cmnd[tau] = runningSum > 0 ? (diff * tau) / runningSum : 1;
  }

  // First local minimum below YIN_THRESHOLD, or else global minimum in [minLag, maxLag].
  let bestTau = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if ((cmnd[tau] ?? 1) < YIN_THRESHOLD) {
      while (tau + 1 <= maxLag && (cmnd[tau + 1] ?? 1) < (cmnd[tau] ?? 1)) tau++;
      bestTau = tau;
      break;
    }
  }
  if (bestTau < 0) {
    let bestVal = 1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      const v = cmnd[tau] ?? 1;
      if (v < bestVal) {
        bestVal = v;
        bestTau = tau;
      }
    }
  }
  if (bestTau < minLag) return null;

  const val = cmnd[bestTau] ?? 1;
  // Parabolic interpolation around bestTau for sub-sample precision.
  let refined = bestTau;
  if (bestTau > minLag && bestTau < maxLag) {
    const y0 = cmnd[bestTau - 1] ?? val;
    const y1 = val;
    const y2 = cmnd[bestTau + 1] ?? val;
    const denom = 2 * (2 * y1 - y0 - y2);
    if (Math.abs(denom) > 1e-12) {
      const delta = clamp((y2 - y0) / denom, -0.5, 0.5);
      refined = bestTau + delta;
    }
  }
  if (refined <= 0) return null;
  const hz = sr / refined;
  if (hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) return null;
  return { hz, clarity: clamp(1 - val, 0, 1) };
}

/**
 * Estimates the fundamental frequency of a clip using multi-window YIN with parabolic interpolation.
 * Returns `hz: null` when the clip is too short, silent or unpitched (e.g. percussion).
 */
export function detectPitch(wav: WavData): PitchEstimate {
  const mono = toMono(wav);
  const frames = mono.length;
  const sr = wav.sampleRate;
  if (frames < 64 || sr < 8000) return { hz: null, clarity: 0, midi: null, cents: 0 };

  const minLag = Math.max(2, Math.floor(sr / MAX_PITCH_HZ));
  const maxLag = Math.min(Math.ceil(sr / MIN_PITCH_HZ), Math.floor(frames / 2) - 1);
  if (maxLag <= minLag) return { hz: null, clarity: 0, midi: null, cents: 0 };

  const win = Math.min(Math.max(maxLag, Math.round(sr * 0.03)), frames - maxLag);
  if (win < minLag) return { hz: null, clarity: 0, midi: null, cents: 0 };

  // Find active span above 10% of peak so trailing silence does not skew analysis.
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(mono[i] ?? 0));
  if (peak < 1e-4) return { hz: null, clarity: 0, midi: null, cents: 0 };
  const activeFloor = peak * 0.1;
  let lastActive = frames - 1;
  while (lastActive > 0 && Math.abs(mono[lastActive] ?? 0) < activeFloor) lastActive--;

  const maxStart = Math.max(0, Math.min(frames - win - maxLag, lastActive - win - maxLag));
  const transientSkip = frames > sr * 0.08 ? Math.min(Math.round(sr * 0.01), maxStart) : 0;
  const span = Math.max(0, maxStart - transientSkip);
  const count = span > 0 ? Math.min(5, Math.max(1, Math.floor(span / Math.max(1, Math.floor(win / 2))) + 1)) : 1;

  const hits: YinFrame[] = [];
  let bestClarity = 0;
  for (let k = 0; k < count; k++) {
    const offset = count === 1 ? transientSkip : Math.round(transientSkip + (span * k) / (count - 1));
    const r = yinWindow(mono, offset, win, minLag, maxLag, sr);
    if (!r) continue;
    if (r.clarity > bestClarity) bestClarity = r.clarity;
    if (r.clarity >= MIN_CLARITY) hits.push(r);
  }
  if (hits.length === 0) return { hz: null, clarity: bestClarity, midi: null, cents: 0 };

  const sortedHz = hits.map((h) => h.hz).sort((a, b) => a - b);
  const mid = Math.floor(sortedHz.length / 2);
  const hz = sortedHz.length % 2 === 1 ? (sortedHz[mid] ?? 0) : ((sortedHz[mid - 1] ?? 0) + (sortedHz[mid] ?? 0)) / 2;
  const clarity = hits.reduce((acc, h) => acc + h.clarity, 0) / hits.length;
  const exactMidi = hzToMidi(hz);
  const midi = clamp(Math.round(exactMidi), 0, 127);
  const cents = (exactMidi - midi) * 100;
  return { hz, clarity, midi, cents };
}

function sinc(x: number): number {
  if (Math.abs(x) < 1e-8) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczos(x: number, a: number): number {
  const ax = Math.abs(x);
  if (ax >= a) return 0;
  return sinc(x) * sinc(x / a);
}

/**
 * Resamples `wav` to `targetSampleRate` and optionally shifts pitch by `pitchRatio` (where
 * `pitchRatio = targetHz / sourceHz`) in a single deterministic windowed-sinc (Lanczos-3) pass.
 */
export function resampleWav(wav: WavData, targetSampleRate: number, pitchRatio = 1): WavData {
  const targetSr = clamp(Math.round(targetSampleRate), 8000, 192000);
  const ratio = Number.isFinite(pitchRatio) && pitchRatio > 0 ? clamp(pitchRatio, MIN_PITCH_RATIO, MAX_PITCH_RATIO) : 1;
  const inFrames = wav.channels[0]?.length ?? 0;
  if (inFrames === 0) return { sampleRate: targetSr, channels: wav.channels.map(() => new Float32Array(0)) };
  if (wav.sampleRate === targetSr && Math.abs(ratio - 1) < 1e-7) {
    return { sampleRate: targetSr, channels: wav.channels.map((ch) => new Float32Array(ch)) };
  }

  const step = (ratio * wav.sampleRate) / targetSr;
  const outFrames = Math.max(1, Math.round(inFrames / step));
  // When downsampling / pitching up (step > 1), scale the sinc cutoff by 1/step to prevent aliasing.
  const filterScale = step > 1 ? 1 / step : 1;
  const radius = Math.ceil(LANCZOS_A / filterScale);

  const channels = wav.channels.map((ch) => {
    const out = new Float32Array(outFrames);
    for (let j = 0; j < outFrames; j++) {
      const center = j * step;
      const i0 = Math.max(0, Math.floor(center - radius));
      const i1 = Math.min(inFrames - 1, Math.ceil(center + radius));
      let acc = 0;
      let wSum = 0;
      for (let i = i0; i <= i1; i++) {
        const w = lanczos((center - i) * filterScale, LANCZOS_A);
        acc += (ch[i] ?? 0) * w;
        wSum += w;
      }
      out[j] = wSum > 1e-12 ? acc / wSum : (ch[Math.min(inFrames - 1, Math.round(center))] ?? 0);
    }
    return out;
  });

  return { sampleRate: targetSr, channels };
}

/**
 * Calibrates an imported audio clip for musical use: normalises level/DC/lead-in, detects pitch,
 * retunes pitched clips to concert pitch (A4 = 440 Hz), and resamples to `targetSampleRate` in a
 * single deterministic pass.
 */
export function calibrateClip(wav: WavData, opts: CalibrateOptions = {}): CalibratedClip {
  const targetSampleRate = clamp(Math.round(opts.targetSampleRate ?? DEFAULT_CLIP_SAMPLE_RATE), 8000, 192000);
  const prepared = opts.normalize === false ? wav : normalize(wav);
  const pitch = detectPitch(prepared);
  const kind: SampleKind = opts.kind ?? (pitch.hz !== null || opts.targetRoot !== undefined ? 'note' : 'impulse');

  let root: number | null = null;
  let pitchRatio = 1;
  let retuneCents = 0;

  if (pitch.hz !== null && opts.retune !== false) {
    const targetMidi =
      opts.targetRoot !== undefined && Number.isFinite(opts.targetRoot)
        ? clamp(Math.round(opts.targetRoot), 0, 127)
        : (pitch.midi ?? 60);
    const targetHz = midiToHz(targetMidi);
    pitchRatio = clamp(targetHz / pitch.hz, MIN_PITCH_RATIO, MAX_PITCH_RATIO);
    retuneCents = 1200 * Math.log2(pitchRatio);
    root = targetMidi;
  } else if (opts.targetRoot !== undefined && Number.isFinite(opts.targetRoot)) {
    root = clamp(Math.round(opts.targetRoot), 0, 127);
  } else if (kind === 'note') {
    root = 60;
  }

  const resampled = resampleWav(prepared, targetSampleRate, pitchRatio);
  const resampleRatio = targetSampleRate / wav.sampleRate / pitchRatio;

  return {
    wav: resampled,
    calibration: {
      sourceSampleRate: wav.sampleRate,
      sampleRate: resampled.sampleRate,
      detectedHz: pitch.hz,
      clarity: pitch.clarity,
      root,
      retuneCents,
      resampleRatio,
      kind,
    },
  };
}
