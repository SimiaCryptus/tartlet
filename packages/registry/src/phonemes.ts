// The singing alphabet (TS-45): a closed, hand-written ASCII phoneme grammar for sung syllables.
// It is phonetic, not spelling, and it is never passed to any host speech API.

/** Canonical vowel names. They match the formant tables in @tartlet/webaudio. */
export const VOWELS: readonly string[] = [
  'a',
  'e',
  'i',
  'o',
  'u',
  'ae',
  'ah',
  'aw',
  'eh',
  'er',
  'ih',
  'oh',
  'oo',
  'uh',
];
/** Common spellings read as a canonical vowel. */
const VOWEL_ALIASES: ReadonlyMap<string, string> = new Map([
  ['ee', 'i'],
  ['ou', 'oo'],
  ['ue', 'oo'],
  ['ai', 'e'],
  ['oa', 'oh'],
]);
export const CONSONANTS: readonly string[] = [
  'p',
  't',
  'k',
  'b',
  'd',
  'g',
  'f',
  's',
  'sh',
  'h',
  'v',
  'z',
  'th',
  'm',
  'n',
  'ng',
  'l',
  'r',
  'w',
  'y',
];
export const VOICE_TYPES: readonly string[] = ['bass', 'tenor', 'alto', 'soprano', 'child'];
/** Sound names rendered by the vocal model (TS-43). */
export const VOCAL_SOUNDS: readonly string[] = ['voice', 'aah', 'ooh', 'hum', 'whisper', 'choir'];
export const MAX_SYLLABLE_LENGTH = 16;

const MAX_CLUSTER = 2;
const VOWEL_SET: ReadonlySet<string> = new Set(VOWELS);
const CONSONANT_SET: ReadonlySet<string> = new Set(CONSONANTS);
const LETTERS = /^[a-z_]+$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

export interface Syllable {
  /** A lone `_`: keep singing the previous vowel. */
  readonly hold: boolean;
  readonly onset: readonly string[];
  /** One vowel, or several joined by `_` and glided across the note. */
  readonly vowels: readonly string[];
  readonly coda: readonly string[];
}

/** The canonical vowel for a name or alias, or undefined. */
export function normalizeVowel(text: string): string | undefined {
  const v = text.toLowerCase();
  return VOWEL_SET.has(v) ? v : VOWEL_ALIASES.get(v);
}

interface Phoneme {
  readonly vowel: boolean;
  readonly p: string;
}

/** Greedy, longest-match tokenisation. Returns null on any symbol outside the alphabet. */
function phonemes(seg: string): Phoneme[] | null {
  const out: Phoneme[] = [];
  let i = 0;
  while (i < seg.length) {
    const two = seg.slice(i, i + 2);
    if (two.length === 2) {
      const v = normalizeVowel(two);
      if (v !== undefined) {
        out.push({ vowel: true, p: v });
        i += 2;
        continue;
      }
      if (CONSONANT_SET.has(two)) {
        out.push({ vowel: false, p: two });
        i += 2;
        continue;
      }
    }
    const one = seg.charAt(i);
    if (VOWEL_SET.has(one)) out.push({ vowel: true, p: one });
    else if (CONSONANT_SET.has(one)) out.push({ vowel: false, p: one });
    else return null;
    i++;
  }
  return out;
}

function segment(seg: string): { onset: string[]; vowel: string; coda: string[] } | null {
  const ps = phonemes(seg);
  if (!ps) return null;
  const vi = ps.findIndex((p) => p.vowel);
  if (vi < 0 || ps.slice(vi + 1).some((p) => p.vowel)) return null;
  const vowel = ps[vi]?.p;
  if (vowel === undefined) return null;
  const onset = ps.slice(0, vi).map((p) => p.p);
  const coda = ps.slice(vi + 1).map((p) => p.p);
  if (onset.length > MAX_CLUSTER || coda.length > MAX_CLUSTER) return null;
  return { onset, vowel, coda };
}

/**
 * syllable := onset? vowel ('_' vowel)* coda?, with at most two consonants per cluster.
 * Returns null when the text is not in the singing alphabet.
 */
export function parseSyllable(text: string): Syllable | null {
  const s = text.toLowerCase();
  if (s.length === 0 || s.length > MAX_SYLLABLE_LENGTH || !LETTERS.test(s)) return null;
  if (s === '_') return { hold: true, onset: [], vowels: [], coda: [] };
  const segs = s.split('_');
  let onset: readonly string[] = [];
  let coda: readonly string[] = [];
  const vowels: string[] = [];
  for (const [i, seg] of segs.entries()) {
    const p = segment(seg);
    if (!p) return null;
    const last = i === segs.length - 1;
    if ((i > 0 && p.onset.length > 0) || (!last && p.coda.length > 0)) return null;
    if (i === 0) onset = p.onset;
    if (last) coda = p.coda;
    vowels.push(p.vowel);
  }
  return { hold: false, onset, vowels, coda };
}

/** A valid syllable one deletion or substitution away, if there is one. */
export function suggestSyllable(text: string): string | undefined {
  const s = text.toLowerCase();
  if (s.length === 0 || s.length > MAX_SYLLABLE_LENGTH + 1) return undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s.slice(0, i) + s.slice(i + 1);
    if (c.length > 0 && parseSyllable(c) !== null) return c;
  }
  for (let i = 0; i < s.length; i++) {
    for (const ch of ALPHABET) {
      const c = s.slice(0, i) + ch + s.slice(i + 1);
      if (parseSyllable(c) !== null) return c;
    }
  }
  return undefined;
}
