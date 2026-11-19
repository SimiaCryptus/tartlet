import { freqToMidi, midiToFreq, parseScale } from '@tartlet/registry';
import { FieldFx, hueForMidi } from './fx';
import { ThereminController, midiToNoteName } from './theremin';

function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`missing #${id}`);
  return e;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// ---- elements (ids match index.html)
const root = document.documentElement;
const app = el('app', HTMLElement);
const field = el('theremin-field', HTMLElement);
const guides = el('theremin-guides', HTMLElement);
const fxCanvas = el('fx-canvas', HTMLCanvasElement);
const statusEl = el('audio-status', HTMLElement);
const hzOut = el('readout-hz', HTMLElement);
const noteOut = el('readout-note', HTMLElement);
const gainOut = el('readout-gain', HTMLElement);
const cutoffOut = el('readout-cutoff', HTMLElement);
const gainMeter = el('gain-meter', HTMLElement);
const cutoffMeter = el('cutoff-meter', HTMLElement);

const holdBtn = el('hold-btn', HTMLButtonElement);
const snapBtn = el('snap-btn', HTMLButtonElement);
const jamBtn = el('jam-btn', HTMLButtonElement);
const settingsBtn = el('settings-btn', HTMLButtonElement);
const panicBtn = el('panic-btn', HTMLButtonElement);
const fullscreenBtn = el('fullscreen-btn', HTMLButtonElement);

const sheet = el('settings-sheet', HTMLElement);
const sheetClose = el('sheet-close', HTMLButtonElement);
const tabs = Array.from(sheet.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

const timbre = el('timbre', HTMLSelectElement);
const pitchMode = el('pitch-mode', HTMLSelectElement);
const scaleSelect = el('scale-select', HTMLSelectElement);
const scaleRoot = el('scale-root', HTMLSelectElement);

const accompEnabled = el('accomp-enabled', HTMLInputElement);
const accompPreset = el('accomp-preset', HTMLSelectElement);
const accompApply = el('accomp-apply', HTMLButtonElement);
const accompSource = el('accomp-source', HTMLTextAreaElement);
const accompDiags = el('accomp-diags', HTMLElement);

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

const MAX_GAIN = 0.85;

const controller = new ThereminController({
  fMin: fMin.valueAsNumber,
  fMax: fMax.valueAsNumber,
  tau: glideTau.valueAsNumber,
  maxGain: MAX_GAIN,
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

const fx = new FieldFx(fxCanvas, () => controller.state);

// ---- small helpers
function haptic(ms: number): void {
  if (!('vibrate' in navigator)) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* not supported */
  }
}

const formatHz = (hz: number): string => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : String(Math.round(hz)));

function popNote(): void {
  noteOut.classList.remove('pop');
  noteOut.classList.add('pop');
}

// ---- rendering
let rafId: number | null = null;
let audioFailed = false;
let pendingAccomp = false;
let lastNote = '';

function render(): void {
  const st = controller.state;

  root.style.setProperty('--hue', hueForMidi(st.midi).toFixed(1));
  app.dataset.active = String(st.active);
  app.dataset.hold = String(st.hold);
  app.dataset.mode = st.quantized ? 'snap' : 'glide';

  if (audioFailed) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = 'No audio';
  } else if (st.muted) {
    statusEl.dataset.state = 'idle';
    statusEl.textContent = 'Muted';
  } else if (controller.ready) {
    statusEl.dataset.state = 'active';
    statusEl.textContent = st.hold ? 'Live · Hold' : 'Live';
  } else {
    statusEl.dataset.state = 'idle';
    statusEl.textContent = 'Tap to start';
  }

  hzOut.textContent = st.freq.toFixed(1);
  noteOut.textContent = st.noteName;
  if (st.active && st.noteName !== lastNote) {
    popNote();
    if (st.quantized && lastNote !== '') {
      fx.noteChange(st.noteName);
      haptic(6);
    }
  }
  lastNote = st.active ? st.noteName : '';

  gainOut.textContent = st.gain.toFixed(2);
  cutoffOut.textContent = formatHz(st.cutoff);
  gainMeter.style.setProperty('--level', clamp01(st.gain / MAX_GAIN).toFixed(3));
  cutoffMeter.style.setProperty('--level', clamp01(Math.log(st.cutoff / 150) / Math.log(12000 / 150)).toFixed(3));

  holdBtn.setAttribute('aria-pressed', String(st.hold));
  snapBtn.setAttribute('aria-pressed', String(pitchMode.value === 'snap'));

  const running = controller.accompanimentRunning;
  if (accompEnabled.checked !== running && !pendingAccomp) accompEnabled.checked = running;
  jamBtn.setAttribute('aria-pressed', String(accompEnabled.checked));
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

// ---- audio unlock (iOS needs a real gesture; retry until it sticks)
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const;

function unlock(): void {
  if (controller.ready) return;
  void controller.start().then((engine) => {
    audioFailed = !engine;
    if (engine) {
      for (const t of UNLOCK_EVENTS) document.removeEventListener(t, unlock, true);
    }
    scheduleRender();
  });
}
for (const t of UNLOCK_EVENTS) document.addEventListener(t, unlock, { capture: true, passive: true });

function resumeAudio(): void {
  void controller.start().then((engine) => {
    if (engine && engine.ctx.state !== 'running') {
      engine.ctx.resume().catch(() => undefined);
    }
  });
}

// ---- pointer handling on the field
let activePointerId: number | null = null;

function normalizedFromPointer(e: PointerEvent): readonly [number, number] {
  const rect = field.getBoundingClientRect();
  const x = rect.width > 0 ? clamp01((e.clientX - rect.left) / rect.width) : 0.5;
  const y = rect.height > 0 ? clamp01(1 - (e.clientY - rect.top) / rect.height) : 0.5;
  return [x, y];
}

field.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  field.setPointerCapture(e.pointerId);
  app.dataset.started = 'true';
  resumeAudio();
  const [x, y] = normalizedFromPointer(e);
  controller.pointerDown(x, y);
  fx.burst();
  haptic(8);
  scheduleRender();
});

