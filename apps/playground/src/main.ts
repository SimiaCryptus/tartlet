import './style.css';
import { installCaptureTap } from './audio-capture';
import { defineTartletPlayer, type TartletPlayerElement } from '@tartlet/element';
import type { Problem } from './assistant';
import { initShare } from './share';
import { initRingtone } from './ringtone';
import { initLibrary } from './library';
import { slugify, type SketchMeta } from './album-schema';
import { EMPTY_CATALOG, initCatalog, loadCatalog, type Catalog, type CatalogSketch } from './catalog';
import { initPanels } from './panels';
// Must run before the player builds its audio graph so ringtone recording can hear it.
installCaptureTap();

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}

// Restore the window layout before the player is defined, so it is not moved after it connects.
const panels = initPanels({
  desk: el('desk'),
  windowsButton: el('windows-btn') as HTMLButtonElement,
  tabbar: el('tabbar'),
  defaultActive: 'player',
});

defineTartletPlayer();

const player = el('player') as TartletPlayerElement;
const editor = el('editor') as HTMLTextAreaElement;
const presetTitle = el('preset-title');
const seedInput = el('seed') as HTMLInputElement;
const diagBadge = el('diag-badge');
const counts = el('counts');
const toast = el('toast');
const fab = el('fab-play') as HTMLButtonElement;

/** Albums are discovered through this manifest (albums/manifest.json next to index.html). */
const MANIFEST_URL = new URL('albums/manifest.json', document.baseURI).href;

let catalog: Catalog = EMPTY_CATALOG;
/** Album sketch restored by Reset. */
let current: CatalogSketch | null = null;
/** Album sketch the editor came from, offered as metadata when saving to the library. */
let origin: CatalogSketch | null = null;
let fileStem = 'sketch';

// ---- feedback

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function flash(msg: string): void {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 1800);
}

function updateCounts(): void {
  const lines = editor.value.split('\n').length;
  counts.textContent = `${String(lines)} lines · ${String(editor.value.length)} chars`;
}

// ---- applying source

let timer: ReturnType<typeof setTimeout> | undefined;
function apply(): void {
  clearTimeout(timer);
  player.source = editor.value;
  updateCounts();
  syncUrl();
}
function scheduleApply(): void {
  clearTimeout(timer);
  updateCounts();
  timer = setTimeout(apply, 300);
}

function loadSketch(s: CatalogSketch): void {
  current = s;
  origin = s;
  fileStem = s.id;
  editor.value = s.source;
  presetTitle.textContent = s.name;
  browser.markActive(s.id);
  library.forget();
  if (s.seed !== undefined) {
    seedInput.value = s.seed;
    applySeed();
  } else {
    apply();
  }
}

// ---- album browser

const browser = initCatalog(el('panel-presets'), (s) => {
  loadSketch(s);
  // On phones the album list fills the screen; jump to the player so the sketch can be heard.
  if (panels.isMobile()) panels.show('player');
});

// ---- diagnostics badge

player.addEventListener('diagnostics', () => {
  const ds = player.diagnostics;
  const errors = ds.filter((d) => d.severity === 'error').length;
  const warnings = ds.filter((d) => d.severity === 'warning').length;
  const plural = (n: number, w: string): string => `${String(n)} ${w}${n === 1 ? '' : 's'}`;
  if (errors > 0) {
    diagBadge.className = 'badge error';
    diagBadge.textContent = plural(errors, 'error');
  } else if (warnings > 0) {
    diagBadge.className = 'badge warning';
    diagBadge.textContent = plural(warnings, 'warning');
  } else {
    diagBadge.className = 'badge ok';
    diagBadge.textContent = 'No issues';
  }
  document.body.classList.toggle(
    'has-pulse',
    ds.some((d) => d.id === 'I-EXT-PULSE'),
  );
});

// ---- transport state (logo pulse and the phone play button)

function updateTransport(): void {
  const playing = player.playing;
  document.body.classList.toggle('is-playing', playing);
  fab.textContent = playing ? '■' : '▶';
  fab.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  fab.classList.toggle('is-playing', playing);
}
player.addEventListener('statechange', updateTransport);
fab.addEventListener('click', () => {
  if (player.playing) player.stop();
  else void player.play();
});
updateTransport();

