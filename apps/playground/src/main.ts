import './style.css';
import { installCaptureTap } from './audio-capture';
import { defineTartletPlayer, type TartletPlayerElement } from '@tartlet/element';
import { PRESETS, type Preset } from './presets';
import type { Problem } from './assistant';
import { initShare } from './share';
import { initRingtone } from './ringtone';
import { initLibrary, slugify } from './library';
// Must run before the player builds its audio graph so ringtone recording can hear it.
installCaptureTap();

defineTartletPlayer();

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}

const player = el('player') as TartletPlayerElement;
const editor = el('editor') as HTMLTextAreaElement;
const presetList = el('presets');
const presetTitle = el('preset-title');
const seedInput = el('seed') as HTMLInputElement;
const diagBadge = el('diag-badge');
const counts = el('counts');
const toast = el('toast');

let current: Preset = PRESETS[0];
let fileStem = current.id;

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

function markActive(id: string | undefined): void {
  for (const b of presetList.querySelectorAll<HTMLButtonElement>('button.preset')) {
    b.setAttribute('aria-pressed', String(b.dataset.id === id));
  }
}

function loadPreset(p: Preset): void {
  current = p;
  fileStem = p.id;
  editor.value = p.source;
  presetTitle.textContent = p.name;
  markActive(p.id);
  library.forget();
  apply();
}

// ---- presets

function presetButton(p: Preset): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'preset';
  b.dataset.id = p.id;
  const name = document.createElement('span');
  name.className = 'preset-name';
  name.textContent = p.name;
  const blurb = document.createElement('span');
  blurb.className = 'preset-blurb';
  blurb.textContent = p.blurb;
  const tags = document.createElement('span');
  tags.className = 'preset-tags';
  for (const t of p.tags) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = t;
    tags.append(tag);
  }
  b.append(name, blurb, tags);
  b.addEventListener('click', () => {
    loadPreset(p);
  });
  return b;
}
const groups = new Map<string, Preset[]>();
for (const p of PRESETS) {
  const g = groups.get(p.group);
  if (g) g.push(p);
  else groups.set(p.group, [p]);
}
for (const [group, list] of groups) {
  const h = document.createElement('h3');
  h.className = 'preset-group';
  h.textContent = group;
  presetList.append(h, ...list.map(presetButton));
}

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
});

player.addEventListener('statechange', () => {
  document.body.classList.toggle('is-playing', player.playing);
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
  if (t instanceof Element && t.closest('dialog')) return;
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
  loadPreset(current);
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
  const preset = PRESETS.find((p) => p.source === source);
  if (preset) return `#preset=${preset.id}`;
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
  const presetId = /^#preset=([\w-]+)$/.exec(h)?.[1];
  if (presetId !== undefined) {
    const p = PRESETS.find((x) => x.id === presetId);
    if (p) {
      loadPreset(p);
      return true;
    }
    flash('That preset link is not known');
    return false;
  }
  const src = /^#src=([A-Za-z0-9_-]*)$/.exec(h)?.[1];
  if (src === undefined) return false;
  try {
    const source = decode(src);
    const preset = PRESETS.find((p) => p.source === source);
    if (preset) {
      loadPreset(preset);
      return true;
    }
    editor.value = source;
    presetTitle.textContent = 'Shared sketch';
    fileStem = 'shared';
    markActive(undefined);
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
const library = initLibrary(el('library'), {
  getSource: () => editor.value,
  getSeed: () => seedInput.value,
  suggestName: () => presetTitle.textContent || '',
  load(sketch) {
    editor.value = sketch.source;
    presetTitle.textContent = sketch.name;
    fileStem = slugify(sketch.name) || 'sketch';
    markActive(undefined);
    seedInput.value = sketch.seed ?? '';
    applySeed(); // sets or clears the seed, then applies the source
  },
  flash,
});
// ---- optional AI assistant (loaded on first open)
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
      markActive(undefined);
      library.forget();
    }
    apply();
  });
}
const assistantRoot = el('assistant') as HTMLDetailsElement;
let assistantLoaded = false;
assistantRoot.addEventListener('toggle', () => {
  if (!assistantRoot.open || assistantLoaded) return;
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
});

// ---- startup

if (!loadFromHash()) loadPreset(current);

// Pasting a different link into the address bar (or editing the hash) loads it in place.
window.addEventListener('hashchange', () => {
  if (location.hash !== hashFor(editor.value)) loadFromHash();
});
