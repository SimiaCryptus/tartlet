import type { Diagnostic } from '@tartlet/ir';
import { DEFAULT_SYNTH_PARAMS, SCALE_NAMES, SynthController, midiToNoteName } from './synth';

interface SliderDef {
  readonly key: keyof typeof DEFAULT_SYNTH_PARAMS;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
}

const SLIDERS: readonly SliderDef[] = [
  { key: 'cutoff', label: 'Cutoff', min: 60, max: 16000, step: 10, unit: 'Hz' },
  { key: 'resonance', label: 'Resonance', min: 0.5, max: 18, step: 0.1 },
  { key: 'attack', label: 'Attack', min: 0.005, max: 2, step: 0.005, unit: 's' },
  { key: 'decay', label: 'Decay', min: 0.01, max: 2, step: 0.01, unit: 's' },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01 },
  { key: 'release', label: 'Release', min: 0.02, max: 4, step: 0.01, unit: 's' },
  { key: 'detune', label: 'Detune', min: 0, max: 50, step: 1, unit: 'ct' },
  { key: 'unison', label: 'Unison', min: 1, max: 6, step: 1 },
  { key: 'shape', label: 'Drive', min: 0, max: 1, step: 0.01 },
  { key: 'room', label: 'Room', min: 0, max: 1, step: 0.01 },
  { key: 'delay', label: 'Delay', min: 0, max: 1, step: 0.01 },
  { key: 'gain', label: 'Gain', min: 0, max: 1.2, step: 0.01 },
];

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
const OSC_TYPES = ['sawtooth', 'triangle', 'square', 'sine'] as const;
const DEFAULT_BACKING = 's("bd sd, hh*4").cutoff(param("cutoff", 1600)).room(param("room", 0.2))';

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

const synth = new SynthController();
const rootContainer = document.getElementById('app') ?? document.body;

// Header & audio status
const app = makeEl('main', 'synth-app');
app.style.fontFamily = 'system-ui, sans-serif';
app.style.maxWidth = '960px';
app.style.margin = '0 auto';
app.style.padding = '16px';
app.style.display = 'grid';
app.style.gap = '16px';

const header = makeEl('header', 'synth-header');
header.style.display = 'flex';
header.style.flexWrap = 'wrap';
header.style.alignItems = 'center';
header.style.justifyContent = 'space-between';
header.style.gap = '12px';

const title = makeEl('h1', undefined, 'Tartlet Poly Synth');
title.style.margin = '0';
title.style.fontSize = '1.25rem';

const statusEl = makeEl('span', 'audio-status', 'Click, tap or press a key to turn sound on.');

const headerActions = makeEl('div', 'header-actions');
headerActions.style.display = 'flex';
headerActions.style.alignItems = 'center';
headerActions.style.gap = '10px';

const muteLabel = makeEl('label');
const muteCheckbox = makeEl('input');
muteCheckbox.type = 'checkbox';
muteCheckbox.id = 'mute';
muteLabel.append(muteCheckbox, document.createTextNode(' Mute'));

const panicBtn = makeEl('button', 'panic-btn', 'All Notes Off');
panicBtn.type = 'button';

headerActions.append(muteLabel, panicBtn);
header.append(title, statusEl, headerActions);

// Scale & oscillator toolbar
const toolbar = makeEl('section', 'synth-toolbar');
toolbar.style.display = 'flex';
toolbar.style.flexWrap = 'wrap';
toolbar.style.alignItems = 'center';
toolbar.style.gap = '12px';

const oscSelect = makeEl('select');
for (const osc of OSC_TYPES) {
  const opt = makeEl('option', undefined, osc);
  opt.value = osc;
  if (osc === DEFAULT_SYNTH_PARAMS.s) opt.selected = true;
  oscSelect.append(opt);
}
const oscLabel = makeEl('label', undefined, 'Wave ');
oscLabel.append(oscSelect);

