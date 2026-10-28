// Music-theory facts: pitch classes and scale interval sets.

const PITCH_CLASS = new Map<string, number>([
  ['c', 0],
  ['d', 2],
  ['e', 4],
  ['f', 5],
  ['g', 7],
  ['a', 9],
  ['b', 11],
]);
// eslint-disable-next-line security/detect-unsafe-regex -- anchored, no nested repetition: linear time
const NOTE = /^([a-gA-G])([#sbf]*)(-?\d+)?$/;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;

/** Note name or number to MIDI. A bare letter means octave 3, so c3 = 48. Returns null if invalid. */
export function noteToMidi(text: string): number | null {
  if (NUMBER.test(text)) return Number(text);
  const m = NOTE.exec(text);
  if (!m) return null;
  const pc = PITCH_CLASS.get((m[1] ?? '').toLowerCase());
  if (pc === undefined) return null;
  let acc = 0;
  for (const ch of m[2] ?? '') acc += ch === '#' || ch === 's' ? 1 : -1;
  const octave = m[3] === undefined ? 3 : Number(m[3]);
  return 12 * (octave + 1) + pc + acc;
}

export const SCALES: ReadonlyMap<string, readonly number[]> = new Map<string, readonly number[]>([
  ['major', [0, 2, 4, 5, 7, 9, 11]],
  ['ionian', [0, 2, 4, 5, 7, 9, 11]],
  ['minor', [0, 2, 3, 5, 7, 8, 10]],
  ['aeolian', [0, 2, 3, 5, 7, 8, 10]],
  ['dorian', [0, 2, 3, 5, 7, 9, 10]],
  ['phrygian', [0, 1, 3, 5, 7, 8, 10]],
  ['lydian', [0, 2, 4, 6, 7, 9, 11]],
  ['mixolydian', [0, 2, 4, 5, 7, 9, 10]],
  ['locrian', [0, 1, 3, 5, 6, 8, 10]],
  ['harmonic minor', [0, 2, 3, 5, 7, 8, 11]],
  ['melodic minor', [0, 2, 3, 5, 7, 9, 11]],
  ['major pentatonic', [0, 2, 4, 7, 9]],
  ['minor pentatonic', [0, 3, 5, 7, 10]],
  ['blues', [0, 3, 5, 6, 7, 10]],
  ['chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
]);

/** "D:minor" gives { root: 50, intervals } (TS-11: a bare root is octave 3). */
export function parseScale(spec: string): { root: number; intervals: readonly number[] } | null {
  const [rootText = '', ...rest] = spec.trim().split(':');
  const root = noteToMidi(rootText);
  const intervals = SCALES.get(rest.join(' ').toLowerCase());
  return root === null || !intervals ? null : { root, intervals };
}

export function degreeToMidi(degree: number, scale: { root: number; intervals: readonly number[] }): number {
  const len = scale.intervals.length;
  const d = Math.floor(degree);
  const octave = Math.floor(d / len);
  const idx = d - octave * len;
  return scale.root + (scale.intervals[idx] ?? 0) + 12 * octave;
}
