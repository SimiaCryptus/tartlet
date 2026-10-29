// Documentation and vocabulary for the Tartlet language, used by the code editor's completion and
// hover tooltips. Names come from Tartlet's registry, so completion never offers something that does
// not exist; the curated table below adds signatures and plain-language descriptions.
import {
  AMBIENCE_SOUNDS,
  CREATURE_SOUNDS,
  DRUM_SOUNDS,
  FOLEY_SOUNDS,
  NOISE_SOUNDS,
  OSCILLATOR_SOUNDS,
  SCALES,
  SPACE_NAMES,
  VOCAL_SOUNDS,
  VOWELS,
  defaultRegistry,
} from '@tartlet/registry';

export type DocKind = 'signal' | 'control' | 'transform' | 'tonal' | 'combinator' | 'keyword' | 'other';

export interface SymbolDoc {
  readonly name: string;
  readonly kind: DocKind;
  readonly signature: string;
  readonly doc: string;
  readonly aliases: readonly string[];
  /** Short label shown next to completions. */
  readonly detail: string;
}

export interface SoundDoc {
  readonly name: string;
  readonly group: string;
  readonly doc: string;
}

/** [signature, description, kind for names that may not be in the registry] */
type Curated = readonly [string, string, DocKind?];

const CURATED: Partial<Record<string, Curated>> = {
  // ---- program shape and starters
  setcpm: [
    'setcpm(bpm / 4)',
    'Sets the tempo in cycles per minute. setcpm(120/4) makes one cycle a 4/4 bar at 120 BPM. Put it on the first line.',
    'other',
  ],
  setcps: ['setcps(cps)', 'Sets the tempo in cycles per second.', 'other'],
  const: [
    'const name = pattern',
    'Binds a pattern or a function to a name. Declare it before use; names must not reuse built-ins. Functions: const f = (x, n = 2) => x.ply(n).',
    'keyword',
  ],
  return: ['x => { return x.fast(2); }', 'The only statement allowed inside a block body.', 'keyword'],
  s: [
    's("bd sd")',
    'Plays sounds by name: drums, synths (sine, sawtooth…), noise, voices, ambiences and foley. As a method, .s("sawtooth") picks the sound of pitched events.',
  ],
  sound: ['sound("bd sd")', 'Same as s(): plays sounds by name.'],
  note: [
    'note("c3 e3 g3")',
    'Plays pitches: note names with # or b and an octave (c3 = MIDI 48; a bare letter is octave 3), or MIDI numbers.',
  ],
  n: ['n("0 2 4")', 'Numbers, usually scale degrees: n("0 2 4").scale("D:minor"). On drums it picks a variant.'],
  freq: ['freq("220 330")', 'Plays pitches given in hertz.'],
  stack: ['stack(a, b, …)', 'Plays patterns at the same time.', 'combinator'],
  cat: ['cat(a, b, …)', 'Plays one pattern per cycle, in turn.', 'combinator'],
  seq: ['seq(a, b, …)', 'Squeezes all the patterns into one cycle, one after another.', 'combinator'],
  run: ['run(n)', 'Counts 0 to n-1 across the cycle: n(run(8)).', 'combinator'],
  silence: ['silence', 'An empty pattern.', 'combinator'],
  // ---- signals
  sine: ['sine', 'A sine wave from 0 to 1, one period per cycle. Shape it with .range(lo, hi) and .slow(n).', 'signal'],
  cosine: ['cosine', 'A cosine wave from 0 to 1 (a sine a quarter cycle ahead).', 'signal'],
  saw: ['saw', 'A ramp rising from 0 to 1 each cycle.', 'signal'],
  isaw: ['isaw', 'A ramp falling from 1 to 0 each cycle.', 'signal'],
  tri: ['tri', 'A triangle wave from 0 to 1 and back each cycle.', 'signal'],
  square: ['square', 'A square wave: 0 for half the cycle, 1 for the other half.', 'signal'],
  rand: ['rand', 'A seeded random value from 0 to 1 at each event.', 'signal'],
  perlin: ['perlin', 'Smooth seeded noise from 0 to 1.', 'signal'],
  irand: ['irand(n)', 'Seeded random whole numbers below n. Use .segment(n) to sample it in steps.', 'signal'],
  // ---- time and structure
  fast: ['.fast(factor)', 'Speeds the pattern up. The factor may be a pattern: .fast("<1 2>").'],
  slow: ['.slow(factor)', 'Slows the pattern down: .slow(2) spreads one cycle over two.'],
  rev: ['.rev()', 'Reverses each cycle. Also usable as a value: .every(4, rev).'],
  palindrome: ['.palindrome()', 'Plays forwards, then backwards on alternate cycles.'],
  late: ['.late(cycles)', 'Shifts the pattern later, in cycles: .late(1/8).'],
  early: ['.early(cycles)', 'Shifts the pattern earlier, in cycles: .early(1/8).'],
  every: ['.every(n, f)', 'Applies f once every n cycles. n must be a constant number.'],
  lastOf: ['.lastOf(n, f)', 'Applies f on the last cycle of every n. n must be a constant.'],
  off: ['.off(time, f)', 'Layers a copy shifted by time and changed by f: .off(1/8, x => x.add(12)).'],
  jux: ['.jux(f)', 'Plays the pattern on the left and f applied to it on the right.'],
  ply: ['.ply(n)', 'Repeats each event n times within its step.'],
  struct: ['.struct("x ~ x x")', 'Borrows a rhythm: plays the values on the x steps.'],
  mask: ['.mask("1 0")', 'Silences the parts of each cycle where the mask is 0 or ~.'],
  euclid: ['.euclid(k, n, rotate?)', 'Keeps k hits spread evenly over n steps. Constant arguments.'],
  iter: ['.iter(n)', 'Starts each cycle one n-th further along.'],
  iterBack: ['.iterBack(n)', 'Like iter, but moving backwards.'],
  chunk: ['.chunk(n, f)', 'Applies f to one moving n-th of each cycle. n must be a constant.'],
  chunkBack: ['.chunkBack(n, f)', 'Like chunk, but the chunk moves backwards from the end.'],
  swing: ['.swing(n)', 'Delays every second of n subdivisions per cycle.'],
  swingBy: ['.swingBy(amount, n)', 'Swing with a chosen delay: .swingBy(1/3, 4).'],
  echo: ['.echo(times, time, feedback)', 'Adds fading repeats. Constant arguments.'],
  superimpose: ['.superimpose(f)', 'Plays the pattern together with f applied to it.'],
  within: [
    '.within(begin, end, f)',
    'Applies f only between begin and end of each cycle (0 to 1). Constant arguments.',
  ],
  zoom: ['.zoom(begin, end)', 'Stretches part of each cycle over the whole cycle.'],
  compress: ['.compress(begin, end)', 'Squeezes each cycle into begin..end, leaving silence around it.'],
  fastGap: ['.fastGap(factor)', 'Speeds up but keeps cycle boundaries, leaving a silent gap.'],
  linger: ['.linger(fraction)', 'Repeats the first fraction of each cycle to fill the cycle.'],
  brak: ['.brak()', 'Squashes every other cycle into a syncopated half.'],
  press: ['.press()', 'Pushes each event half-way into its step.'],
  hurry: ['.hurry(factor)', 'Speeds up and raises playback speed (pitch) together.'],
  apply: ['.apply(f, …args)', 'Hands the pattern to a function: .apply(stutter, 3).'],
  segment: ['.segment(n)', 'Samples a signal n times per cycle, turning it into steps. n must be a constant.'],
  range: ['.range(lo, hi)', 'Maps a 0–1 signal onto lo..hi. Constant arguments.'],
  label: ['.label("name")', 'Names a track for display.'],
  // ---- chance
  degrade: ['.degrade()', 'Drops half the events at random (seeded).'],
  degradeBy: ['.degradeBy(p)', 'Drops a share p of the events at random (seeded).'],
  undegradeBy: ['.undegradeBy(p)', 'The complement of degradeBy: keeps only the events degradeBy would drop.'],
  sometimes: ['.sometimes(f)', 'Applies f to about half the events (seeded).'],
  sometimesBy: ['.sometimesBy(p, f)', 'Applies f to a share p of the events. p must be a constant.'],
  often: ['.often(f)', 'Applies f to about 75% of the events.'],
  rarely: ['.rarely(f)', 'Applies f to about 25% of the events.'],
  almostNever: ['.almostNever(f)', 'Applies f to about 10% of the events.'],
  almostAlways: ['.almostAlways(f)', 'Applies f to about 90% of the events.'],
  someCycles: ['.someCycles(f)', 'Applies f to whole cycles, about half of them.'],
  someCyclesBy: ['.someCyclesBy(p, f)', 'Applies f to a share p of whole cycles.'],
  shuffle: ['.shuffle(n)', 'Plays the n slices of each cycle in a random order, each once.'],
  scramble: ['.scramble(n)', 'Picks n slices of each cycle at random, with repeats.'],
  seed: ['.seed("name")', 'Pins the random draws in the chain before it to a named take.'],
  // ---- arithmetic and pitch
  add: ['.add(n)', 'Adds to each value: scale degrees, notes or numbers.'],
  sub: ['.sub(n)', 'Subtracts from each value.'],
  mul: ['.mul(n)', 'Multiplies each value.'],
  div: ['.div(n)', 'Divides each value.'],
  mod: ['.mod(n)', 'Remainder after dividing by n.'],
  floor: ['.floor()', 'Rounds each value down.'],
  ceil: ['.ceil()', 'Rounds each value up.'],
  round: ['.round()', 'Rounds each value to the nearest whole number.'],
  toBipolar: ['.toBipolar()', 'Maps 0..1 onto -1..1.'],
  fromBipolar: ['.fromBipolar()', 'Maps -1..1 onto 0..1.'],
  scale: ['.scale("D:minor")', 'Maps numbers onto a scale, "Root:name". Needs pitched events (n, note or freq).'],
  transpose: ['.transpose(semitones)', 'Moves pitched events by semitones.'],
  octave: ['.octave(n)', 'Moves pitched events by n octaves.'],
  legato: ['.legato(amount)', 'Note length relative to its step: 1 fills it, .5 is half.'],
  accent: ['.accent("x ~ ~ x")', 'Makes the events on x steps louder.'],
  nudge: ['.nudge(seconds)', 'Shifts events in time by seconds (a hair behind or ahead of the beat).'],
  // ---- level, filters, envelope
  gain: ['.gain(level)', 'Volume. Keep it at or below 1 (0.3 to 0.6 for dense layers).'],
  velocity: ['.velocity(level)', 'How hard a note is played, 0 to 1.'],
  pan: ['.pan(position)', 'Stereo position: 0 left, .5 centre, 1 right.'],
  lpf: ['.lpf(hz)', 'Low-pass filter cutoff in hertz.'],
  hpf: ['.hpf(hz)', 'High-pass filter cutoff in hertz.'],
  lpq: ['.lpq(q)', 'Low-pass filter resonance.'],
  resonance: ['.resonance(q)', 'Filter resonance.'],
  attack: ['.attack(seconds)', 'Envelope attack time.'],
  decay: ['.decay(seconds)', 'Envelope decay time.'],
  sustain: ['.sustain(level)', 'Envelope sustain level, 0 to 1.'],
  release: ['.release(seconds)', 'Envelope release time.'],
  lpenv: ['.lpenv(depth)', 'Filter envelope depth: sweeps the low-pass cutoff on each note.'],
  lpattack: ['.lpattack(seconds)', 'Attack time of the filter envelope.'],
  lpdecay: ['.lpdecay(seconds)', 'Decay time of the filter envelope.'],
  // ---- effects and space
  room: ['.room(amount)', 'Reverb amount.'],
  size: ['.size(amount)', 'Reverb length.'],
  space: ['.space("hall")', 'Reverb character: room, hall, plate, church, outdoor…'],
  delay: ['.delay(amount)', 'Echo send level.'],
  delaytime: ['.delaytime(time)', 'Echo time: 3/8, .25 …'],
  delayfeedback: ['.delayfeedback(amount)', 'How much of each echo feeds the next.'],
  shape: ['.shape(amount)', 'Drive / waveshaping distortion.'],
  crush: ['.crush(bits)', 'Bit crusher: fewer bits sound rougher.'],
  vowel: ['.vowel("a")', 'Formant filter that makes a sound vowel-like.'],
  speed: ['.speed(rate)', 'Playback speed of drum and foley sounds.'],
  orbit: ['.orbit(n)', 'Effects bus for reverb and delay.'],
  // ---- synthesis
  fm: ['.fm(index)', 'Frequency modulation amount.'],
  fmh: ['.fmh(ratio)', 'Frequency modulation ratio (harmonicity).'],
  unison: ['.unison(voices)', 'Number of detuned copies.'],
  detune: ['.detune(amount)', 'Detune between unison copies.'],
  penv: ['.penv(semitones)', 'Pitch envelope depth.'],
  pdecay: ['.pdecay(seconds)', 'Pitch envelope decay.'],
  mono: ['.mono(1)', 'Monophonic: each note cuts the previous one.'],
  glide: ['.glide(seconds)', 'Portamento between notes in mono mode.'],
  timbre: ['.timbre("organ")', 'Named waveform: soft, bright, glass, hollow, reed, organ…'],
  pw: ['.pw(width)', 'Pulse width of a square wave, 0 to 1.'],
  vib: ['.vib(hz)', 'Vibrato rate.'],
  vibdepth: ['.vibdepth(semitones)', 'Vibrato depth.'],
  trem: ['.trem(hz)', 'Tremolo rate.'],
  tremdepth: ['.tremdepth(amount)', 'Tremolo depth.'],
  grain: ['.grain(ms)', 'Plays the sound as a cloud of grains of this length.'],
  gdensity: ['.gdensity(per second)', 'Grain density.'],
  gjitter: ['.gjitter(amount)', 'Random variation of grain timing.'],
  // ---- voices and ambiences
  syl: [
    '.syl("la li [lu _]")',
    'Sings phonetic syllables: up to two consonants, then a vowel; "_" holds the previous vowel.',
  ],
  voicetype: ['.voicetype("alto")', 'Voice type of a singing voice.'],
  vglide: ['.vglide(seconds)', 'Glide between sung notes.'],
  talk: ['.talk(amount)', 'Puts the syllable vowels on a synth (talk box).'],
  overtone: ['.overtone(n)', 'Adds an overtone whistle to a hum.'],
  intensity: ['.intensity(amount)', 'How strong an ambience is (rain, wind, fire…).'],
  density: ['.density(amount)', 'How busy an ambience is.'],
  // ---- placement and headphones
  azimuth: ['.azimuth(degrees)', 'Direction around your head: 0 ahead, 90 right, -90 left, 180 behind. Headphones.'],
  elevation: ['.elevation(degrees)', 'Height above or below ear level. Headphones.'],
  distance: ['.distance(amount)', 'How far away the sound is.'],
  posglide: ['.posglide(seconds)', 'Glide between positions.'],
  occlude: ['.occlude(amount)', 'Muffles the sound as if behind a wall.'],
  binaural: ['.binaural(hz)', 'Binaural beat: each ear is detuned by half the value. 3–30 Hz shows a safety warning.'],
  isochronic: ['.isochronic(hz)', 'Amplitude pulsing at this rate. 3–30 Hz shows a safety warning.'],
  isodepth: ['.isodepth(amount)', 'Depth of isochronic pulsing.'],
  itd: ['.itd(ms)', 'Interaural time difference: under ~0.7 ms moves the sound sideways, 1–30 ms widens it.'],
  ild: ['.ild(db)', 'Interaural level difference: makes the right ear louder (negative: left).'],
  iphase: ['.iphase(degrees)', 'Phase between the ears: 0 centred, 180 diffuse (nearly vanishes in mono).'],
  irate: ['.irate(turns per second)', 'Rotates the interaural phase continuously. 3–30 Hz shows a safety warning.'],
  icorr: ['.icorr(amount)', 'Correlation between the ears: 1 identical, near 0 unrelated (wide).'],
  earsh: ['.earsh(cents)', 'Raises the right ear and lowers the left by half the value each.'],
  earsplit: [
    '.earsplit("bands")',
    'Splits the sound between the ears: "bands" (lows / highs) or "harmonics" (alternate partials).',
  ],
  splitfreq: ['.splitfreq(hz)', 'Crossover frequency for earsplit("bands").'],
  earswap: ['.earswap("0 1")', 'Swaps the ears on steps marked 1.'],
  lcutoff: ['.lcutoff(hz)', 'Low-pass filter on the left ear only.'],
  rcutoff: ['.rcutoff(hz)', 'Low-pass filter on the right ear only.'],
  rhcutoff: ['.rhcutoff(hz)', 'High-pass filter on the right ear only.'],
  dichotic: [
    '.dichotic(hz)',
    'Phase-shifts one ear in a narrow band, so a faint pitch appears between the ears (Huggins pitch).',
  ],
  dichoticq: ['.dichoticq(q)', 'Width of the dichotic band.'],
};