// ---- pulse warning (TS-61): shown once per session before playing steady 3–30 Hz pulsing
const pulseDialog = el('pulse-dialog') as HTMLDialogElement;
const pulseRates = el('pulse-rates');
const PULSE_ACK_KEY = 'tartlet.pulse-ack';
let pulseAck = false;
function pulseAcknowledged(): boolean {
  if (pulseAck) return true;
  try {
    return sessionStorage.getItem(PULSE_ACK_KEY) === '1';
  } catch {
    return false;
  }
}
function acknowledgePulse(): void {
  pulseAck = true;
  try {
    sessionStorage.setItem(PULSE_ACK_KEY, '1');
  } catch {
    // storage unavailable; the in-memory flag still covers this page
  }
}
player.addEventListener('beforeplay', (e) => {
  if (!player.diagnostics.some((d) => d.id === 'I-EXT-PULSE') || pulseAcknowledged()) return;
  e.preventDefault();
  const ranges = (player.program?.advisories ?? []).flatMap((a) =>
    a.pulse ? [`${a.output}: ${String(a.pulse[0])}–${String(a.pulse[1])} Hz`] : [],
  );
  pulseRates.textContent = ranges.join(', ') || 'see the diagnostics';
  pulseDialog.showModal();
});
el('pulse-play').addEventListener('click', () => {
  acknowledgePulse();
  pulseDialog.close();
  void player.play();
});
el('pulse-cancel').addEventListener('click', () => {
  pulseDialog.close();
});

// ---- editor

editor.addEventListener('input', scheduleApply);
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    apply();
    flash('Applied');
  }
});

// Space toggles the transport when focus is not in a field or control.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  const t = e.target;
  if (t instanceof Element && t.closest('dialog, [role="menu"], [role="separator"]')) return;
  if (
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLInputElement ||
    t instanceof HTMLSelectElement ||
    t instanceof HTMLButtonElement ||
    t instanceof HTMLAnchorElement ||
    t instanceof HTMLMediaElement ||
    t === player
  )
    return;
  e.preventDefault();
  if (player.playing) player.stop();
  else void player.play();
});

// ---- toolbar

el('apply-btn').addEventListener('click', () => {
  apply();
  flash('Applied');
});

el('reset-btn').addEventListener('click', () => {
  if (!current) {
    flash('No album sketch to restore');
    return;
  }
  loadSketch(current);
  flash(`Restored "${current.name}"`);
});

el('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(editor.value).then(
    () => {
      flash('Source copied');
    },
    () => {
      flash('Copy failed');
    },
  );
});

el('help-btn').addEventListener('click', () => {
  panels.show('cheatsheet');
});