const rootSelect = makeEl('select');
for (const note of ROOT_NOTES) {
  const opt = makeEl('option', undefined, note);
  opt.value = note;
  if (note === 'C') opt.selected = true;
  rootSelect.append(opt);
}
const rootLabel = makeEl('label', undefined, 'Root ');
rootLabel.append(rootSelect);

const scaleSelect = makeEl('select');
for (const name of SCALE_NAMES) {
  const opt = makeEl('option', undefined, name);
  opt.value = name;
  if (name === 'major') opt.selected = true;
  scaleSelect.append(opt);
}
const scaleLabel = makeEl('label', undefined, 'Scale ');
scaleLabel.append(scaleSelect);

const octDownBtn = makeEl('button', undefined, 'Oct -');
octDownBtn.type = 'button';
const octDisplay = makeEl('span', 'octave-display', 'Oct 4');
const octUpBtn = makeEl('button', undefined, 'Oct +');
octUpBtn.type = 'button';

toolbar.append(oscLabel, rootLabel, scaleLabel, octDownBtn, octDisplay, octUpBtn);

// Sliders grid
const controlsGrid = makeEl('section', 'synth-controls');
controlsGrid.style.display = 'grid';
controlsGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(170px, 1fr))';
controlsGrid.style.gap = '10px';

for (const def of SLIDERS) {
  const card = makeEl('label', 'control-card');
  card.style.display = 'grid';
  card.style.gap = '4px';

  const top = makeEl('span');
  top.style.display = 'flex';
  top.style.justifyContent = 'space-between';
  top.style.fontSize = '0.85rem';

  const initial = Number(DEFAULT_SYNTH_PARAMS[def.key]);
  const formatVal = (v: number): string => `${String(v)}${def.unit ? ` ${def.unit}` : ''}`;
  const valSpan = makeEl('span', 'control-value', formatVal(initial));
  top.append(makeEl('span', undefined, def.label), valSpan);

  const input = makeEl('input');
  input.type = 'range';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.value = String(initial);

  input.addEventListener('input', () => {
    const v = Number(input.value);
    valSpan.textContent = formatVal(v);
    synth.setParam(def.key, v);
  });
  // Return keyboard focus after dragging a slider so QWERTY keys keep playing.
  input.addEventListener('change', () => {
    input.blur();
  });

  card.append(top, input);
  controlsGrid.append(card);
}

// Polyphonic scale-locked keyboard
const keyboardEl = makeEl('section', 'synth-keyboard');
keyboardEl.style.display = 'grid';
keyboardEl.style.gridTemplateColumns = `repeat(${String(QWERTY_KEYS.length)}, minmax(38px, 1fr))`;
keyboardEl.style.gap = '4px';
keyboardEl.style.touchAction = 'none';
keyboardEl.style.userSelect = 'none';

const keyButtons: HTMLButtonElement[] = [];
const keyNoteLabels: HTMLSpanElement[] = [];

for (const [index, qwerty] of QWERTY_KEYS.entries()) {
  const btn = makeEl('button', 'synth-key');
  btn.type = 'button';
  btn.dataset.keyIndex = String(index);
  btn.style.minHeight = '112px';
  btn.style.display = 'flex';
  btn.style.flexDirection = 'column';
  btn.style.justifyContent = 'space-between';
  btn.style.alignItems = 'center';
  btn.style.padding = '8px 4px';
  btn.style.borderRadius = '6px';
  btn.style.border = '1px solid #888';
  btn.style.background = '#f8f8fa';
  btn.style.cursor = 'pointer';
  btn.style.touchAction = 'none';

  const kbd = makeEl('span', 'key-shortcut', qwerty.label);
  kbd.style.fontSize = '0.75rem';
  kbd.style.opacity = '0.7';

  const noteSpan = makeEl('span', 'key-note');
  noteSpan.style.fontWeight = '600';
  noteSpan.style.fontSize = '0.85rem';

  btn.append(kbd, noteSpan);
  keyButtons.push(btn);
  keyNoteLabels.push(noteSpan);
  keyboardEl.append(btn);
}

