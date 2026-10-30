import type { PatternType, ValueKind } from '@tartlet/ir';

// Descriptions are original Tartlet prose (idea.md §4, rule 4).

export type Category = 'control' | 'combinator' | 'transform' | 'tonal' | 'directive' | 'constant' | 'signal';

export interface ParamSpec {
  readonly name: string;
  readonly type: ValueKind | 'function' | 'pattern-any';
  readonly patternable: boolean;
  readonly optional?: boolean;
  readonly range?: readonly [number, number];
}

export interface RegistryEntry {
  readonly id: string;
  readonly names: readonly string[];
  readonly compatAliases?: readonly string[];
  readonly form: 'constructor' | 'method' | 'both' | 'directive' | 'function-value';
  readonly params: readonly ParamSpec[];
  readonly returns: PatternType | 'same-as-receiver';
  readonly level: 'L1' | 'L2' | 'L3';
  readonly deterministic: 'pure' | 'seeded';
  readonly since: string;
  readonly description: string;
  /** Tartlet extension used by the checker to choose a lowering. */
  readonly category: Category;
}

export interface Lookup {
  readonly entry: RegistryEntry;
  readonly via: 'canonical' | 'alias' | 'compat';
  readonly typed: string;
}

const SINCE = '0.0.0';
const SINCE_T1 = '0.1.0';
const SINCE_T2 = '0.2.0';
const SINCE_T3 = '0.3.0';
const SINCE_T4 = '0.4.0';
const SINCE_T5 = '0.5.0';
const SINCE_T6 = '0.6.0';
const SINCE_T7 = '0.7.0';
const SINCE_T8 = '0.8.0';
const SINCE_T9 = '0.9.0';
const SINCE_T10 = '0.10.0';
const SINCE_T11 = '0.11.0';
const SINCE_T12 = '0.12.0';
const SINCE_T13 = '0.13.0';

function control(
  id: string,
  names: readonly string[],
  kind: ValueKind,
  description: string,
  extra: { compat?: readonly string[]; range?: readonly [number, number]; since?: string } = Object.create(
    null,
  ) as object,
): RegistryEntry {
  return {
    id,
    names,
    ...(extra.compat ? { compatAliases: extra.compat } : undefined),
    form: 'both',
    params: [{ name: 'value', type: kind, patternable: true, ...(extra.range ? { range: extra.range } : undefined) }],
    returns: { kind: 'pattern', of: 'controls' },
    level: 'L2',
    deterministic: 'pure',
    since: extra.since ?? SINCE,
    description,
    category: 'control',
  };
}

function transform(
  id: string,
  names: readonly string[],
  params: readonly ParamSpec[],
  description: string,
  deterministic: 'pure' | 'seeded' = 'pure',
): RegistryEntry {
  return {
    id,
    names,
    form: 'method',
    params,
    returns: 'same-as-receiver',
    level: 'L2',
    deterministic,
    since: SINCE_T1,
    description,
    category: 'transform',
  };
}

const ANY: ParamSpec = { name: 'pattern', type: 'pattern-any', patternable: true };
const FACTOR: ParamSpec = { name: 'factor', type: 'number', patternable: true };
const SHIFT: ParamSpec = { name: 'cycles', type: 'number', patternable: true };
const FN: ParamSpec = { name: 'f', type: 'function', patternable: false };
const RHYTHM: ParamSpec = { name: 'rhythm', type: 'string', patternable: true };
const CONST_NUM = (name: string, optional = false): ParamSpec => ({
  name,
  type: 'number',
  patternable: false,
  ...(optional ? { optional } : undefined),
});
function t2(
  id: string,
  names: readonly string[],
  params: readonly ParamSpec[],
  description: string,
  deterministic: 'pure' | 'seeded' = 'pure',
): RegistryEntry {
  return { ...transform(id, names, params, description, deterministic), since: SINCE_T2 };
}
function t3(id: string, names: readonly string[], params: readonly ParamSpec[], description: string): RegistryEntry {
  return { ...transform(id, names, params, description), since: SINCE_T3 };
}
/** Standard-library transforms (docs/language_extensions.md Part 2). They are L3 (TS-53). */
function lib(
  id: string,
  names: readonly string[],
  params: readonly ParamSpec[],
  description: string,
  deterministic: 'pure' | 'seeded' = 'pure',
): RegistryEntry {
  return { ...transform(id, names, params, description, deterministic), level: 'L3', since: SINCE_T6 };
}
const UNIT = (name: string): ParamSpec => ({ name, type: 'number', patternable: false, range: [0, 1] });
const AMOUNT: ParamSpec = { name: 'amount', type: 'number', patternable: true };
/** Headphone extensions from docs/binaural.md Tiers B1–B3 (TS-64 to TS-67). L3, so they stay out of the prompt. */
function earControl(
  id: string,
  kind: ValueKind,
  description: string,
  range?: readonly [number, number],
): RegistryEntry {
  return {
    ...control(id, [id], kind, description, { since: SINCE_T8, ...(range ? { range } : undefined) }),
    level: 'L3',
  };
}
/** Space and texture extensions from docs/instruments.md Tiers 5 and 7 (TS-69 to TS-76). L3. */
function envControl(
  id: string,
  kind: ValueKind,
  description: string,
  range?: readonly [number, number],
): RegistryEntry {
  return {
    ...control(id, [id], kind, description, { since: SINCE_T9, ...(range ? { range } : undefined) }),
    level: 'L3',
  };
}
/** Frequency-domain extensions from docs/dsp.md Part 1 (TS-77 to TS-80). L3. */
function dspControl(
  id: string,
  kind: ValueKind,
  description: string,
  range?: readonly [number, number],
): RegistryEntry {
  return {
    ...control(id, [id], kind, description, { since: SINCE_T10, ...(range ? { range } : undefined) }),
    level: 'L3',
  };
}
/** Impulse-response extensions from docs/dsp.md Part 2 (TS-81 to TS-85). L3. */
function irControl(id: string, kind: ValueKind, description: string, range?: readonly [number, number]): RegistryEntry {
  return {
    ...control(id, [id], kind, description, { since: SINCE_T11, ...(range ? { range } : undefined) }),
    level: 'L3',
  };
}
/** Response-curve and dynamics extensions from docs/dsp.md Part 3 (TS-86 to TS-89). L3. */
function cvControl(id: string, kind: ValueKind, description: string, range?: readonly [number, number]): RegistryEntry {
  return {
    ...control(id, [id], kind, description, { since: SINCE_T12, ...(range ? { range } : undefined) }),
    level: 'L3',
  };
}
function signalEntry(id: string, description: string): RegistryEntry {
  return {
    id,
    names: [id],
    form: 'constructor',
    params: [],
    returns: { kind: 'signal', of: 'number' },
    level: 'L2',
    deterministic: id === 'rand' ? 'seeded' : 'pure',
    since: SINCE_T2,
    description,
    category: 'signal',
  };
}