const FALLBACK: Record<DocKind, string> = {
  signal:
    'A continuous signal from 0 to 1, sampled at each event. Shape it with .range(lo, hi), .slow(n) or .segment(n).',
  control: 'A control: sets a parameter on every event. Takes a number, a mini-notation string or a pattern.',
  transform: 'A transform: reshapes the pattern in time or structure.',
  tonal: 'A tonal transform: works on pitched events (note, n or freq).',
  combinator: 'A combinator: builds a pattern from other patterns.',
  keyword: 'A language keyword.',
  other: 'A Tartlet built-in.',
};

const KINDS = new Set<string>(['signal', 'control', 'transform', 'tonal', 'combinator']);

/** Names that start patterns or statements (suggested first at the start of a line). */
export const STARTERS: ReadonlySet<string> = new Set([
  's',
  'sound',
  'note',
  'n',
  'freq',
  'stack',
  'cat',
  'seq',
  'run',
  'silence',
  'irand',
  'setcpm',
  'setcps',
]);
/** Names that are never methods. */
export const TOP_ONLY: ReadonlySet<string> = new Set([
  'setcpm',
  'setcps',
  'silence',
  'run',
  'irand',
  'const',
  'return',
]);

function defaultSignature(name: string, kind: DocKind): string {
  switch (kind) {
    case 'signal':
    case 'keyword':
      return name;
    case 'control':
      return `.${name}(value)`;
    case 'combinator':
      return `${name}(…)`;
    default:
      return `.${name}(…)`;
  }
}