// Optional backing track panel
const backingSection = makeEl('section', 'backing-section');
backingSection.style.display = 'grid';
backingSection.style.gap = '8px';

const backingHeader = makeEl('div');
backingHeader.style.display = 'flex';
backingHeader.style.alignItems = 'center';
backingHeader.style.justifyContent = 'space-between';
backingHeader.style.gap = '8px';

const backingTitle = makeEl('strong', undefined, 'Backing Track (live param(...) controls)');
const backingButtons = makeEl('div');
backingButtons.style.display = 'flex';
backingButtons.style.gap = '8px';
const backingToggleBtn = makeEl('button', undefined, 'Start Backing');
backingToggleBtn.type = 'button';
const backingReloadBtn = makeEl('button', undefined, 'Update Pattern');
backingReloadBtn.type = 'button';
backingButtons.append(backingToggleBtn, backingReloadBtn);
backingHeader.append(backingTitle, backingButtons);

const backingInput = makeEl('textarea');
backingInput.rows = 3;
backingInput.value = DEFAULT_BACKING;
backingInput.style.width = '100%';
backingInput.style.fontFamily = 'ui-monospace, monospace';

const backingDiags = makeEl('ul', 'backing-diags');
backingDiags.style.margin = '0';
backingDiags.style.paddingLeft = '18px';
backingDiags.style.fontSize = '0.85rem';

backingSection.append(backingHeader, backingInput, backingDiags);

app.replaceChildren(header, toolbar, controlsGrid, keyboardEl, backingSection);
rootContainer.replaceChildren(app);

// Active interaction state
const activePointers = new Map<number, number>();
const activeQwerty = new Map<string, number>();

function updateStatus(): void {
  statusEl.textContent = synth.ready ? 'Sound is on.' : 'Click, tap or press a key to turn sound on.';
  statusEl.classList.toggle('is-on', synth.ready);
}

function renderKeyLabels(): void {
  const baseOct = 4 + synth.octaveOffset;
  octDisplay.textContent = `Oct ${String(baseOct)}`;
  for (const [index, span] of keyNoteLabels.entries()) {
    span.textContent = midiToNoteName(synth.resolveKeyMidi(index));
  }
}

function refreshKeyHighlights(): void {
  const held = new Set<number>([...activePointers.values(), ...activeQwerty.values()]);
  for (const [index, btn] of keyButtons.entries()) {
    const isDown = held.has(index);
    btn.classList.toggle('is-active', isDown);
    btn.style.background = isDown ? '#dbeafe' : '#f8f8fa';
    btn.style.borderColor = isDown ? '#2563eb' : '#888';
  }
}

function renderDiagnostics(diags: readonly Diagnostic[], running: boolean): void {
  const items = diags.map((d) => {
    const li = makeEl('li', d.severity, `line ${String(d.range.start.line + 1)}: ${d.id} ${d.message}`);
    return li;
  });
  if (items.length === 0) {
    items.push(makeEl('li', undefined, running ? 'Backing track running.' : 'No issues.'));
  }
  backingDiags.replaceChildren(...items);
}

function applyScale(): void {
  const spec = `${rootSelect.value}4:${scaleSelect.value}`;
  synth.setScale(spec);
  renderKeyLabels();
}

function releasePointer(pointerId: number): void {
  if (!activePointers.has(pointerId)) return;
  activePointers.delete(pointerId);
  synth.noteOff(`ptr:${String(pointerId)}`);
  refreshKeyHighlights();
}

function keyIndexFromPoint(clientX: number, clientY: number): number | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const keyEl = hit instanceof Element ? hit.closest<HTMLElement>('[data-key-index]') : null;
  if (!keyEl) return null;
  const raw = keyEl.dataset.keyIndex;
  if (raw === undefined) return null;
  const idx = Number(raw);
  return Number.isInteger(idx) ? idx : null;
}

