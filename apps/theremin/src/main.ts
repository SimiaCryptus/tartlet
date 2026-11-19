import { freqToMidi, midiToFreq, parseScale } from '@tartlet/registry';
import { ThereminController, midiToNoteName } from './theremin';

function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`missing #${id}`);
  return e;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// ---- elements (ids match index.html)
const field = el('theremin-field', HTMLElement);
const guides = el('theremin-guides', HTMLElement);
const crosshair = el('theremin-crosshair', HTMLElement);
const statusEl = el('audio-status', HTMLElement);
const hzOut = el('readout-hz', HTMLElement);
const noteOut = el('readout-note', HTMLElement);
const gainOut = el('readout-gain', HTMLElement);
const cutoffOut = el('readout-cutoff', HTMLElement);
const holdBtn = el('hold-btn', HTMLButtonElement);
const panicBtn = el('panic-btn', HTMLButtonElement);

const timbre = el('timbre', HTMLSelectElement);
const pitchMode = el('pitch-mode', HTMLSelectElement);
const scaleSelect = el('scale-select', HTMLSelectElement);
const scaleRoot = el('scale-root', HTMLSelectElement);

const accompEnabled = el('accomp-enabled', HTMLInputElement);
const accompPreset = el('accomp-preset', HTMLSelectElement);
const accompApply = el('accomp-apply', HTMLButtonElement);
const accompSource = el('accomp-source', HTMLTextAreaElement);
const accompDiags = el('accomp-diags', HTMLElement);

field.style.touchAction = 'none';

// ---- option mapping
/** Scale names as the registry knows them. */
const SCALE_NAMES: Readonly<Record<string, string>> = {
  pentatonicMajor: 'major pentatonic',
  pentatonicMinor: 'minor pentatonic',
};
const scaleSpec = (): string => `${scaleRoot.value}:${SCALE_NAMES[scaleSelect.value] ?? scaleSelect.value}`;
/** Held voices are oscillators only, so the vowel timbres play as a saw. */
const waveformOf = (v: string): string => (v === 'aah' || v === 'ooh' ? 'sawtooth' : v);

const range = (id: string): HTMLInputElement => el(id, HTMLInputElement);
const fMin = range('freq-min');
const fMax = range('freq-max');
const glideTau = range('glide-tau');
const vibRate = range('vibrato-rate');
const vibDepth = range('vibrato-depth');
const filterCutoff = range('filter-cutoff');
const filterQ = range('filter-q');
const roomAmount = range('room-amount');
const delayAmount = range('delay-amount');
const delayTime = range('delay-time');
const delayFeedback = range('delay-feedback');

const controller = new ThereminController({
  fMin: fMin.valueAsNumber,
  fMax: fMax.valueAsNumber,
  tau: glideTau.valueAsNumber,
  waveform: waveformOf(timbre.value),
  scale: pitchMode.value === 'snap' ? scaleSpec() : '',
  vibratoRate: vibRate.valueAsNumber,
  vibratoDepth: vibDepth.valueAsNumber / 100,
  cutoffMax: filterCutoff.valueAsNumber,
  resonance: filterQ.valueAsNumber,
  room: roomAmount.valueAsNumber,
  delay: delayAmount.valueAsNumber,
  delayTime: delayTime.valueAsNumber,
  delayFeedback: delayFeedback.valueAsNumber,
});

// ---- rendering
let rafId: number | null = null;
let audioFailed = false;

function render(): void {
  const st = controller.state;

  field.dataset.active = String(st.active);
  field.style.setProperty('--cx', `${(st.x * 100).toFixed(2)}%`);
  field.style.setProperty('--cy', `${((1 - st.y) * 100).toFixed(2)}%`);
  crosshair.hidden = !st.active;

  if (audioFailed) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = 'Audio is unavailable in this browser.';
  } else if (st.muted) {
    statusEl.dataset.state = 'idle';
    statusEl.textContent = 'Muted';
  } else if (controller.ready) {
    statusEl.dataset.state = 'active';
    statusEl.textContent = st.hold ? 'Audio on · Hold' : 'Audio on';
  } else {
    statusEl.dataset.state = 'idle';
    statusEl.textContent = 'Audio off — touch or click the field to start';
  }

  hzOut.textContent = `${st.freq.toFixed(1)} Hz`;
  noteOut.textContent = st.noteName;
  gainOut.textContent = st.gain.toFixed(2);
  cutoffOut.textContent = `${String(Math.round(st.cutoff))} Hz`;

  holdBtn.setAttribute('aria-pressed', String(st.hold));

  const running = controller.accompanimentRunning;
  if (accompEnabled.checked !== running && !pendingAccomp) accompEnabled.checked = running;
}

