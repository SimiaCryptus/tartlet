import type { Diagnostic } from '@tartlet/ir';
import { FxLayer } from './fx';
import { DEFAULT_SYNTH_PARAMS, SCALE_NAMES, SynthController, midiToNoteName, type SynthParams } from './synth';

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------

type NumericParamKey = {
  [K in keyof SynthParams]: SynthParams[K] extends number ? K : never;
}[keyof SynthParams];

interface SliderDef {
  readonly key: NumericParamKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
}

interface SliderGroup {
  readonly title: string;
  readonly sliders: readonly SliderDef[];
}

const SLIDER_GROUPS: readonly SliderGroup[] = [
  {
    title: 'Tone',
    sliders: [
      { key: 'cutoff', label: 'Cutoff', min: 60, max: 16000, step: 10, unit: 'Hz' },
      { key: 'resonance', label: 'Resonance', min: 0.5, max: 18, step: 0.1 },
      { key: 'shape', label: 'Drive', min: 0, max: 1, step: 0.01 },
      { key: 'detune', label: 'Detune', min: 0, max: 50, step: 1, unit: 'ct' },
      { key: 'unison', label: 'Unison', min: 1, max: 6, step: 1 },
    ],
  },
  {
    title: 'Envelope',
    sliders: [
      { key: 'attack', label: 'Attack', min: 0.005, max: 2, step: 0.005, unit: 's' },
      { key: 'decay', label: 'Decay', min: 0.01, max: 2, step: 0.01, unit: 's' },
      { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01 },
      { key: 'release', label: 'Release', min: 0.02, max: 4, step: 0.01, unit: 's' },
    ],
  },
  {
    title: 'Space & Output',
    sliders: [
      { key: 'room', label: 'Room', min: 0, max: 1, step: 0.01 },
      { key: 'delay', label: 'Delay', min: 0, max: 1, step: 0.01 },
      { key: 'gain', label: 'Gain', min: 0, max: 1.2, step: 0.01 },
    ],
  },
];

interface Preset {
  readonly name: string;
  readonly tag: string;
  readonly params: Partial<SynthParams>;
}

const PRESETS: readonly Preset[] = [
  {
    name: 'Neon Lead',
    tag: 'Bright saw stack',
    params: {
      s: 'sawtooth',
      cutoff: 4200,
      resonance: 4,
      attack: 0.01,
      decay: 0.2,
      sustain: 0.7,
      release: 0.3,
      detune: 14,
      unison: 3,
      shape: 0.15,
      room: 0.25,
      delay: 0.25,
      gain: 0.45,
    },
  },
  {
    name: 'Glass Pad',
    tag: 'Slow & dreamy',
    params: {
      s: 'triangle',
      cutoff: 2600,
      resonance: 1.2,
      attack: 0.6,
      decay: 0.8,
      sustain: 0.8,
      release: 1.8,
      detune: 22,
      unison: 4,
      shape: 0,
      room: 0.7,
      delay: 0.35,
      gain: 0.5,
    },
  },
  {
    name: 'Sub Bass',
    tag: 'Deep & driven',
    params: {
      s: 'sine',
      cutoff: 900,
      resonance: 2,
      attack: 0.005,
      decay: 0.3,
      sustain: 0.9,
      release: 0.15,
      detune: 0,
      unison: 1,
      shape: 0.35,
      room: 0.05,
      delay: 0,
      gain: 0.7,
    },
  },
  {
    name: 'Chip Pluck',
    tag: '8-bit arcade',
    params: {
      s: 'square',
      cutoff: 5200,
      resonance: 6,
      attack: 0.005,
      decay: 0.12,
      sustain: 0.1,
      release: 0.2,
      detune: 4,
      unison: 1,
      shape: 0.1,
      room: 0.2,
      delay: 0.3,
      gain: 0.35,
    },
  },
];

const WAVES: readonly { readonly value: string; readonly label: string; readonly path: string }[] = [
  { value: 'sawtooth', label: 'Saw', path: 'M2 13 L9 4 V13 L16 4 V13' },
  { value: 'triangle', label: 'Tri', path: 'M1.5 13 L5.5 5 L9.5 13 L13.5 5 L17.5 13' },
  { value: 'square', label: 'Sqr', path: 'M2 13 V5 H6.5 V13 H11 V5 H15.5 V13 H18' },
  { value: 'sine', label: 'Sine', path: 'M2 9 C4 2 7 2 9.5 9 S15 16 17.5 9' },
];

