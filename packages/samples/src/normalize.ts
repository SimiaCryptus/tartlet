// The sample standard (docs/samples.md Part 2, TS-92): peak at -1 dBFS, no DC, no leading
// silence, length caps. The importer enforces it; hosts normalise files that break it.
import type { WavData } from './wav';

export type SampleKind = 'impulse' | 'note';

/** -1 dBFS as a linear peak. */
export const PEAK_TARGET = 10 ** (-1 / 20);
/** -60 dBFS: quieter leading frames count as silence. */
export const SILENCE = 0.001;
const PEAK_TOLERANCE_DB = 0.5;
const DC_TOLERANCE = 0.005;
const MAX_LEAD_SECONDS = 0.001;
export const MAX_SAMPLE_SECONDS: Readonly<Record<SampleKind, number>> = { impulse: 30, note: 120 };

export interface Measure {
  readonly peak: number;
  /** The largest absolute channel mean. */
  readonly dc: number;
  /** Seconds of leading silence. */
  readonly leadIn: number;
  readonly seconds: number;
}

function frameCount(w: WavData): number {
  return w.channels[0]?.length ?? 0;
}

export function measure(w: WavData): Measure {
  const frames = frameCount(w);
  let peak = 0;
  let dc = 0;
  for (const ch of w.channels) {
    let sum = 0;
    for (const v of ch) {
      sum += v;
      peak = Math.max(peak, Math.abs(v));
    }
    if (frames > 0) dc = Math.max(dc, Math.abs(sum / frames));
  }
  let lead = 0;
  while (lead < frames && w.channels.every((ch) => Math.abs(ch[lead] ?? 0) < SILENCE)) lead++;
  return { peak, dc, leadIn: lead / w.sampleRate, seconds: frames / w.sampleRate };
}

/** Plain-language deviations from the standard; empty when the file follows it. */
export function standardIssues(w: WavData, kind: SampleKind): string[] {
  const m = measure(w);
  const out: string[] = [];
  if (m.peak === 0) out.push('it is silent');
  else {
    const db = 20 * Math.log10(m.peak / PEAK_TARGET);
    if (Math.abs(db) > PEAK_TOLERANCE_DB) out.push(`its peak is ${db.toFixed(1)} dB away from -1 dBFS`);
    if (m.leadIn > MAX_LEAD_SECONDS) out.push(`it starts with ${(m.leadIn * 1000).toFixed(0)} ms of silence`);
  }
  if (m.dc > DC_TOLERANCE) out.push('it has a DC offset');
  if (m.seconds > MAX_SAMPLE_SECONDS[kind]) {
    out.push(`it is longer than ${String(MAX_SAMPLE_SECONDS[kind])} s`);
  }
  return out;
}

/** Removes DC, trims leading silence and scales the peak to -1 dBFS. Deterministic. */
export function normalize(w: WavData): WavData {
  const frames = frameCount(w);
  const centred = w.channels.map((ch) => {
    let sum = 0;
    for (const v of ch) sum += v;
    const mean = frames > 0 ? sum / frames : 0;
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = (ch[i] ?? 0) - mean;
    return out;
  });
  let lead = 0;
  while (lead < frames && centred.every((ch) => Math.abs(ch[lead] ?? 0) < SILENCE)) lead++;
  let peak = 0;
  for (const ch of centred) for (let i = lead; i < frames; i++) peak = Math.max(peak, Math.abs(ch[i] ?? 0));
  const g = peak > 0 ? PEAK_TARGET / peak : 1;
  const len = Math.max(0, frames - lead);
  const channels = centred.map((ch) => {
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = (ch[i + lead] ?? 0) * g;
    return out;
  });
  return { sampleRate: w.sampleRate, channels };
}
