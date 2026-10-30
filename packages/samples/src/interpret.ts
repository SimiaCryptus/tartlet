// Impulse and note interpreters (docs/samples.md Part 4, TS-93). Pure functions from controls
// to a playback plan; the audio adapter only executes plans.

export interface Zone {
  readonly root: number;
  readonly lo: number;
  readonly hi: number;
  readonly vlo: number;
  readonly vhi: number;
}

export interface SamplePlan {
  /** Index of the take to play. */
  readonly take: number;
  /** Playback rate. */
  readonly rate: number;
}

/** Note samples transpose at most this many semitones from their root. */
export const MAX_TRANSPOSE = 24;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** `speed` as a rate: its magnitude, within 1/8 to 8 (negative speeds are not reversed yet). */
export function speedRate(speed: number | undefined): number {
  const s = speed !== undefined && Number.isFinite(speed) ? Math.abs(speed) : 1;
  return clamp(s, 0.125, 8);
}

/** One-shots: take `n` modulo the number of takes, at the `speed` rate (§4.1). */
export function planImpulse(count: number, input: { readonly n?: number; readonly speed?: number }): SamplePlan {
  const k = Math.max(1, Math.floor(count));
  const n = input.n !== undefined && Number.isFinite(input.n) ? Math.floor(input.n) : 0;
  return { take: ((n % k) + k) % k, rate: speedRate(input.speed) };
}

/**
 * Pitched samples (§4.2): the takes whose zone holds the note and velocity, or else the takes
 * with the nearest root (ties go to the lower root). A seeded draw picks among several.
 */
export function planNote(
  zones: readonly Zone[],
  input: { readonly note?: number; readonly velocity?: number; readonly speed?: number; readonly rseed?: number },
): SamplePlan | null {
  const first = zones[0];
  if (!first) return null;
  const note = input.note !== undefined && Number.isFinite(input.note) ? input.note : first.root;
  const vel = clamp(input.velocity !== undefined && Number.isFinite(input.velocity) ? input.velocity : 1, 0, 1);
  let group = zones.flatMap((z, i) => (z.lo <= note && note <= z.hi && z.vlo <= vel && vel <= z.vhi ? [i] : []));
  if (group.length === 0) {
    let best = first.root;
    for (const z of zones) {
      const d = Math.abs(z.root - note);
      const bd = Math.abs(best - note);
      if (d < bd || (d === bd && z.root < best)) best = z.root;
    }
    group = zones.flatMap((z, i) => (z.root === best ? [i] : []));
  }
  const u = clamp(input.rseed !== undefined && Number.isFinite(input.rseed) ? input.rseed : 0, 0, 1);
  const pick = group[Math.min(group.length - 1, Math.floor(u * group.length))] ?? 0;
  const root = zones[pick]?.root ?? first.root;
  const semis = clamp(note - root, -MAX_TRANSPOSE, MAX_TRANSPOSE);
  return { take: pick, rate: 2 ** (semis / 12) * speedRate(input.speed) };
}

/** General MIDI percussion notes to drum names, for banks that declare `gm: true`. */
export const GM_DRUMS: ReadonlyMap<number, string> = new Map([
  [35, 'kick'],
  [36, 'kick'],
  [37, 'rim'],
  [38, 'snare'],
  [39, 'clap'],
  [40, 'snare'],
  [41, 'tom'],
  [42, 'hat'],
  [43, 'tom'],
  [44, 'hat'],
  [45, 'tom'],
  [46, 'openhat'],
  [47, 'tom'],
  [48, 'tom'],
  [49, 'crash'],
  [50, 'tom'],
  [51, 'ride'],
  [57, 'crash'],
  [59, 'ride'],
]);