export const ENTRIES: readonly RegistryEntry[] = [
  control(
    's',
    ['s', 'sound'],
    'sample',
    'Chooses the sound source: a kit name, a sample variant or a built-in oscillator.',
  ),
  control('note', ['note'], 'note', 'Sets pitch from note names or MIDI numbers.'),
  control('n', ['n'], 'number', 'Sets a number used as a sample variant or as a scale degree.'),
  control('freq', ['freq'], 'number', 'Sets pitch directly in hertz.'),
  control('gain', ['gain'], 'number', 'Scales loudness. One is unity.', { range: [0, 1.5] }),
  control('velocity', ['velocity'], 'number', 'Scales loudness per note, between zero and one.', { range: [0, 1] }),
  control('pan', ['pan'], 'number', 'Stereo position: zero is left, one is right.', { range: [0, 1] }),
  control('speed', ['speed'], 'number', 'Playback rate for samples.'),
  control('cutoff', ['cutoff', 'lpf'], 'number', 'Low-pass filter frequency in hertz.', { range: [20, 20000] }),
  control('resonance', ['resonance', 'lpq'], 'number', 'Emphasis at the low-pass cutoff.', { range: [0, 30] }),
  control('hcutoff', ['hcutoff', 'hpf'], 'number', 'High-pass filter frequency in hertz.', { range: [20, 20000] }),
  control('attack', ['attack'], 'number', 'Seconds to rise to full level.'),
  control('decay', ['decay'], 'number', 'Seconds to fall from peak to the sustain level.'),
  control('sustain', ['sustain'], 'number', 'Held level as a fraction of peak.'),
  control('release', ['release'], 'number', 'Seconds to fade out after the note ends.'),
  control('room', ['room'], 'number', 'Amount of reverb send.', { compat: ['reverb'], range: [0, 1] }),
  control('size', ['size'], 'number', 'Reverb space size.'),
  control('delay', ['delay'], 'number', 'Amount of echo send.', { range: [0, 1] }),
  control('delaytime', ['delaytime'], 'number', 'Echo spacing, in cycles or seconds depending on the host.'),
  control('delayfeedback', ['delayfeedback'], 'number', 'How much each echo feeds the next.', {
    compat: ['feedback'],
    range: [0, 0.98],
  }),
  control('shape', ['shape'], 'number', 'Waveshaping distortion amount.', { range: [0, 1] }),
  control('crush', ['crush'], 'number', 'Bit-depth reduction.', { range: [1, 16] }),
  control(
    'vowel',
    ['vowel'],
    'string',
    'Formant filter vowel: a e i o u, or ae ah aw eh er ih oh oo uh. Unknown vowels are sung as ah.',
  ),
  control('orbit', ['orbit'], 'number', 'Effects bus number.'),
  // Headphone extensions (TS-40).
  control(
    'binaural',
    ['binaural'],
    'number',
    'Beat rate in hertz for headphones: the left ear hears the pitch lowered by half this amount, the right ear raised by half.',
    { range: [0, 40], since: SINCE_T3 },
  ),
  control(
    'azimuth',
    ['azimuth'],
    'number',
    'Direction around the listener in degrees: zero is straight ahead, 90 is to the right and -90 to the left.',
    { range: [-180, 180], since: SINCE_T3 },
  ),
  control('elevation', ['elevation'], 'number', 'Height above or below the listener in degrees.', {
    range: [-90, 90],
    since: SINCE_T3,
  }),
  control(
    'distance',
    ['distance'],
    'number',
    'How far the sound is from the listener. One is the reference distance; farther sounds are quieter.',
    { range: [0.5, 50], since: SINCE_T3 },
  ),
  // Per-ear extensions (TS-62). L3, so they stay out of the system prompt.
  {
    ...control(
      'earsh',
      ['earsh'],
      'number',
      'Detunes the ears in opposite directions, in cents: the right ear is raised and the left lowered by half each.',
      { range: [-100, 100], since: SINCE_T7 },
    ),
    level: 'L3',
  },
  {
    ...control(
      'itd',
      ['itd'],
      'number',
      'Delays one ear by up to 40 milliseconds. Positive values delay the left ear, so the sound leans to the right.',
      { range: [-40, 40], since: SINCE_T7 },
    ),
    level: 'L3',
  },
  {
    ...control(
      'ild',
      ['ild'],
      'number',
      'Level difference between the ears in decibels. Positive is louder on the right; total loudness stays the same.',
      { range: [-12, 12], since: SINCE_T7 },
    ),
    level: 'L3',
  },
  {
    ...control(
      'iphase',
      ['iphase'],
      'number',
      'Phase offset between the ears for oscillator voices, in degrees. Near 180 the tone seems to sit inside the head.',
      { range: [0, 180], since: SINCE_T7 },
    ),
    level: 'L3',
  },
  {
    ...control(
      'earswap',
      ['earswap'],
      'number',
      'Swaps the left and right ears when set to one. Patterned, it makes the sound hop from ear to ear.',
      { range: [0, 1], since: SINCE_T7 },
    ),
    level: 'L3',
  },
  // Per-ear filters, correlation, spectral splits, dichotic pitch and pulses (TS-64 to TS-67).
  earControl('lcutoff', 'number', 'A low-pass filter on the left ear only, in hertz.', [20, 20000]),
  earControl('rcutoff', 'number', 'A low-pass filter on the right ear only, in hertz.', [20, 20000]),
  earControl('lhcutoff', 'number', 'A high-pass filter on the left ear only, in hertz.', [20, 20000]),
  earControl('rhcutoff', 'number', 'A high-pass filter on the right ear only, in hertz.', [20, 20000]),
  earControl(
    'icorr',
    'number',
    'How alike the two ears are for noise sounds: one gives the same noise in both, zero gives unrelated noise in each.',
    [0, 1],
  ),
  earControl(
    'earsplit',
    'string',
    'Splits a sound between the ears: "harmonics" sends alternate harmonics of an oscillator to each ear, "bands" sends the lows left and the highs right, "none" turns it off.',
  ),
  earControl('splitfreq', 'number', 'Crossover frequency in hertz for earsplit "bands".', [100, 8000]),
  earControl(
    'dichotic',
    'number',
    'On noise sounds, shifts the phase of one ear in a narrow band at this frequency, so headphones hear a faint pitch that neither ear hears alone. Zero turns it off.',
    [0, 2000],
  ),
  earControl('dichoticq', 'number', 'How narrow the dichotic band is; higher gives a clearer pitch.', [1, 50]),
  earControl(
    'isochronic',
    'number',
    'Pulses the loudness at this rate in hertz. Unlike a binaural beat, it can be heard on speakers too.',
    [0, 40],
  ),
  earControl('isodepth', 'number', 'How deep the isochronic pulses are, from zero for none to one for full.', [0, 1]),
  earControl(
    'irate',
    'number',
    'Rotates the phase between the ears of an oscillator voice at this rate in hertz, like a slow binaural beat.',
    [0, 10],
  ),
  // Synthesis extensions (TS-42).
  control(
    'lpenv',
    ['lpenv'],
    'number',
    'How far the filter envelope moves the low-pass cutoff, in octaves. Negative values sweep downwards.',
    { range: [-8, 8], since: SINCE_T3 },
  ),
  control('lpattack', ['lpattack'], 'number', 'Seconds for the filter envelope to reach its peak.', {
    range: [0, 10],
    since: SINCE_T3,
  }),
  control('lpdecay', ['lpdecay'], 'number', 'Seconds for the filter envelope to fall to its held level.', {
    range: [0, 10],
    since: SINCE_T3,
  }),
  control('lpsustain', ['lpsustain'], 'number', 'Held level of the filter envelope, from zero to one.', {
    range: [0, 1],
    since: SINCE_T3,
  }),
  control('lprelease', ['lprelease'], 'number', 'Seconds for the filter envelope to settle after the note ends.', {
    range: [0, 10],
    since: SINCE_T3,
  }),
  control(
    'penv',
    ['penv'],
    'number',
    'Starting pitch offset in semitones; the pitch then settles back onto the note.',
    { range: [-48, 48], since: SINCE_T3 },
  ),
  control('pdecay', ['pdecay'], 'number', 'Seconds for the pitch offset to settle.', {
    range: [0, 5],
    since: SINCE_T3,
  }),
  control('vib', ['vib'], 'number', 'Vibrato rate in hertz.', {
    compat: ['vibrato'],
    range: [0, 30],
    since: SINCE_T3,
  }),
  control('vibdepth', ['vibdepth'], 'number', 'Vibrato depth in semitones.', { range: [0, 12], since: SINCE_T3 }),
  control('trem', ['trem'], 'number', 'Tremolo rate in hertz.', {
    compat: ['tremolo'],
    range: [0, 30],
    since: SINCE_T3,
  }),
  control('tremdepth', ['tremdepth'], 'number', 'Tremolo depth, from zero for none to one for full.', {
    range: [0, 1],
    since: SINCE_T3,
  }),
  control('fm', ['fm', 'fmi'], 'number', 'Frequency-modulation index: how strongly a sine modulator bends the pitch.', {
    range: [0, 50],
    since: SINCE_T3,
  }),
  control('fmh', ['fmh'], 'number', 'Modulator frequency as a multiple of the note frequency.', {
    range: [0, 16],
    since: SINCE_T3,
  }),
  control('pw', ['pw'], 'number', 'Pulse width for square voices; one half is a plain square.', {
    range: [0, 1],
    since: SINCE_T3,
  }),
  control('unison', ['unison'], 'number', 'How many slightly detuned copies of an oscillator voice to stack.', {
    range: [1, 16],
    since: SINCE_T3,
  }),
  control('detune', ['detune'], 'number', 'Total spread of the unison copies, in cents.', {
    range: [0, 100],
    since: SINCE_T3,
  }),
  control(
    'timbre',
    ['timbre'],
    'string',
    'A named waveform for oscillator voices: organ, hollow, bright, soft, reed or glass.',
    { since: SINCE_T3 },
  ),
  control('glide', ['glide'], 'number', 'Seconds to slide from the previous note of the same mono line.', {
    compat: ['portamento'],
    range: [0, 5],
    since: SINCE_T3,
  }),
  control('mono', ['mono'], 'number', 'A monophonic line number: a new note on the line ends the one before.', {
    range: [0, 64],
    since: SINCE_T3,
  }),
  // Vocal extensions (TS-43 to TS-47).
  control(
    'voicetype',
    ['voicetype'],
    'string',
    'Voice type that sets the vowel resonances: bass, tenor, alto, soprano or child.',
    {
      since: SINCE_T4,
    },
  ),
  control(
    'formant',
    ['formant'],
    'number',
    'Moves the vowel resonances by semitones without changing pitch; lower sounds larger.',
    {
      range: [-12, 12],
      since: SINCE_T4,
    },
  ),
  control('vglide', ['vglide'], 'number', 'Seconds to slide the vowel from the previous note of the same mono line.', {
    range: [0, 5],
    since: SINCE_T4,
  }),
  control('ring', ['ring'], 'number', 'Adds a bright resonance near three kilohertz, like a trained singer.', {
    range: [0, 1],
    since: SINCE_T4,
  }),
  control('breath', ['breath'], 'number', 'How much breath noise is mixed into a voice.', {
    range: [0, 1],
    since: SINCE_T4,
  }),
  control(
    'effort',
    ['effort'],
    'number',
    'Vocal effort: soft voices are darker and breathier, strong ones brighter. Defaults to velocity.',
    {
      range: [0, 1],
      since: SINCE_T4,
    },
  ),
  control('jitter', ['jitter'], 'number', 'Small random wobble in the pitch of a voice.', {
    range: [0, 1],
    since: SINCE_T4,
  }),
  control('shimmer', ['shimmer'], 'number', 'Small random wobble in the loudness of a voice.', {
    range: [0, 1],
    since: SINCE_T4,
  }),
  control('scoop', ['scoop'], 'number', 'Semitones below the note where a voice starts before rising into it.', {
    range: [-12, 0],
    since: SINCE_T4,
  }),
  control('vibdel', ['vibdel'], 'number', 'Seconds before vibrato fades in.', { range: [0, 2], since: SINCE_T4 }),
  control('fry', ['fry'], 'number', 'Adds a rough undertone an octave down, for vocal fry and growls.', {
    range: [0, 1],
    since: SINCE_T4,
  }),
  control('scatter', ['scatter'], 'number', 'Seconds by which the voices of a choir start apart from each other.', {
    range: [0, 0.06],
    since: SINCE_T4,
  }),
  control('width', ['width'], 'number', 'Stereo spread of the voices in a choir.', { range: [0, 1], since: SINCE_T4 }),
  control(
    'syl',
    ['syl'],
    'string',
    'A sung syllable in the phonetic singing alphabet, such as "la", "shee" or "mi_a_u". A lone "_" holds the previous vowel.',
    { since: SINCE_T4 },
  ),
  control('talk', ['talk'], 'number', 'How strongly a vowel or syllable shapes a non-voice sound, like a talkbox.', {
    range: [0, 1],
    since: SINCE_T4,
  }),
  control('overtone', ['overtone'], 'number', 'Boosts one harmonic of the note, for overtone-singing whistles.', {
    range: [4, 16],
    since: SINCE_T4,
  }),
  // Library controls (TS-59).
  {
    ...control(
      'legato',
      ['legato', 'clip'],
      'number',
      'How long each note sounds, as a share of its step: below one is detached, above one overlaps.',
      { range: [0, 8], since: SINCE_T6 },
    ),
    level: 'L3',
  },
  {
    ...control(
      'nudge',
      ['nudge'],
      'number',
      'Moves each note by a small number of seconds of real time without changing the pattern; negative is earlier.',
      { range: [-0.05, 0.25], since: SINCE_T6 },
    ),
    level: 'L3',
  },
  // Space and environment (TS-69 to TS-72).
  envControl(
    'space',
    'string',
    'The kind of space the reverb on this orbit imitates: room, hall, plate, church or outdoor. room and size still set how much and how long.',
  ),
  envControl(
    'occlude',
    'number',
    'Muffles and softens a sound as if it were behind a wall or in the next room, from zero for none to one for fully hidden.',
    [0, 1],
  ),
  envControl(
    'posglide',
    'number',
    'Seconds a placed sound takes to travel from where the previous note of the same sound and orbit was, so sweeps glide instead of jumping.',
    [0, 2],
  ),
  // Sound textures (TS-73 to TS-76).
  envControl(
    'intensity',
    'number',
    'How strong an ambience or creature sound is: lighter or heavier rain, calmer or wilder wind, a smaller or bigger fire.',
    [0, 1],
  ),
  envControl(
    'density',
    'number',
    'How many small events per second happen inside an ambience or creature sound: drops, crackles, gusts or chirps.',
    [0.1, 200],
  ),
  envControl(
    'grain',
    'number',
    'Grain length in milliseconds. Setting it plays an oscillator or noise sound as a cloud of short overlapping grains.',
    [5, 500],
  ),
  envControl('gdensity', 'number', 'How many grains start each second.', [1, 200]),
  envControl(
    'gjitter',
    'number',
    'How far the grains wander in time and in source position, from zero for none to one.',
    [0, 1],
  ),
  envControl(
    'gpos',
    'number',
    'Where in the source the grains are read from, from zero for the start to one for the end.',
    [0, 1],
  ),
  // Spectral shaping with native filters (TS-77, TS-78).
  dspControl('lowshelf', 'number', 'Boosts or cuts everything below about 200 Hz, in decibels.', [-18, 12]),
  dspControl('highshelf', 'number', 'Boosts or cuts everything above about 4 kHz, in decibels.', [-18, 12]),
  dspControl('lsfreq', 'number', 'Moves the low shelf to another frequency, in hertz.', [20, 20000]),
  dspControl('hsfreq', 'number', 'Moves the high shelf to another frequency, in hertz.', [20, 20000]),
  dspControl('peak', 'number', 'Boosts or cuts a band around peakfreq, in decibels. Zero turns it off.', [-18, 12]),
  dspControl('peakfreq', 'number', 'Centre of the peak band, in hertz.', [20, 20000]),
  dspControl('peakq', 'number', 'How narrow the peak band is; higher is narrower.', [0.1, 18]),
  dspControl('bandf', 'number', 'Keeps only a band around this frequency, in hertz.', [20, 20000]),
  dspControl('bandq', 'number', 'How narrow the kept band is; higher is narrower.', [0.1, 30]),
  dspControl('notch', 'number', 'Removes a narrow band at this frequency, in hertz.', [20, 20000]),
  dspControl('notchq', 'number', 'How narrow the removed band is; higher is narrower.', [0.1, 30]),
  dspControl(
    'tilt',
    'number',
    'Tilts the whole spectrum around 1 kHz, in decibels per octave: negative is darker, positive brighter.',
    [-6, 6],
  ),
  dspControl(
    'fshift',
    'number',
    'Moves every partial up or down by the same number of hertz, so harmonic tones turn bell-like or metallic.',
    [-2000, 2000],
  ),
  dspControl(
    'ringmod',
    'number',
    'Multiplies the sound by a sine at this frequency, in hertz, for clangorous sidebands. Zero turns it off.',
    [0, 4000],
  ),
  dspControl('ringmix', 'number', 'How much of the ring-modulated sound is heard, from zero to one.', [0, 1]),
  // Short-time spectral processing (TS-79, TS-80).
  dspControl(
    'spectral',
    'string',
    'A spectral effect: none, freeze, blur, gate, robot, whisper, comb or shift. It works on the spectrum of short slices of the sound.',
  ),
  dspControl('samount', 'number', 'How strong the spectral effect is, from zero to one.', [0, 1]),
  dspControl(
    'sgate',
    'number',
    'Level in decibels below which spectral("gate") removes parts of the spectrum.',
    [-90, 0],
  ),
  dspControl(
    'scomb',
    'number',
    'Spacing in hertz for spectral("comb"): only the spectrum near multiples of it is kept, so noise turns into a buzz.',
    [20, 2000],
  ),
  dspControl('sshift', 'number', 'Semitones for spectral("shift"), a cheap and smeary pitch shift.', [-24, 24]),
  dspControl(
    'ssend',
    'number',
    'Sends to one spectral effect shared by the orbit instead of giving every note its own.',
    [0, 1],
  ),
  // Impulse-response filters (TS-81 to TS-85).
  irControl(
    'fir',
    'string',
    'A linear-phase filter that keeps transients sharp: none, lowpass, highpass, bandpass or bandstop. It delays the sound slightly, so playback starts it early.',
  ),
  irControl('firfreq', 'number', 'Cutoff of the fir filter in hertz, or the centre of its band.', [20, 20000]),
  irControl('firwidth', 'number', 'Width of the fir band in octaves, for bandpass and bandstop.', [0.1, 4]),
  irControl(
    'firlen',
    'string',
    'How long the fir filter is: short, medium or long. Longer is steeper but delays the sound more.',
  ),
  irControl(
    'body',
    'string',
    'Plays the sound through a generated resonant body: box, guitar, violin, tube, can, phone, radio or megaphone. none turns it off.',
  ),
  irControl(
    'bodysize',
    'number',
    'Scales the body: above one sounds larger and lower, below one smaller and higher.',
    [0.25, 4],
  ),
  irControl('bodymix', 'number', 'How much of the body response is heard, from zero to one.', [0, 1]),
  irControl(
    'cab',
    'string',
    'Sends the sound through a generated speaker cabinet shared by the orbit: small, open, closed, combo or stack. none turns it off.',
  ),
  irControl('spacepre', 'number', 'Silence before the reverb tail of a space, in milliseconds.', [0, 200]),
  irControl('spacedamp', 'number', 'How quickly the tail of a space darkens, from zero to one.', [0, 1]),
  // Transfer curves, dynamics and control curves (TS-86 to TS-89).
  cvControl(
    'curve',
    'string',
    'A transfer curve the sound passes through: none, soft, hard, tanh, tube, fold, rect, half, or cheby2 to cheby7, which turn a loud sine into that harmonic.',
  ),
  cvControl(
    'drive',
    'number',
    'How hard the sound is pushed into the curve, in decibels. Loudness stays level, so more drive changes the colour, not the volume.',
    [0, 24],
  ),
  cvControl('bias', 'number', 'Offsets the sound before the curve, adding even harmonics.', [-0.5, 0.5]),
  cvControl('curvemix', 'number', 'How much of the curved sound is heard, from zero to one.', [0, 1]),
  cvControl(
    'comp',
    'number',
    'Threshold in decibels of a compressor shared by the orbit, which glues its tracks together. Zero turns it off.',
    [-60, 0],
  ),
  cvControl('compratio', 'number', 'How strongly the orbit compressor squeezes loud sound.', [1, 20]),
  cvControl('compknee', 'number', 'How gradually the orbit compressor starts to act, in decibels.', [0, 40]),
  cvControl('compattack', 'number', 'Seconds the orbit compressor takes to react.', [0, 1]),
  cvControl('comprelease', 'number', 'Seconds the orbit compressor takes to let go.', [0, 1]),
  cvControl(
    'gate',
    'number',
    'Silences the sound whenever it falls below this level, in decibels, for tight noise beds and short tails.',
    [-90, 0],
  ),
  cvControl('gaterelease', 'number', 'Seconds the gate takes to close.', [0.005, 1]),
  cvControl(
    'envcurve',
    'string',
    'Shape of the loudness envelope: lin, exp or log. exp fades fast and then slowly, which sounds natural.',
  ),
  cvControl(
    'velcurve',
    'number',
    'Bends how velocity maps to loudness: above one, soft notes get softer; below one, they get louder.',
    [0.25, 4],
  ),
  {
    id: 'stack',
    names: ['stack'],
    form: 'both',
    params: [{ ...ANY, name: 'layers' }],
    returns: { kind: 'pattern', of: 'controls' },
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'Plays all layers at once.',
    category: 'combinator',
  },
  {
    id: 'slowcat',
    names: ['cat', 'slowcat'],
    form: 'constructor',
    params: [{ ...ANY, name: 'items' }],
    returns: { kind: 'pattern', of: 'controls' },
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'Plays one item per cycle, in turn.',
    category: 'combinator',
  },
  {
    id: 'fastcat',
    names: ['seq', 'fastcat'],
    form: 'constructor',
    params: [{ ...ANY, name: 'items' }],
    returns: { kind: 'pattern', of: 'controls' },
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'Squeezes all items into each cycle, in order.',
    category: 'combinator',
  },
  transform('fast', ['fast'], [FACTOR], 'Speeds the pattern up by a factor.'),
  transform('slow', ['slow'], [FACTOR], 'Stretches the pattern by a factor.'),
  transform('rev', ['rev'], [], 'Plays every cycle back to front.'),
  transform(
    'every',
    ['every', 'firstOf'],
    [
      { name: 'n', type: 'number', patternable: false },
      { name: 'f', type: 'function', patternable: false },
    ],
    'Applies a function on the first cycle of every group of n cycles.',
  ),
  transform('early', ['early'], [SHIFT], 'Moves the pattern earlier by a number of cycles.'),
  transform('late', ['late'], [SHIFT], 'Moves the pattern later by a number of cycles.'),
  transform(
    'degradeBy',
    ['degradeBy'],
    [{ name: 'amount', type: 'number', patternable: true, range: [0, 1] }],
    'Removes a seeded random share of events. The share is between zero and one.',
    'seeded',
  ),
  t2('off', ['off'], [SHIFT, FN], 'Layers a copy shifted later in time, with a function applied to the copy.'),
  t2('jux', ['jux'], [FN], 'Plays the pattern on the left and a transformed copy on the right.'),
  t2('ply', ['ply'], [FACTOR], 'Repeats each event several times within its own duration.'),
  t2(
    'struct',
    ['struct'],
    [RHYTHM],
    "Takes its rhythm from a pattern of true and false steps and keeps this pattern's values.",
  ),
  t2('mask', ['mask'], [RHYTHM], 'Silences the pattern wherever the mask is false or zero.'),
  t2(
    'euclid',
    ['euclid'],
    [CONST_NUM('k'), CONST_NUM('n'), CONST_NUM('rotation', true)],
    'Keeps the pattern only on the hits of k onsets spread evenly over n steps.',
  ),
  t2('degrade', ['degrade'], [], 'Removes about half of the events, chosen by a seeded draw.', 'seeded'),
  t2(
    'sometimesBy',
    ['sometimesBy'],
    [{ name: 'amount', type: 'number', patternable: false, range: [0, 1] }, FN],
    'Applies a function to a seeded random share of events.',
    'seeded',
  ),
  t2(
    'sometimes',
    ['sometimes'],
    [FN],
    'Applies a function to about half of the events, chosen by a seeded draw.',
    'seeded',
  ),
  t2(
    'add',
    ['add'],
    [{ name: 'amount', type: 'number', patternable: true }],
    'Adds a number to notes, degrees or plain numbers.',
  ),
  t2(
    'transpose',
    ['transpose'],
    [{ name: 'semitones', type: 'number', patternable: true }],
    'Shifts notes by a number of semitones.',
  ),
  t2(
    'range',
    ['range'],
    [CONST_NUM('min'), CONST_NUM('max')],
    'Rescales values between zero and one onto a new interval.',
  ),
  t2(
    'seed',
    ['seed'],
    [{ name: 'value', type: 'string', patternable: false }],
    'Pins the random choices below this point to a named variation.',
    'seeded',
  ),
  t2(
    'label',
    ['label'],
    [{ name: 'name', type: 'string', patternable: false }],
    'Gives a track a stable name for mixers, diagnostics and diffs.',
  ),
  t3(
    'iter',
    ['iter'],
    [CONST_NUM('n')],
    'Starts each cycle one nth further into the pattern, wrapping around after n cycles.',
  ),
  t3('iterBack', ['iterBack'], [CONST_NUM('n')], 'Like iter, but each cycle starts one nth earlier instead.'),
  t3('palindrome', ['palindrome'], [], 'Plays forwards, then backwards, on alternating cycles.'),
  {
    ...transform(
      'apply',
      ['apply'],
      [FN],
      'Hands the pattern to a function, such as a named const function. Further arguments follow the pattern.',
    ),
    since: SINCE_T5,
  },
  // ---- Standard library (TS-53 to TS-59)
  lib(
    'within',
    ['within'],
    [UNIT('begin'), UNIT('end'), FN],
    'Applies a function, keeping only what it plays between two points of each cycle; the rest of the cycle is left as it was.',
  ),
  lib(
    'chunk',
    ['chunk'],
    [CONST_NUM('n'), FN],
    'Splits each cycle into n parts and applies a function to one of them, moving one part later each cycle.',
  ),
  lib(
    'chunkBack',
    ['chunkBack'],
    [CONST_NUM('n'), FN],
    'Like chunk, but the transformed part moves one part earlier each cycle.',
  ),
  lib('lastOf', ['lastOf'], [CONST_NUM('n'), FN], 'Applies a function on the last cycle of every group of n cycles.'),
  lib(
    'zoom',
    ['zoom'],
    [CONST_NUM('begin'), CONST_NUM('end')],
    'Plays only the stretch of each cycle between begin and end, stretched to fill the whole cycle.',
  ),
  lib(
    'compress',
    ['compress'],
    [UNIT('begin'), UNIT('end')],
    'Squeezes each cycle into the stretch between begin and end, leaving the rest silent.',
  ),
  lib(
    'fastGap',
    ['fastGap'],
    [CONST_NUM('factor')],
    'Plays each cycle faster by a factor, then rests until the next cycle begins.',
  ),
  lib('linger', ['linger'], [UNIT('fraction')], 'Repeats the opening fraction of each cycle until the cycle is full.'),
  lib(
    'segment',
    ['segment'],
    [CONST_NUM('n')],
    'Samples the pattern at n evenly spaced steps per cycle, turning a signal into separate events.',
  ),
  lib('hurry', ['hurry'], [FACTOR], 'Speeds the pattern up and raises sample playback speed by the same factor.'),
  lib(
    'swingBy',
    ['swingBy'],
    [CONST_NUM('amount'), CONST_NUM('n')],
    'Divides each cycle into n slices and delays the events in the second half of each slice by a share of a slice.',
  ),
  lib('swing', ['swing'], [CONST_NUM('n')], 'A light swing: swingBy with a third of a slice.'),
  lib('brak', ['brak'], [], 'On every other cycle, squeezes the cycle into its middle half for a syncopated break.'),
  lib('press', ['press'], [], 'Moves every event into the second half of its own duration.'),
  lib(
    'pressBy',
    ['pressBy'],
    [{ name: 'amount', type: 'number', patternable: true, range: [0, 1] }],
    'Delays the start of every event by a share of its own duration, keeping its end.',
  ),
  lib('superimpose', ['superimpose'], [FN], 'Plays the pattern together with a transformed copy of itself.'),
  lib(
    'echo',
    ['echo'],
    [CONST_NUM('times'), CONST_NUM('time'), UNIT('feedback')],
    'Adds delayed copies, each one later by the given time and quieter by the feedback factor.',
  ),
  lib(
    'often',
    ['often'],
    [FN],
    'Applies a function to about three quarters of the events, chosen by a seeded draw.',
    'seeded',
  ),
  lib(
    'rarely',
    ['rarely'],
    [FN],
    'Applies a function to about a quarter of the events, chosen by a seeded draw.',
    'seeded',
  ),
  lib(
    'almostNever',
    ['almostNever'],
    [FN],
    'Applies a function to about one event in ten, chosen by a seeded draw.',
    'seeded',
  ),
  lib(
    'almostAlways',
    ['almostAlways'],
    [FN],
    'Applies a function to about nine events in ten, chosen by a seeded draw.',
    'seeded',
  ),
  lib('always', ['always'], [FN], 'Applies a function to every event.'),
  lib('never', ['never'], [FN], 'Ignores the function and plays the pattern unchanged.'),
  lib(
    'someCyclesBy',
    ['someCyclesBy'],
    [UNIT('amount'), FN],
    'Decides once per cycle, with a seeded draw, whether to apply a function to the whole cycle.',
    'seeded',
  ),
  lib(
    'someCycles',
    ['someCycles'],
    [FN],
    'Applies a function to about half of the cycles, decided once per cycle by a seeded draw.',
    'seeded',
  ),
  lib(
    'shuffle',
    ['shuffle'],
    [CONST_NUM('n')],
    'Cuts each cycle into n slices and plays every slice once, in a seeded random order.',
    'seeded',
  ),
  lib(
    'scramble',
    ['scramble'],
    [CONST_NUM('n')],
    'Cuts each cycle into n slices and fills each slot with a slice picked by a seeded draw, so slices may repeat.',
    'seeded',
  ),
  lib(
    'undegradeBy',
    ['undegradeBy'],
    [{ name: 'amount', type: 'number', patternable: true, range: [0, 1] }],
    'Keeps only a seeded random share of the events. The share is between zero and one.',
    'seeded',
  ),
  lib('sub', ['sub'], [AMOUNT], 'Subtracts a number from notes, degrees or plain numbers.'),
  lib('mul', ['mul'], [AMOUNT], 'Multiplies notes, degrees or plain numbers by a number.'),
  lib('div', ['div'], [AMOUNT], 'Divides notes, degrees or plain numbers by a number; zero leaves them unchanged.'),
  lib('mod', ['mod'], [AMOUNT], 'Wraps notes, degrees or plain numbers into the range from zero up to a number.'),
  lib('round', ['round'], [], 'Rounds notes, degrees or plain numbers to the nearest whole number.'),
  lib('floor', ['floor'], [], 'Rounds notes, degrees or plain numbers down to a whole number.'),
  lib('ceil', ['ceil'], [], 'Rounds notes, degrees or plain numbers up to a whole number.'),
  lib('toBipolar', ['toBipolar'], [], 'Maps values between zero and one onto values between minus one and one.'),
  lib('fromBipolar', ['fromBipolar'], [], 'Maps values between minus one and one onto values between zero and one.'),
  lib(
    'octave',
    ['octave'],
    [{ name: 'octaves', type: 'number', patternable: true }],
    'Moves notes up or down by whole octaves.',
  ),
  lib('accent', ['accent'], [RHYTHM], 'Makes events louder wherever the rhythm is true at their start.'),
  {
    id: 'run',
    names: ['run'],
    form: 'constructor',
    params: [CONST_NUM('n')],
    returns: { kind: 'pattern', of: 'number' },
    level: 'L3',
    deterministic: 'pure',
    since: SINCE_T6,
    description: 'Counts from zero up to n minus one, spread evenly over each cycle.',
    category: 'constant',
  },
  {
    id: 'irand',
    names: ['irand'],
    form: 'constructor',
    params: [CONST_NUM('n')],
    returns: { kind: 'signal', of: 'number' },
    level: 'L3',
    deterministic: 'seeded',
    since: SINCE_T6,
    description: 'A seeded random whole number from zero up to, but not including, n.',
    category: 'signal',
  },
  {
    ...signalEntry('perlin', 'A seeded value between zero and one that drifts smoothly from cycle to cycle.'),
    level: 'L3',
    deterministic: 'seeded',
    since: SINCE_T6,
  },
  signalEntry('sine', 'A smooth wave from zero up to one and back, once per cycle.'),
  signalEntry('cosine', 'The smooth wave, started a quarter of a cycle later.'),
  signalEntry('saw', 'Climbs from zero to one across each cycle.'),
  signalEntry('isaw', 'Falls from one to zero across each cycle.'),
  signalEntry('tri', 'Climbs and then falls once per cycle.'),
  signalEntry('square', 'Zero in the first half of each cycle and one in the second.'),
  signalEntry('rand', 'A seeded random value between zero and one.'),
  {
    id: 'scale',
    names: ['scale'],
    form: 'method',
    params: [{ name: 'name', type: 'string', patternable: false }],
    returns: 'same-as-receiver',
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'Turns `n` degrees into notes of a named scale such as "D:minor".',
    category: 'tonal',
  },
  {
    id: 'silence',
    names: ['silence'],
    form: 'constructor',
    params: [],
    returns: { kind: 'pattern', of: 'controls' },
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'A pattern with no events.',
    category: 'constant',
  },
  {
    id: 'setcps',
    names: ['setcps'],
    form: 'directive',
    params: [{ name: 'cps', type: 'number', patternable: false }],
    returns: { kind: 'error' },
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'Sets tempo in cycles per second.',
    category: 'directive',
  },
  {
    id: 'setcpm',
    names: ['setcpm'],
    form: 'directive',
    params: [{ name: 'cpm', type: 'number', patternable: false }],
    returns: { kind: 'error' },
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'Sets tempo in cycles per minute.',
    category: 'directive',
  },
  {
    id: 'samples',
    names: ['samples'],
    form: 'directive',
    params: [{ name: 'bank', type: 'string', patternable: false }],
    returns: { kind: 'error' },
    level: 'L2',
    deterministic: 'pure',
    since: SINCE,
    description: 'Declares a sample bank. It is fetched only if the host allows it.',
    category: 'directive',
  },
  {
    id: 'sample',
    names: ['sample'],
    form: 'directive',
    params: [
      { name: 'name', type: 'string', patternable: false },
      { name: 'path', type: 'string', patternable: false },
    ],
    returns: { kind: 'error' },
    level: 'L3',
    deterministic: 'pure',
    since: SINCE_T13,
    description:
      'Binds a WAV file, given by a path relative to the sample collection, to a sound name. The host loads it; the document never fetches anything.',
    category: 'directive',
  },
];