const ICONS = {
  speaker: ['M3 7 H6 L10 4 V14 L6 11 H3 Z', 'M13 6.5 A3.5 3.5 0 0 1 13 11.5', 'M15.2 4.3 A6.5 6.5 0 0 1 15.2 13.7'],
  speakerOff: ['M3 7 H6 L10 4 V14 L6 11 H3 Z', 'M13 7 L17 11', 'M17 7 L13 11'],
  stop: ['M5.5 4.5 H14.5 V13.5 H5.5 Z'],
  sliders: ['M3 5 H8', 'M12 5 H17', 'M10 3 V7', 'M3 13 H5', 'M9 13 H17', 'M7 11 V15'],
  close: ['M5 4 L15 14', 'M15 4 L5 14'],
  play: ['M6 4 L15 9 L6 14 Z'],
} as const;

const QWERTY_KEYS: readonly { readonly code: string; readonly label: string }[] = [
  { code: 'KeyA', label: 'A' },
  { code: 'KeyS', label: 'S' },
  { code: 'KeyD', label: 'D' },
  { code: 'KeyF', label: 'F' },
  { code: 'KeyG', label: 'G' },
  { code: 'KeyH', label: 'H' },
  { code: 'KeyJ', label: 'J' },
  { code: 'KeyK', label: 'K' },
  { code: 'KeyL', label: 'L' },
  { code: 'Semicolon', label: ';' },
  { code: 'Quote', label: "'" },
  { code: 'KeyQ', label: 'Q' },
  { code: 'KeyW', label: 'W' },
  { code: 'KeyE', label: 'E' },
  { code: 'KeyR', label: 'R' },
  { code: 'KeyT', label: 'T' },
  { code: 'KeyY', label: 'Y' },
  { code: 'KeyU', label: 'U' },
];

const QWERTY_INDEX = new Map<string, number>(QWERTY_KEYS.map((k, idx) => [k.code, idx]));
const ROOT_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const DEFAULT_BACKING = 's("bd sd, hh*4").cutoff(param("cutoff", 1600)).room(param("room", 0.2))';
/** Keep in sync with the `.combo-bar` animation duration in style.css. */
const COMBO_WINDOW_MS = 1400;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeIcon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function makeIconButton(label: string, icon: SVGSVGElement, className = 'icon-btn'): HTMLButtonElement {
  const btn = makeEl('button', className);
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon);
  return btn;
}

function makeChipSelect(
  label: string,
  values: readonly string[],
  selected: string,
  display: (v: string) => string = (v) => v,
): { readonly wrap: HTMLLabelElement; readonly select: HTMLSelectElement } {
  const wrap = makeEl('label', 'chip');
  const select = makeEl('select');
  for (const value of values) {
    const opt = makeEl('option', undefined, display(value));
    opt.value = value;
    if (value === selected) opt.selected = true;
    select.append(opt);
  }
  wrap.append(makeEl('span', 'chip-label', label), select);
  return { wrap, select };
}

/** Re-triggers CSS animations attached to the given classes. */
function restartClasses(el: Element, ...classes: string[]): void {
  el.classList.remove(...classes);
  // Force a style/layout flush so re-adding the classes restarts the animation.
  el.getBoundingClientRect();
  el.classList.add(...classes);
}

function prettyNote(note: string): string {
  return note.replace('#', '♯').replace(/^([A-G])b$/, '$1♭');
}

function decimalsFor(step: number): number {
  const frac = String(step).split('.')[1];
  return frac ? frac.length : 0;
}

// ---------------------------------------------------------------------------
// Build UI
// ---------------------------------------------------------------------------

const synth = new SynthController();
const rootContainer = document.getElementById('app') ?? document.body;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const canVibrate = 'vibrate' in navigator;

// Animated backdrop + particle overlay
const backdrop = makeEl('div', 'backdrop');
backdrop.setAttribute('aria-hidden', 'true');
backdrop.append(makeEl('div', 'backdrop-glow'), makeEl('div', 'backdrop-grid'));

