// Resource resolution (idea.md §11.2). This is the package stage: built-in oscillators, the
// synthesized general kit, and the fallback mapper. Nothing here fetches.

export type Resolution =
  | { readonly status: 'ok'; readonly name: string }
  | { readonly status: 'fallback'; readonly name: string; readonly to: string }
  | { readonly status: 'missing'; readonly name: string };

export interface KitEntry {
  readonly name: string;
  readonly kind: 'drum' | 'oscillator' | 'noise' | 'voice' | 'ambience' | 'foley' | 'creature';
  readonly license: 'Apache-2.0';
  readonly provenance: string;
}

export const OSCILLATORS: readonly string[] = ['sine', 'square', 'triangle', 'sawtooth'];
export const DRUMS: readonly string[] = ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd'];
/** Noise sources (TS-42). */
export const NOISES: readonly string[] = ['white', 'pink', 'brown'];
/** Vocal model sounds (TS-43). */
export const VOICES: readonly string[] = ['voice', 'aah', 'ooh', 'hum', 'whisper', 'choir'];
/** Procedural ambiences (TS-73). */
export const AMBIENCES: readonly string[] = ['rain', 'wind', 'fire', 'stream', 'surf', 'crowd'];
/** Foley one-shots (TS-74). */
export const FOLEY: readonly string[] = ['drip', 'click', 'tick', 'creak', 'step'];
/** Creature and machine models (TS-76). */
export const CREATURES: readonly string[] = ['bird', 'insect', 'engine'];

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
  ...AMBIENCES.map((name): KitEntry => ({
    name,
    kind: 'ambience',
    license: 'Apache-2.0',
    provenance: 'filtered fixed-seed noise and seeded micro-events synthesized in @tartlet/webaudio',
  })),
  ...FOLEY.map((name): KitEntry => ({
    name,
    kind: 'foley',
    license: 'Apache-2.0',
    provenance: 'synthesized in @tartlet/webaudio',
  })),
  ...CREATURES.map((name): KitEntry => ({
    name,
    kind: 'creature',
    license: 'Apache-2.0',
    provenance: 'FM, noise-band and pulse-train models synthesized in @tartlet/webaudio',
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
  ['chatter', 'crowd'],
  ['people', 'crowd'],
  ['ocean', 'surf'],
  ['waves', 'surf'],
  ['sea', 'surf'],
  ['river', 'stream'],
  ['brook', 'stream'],
  ['water', 'stream'],
  ['storm', 'rain'],
  ['breeze', 'wind'],
  ['campfire', 'fire'],
  ['crackle', 'fire'],
  ['footstep', 'step'],
  ['footsteps', 'step'],
  ['clock', 'tick'],
  ['door', 'creak'],
  ['drop', 'drip'],
  ['clicks', 'click'],
  ['birdsong', 'bird'],
  ['chirp', 'bird'],
  ['cricket', 'insect'],
  ['cicada', 'insect'],
  ['motor', 'engine'],
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
  [/perc|wood|block/, 'rim'],
  [/click/, 'click'],
  [/piano|keys|rhodes|organ|pluck|bell|marimba|vibe|harp/, 'triangle'],
  [/choir/, 'choir'],
  [/whisper/, 'whisper'],
  [/vox|vocal|voice|sing/, 'voice'],
  [/bass|pad|string|lead|brass/, 'sawtooth'],
  [/sine|sub/, 'sine'],
  [/square|chip/, 'square'],
  [/rain|storm|drizzle/, 'rain'],
  [/wind|breeze|gust/, 'wind'],
  [/fire|crackl|flame/, 'fire'],
  [/stream|river|brook|creek|water/, 'stream'],
  [/crowd|murmur|people/, 'crowd'],
  [/bird|chirp|tweet|gull/, 'bird'],
  [/surf|wave|ocean|sea|beach|tide/, 'surf'],
  [/insect|cricket|cicada|bug/, 'insect'],
  [/engine|motor|truck/, 'engine'],
  [/drip|drop/, 'drip'],
  [/step|foot/, 'step'],
  [/tick|clock/, 'tick'],
  [/creak|door|squeak/, 'creak'],
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