export class Registry {
  readonly #byName = new Map<string, Lookup>();
  readonly #byId = new Map<string, RegistryEntry>();

  constructor(entries: readonly RegistryEntry[]) {
    for (const entry of entries) {
      this.#byId.set(entry.id, entry);
      entry.names.forEach((typed, i) =>
        this.#byName.set(typed, { entry, via: i === 0 ? 'canonical' : 'alias', typed }),
      );
      for (const typed of entry.compatAliases ?? []) this.#byName.set(typed, { entry, via: 'compat', typed });
    }
  }

  /** Map-backed, so `__proto__` and `constructor` never resolve (idea.md §6.2). */
  lookup(name: string): Lookup | undefined {
    return this.#byName.get(name);
  }

  get(id: string): RegistryEntry | undefined {
    return this.#byId.get(id);
  }

  entries(): IterableIterator<RegistryEntry> {
    return this.#byId.values();
  }

  /** The closest known name within edit distance 2, if it is unique. */
  suggest(name: string): { name: string; distance: number } | undefined {
    let best: { name: string; distance: number } | undefined;
    let tie = false;
    for (const known of this.#byName.keys()) {
      const d = editDistance(name, known);
      if (d > 2) continue;
      if (!best || d < best.distance) {
        best = { name: known, distance: d };
        tie = false;
      } else if (d === best.distance) {
        tie = true;
      }
    }
    return tie ? undefined : best;
  }
}