field.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  const [x, y] = normalizedFromPointer(e);
  controller.pointerMove(x, y);
  fx.wake();
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
field.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});
// Safari pinch-zoom gestures would otherwise hijack the field.
document.addEventListener(
  'gesturestart',
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);

// ---- dock
holdBtn.addEventListener('click', () => {
  app.dataset.started = 'true';
  controller.toggleHold();
  fx.wake();
  haptic(10);
  scheduleRender();
});

snapBtn.addEventListener('click', () => {
  pitchMode.value = pitchMode.value === 'snap' ? 'continuous' : 'snap';
  applyScale();
  haptic(6);
});

jamBtn.addEventListener('click', () => {
  accompEnabled.checked = !accompEnabled.checked;
  accompEnabled.dispatchEvent(new Event('change'));
  haptic(6);
});

function panic(): void {
  activePointerId = null;
  controller.panic();
  accompEnabled.checked = false;
  haptic(20);
  scheduleRender();
}
panicBtn.addEventListener('click', panic);

// ---- fullscreen (hidden where unsupported, e.g. iPhone Safari)
if (!document.fullscreenEnabled) fullscreenBtn.hidden = true;
fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  } else {
    root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.setAttribute('aria-pressed', String(document.fullscreenElement !== null));
});

// ---- settings sheet
function setSheet(open: boolean): void {
  sheet.dataset.open = String(open);
  sheet.setAttribute('aria-hidden', String(!open));
  sheet.toggleAttribute('inert', !open);
  settingsBtn.setAttribute('aria-expanded', String(open));
}
settingsBtn.addEventListener('click', () => {
  setSheet(sheet.dataset.open !== 'true');
});
sheetClose.addEventListener('click', () => {
  setSheet(false);
  settingsBtn.focus({ preventScroll: true });
});

function selectTab(tab: HTMLButtonElement): void {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
    if (panel) panel.hidden = !selected;
  }
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => {
    selectTab(tab);
  });
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (next) {
      selectTab(next);
      next.focus();
    }
  });
});

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

// ---- sliders: a readout and a filled track for each one
function bindRange(
  input: HTMLInputElement,
  outId: string,
  format: (v: number) => string,
  apply: (v: number) => void,
): void {
  const out = el(outId, HTMLElement);
  const setFill = (): void => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const pct = max > min ? ((input.valueAsNumber - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${String(clamp01(pct / 100) * 100)}%`);
  };
  const update = (): void => {
    const v = input.valueAsNumber;
    if (!Number.isFinite(v)) return;
    out.textContent = format(v);
    setFill();
    apply(v);
    scheduleRender();
  };
  input.addEventListener('input', update);
  out.textContent = format(input.valueAsNumber);
  setFill();
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
  scheduleRender();
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
    app.dataset.started = 'true';
    controller.toggleHold();
    fx.wake();
    scheduleRender();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    setSheet(false);
    panic();
  }
});

// ---- lifecycle
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (activePointerId !== null) {
      activePointerId = null;
      controller.pointerUp();
    }
  } else {
    fx.wake();
    scheduleRender();
  }
});

window.addEventListener('pagehide', () => {
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  fx.dispose();
  controller.dispose();
});

setSheet(false);
renderGuides();
render();