const fxCanvas = makeEl('canvas', 'fx');
fxCanvas.setAttribute('aria-hidden', 'true');
const fx = new FxLayer(fxCanvas, { reducedMotion });

// Splash / start screen
const splash = makeEl('div', 'splash');
splash.setAttribute('role', 'dialog');
splash.setAttribute('aria-label', 'Start Tartlet');
const splashInner = makeEl('div', 'splash-inner');
const splashLogo = makeEl('h1', 'splash-logo', 'TARTLET');
const splashSub = makeEl('p', 'splash-sub', 'Neon poly synth · scale-locked pads · multi-touch');
const splashPlay = makeEl('button', 'splash-play', 'Tap to play');
splashPlay.type = 'button';
const splashHint = makeEl(
  'p',
  'splash-hint',
  hasFinePointer
    ? 'Play with A S D F … and Q W E R …  ·  [ ] shifts octave  ·  Esc stops everything'
    : 'Slide across pads for glissando · use several fingers for chords · headphones recommended',
);
splashInner.append(splashLogo, splashSub, splashPlay, splashHint);
splash.append(splashInner);

// Stage
const stage = makeEl('div', 'stage');

// HUD
const hud = makeEl('header', 'hud');

const brand = makeEl('div', 'brand');
const statusDot = makeEl('span', 'status-dot');
statusDot.setAttribute('role', 'status');
brand.append(makeEl('span', 'brand-logo', 'T'), makeEl('span', 'brand-name', 'Tartlet'), statusDot);

const hudCenter = makeEl('div', 'hud-center');
const nowPlaying = makeEl('output', 'now-playing is-idle', 'Ready');
const combo = makeEl('div', 'combo');
combo.setAttribute('aria-hidden', 'true');
const comboValue = makeEl('span', 'combo-value', 'x0');
const comboLabel = makeEl('span', 'combo-label', 'Combo');
const comboBar = makeEl('span', 'combo-bar');
combo.append(comboValue, comboLabel, comboBar);
hudCenter.append(nowPlaying, combo);

const hudActions = makeEl('div', 'hud-actions');
const iconSpeaker = makeIcon(ICONS.speaker);
const iconSpeakerOff = makeIcon(ICONS.speakerOff);
iconSpeakerOff.classList.add('is-hidden');
const muteBtn = makeIconButton('Mute', iconSpeaker);
muteBtn.append(iconSpeakerOff);
muteBtn.setAttribute('aria-pressed', 'false');
const panicBtn = makeIconButton('All notes off (Esc)', makeIcon(ICONS.stop), 'icon-btn icon-btn--danger');
const settingsBtn = makeIconButton('Sound settings', makeIcon(ICONS.sliders), 'icon-btn icon-btn--accent');
settingsBtn.setAttribute('aria-controls', 'sound-sheet');
settingsBtn.setAttribute('aria-expanded', 'false');
hudActions.append(muteBtn, panicBtn, settingsBtn);

hud.append(brand, hudCenter, hudActions);

// Quick bar
const quickbar = makeEl('nav', 'quickbar');
quickbar.setAttribute('aria-label', 'Quick controls');

const waveSeg = makeEl('div', 'seg');
waveSeg.setAttribute('role', 'group');
waveSeg.setAttribute('aria-label', 'Waveform');
const waveButtons = new Map<string, HTMLButtonElement>();
for (const wave of WAVES) {
  const btn = makeEl('button', 'seg-btn');
  btn.type = 'button';
  btn.title = wave.value;
  btn.setAttribute('aria-label', `${wave.value} wave`);
  btn.setAttribute('aria-pressed', String(wave.value === DEFAULT_SYNTH_PARAMS.s));
  btn.append(makeIcon([wave.path]), makeEl('span', 'seg-label', wave.label));
  btn.addEventListener('click', () => {
    setWave(wave.value);
  });
  waveButtons.set(wave.value, btn);
  waveSeg.append(btn);
}

const { wrap: rootChip, select: rootSelect } = makeChipSelect('Key', ROOT_NOTES, 'C', prettyNote);
const { wrap: scaleChip, select: scaleSelect } = makeChipSelect('Scale', SCALE_NAMES, 'major');