function registryDoc(e: object): string {
  const r = e as Record<string, unknown>;
  for (const k of ['doc', 'description', 'summary', 'help']) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

const BY_NAME = new Map<string, SymbolDoc>();
const CANONICAL: SymbolDoc[] = [];

function addSymbol(d: SymbolDoc): void {
  CANONICAL.push(d);
  for (const n of [d.name, ...d.aliases]) if (!BY_NAME.has(n)) BY_NAME.set(n, d);
}

for (const e of defaultRegistry.entries()) {
  const [name, ...aliases] = e.names;
  if (!name || BY_NAME.has(name)) continue;
  const category: string = e.category;
  const kind: DocKind = KINDS.has(category) ? (category as DocKind) : 'other';
  const cur = CURATED[name] ?? aliases.map((a) => CURATED[a]).find((c) => c !== undefined);
  addSymbol({
    name,
    kind,
    aliases,
    detail: category,
    signature: cur?.[0] ?? defaultSignature(name, kind),
    doc: cur?.[1] ?? (registryDoc(e) || FALLBACK[kind]),
  });
}
// Built-ins that live outside the registry (tempo, keywords, combinators): only those with an explicit kind.
for (const [name, cur] of Object.entries(CURATED)) {
  if (!cur || BY_NAME.has(name) || cur[2] === undefined) continue;
  addSymbol({ name, kind: cur[2], aliases: [], detail: cur[2], signature: cur[0], doc: cur[1] });
}

export function lookup(name: string): SymbolDoc | undefined {
  return BY_NAME.get(name);
}

export function allSymbols(): readonly SymbolDoc[] {
  return CANONICAL;
}

export function markdown(d: SymbolDoc, asName?: string): string {
  const parts = ['```tartlet', d.signature, '```', '', d.doc];
  if (asName && asName !== d.name) parts.push('', `\`${asName}\` is read as \`${d.name}\`.`);
  else if (d.aliases.length > 0) parts.push('', `Also written: ${d.aliases.map((a) => `\`${a}\``).join(', ')}`);
  parts.push('', `*${d.detail}*`);
  return parts.join('\n');
}

// ---- sounds and string values

const SOUND_GROUPS: readonly [readonly string[], string, string][] = [
  [DRUM_SOUNDS, 'drum', 'Drum sound. Pick a variant with :n, e.g. "bd:2".'],
  [OSCILLATOR_SOUNDS, 'synth', 'Synth oscillator: play pitches with note() or n().scale().'],
  [NOISE_SOUNDS, 'noise', 'Noise source: shape it with filters and envelopes.'],
  [VOCAL_SOUNDS, 'voice', 'Voice: sings syllables with .syl("la li").'],
  [AMBIENCE_SOUNDS, 'ambience', 'Procedural ambience: use long notes (.slow(4)) with .intensity and .density.'],
  [FOLEY_SOUNDS, 'foley', 'Foley one-shot.'],
  [CREATURE_SOUNDS, 'creature', 'Creature or machine sound.'],
];

export const SOUNDS: readonly SoundDoc[] = SOUND_GROUPS.flatMap(([names, group, doc]) =>
  names.map((name) => ({ name, group, doc })),
);
const SOUND_BY_NAME = new Map(SOUNDS.map((s) => [s.name, s]));

export function soundDoc(name: string): SoundDoc | undefined {
  return SOUND_BY_NAME.get(name.replace(/:\d+$/, ''));
}

export function soundMarkdown(s: SoundDoc): string {
  return `**${s.name}** · ${s.group}\n\n${s.doc}`;
}

export const SCALE_NAMES: readonly string[] = [...SCALES.keys()];
export const SPACES: readonly string[] = [...SPACE_NAMES];
export const VOWEL_NAMES: readonly string[] = [...VOWELS];
export const ROOTS: readonly string[] = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
