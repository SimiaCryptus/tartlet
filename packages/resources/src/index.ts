// Resource resolution (idea.md §11.2). This is the package stage: built-in oscillators, the
// synthesized general kit, and the fallback mapper. Nothing here fetches.

export type Resolution =
  | { readonly status: 'ok'; readonly name: string }
  | { readonly status: 'fallback'; readonly name: string; readonly to: string }
  | { readonly status: 'missing'; readonly name: string };

export interface KitEntry {
  readonly name: string;
  readonly kind: 'drum' | 'oscillator' | 'noise' | 'voice';
  readonly license: 'Apache-2.0';
  readonly provenance: string;
}

export const OSCILLATORS: readonly string[] = ['sine', 'square', 'triangle', 'sawtooth'];
export const DRUMS: readonly string[] = ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd'];
/** Noise sources (TS-42). */
export const NOISES: readonly string[] = ['white', 'pink', 'brown'];
/** Vocal model sounds (TS-43). */
export const VOICES: readonly string[] = ['voice', 'aah', 'ooh', 'hum', 'whisper', 'choir'];

/** License manifest for the general kit. Every sound is procedurally synthesized (TS-38). */
export const GENERAL_KIT: readonly KitEntry[] = [
  ...DRUMS.map((name): KitEntry => ({
    name,
    kind: 'drum',
    license: 'Apache-2.0',
    provenance: 'synthesized in @tartlet/webaudio',
  })),
  ...OSCILLATORS.map((name): KitEntry => ({
    name,
    kind: 'oscillator',
    license: 'Apache-2.0',
    provenance: 'Web Audio oscillator',
  })),
  ...NOISES.map((name): KitEntry => ({
    name,
    kind: 'noise',
    license: 'Apache-2.0',
    provenance: 'generated deterministically in @tartlet/webaudio',
  })),
  ...VOICES.map((name): KitEntry => ({
    name,
    kind: 'voice',
    license: 'Apache-2.0',
    provenance: 'glottal source and formant filters synthesized in @tartlet/webaudio',
  })),
];

const ALIASES = new Map<string, string>([
  ['kick', 'bd'],
  ['bassdrum', 'bd'],
  ['808', 'bd'],
  ['808bd', 'bd'],
  ['909', 'bd'],
  ['909bd', 'bd'],
  ['snare', 'sd'],
  ['sn', 'sd'],
  ['808sd', 'sd'],
  ['909sd', 'sd'],
  ['hihat', 'hh'],
  ['hat', 'hh'],
  ['ch', 'hh'],
  ['hc', 'hh'],
  ['808hc', 'hh'],
  ['808ch', 'hh'],
  ['openhat', 'oh'],
  ['808oh', 'oh'],
  ['ho', 'oh'],
  ['clap', 'cp'],
  ['handclap', 'cp'],
  ['808cp', 'cp'],
  ['realclaps', 'cp'],
  ['rimshot', 'rim'],
  ['rs', 'rim'],
  ['808rs', 'rim'],
  ['tom', 'mt'],
  ['808lt', 'lt'],
  ['808mt', 'mt'],
  ['808ht', 'ht'],
  ['crash', 'cr'],
  ['ride', 'rd'],
  ['piano', 'triangle'],
  ['superpiano', 'triangle'],
  ['rhodes', 'triangle'],
  ['epiano', 'triangle'],
  ['keys', 'triangle'],
  ['casio', 'square'],
  ['arpy', 'triangle'],
  ['pluck', 'triangle'],
  ['gm_acoustic_grand_piano', 'triangle'],
  ['bass', 'sawtooth'],
  ['synthbass', 'sawtooth'],
  ['pad', 'sawtooth'],
  ['supersaw', 'sawtooth'],
  ['saw', 'sawtooth'],
  ['tri', 'triangle'],
  ['sin', 'sine'],
  ['sqr', 'square'],
  ['pulse', 'square'],
  ['noise', 'white'],
  ['whitenoise', 'white'],
  ['pinknoise', 'pink'],
  ['brownnoise', 'brown'],
  ['hiss', 'white'],
  ['vox', 'voice'],
  ['vocal', 'voice'],
  ['vocals', 'voice'],
  ['singer', 'voice'],
  ['chorus', 'choir'],
  ['whisp', 'whisper'],
]);

const HEURISTICS: readonly (readonly [RegExp, string])[] = [
  [/kick|bd/, 'bd'],
  [/snare|sd/, 'sd'],
  [/open.?hat|oh/, 'oh'],
  [/hat|hh/, 'hh'],
  [/clap|cp/, 'cp'],
  [/rim/, 'rim'],
  [/crash/, 'cr'],
  [/ride/, 'rd'],
  [/tom/, 'mt'],
  [/perc|wood|block|click/, 'rim'],
  [/piano|keys|rhodes|organ|pluck|bell|marimba|vibe|harp/, 'triangle'],
  [/choir/, 'choir'],
  [/whisper/, 'whisper'],
  [/vox|vocal|voice|sing/, 'voice'],
  [/bass|pad|string|lead|brass/, 'sawtooth'],
  [/sine|sub/, 'sine'],
  [/square|chip/, 'square'],
  [/pink/, 'pink'],
  [/brown|rumble/, 'brown'],
  [/noise|hiss|static/, 'white'],
];

export interface SoundCatalog {
  resolve(name: string): Resolution;
  list(): readonly string[];
}

/** The package and fallback stages. With `fallback: false`, unknown names are missing (Q-05). */
export function createCatalog(
  opts: { fallback?: boolean; extra?: Iterable<string> } = Object.create(null) as object,
): SoundCatalog {
  const known = new Set<string>([...GENERAL_KIT.map((k) => k.name), ...(opts.extra ?? [])]);
  const fallback = opts.fallback !== false;
  return {
    resolve(name) {
      if (known.has(name)) return { status: 'ok', name };
      if (!fallback) return { status: 'missing', name };
      const lower = name.toLowerCase();
      const alias = ALIASES.get(lower);
      if (alias) return { status: 'fallback', name, to: alias };
      for (const [re, to] of HEURISTICS) if (re.test(lower)) return { status: 'fallback', name, to };
      return { status: 'missing', name };
    },
    list: () => [...known],
  };
}

const DEFAULT = createCatalog();

export function resolveSound(name: string): Resolution {
  return DEFAULT.resolve(name);
}