const octChip = makeEl('div', 'chip stepper');
octChip.setAttribute('role', 'group');
octChip.setAttribute('aria-label', 'Octave');
const octDownBtn = makeEl('button', 'step-btn', '−');
octDownBtn.type = 'button';
octDownBtn.setAttribute('aria-label', 'Octave down ([)');
const octValue = makeEl('span', 'step-value', '4');
octValue.setAttribute('aria-live', 'polite');
const octUpBtn = makeEl('button', 'step-btn', '+');
octUpBtn.type = 'button';
octUpBtn.setAttribute('aria-label', 'Octave up (])');
octChip.append(makeEl('span', 'chip-label', 'Oct'), octDownBtn, octValue, octUpBtn);

const beatBtn = makeEl('button', 'chip beat-btn');
beatBtn.type = 'button';
beatBtn.setAttribute('aria-pressed', 'false');
const beatLabel = makeEl('span', undefined, 'Beat');
beatBtn.append(makeIcon(ICONS.play), beatLabel, makeEl('span', 'beat-dot'));

quickbar.append(waveSeg, rootChip, scaleChip, octChip, beatBtn);

// Pads
const padsEl = makeEl('section', 'pads');
padsEl.setAttribute('aria-label', 'Note pads');

const padButtons: HTMLButtonElement[] = [];
const padNoteLabels: HTMLSpanElement[] = [];
const padDegreeLabels: HTMLSpanElement[] = [];

for (const [index, qwerty] of QWERTY_KEYS.entries()) {
  const btn = makeEl('button', 'pad');
  btn.type = 'button';
  btn.dataset.keyIndex = String(index);

  const keyHint = makeEl('span', 'pad-key', qwerty.label);
  const rootDot = makeEl('span', 'pad-root-dot');
  const note = makeEl('span', 'pad-note');
  const degree = makeEl('span', 'pad-degree');

  btn.append(keyHint, rootDot, note, degree);
  padButtons.push(btn);
  padNoteLabels.push(note);
  padDegreeLabels.push(degree);
  padsEl.append(btn);
}

stage.append(hud, quickbar, padsEl);

// Settings sheet
const sheetBackdrop = makeEl('div', 'sheet-backdrop');
const sheet = makeEl('aside', 'sheet');
sheet.id = 'sound-sheet';
sheet.setAttribute('aria-label', 'Sound settings');
sheet.inert = true;

const sheetTop = makeEl('div', 'sheet-top');
const sheetHandle = makeEl('div', 'sheet-handle');
const sheetHead = makeEl('div', 'sheet-head');
const tabs = makeEl('div', 'seg tabs');
tabs.setAttribute('role', 'tablist');
const soundTab = makeEl('button', 'seg-btn', 'Sound');
soundTab.type = 'button';
soundTab.setAttribute('role', 'tab');
soundTab.setAttribute('aria-selected', 'true');
const beatTab = makeEl('button', 'seg-btn', 'Beat');
beatTab.type = 'button';
beatTab.setAttribute('role', 'tab');
beatTab.setAttribute('aria-selected', 'false');
tabs.append(soundTab, beatTab);
const closeBtn = makeIconButton('Close settings', makeIcon(ICONS.close));
sheetHead.append(tabs, closeBtn);
sheetTop.append(sheetHandle, sheetHead);

const sheetBody = makeEl('div', 'sheet-body');

// Sound panel
const soundPanel = makeEl('div', 'sheet-panel');
soundPanel.setAttribute('role', 'tabpanel');

const presetGrid = makeEl('div', 'presets');
const presetButtons = new Map<Preset, HTMLButtonElement>();
for (const preset of PRESETS) {
  const btn = makeEl('button', 'preset-btn');
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'false');
  btn.append(makeEl('span', undefined, preset.name), makeEl('small', undefined, preset.tag));
  btn.addEventListener('click', () => {
    applyPreset(preset);
  });
  presetButtons.set(preset, btn);
  presetGrid.append(btn);
}
soundPanel.append(makeEl('h2', 'section-title', 'Presets'), presetGrid);

interface SliderControl {
  readonly def: SliderDef;
  readonly input: HTMLInputElement;
  readonly valueEl: HTMLSpanElement;
}
const sliderControls = new Map<string, SliderControl>();

function formatSlider(def: SliderDef, v: number): string {
  const text = v.toFixed(decimalsFor(def.step));
  return def.unit ? `${text} ${def.unit}` : text;
}