function scheduleRender(): void {
  if (rafId !== null) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    render();
  });
}

// ---- scale guides along the pitch axis
function renderGuides(): void {
  guides.replaceChildren();
  const sc = parseScale(scaleSpec());
  if (!sc) return;
  const lo = Math.max(20, fMin.valueAsNumber);
  const hi = Math.max(lo + 1, fMax.valueAsNumber);
  const first = Math.ceil(freqToMidi(lo));
  const last = Math.floor(freqToMidi(hi));
  const span = Math.log(hi / lo);
  const nodes: HTMLElement[] = [];
  for (let m = first; m <= last && nodes.length < 200; m++) {
    const pc = (((m - sc.root) % 12) + 12) % 12;
    if (!sc.intervals.includes(pc)) continue;
    const x = Math.log(midiToFreq(m) / lo) / span;
    const line = document.createElement('div');
    line.className = 'theremin-guide-line';
    line.style.setProperty('--x', `${(x * 100).toFixed(3)}%`);
    if (pc === 0) {
      line.dataset.root = 'true';
      const label = document.createElement('span');
      label.className = 'theremin-guide-label';
      label.textContent = midiToNoteName(m);
      line.append(label);
    }
    nodes.push(line);
  }
  guides.replaceChildren(...nodes);
}

// ---- pointer handling on the field
let activePointerId: number | null = null;

function normalizedFromPointer(e: PointerEvent): readonly [number, number] {
  const rect = field.getBoundingClientRect();
  const x = rect.width > 0 ? clamp01((e.clientX - rect.left) / rect.width) : 0.5;
  const y = rect.height > 0 ? clamp01(1 - (e.clientY - rect.top) / rect.height) : 0.5;
  return [x, y];
}

function unlock(): void {
  void controller.start().then((engine) => {
    if (!engine) audioFailed = true;
    scheduleRender();
  });
}
document.addEventListener('pointerdown', unlock, { once: true });
document.addEventListener('keydown', unlock, { once: true });

field.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  field.setPointerCapture(e.pointerId);
  const [x, y] = normalizedFromPointer(e);
  controller.pointerDown(x, y);
  scheduleRender();
});

field.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  const [x, y] = normalizedFromPointer(e);
  controller.pointerMove(x, y);
  scheduleRender();
});

function handlePointerRelease(e: PointerEvent): void {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  if (field.hasPointerCapture(e.pointerId)) field.releasePointerCapture(e.pointerId);
  controller.pointerUp();
  scheduleRender();
}
field.addEventListener('pointerup', handlePointerRelease);
field.addEventListener('pointercancel', handlePointerRelease);

// ---- buttons
holdBtn.addEventListener('click', () => {
  controller.toggleHold();
  scheduleRender();
});

function panic(): void {
  activePointerId = null;
  controller.panic();
  accompEnabled.checked = false;
  scheduleRender();
}
panicBtn.addEventListener('click', panic);

// ---- sound & pitch
timbre.addEventListener('change', () => {
  controller.setConfig({ waveform: waveformOf(timbre.value) });
  scheduleRender();
});

function applyScale(): void {
  controller.setConfig({ scale: pitchMode.value === 'snap' ? scaleSpec() : '' });
  renderGuides();
  scheduleRender();
}
pitchMode.addEventListener('change', applyScale);
scaleSelect.addEventListener('change', applyScale);
scaleRoot.addEventListener('change', applyScale);

// ---- sliders: a readout next to each one
function bindRange(
  input: HTMLInputElement,
  outId: string,
  format: (v: number) => string,
  apply: (v: number) => void,
): void {
  const out = el(outId, HTMLElement);
  const update = (): void => {
    const v = input.valueAsNumber;
    if (!Number.isFinite(v)) return;
    out.textContent = format(v);
    apply(v);
    scheduleRender();
  };
  input.addEventListener('input', update);
  out.textContent = format(input.valueAsNumber);
}

