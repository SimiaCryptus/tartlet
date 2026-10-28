// Sound kinds of the general kit, for checker rules that depend on the kind of voice (TS-68).
// They mirror @tartlet/resources; a conformance test keeps the two in step.

export const OSCILLATOR_SOUNDS: readonly string[] = ['sine', 'square', 'triangle', 'sawtooth'];
export const NOISE_SOUNDS: readonly string[] = ['white', 'pink', 'brown'];
export const DRUM_SOUNDS: readonly string[] = ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd'];
/** Procedural ambiences (TS-73). */
export const AMBIENCE_SOUNDS: readonly string[] = ['rain', 'wind', 'fire', 'stream', 'surf', 'crowd'];
/** Foley one-shots (TS-74). */
export const FOLEY_SOUNDS: readonly string[] = ['drip', 'click', 'tick', 'creak', 'step'];
/** Creature and machine models (TS-76). */
export const CREATURE_SOUNDS: readonly string[] = ['bird', 'insect', 'engine'];
/** Sounds that receive a texture seed (`tseed`) from core (TS-73). */
export const TEXTURE_SOUNDS: readonly string[] = [...AMBIENCE_SOUNDS, ...FOLEY_SOUNDS, ...CREATURE_SOUNDS];
/** Reverb characters for `space` (TS-69). */
export const SPACE_NAMES: readonly string[] = ['room', 'hall', 'plate', 'church', 'outdoor'];