function paintSlider(ctrl: SliderControl, v: number): void {
  const pct = ((v - ctrl.def.min) / (ctrl.def.max - ctrl.def.min)) * 100;
  ctrl.input.style.setProperty('--fill', `${String(Math.max(0, Math.min(100, pct)))}%`);
  ctrl.valueEl.textContent = formatSlider(ctrl.def, v);
}

function setSliderValue(key: string, v: number): void {
  const ctrl = sliderControls.get(key);
  if (!ctrl) return;
  ctrl.input.value = String(v);
  paintSlider(ctrl, v);
}

for (const group of SLIDER_GROUPS) {
  const grid = makeEl('div', 'sliders');
  for (const def of group.sliders) {
    const card = makeEl('label', 'slider-card');
    const top = makeEl('span', 'slider-top');
    const valueEl = makeEl('span', 'slider-value');
    top.append(makeEl('span', undefined, def.label), valueEl);

    const input = makeEl('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    const initial = DEFAULT_SYNTH_PARAMS[def.key];
    input.value = String(initial);

    const ctrl: SliderControl = { def, input, valueEl };
    sliderControls.set(def.key, ctrl);
    paintSlider(ctrl, initial);

    input.addEventListener('input', () => {
      const v = Number(input.value);
      paintSlider(ctrl, v);
      synth.setParam(def.key, v);
      markPreset(null);
    });
    // Return keyboard focus after dragging so QWERTY keys keep playing.
    input.addEventListener('change', () => {
      input.blur();
    });

    card.append(top, input);
    grid.append(card);
  }
  soundPanel.append(makeEl('h2', 'section-title', group.title), grid);
}

// Beat (backing) panel
const beatPanel = makeEl('div', 'sheet-panel');
beatPanel.setAttribute('role', 'tabpanel');
beatPanel.hidden = true;

const beatIntro = makeEl(
  'p',
  'beat-intro',
  'A live Tartlet pattern that loops under your playing. param("cutoff"), param("room") … follow the Sound sliders in real time.',
);
const backingInput = makeEl('textarea', 'code');
backingInput.rows = 4;
backingInput.value = DEFAULT_BACKING;
backingInput.spellcheck = false;
backingInput.setAttribute('autocapitalize', 'off');
backingInput.setAttribute('autocomplete', 'off');
backingInput.setAttribute('aria-label', 'Backing pattern source');

const backingActions = makeEl('div', 'beat-actions');
const backingToggleBtn = makeEl('button', 'btn btn-primary', 'Start Beat');
backingToggleBtn.type = 'button';
const backingReloadBtn = makeEl('button', 'btn', 'Update Pattern');
backingReloadBtn.type = 'button';
backingReloadBtn.title = 'Ctrl/⌘ + Enter';
backingActions.append(backingToggleBtn, backingReloadBtn);

const backingDiags = makeEl('ul', 'diags');
backingDiags.setAttribute('aria-live', 'polite');

beatPanel.append(beatIntro, backingInput, backingActions, backingDiags);

sheetBody.append(soundPanel, beatPanel);
sheet.append(sheetTop, sheetBody);

rootContainer.replaceChildren(backdrop, stage, fxCanvas, sheetBackdrop, sheet, splash);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activePointers = new Map<number, number>();
const activeQwerty = new Map<string, number>();
let comboCount = 0;
let lastHitAt = 0;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function updateStatus(): void {
  const label = synth.ready ? 'Sound is on' : 'Sound is off — tap or press a key';
  statusDot.classList.toggle('is-on', synth.ready);
  statusDot.title = label;
  statusDot.setAttribute('aria-label', label);
}

function renderKeyLabels(): void {
  const scale = synth.scale;
  const degrees = Math.max(1, scale.intervals.length);
  octValue.textContent = String(4 + synth.octaveOffset);
  for (const [index, btn] of padButtons.entries()) {
    const midi = synth.resolveKeyMidi(index);
    const name = midiToNoteName(midi);
    const rel = ((Math.round(midi - scale.root) % 12) + 12) % 12;
    const hue = (rel * 30 + 315) % 360;
    btn.dataset.hue = String(hue);
    btn.style.setProperty('--hue', String(hue));
    btn.classList.toggle('is-root', rel === 0);
    const label = QWERTY_KEYS[index]?.label ?? '';
    btn.setAttribute('aria-label', `${name} (key ${label})`);
    const noteEl = padNoteLabels[index];
    if (noteEl) noteEl.textContent = name;
    const degEl = padDegreeLabels[index];
    if (degEl) degEl.textContent = String((index % degrees) + 1);
  }
}

function refreshKeyHighlights(): void {
  const held = new Set<number>([...activePointers.values(), ...activeQwerty.values()]);
  for (const [index, btn] of padButtons.entries()) {
    btn.classList.toggle('is-active', held.has(index));
  }
  if (held.size > 0) {
    const names = [...held]
      .sort((a, b) => a - b)
      .map((i) => padNoteLabels[i]?.textContent ?? '')
      .filter((n) => n !== '');
    nowPlaying.textContent = names.join(' · ');
    nowPlaying.classList.remove('is-idle');
  } else {
    nowPlaying.classList.add('is-idle');
  }
  document.documentElement.style.setProperty('--energy', String(Math.min(1, held.size / 4)));
}

function renderDiagnostics(diags: readonly Diagnostic[], running: boolean): void {
  const items = diags.map((d) =>
    makeEl('li', d.severity, `line ${String(d.range.start.line + 1)}: ${d.id} ${d.message}`),
  );
  if (items.length === 0) {
    items.push(makeEl('li', 'ok', running ? 'Beat running.' : 'No issues.'));
  }
  backingDiags.replaceChildren(...items);
}

function syncWaveButtons(value: string): void {
  for (const [wave, btn] of waveButtons) {
    btn.setAttribute('aria-pressed', String(wave === value));
  }
}

function markPreset(active: Preset | null): void {
  for (const [preset, btn] of presetButtons) {
    btn.setAttribute('aria-pressed', String(preset === active));
  }
}

function syncBackingUi(): void {
  const running = synth.backingRunning;
  backingToggleBtn.textContent = running ? 'Stop Beat' : 'Start Beat';
  beatBtn.setAttribute('aria-pressed', String(running));
  beatLabel.textContent = running ? 'Beat on' : 'Beat';
  document.documentElement.classList.toggle('is-beating', running);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setWave(value: string): void {
  synth.setParam('s', value);
  syncWaveButtons(value);
  markPreset(null);
}

function applyPreset(preset: Preset): void {
  synth.updateParams(preset.params);
  for (const [key, value] of Object.entries(preset.params)) {
    if (key === 's') syncWaveButtons(String(value));
    else setSliderValue(key, Number(value));
  }
  markPreset(preset);
}

function applyScale(): void {
  synth.setScale(`${rootSelect.value}4:${scaleSelect.value}`);
  renderKeyLabels();
}

function shiftOctave(delta: number): void {
  synth.shiftOctave(delta);
  renderKeyLabels();
  restartClasses(octValue, 'is-bump');
}

function registerHit(): void {
  const now = performance.now();
  comboCount = now - lastHitAt <= COMBO_WINDOW_MS ? comboCount + 1 : 1;
  lastHitAt = now;
  comboValue.textContent = `x${String(comboCount)}`;
  combo.classList.toggle('is-hot', comboCount >= 8);
  combo.classList.toggle('is-fire', comboCount >= 24);
  restartClasses(combo, 'is-live', 'is-pop');
}

function resetCombo(): void {
  comboCount = 0;
  combo.classList.remove('is-live', 'is-pop', 'is-hot', 'is-fire');
}

function padCenter(idx: number): { x: number; y: number } | null {
  const btn = padButtons[idx];
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function padHue(idx: number): number {
  return Number(padButtons[idx]?.dataset.hue ?? 320);
}

function spawnRipple(btn: HTMLButtonElement, clientX: number, clientY: number): void {
  if (reducedMotion) return;
  const ripples = btn.querySelectorAll('.pad-ripple');
  if (ripples.length >= 3) ripples[0]?.remove();
  const rect = btn.getBoundingClientRect();
  const ripple = makeEl('span', 'pad-ripple');
  ripple.style.setProperty('--x', `${String(clientX - rect.left)}px`);
  ripple.style.setProperty('--y', `${String(clientY - rect.top)}px`);
  ripple.addEventListener(
    'animationend',
    () => {
      ripple.remove();
    },
    { once: true },
  );
  btn.append(ripple);
}

/** Visual + haptic feedback when a pad is struck. */
function strikePad(idx: number, clientX: number, clientY: number, haptic: boolean): void {
  const btn = padButtons[idx];
  if (!btn) return;
  registerHit();
  fx.burst(clientX, clientY, padHue(idx), 0.8 + Math.min(comboCount, 30) / 15);
  spawnRipple(btn, clientX, clientY);
  if (haptic && canVibrate) navigator.vibrate(8);
}

function releasePointer(pointerId: number): void {
  if (!activePointers.has(pointerId)) return;
  activePointers.delete(pointerId);
  synth.noteOff(`ptr:${String(pointerId)}`);
  refreshKeyHighlights();
}

function keyIndexFromTarget(target: EventTarget | null): number | null {
  const keyEl = target instanceof Element ? target.closest<HTMLElement>('[data-key-index]') : null;
  if (!keyEl) return null;
  const raw = keyEl.dataset.keyIndex;
  if (raw === undefined) return null;
  const idx = Number(raw);
  return Number.isInteger(idx) ? idx : null;
}

function keyIndexFromPoint(clientX: number, clientY: number): number | null {
  return keyIndexFromTarget(document.elementFromPoint(clientX, clientY));
}

function releaseAllInputs(): void {
  activePointers.clear();
  activeQwerty.clear();
  synth.allNotesOff();
  refreshKeyHighlights();
}

function panic(): void {
  releaseAllInputs();
  synth.stopAll();
  syncBackingUi();
  renderDiagnostics([], false);
  resetCombo();
  nowPlaying.textContent = 'All notes off';
  nowPlaying.classList.add('is-idle');
}

function setMuted(muted: boolean): void {
  synth.muted = muted;
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.classList.toggle('is-muted', muted);
  iconSpeaker.classList.toggle('is-hidden', muted);
  iconSpeakerOff.classList.toggle('is-hidden', !muted);
  const label = muted ? 'Unmute' : 'Mute';
  muteBtn.title = label;
  muteBtn.setAttribute('aria-label', label);
  if (muted) releaseAllInputs();
}

function setSheetOpen(open: boolean): void {
  if (!open && document.activeElement instanceof HTMLElement && sheet.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  sheet.classList.toggle('is-open', open);
  sheetBackdrop.classList.toggle('is-open', open);
  sheet.inert = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
}

function selectTab(which: 'sound' | 'beat'): void {
  const sound = which === 'sound';
  soundTab.setAttribute('aria-selected', String(sound));
  beatTab.setAttribute('aria-selected', String(!sound));
  soundPanel.hidden = !sound;
  beatPanel.hidden = sound;
  sheetBody.scrollTop = 0;
}

function toggleBacking(): void {
  if (synth.backingRunning) {
    synth.stopBacking();
    syncBackingUi();
    renderDiagnostics([], false);
    return;
  }
  void synth.startBacking(backingInput.value).then((res) => {
    updateStatus();
    syncBackingUi();
    renderDiagnostics(res.diagnostics, synth.backingRunning);
  });
}

function reloadBacking(): void {
  const res = synth.loadBacking(backingInput.value);
  renderDiagnostics(res.diagnostics, synth.backingRunning);
}

function dismissSplash(): void {
  if (splash.classList.contains('is-hidden')) return;
  splash.classList.add('is-hidden');
  splash.inert = true;
  void synth.start().then(updateStatus);
  fx.burst(window.innerWidth / 2, window.innerHeight / 2, 320, 2.5);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// First gesture unlock (any interaction counts)
function unlock(): void {
  void synth.start().then(updateStatus);
}
document.addEventListener('pointerdown', unlock, { once: true });
document.addEventListener('keydown', unlock, { once: true });

splash.addEventListener('click', dismissSplash);

// Block pinch-zoom gestures on iOS Safari so the app behaves like a game.
document.addEventListener('gesturestart', (e) => {
  e.preventDefault();
});

// HUD
muteBtn.addEventListener('click', () => {
  setMuted(!synth.muted);
});
panicBtn.addEventListener('click', panic);
settingsBtn.addEventListener('click', () => {
  setSheetOpen(!sheet.classList.contains('is-open'));
});

// Quick bar
rootSelect.addEventListener('change', () => {
  applyScale();
  rootSelect.blur();
});
scaleSelect.addEventListener('change', () => {
  applyScale();
  scaleSelect.blur();
});
octDownBtn.addEventListener('click', () => {
  shiftOctave(-1);
});
octUpBtn.addEventListener('click', () => {
  shiftOctave(1);
});
beatBtn.addEventListener('click', toggleBacking);

// Sheet
closeBtn.addEventListener('click', () => {
  setSheetOpen(false);
});
sheetBackdrop.addEventListener('click', () => {
  setSheetOpen(false);
});
soundTab.addEventListener('click', () => {
  selectTab('sound');
});
beatTab.addEventListener('click', () => {
  selectTab('beat');
});

let sheetDragStartY: number | null = null;
sheetTop.addEventListener('pointerdown', (e) => {
  sheetDragStartY = e.clientY;
});
sheetTop.addEventListener('pointerup', (e) => {
  if (sheetDragStartY !== null && e.clientY - sheetDragStartY > 50) setSheetOpen(false);
  sheetDragStartY = null;
});
sheetTop.addEventListener('pointercancel', () => {
  sheetDragStartY = null;
});

backingToggleBtn.addEventListener('click', toggleBacking);
backingReloadBtn.addEventListener('click', reloadBacking);
backingInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    reloadBacking();
  }
});

comboBar.addEventListener('animationend', () => {
  resetCombo();
});

// Multi-touch pointer & glissando tracking
padsEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

padsEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const idx = keyIndexFromTarget(e.target);
  if (idx === null) return;
  e.preventDefault();
  activePointers.set(e.pointerId, idx);
  synth.noteOn(`ptr:${String(e.pointerId)}`, synth.resolveKeyMidi(idx));
  strikePad(idx, e.clientX, e.clientY, e.pointerType !== 'mouse');
  refreshKeyHighlights();
  updateStatus();
});