bindRange(
  fMin,
  'freq-min-val',
  (v) => `${String(Math.round(v))} Hz`,
  (v) => {
    controller.setConfig({ fMin: v });
    renderGuides();
  },
);
bindRange(
  fMax,
  'freq-max-val',
  (v) => `${String(Math.round(v))} Hz`,
  (v) => {
    controller.setConfig({ fMax: v });
    renderGuides();
  },
);
bindRange(
  glideTau,
  'glide-tau-val',
  (v) => `${v.toFixed(3)} s`,
  (v) => {
    controller.setConfig({ tau: Math.max(0.001, v) });
  },
);
bindRange(
  vibRate,
  'vibrato-rate-val',
  (v) => `${v.toFixed(1)} Hz`,
  (v) => {
    controller.setConfig({ vibratoRate: v });
  },
);
bindRange(
  vibDepth,
  'vibrato-depth-val',
  (v) => `${String(Math.round(v))} ¢`,
  (v) => {
    controller.setConfig({ vibratoDepth: v / 100 });
  },
);
bindRange(
  filterCutoff,
  'filter-cutoff-val',
  (v) => `${String(Math.round(v))} Hz`,
  (v) => {
    controller.setConfig({ cutoffMax: v });
  },
);
bindRange(
  filterQ,
  'filter-q-val',
  (v) => v.toFixed(1),
  (v) => {
    controller.setConfig({ resonance: v });
  },
);
bindRange(
  roomAmount,
  'room-amount-val',
  (v) => v.toFixed(2),
  (v) => {
    controller.setConfig({ room: v });
  },
);
bindRange(
  delayAmount,
  'delay-amount-val',
  (v) => v.toFixed(2),
  (v) => {
    controller.setConfig({ delay: v });
  },
);
bindRange(
  delayTime,
  'delay-time-val',
  (v) => `${v.toFixed(2)} s`,
  (v) => {
    controller.setConfig({ delayTime: v });
  },
);
bindRange(
  delayFeedback,
  'delay-feedback-val',
  (v) => v.toFixed(2),
  (v) => {
    controller.setConfig({ delayFeedback: v });
  },
);

// ---- accompaniment
const PRESETS: Readonly<Record<string, string>> = {
  pulse: `setcpm(108/4)
bass: note("c2 ~ eb2 g2").s("triangle").lpf(param("thereminY").range(200, 1800)).gain(0.28)
pulse: s("hh*8").gain(param("thereminGain").range(0.04, 0.24)).pan(param("thereminX"))`,
  drone: `setcpm(60/4)
pad: note("<c3 eb3 g3 bb3>").s("sawtooth").lpf(param("thereminY").range(300, 2400)).gain(0.12).room(0.5).attack(0.4).release(1)
sub: note("<c2 ab1>").s("sine").gain(param("thereminGain").range(0.05, 0.3))`,
  perc: `setcpm(120/4)
kick: s("bd ~ bd ~").gain(0.7)
tick: s("hh*8").gain(param("thereminGain").range(0.05, 0.3)).pan(param("thereminX"))
clap: s("~ cp").gain(param("thereminY").range(0.2, 0.7))`,
};

let pendingAccomp = false;

function renderDiagnostics(diags: ReturnType<ThereminController['setAccompaniment']>): void {
  const items = diags
    .filter((d) => d.severity !== 'info')
    .map((d) => {
      const li = document.createElement('li');
      li.className = d.severity;
      li.textContent = `line ${String(d.range.start.line + 1)}: ${d.id} ${d.message}`;
      return li;
    });
  accompDiags.replaceChildren(...items);
}

function applyAccompaniment(): void {
  const source = accompSource.value;
  if (source.trim().length === 0) {
    accompDiags.replaceChildren();
    return;
  }
  renderDiagnostics(controller.setAccompaniment(source));
}

accompPreset.addEventListener('change', () => {
  const src = PRESETS[accompPreset.value];
  if (src !== undefined) accompSource.value = src;
  applyAccompaniment();
});

accompApply.addEventListener('click', () => {
  applyAccompaniment();
});

accompEnabled.addEventListener('change', () => {
  if (!accompEnabled.checked) {
    controller.stopAccompaniment();
    scheduleRender();
    return;
  }
  pendingAccomp = true;
  applyAccompaniment();
  void controller.startAccompaniment().then((ok) => {
    pendingAccomp = false;
    if (!ok) {
      accompEnabled.checked = false;
      audioFailed = !controller.ready;
    }
    scheduleRender();
  });
});

// ---- keyboard
document.addEventListener('keydown', (e) => {
  const target = e.target;
  const inEditable =
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'range');

  if (e.code === 'Space' && !inEditable) {
    if (e.repeat) return;
    e.preventDefault();
    controller.toggleHold();
    scheduleRender();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    panic();
  }
});

window.addEventListener('pagehide', () => {
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  controller.dispose();
});

renderGuides();
render();