function releaseAllInputs(): void {
  activePointers.clear();
  activeQwerty.clear();
  synth.allNotesOff();
  refreshKeyHighlights();
}

// First gesture unlock
function unlock(): void {
  void synth.start().then(updateStatus);
}
document.addEventListener('pointerdown', unlock, { once: true });
document.addEventListener('keydown', unlock, { once: true });

// Toolbar listeners
oscSelect.addEventListener('change', () => {
  synth.setParam('s', oscSelect.value);
  oscSelect.blur();
});
rootSelect.addEventListener('change', () => {
  applyScale();
  rootSelect.blur();
});
scaleSelect.addEventListener('change', () => {
  applyScale();
  scaleSelect.blur();
});
octDownBtn.addEventListener('click', () => {
  synth.shiftOctave(-1);
  renderKeyLabels();
});
octUpBtn.addEventListener('click', () => {
  synth.shiftOctave(1);
  renderKeyLabels();
});
muteCheckbox.addEventListener('change', () => {
  synth.muted = muteCheckbox.checked;
  if (muteCheckbox.checked) releaseAllInputs();
});
panicBtn.addEventListener('click', () => {
  releaseAllInputs();
  synth.stopAll();
  backingToggleBtn.textContent = 'Start Backing';
});

// Multi-touch pointer & mouse glissando tracking
keyboardEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-key-index]') : null;
  if (!target) return;
  const idx = Number(target.dataset.keyIndex);
  if (!Number.isInteger(idx)) return;
  e.preventDefault();
  activePointers.set(e.pointerId, idx);
  synth.noteOn(`ptr:${String(e.pointerId)}`, synth.resolveKeyMidi(idx));
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
  if (nextIdx === prevIdx) return;
  const ptrKeyId = `ptr:${String(e.pointerId)}`;
  synth.noteOff(ptrKeyId);
  if (nextIdx !== null) {
    activePointers.set(e.pointerId, nextIdx);
    synth.noteOn(ptrKeyId, synth.resolveKeyMidi(nextIdx));
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

// QWERTY keyboard interaction (ignores repeats and input/textarea focus)
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;

  if (e.code === 'BracketLeft') {
    synth.shiftOctave(-1);
    renderKeyLabels();
    return;
  }
  if (e.code === 'BracketRight') {
    synth.shiftOctave(1);
    renderKeyLabels();
    return;
  }

  const idx = QWERTY_INDEX.get(e.code);
  if (idx === undefined || activeQwerty.has(e.code)) return;
  e.preventDefault();
  activeQwerty.set(e.code, idx);
  synth.noteOn(`qwerty:${e.code}`, synth.resolveKeyMidi(idx));
  refreshKeyHighlights();
  updateStatus();
});

document.addEventListener('keyup', (e) => {
  if (!activeQwerty.has(e.code)) return;
  activeQwerty.delete(e.code);
  synth.noteOff(`qwerty:${e.code}`);
  refreshKeyHighlights();
});

// Stuck-note cleanup on window blur or hidden tab
window.addEventListener('blur', releaseAllInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllInputs();
});

// Backing track controls
backingToggleBtn.addEventListener('click', () => {
  if (synth.backingRunning) {
    synth.stopBacking();
    backingToggleBtn.textContent = 'Start Backing';
    renderDiagnostics([], false);
    return;
  }
  void synth.startBacking(backingInput.value).then((res) => {
    updateStatus();
    backingToggleBtn.textContent = synth.backingRunning ? 'Stop Backing' : 'Start Backing';
    renderDiagnostics(res.diagnostics, synth.backingRunning);
  });
});

backingReloadBtn.addEventListener('click', () => {
  const res = synth.loadBacking(backingInput.value);
  renderDiagnostics(res.diagnostics, synth.backingRunning);
});

renderKeyLabels();
updateStatus();