document.addEventListener('pointermove', (e) => {
  const prevIdx = activePointers.get(e.pointerId);
  if (prevIdx === undefined) return;
  if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
    releasePointer(e.pointerId);
    return;
  }
  const nextIdx = keyIndexFromPoint(e.clientX, e.clientY);
  if (nextIdx === prevIdx) {
    fx.trail(e.clientX, e.clientY, padHue(prevIdx));
    return;
  }
  const ptrKeyId = `ptr:${String(e.pointerId)}`;
  synth.noteOff(ptrKeyId);
  if (nextIdx !== null) {
    activePointers.set(e.pointerId, nextIdx);
    synth.noteOn(ptrKeyId, synth.resolveKeyMidi(nextIdx));
    strikePad(nextIdx, e.clientX, e.clientY, e.pointerType !== 'mouse');
  } else {
    activePointers.delete(e.pointerId);
  }
  refreshKeyHighlights();
});

document.addEventListener('pointerup', (e) => {
  releasePointer(e.pointerId);
});
document.addEventListener('pointercancel', (e) => {
  releasePointer(e.pointerId);
});

// QWERTY keyboard (ignores repeats and form-field focus)
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (sheet.classList.contains('is-open')) setSheetOpen(false);
    else panic();
    return;
  }
  if (e.repeat) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

  dismissSplash();

  if (e.code === 'BracketLeft') {
    shiftOctave(-1);
    return;
  }
  if (e.code === 'BracketRight') {
    shiftOctave(1);
    return;
  }

  const idx = QWERTY_INDEX.get(e.code);
  if (idx === undefined || activeQwerty.has(e.code)) return;
  e.preventDefault();
  activeQwerty.set(e.code, idx);
  synth.noteOn(`qwerty:${e.code}`, synth.resolveKeyMidi(idx));
  const center = padCenter(idx);
  if (center) strikePad(idx, center.x, center.y, false);
  refreshKeyHighlights();
  updateStatus();
});

document.addEventListener('keyup', (e) => {
  if (!activeQwerty.has(e.code)) return;
  activeQwerty.delete(e.code);
  synth.noteOff(`qwerty:${e.code}`);
  refreshKeyHighlights();
});

// Stuck-note cleanup
window.addEventListener('blur', releaseAllInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllInputs();
});

// Initial render
renderKeyLabels();
refreshKeyHighlights();
updateStatus();
syncBackingUi();
renderDiagnostics([], false);
