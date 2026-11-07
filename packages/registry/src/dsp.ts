// Spectral effect modes for `spectral` (TS-79). The order is the mode index used by the
// spectral kernel in @tartlet/webaudio; a test keeps the two in step.
export const SPECTRAL_MODES: readonly string[] = [
  'none',
  'freeze',
  'blur',
  'gate',
  'robot',
  'whisper',
  'comb',
  'shift',
];

/** Designs for `fir` (TS-81). */
export const FIR_DESIGNS: readonly string[] = ['none', 'lowpass', 'highpass', 'bandpass', 'bandstop'];
/** Kernel lengths for `firlen` (TS-81). */
export const FIR_LENGTHS: readonly string[] = ['short', 'medium', 'long'];
/** Generated body responses for `body` (TS-82). */
export const BODY_NAMES: readonly string[] = [
  'none',
  'box',
  'guitar',
  'violin',
  'tube',
  'can',
  'phone',
  'radio',
  'megaphone',
];
/** Generated speaker cabinets for `cab` (TS-83). */
export const CAB_NAMES: readonly string[] = ['none', 'small', 'open', 'closed', 'combo', 'stack'];
/** Transfer curves for `curve` (TS-86). */
export const CURVE_NAMES: readonly string[] = [
  'none',
  'soft',
  'hard',
  'tanh',
  'tube',
  'fold',
  'rect',
  'half',
  'cheby2',
  'cheby3',
  'cheby4',
  'cheby5',
  'cheby6',
  'cheby7',
];
/** Envelope segment shapes for `envcurve` (TS-88). */
export const ENVCURVE_NAMES: readonly string[] = ['lin', 'exp', 'log'];
/** Rendered cavity shapes for `cavity` (docs/acoustic_rendering.md, Tier A1). */
export const CAVITY_NAMES: readonly string[] = ['none', 'box', 'cylinder', 'sphere', 'tube'];
/** Cavity wall materials for `material`. */
export const MATERIAL_NAMES: readonly string[] = [
  'spruce',
  'maple',
  'wood',
  'metal',
  'glass',
  'plastic',
  'skin',
  'felt',
];
/** Modelled space shapes for `spaceshape` (Tier A2). */
export const SPACE_SHAPES: readonly string[] = ['box', 'cylinder', 'dome', 'corridor'];
/** Modelled space materials for `spacemat`. */
export const SPACE_MATERIALS: readonly string[] = [
  'concrete',
  'stone',
  'brick',
  'plaster',
  'wood',
  'glass',
  'carpet',
  'curtain',
  'snow',
];