function encode(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
// ---- URL tracking: the hash always mirrors the editor, so the address bar is a shareable link.
function hashFor(source: string): string {
  const known = catalog.bySource(source);
  if (known) return `#preset=${known.id}`;
  return source.trim() ? `#src=${encode(source)}` : '';
}
function syncUrl(): void {
  const hash = hashFor(editor.value);
  if (location.hash === hash) return;
  // replaceState keeps history clean and does not fire hashchange.
  history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
}
/** Loads the sketch described by the current URL hash. Returns false if there was none. */
function loadFromHash(): boolean {
  const h = location.hash;
  const sketchId = /^#preset=([\w-]+)$/.exec(h)?.[1];
  if (sketchId !== undefined) {
    const s = catalog.byId(sketchId);
    if (s) {
      loadSketch(s);
      return true;
    }
    flash('That sketch link is not known');
    return false;
  }
  const src = /^#src=([A-Za-z0-9_-]*)$/.exec(h)?.[1];
  if (src === undefined) return false;
  try {
    const source = decode(src);
    const known = catalog.bySource(source);
    if (known) {
      loadSketch(known);
      return true;
    }
    editor.value = source;
    presetTitle.textContent = 'Shared sketch';
    fileStem = 'shared';
    origin = null;
    browser.markActive(undefined);
    library.forget();
    apply();
    return true;
  } catch {
    flash('That share link could not be read');
    return false;
  }
}

const openShare = initShare(el('share-dialog') as HTMLDialogElement, {
  url: () => location.href,
  title: () => presetTitle.textContent || 'Sketch',
  source: () => editor.value,
  fileStem: () => fileStem,
  flash,
});
el('share-btn').addEventListener('click', () => {
  apply(); // also syncs the URL hash, so location.href is the current sketch
  openShare();
});

const openRingtone = initRingtone(el('ringtone-dialog') as HTMLDialogElement, {
  async prepare() {
    apply();
    if (player.playing) player.stop();
    await player.play();
  },
  stop() {
    if (player.playing) player.stop();
  },
  fileStem: () => fileStem,
  hasErrors: () => player.diagnostics.some((d) => d.severity === 'error'),
  flash,
});
el('ringtone-btn').addEventListener('click', openRingtone);

el('download-btn').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileStem}.tartlet`;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
});

function applySeed(): void {
  const v = seedInput.value.trim();
  if (v) player.setAttribute('seed', v);
  else player.removeAttribute('seed');
  apply();
}
seedInput.addEventListener('change', applySeed);
el('reroll-btn').addEventListener('click', () => {
  seedInput.value = Math.random().toString(36).slice(2, 8);
  applySeed();
  flash(`Seed: ${seedInput.value}`);
});
// ---- personal library (localStorage, JSON albums)
function originMeta(): SketchMeta {
  if (!origin) return {};
  return {
    ...(origin.description ? { description: origin.description } : {}),
    ...(origin.category ? { category: origin.category } : {}),
    ...(origin.tags.length > 0 ? { tags: origin.tags } : {}),
    ...(origin.author ? { author: origin.author } : {}),
  };
}
const library = initLibrary(el('library'), {
  getSource: () => editor.value,
  getSeed: () => seedInput.value,
  suggestName: () => presetTitle.textContent || '',
  suggestMeta: originMeta,
  load(sketch) {
    editor.value = sketch.source;
    presetTitle.textContent = sketch.name;
    fileStem = slugify(sketch.name) || 'sketch';
    origin = null;
    browser.markActive(undefined);
    seedInput.value = sketch.seed ?? '';
    applySeed(); // sets or clears the seed, then applies the source
    if (panels.isMobile()) panels.show('player');
  },
  flash,
});
// ---- optional AI assistant (loaded the first time its window is shown)
function describeDiagnostic(d: object): string {
  const r = d as Record<string, unknown>;
  const severity = typeof r.severity === 'string' ? r.severity : 'issue';
  const message = typeof r.message === 'string' ? r.message : JSON.stringify(d);
  const line = typeof r.line === 'number' ? ` (line ${String(r.line)})` : '';
  return `${severity}${line}: ${message}`;
}
function currentProblems(): Problem[] {
  return player.diagnostics
    .filter((d) => d.severity === 'error' || d.severity === 'warning')
    .map((d) => ({ severity: d.severity, text: describeDiagnostic(d) }));
}
function setSourceAndCheck(source: string, title?: string): Promise<Problem[]> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(waitTimer);
      player.removeEventListener('diagnostics', finish);
      resolve(currentProblems());
    };
    const waitTimer = setTimeout(finish, 1500);
    player.addEventListener('diagnostics', finish);
    editor.value = source;
    if (title) {
      presetTitle.textContent = title;
      fileStem = 'ai-sketch';
      origin = null;
      browser.markActive(undefined);
      library.forget();
    }
    apply();
  });
}
const assistantRoot = el('assistant');
let assistantLoaded = false;
function loadAssistant(): void {
  if (assistantLoaded) return;
  assistantLoaded = true;
  import('./assistant').then(
    ({ initAssistant }) => {
      initAssistant(assistantRoot, {
        getSource: () => editor.value,
        setSource: setSourceAndCheck,
        problems: currentProblems,
        flash,
      });
    },
    () => {
      assistantLoaded = false;
      flash('Could not load the assistant');
    },
  );
}
assistantRoot.addEventListener('panelshow', loadAssistant);
if (panels.isVisible('assistant')) loadAssistant();

// ---- startup: discover albums, then load the sketch from the URL or the first album sketch

async function start(): Promise<void> {
  const { catalog: loaded, errors } = await loadCatalog(MANIFEST_URL);
  catalog = loaded;
  browser.setCatalog(loaded, errors);
  if (errors.length > 0) flash('Some albums could not be loaded');
  if (!loadFromHash()) {
    const first = catalog.byId('groove') ?? catalog.sketches[0];
    if (first) loadSketch(first);
    else {
      presetTitle.textContent = 'Untitled';
      updateCounts();
    }
  }
  // Pasting a different link into the address bar (or editing the hash) loads it in place.
  window.addEventListener('hashchange', () => {
    if (location.hash !== hashFor(editor.value)) loadFromHash();
  });
}
void start();