export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

export const defaultRegistry: Registry = new Registry(ENTRIES);

/**
 * Draft v1 of the published system-prompt snippet (idea.md §10.3), generated from the
 * registry so the prompt and the runtime cannot drift apart.
 */
export function systemPrompt(reg: Registry = defaultRegistry): string {
  const names = (c: Category): string =>
    [...reg.entries()]
      .filter((e) => e.category === c && e.level !== 'L3')
      .map((e) => e.names[0] ?? e.id)
      .join(', ');
  return [
    'Write music as Tartlet source (Strudel-compatible). Rules:',
    '- One track per line: `$: <pattern>`. Optionally start with `setcpm(n)`.',
    '- Start a track with s("…"), note("…") or n("…").scale("D:minor"), then chain methods.',
    '- Mini-notation inside strings: `a b` sequence, `~` rest, `[a b]` group, `<a b>` one per cycle, `a, b` layers, `*n` `/n` `!n` `@n` `?` `(k,n)`.',
    `- Controls: ${names('control')}.`,
    `- Transforms: ${names('transform')}. Combinators: ${names('combinator')}.`,
    `- Signals: ${names('signal')}, as in .lpf(sine.range(200, 2000)).`,
    '- Also: often, rarely, superimpose, echo, swing, chunk, run(n).',
    '- A function argument is a transform name like `rev`, or `x => x.fast(2)`.',
    '- Drums: bd, sd, hh, oh, cp, rim, lt, mt, ht, cr, rd. Synths: sine, square, triangle, sawtooth. Noise: white, pink, brown.',
    '- Voices: voice, aah, ooh, hum, whisper, choir. syl("la shee _") sings phonetic syllables: up to two consonants, then a vowel (a e i o u ah oo ee); "_" holds.',
    '- Use `const` for reuse. No imports, loops, if, async, window or fetch.',
  ].join('\n');
}
