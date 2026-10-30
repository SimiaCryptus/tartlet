import './style.css';
import { installCaptureTap } from './audio-capture';
import { initBackgroundAudio } from './background-audio';
import { initPwa } from './pwa';
import { defineTartletPlayer, type TartletPlayerElement } from '@tartlet/element';
import type { AlbumTrack, Problem, Reference } from './assistant';
import type { CodeEditorHandle } from './code-editor';
import { initShare } from './share';
import { initRingtone } from './ringtone';
import { initLibrary } from './library';
import { initQueue, type QueueEntry } from './queue';
import { slugify, toAlbum, type SketchData, type SketchMeta } from './album-schema';
import { createRatingStore, initRatingPanel, sourceKey } from './ratings';
import {
  EMPTY_CATALOG,
  initCatalog,
  loadCatalog,
  resolveAlbumUrl,
  type Catalog,
  type CatalogAlbum,
  type CatalogSketch,
} from './catalog';
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
// ---- ratings and comments: any sketch, stored in this browser, editable during playback
const ratings = createRatingStore();
const ratingPanel = initRatingPanel(el('rating'), ratings, {
  source: () => editor.value,
  name: () => presetTitle.textContent || 'Sketch',
});

/** Albums are discovered through this manifest (albums/manifest.json next to index.html). */
const MANIFEST_URL = new URL('albums/manifest.json', document.baseURI).href;

let catalog: Catalog = EMPTY_CATALOG;
/** Album sketch restored by Reset. */
let current: CatalogSketch | null = null;
/** Album sketch the editor came from, offered as metadata when saving to the library. */
let origin: CatalogSketch | null = null;
let fileStem = 'sketch';
/** Monaco, once loaded (desktop only); null while the plain textarea is in use. */
let codeEditor: CodeEditorHandle | null = null;

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
  ratingPanel.refresh();
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

const browser = initCatalog(
  el('panel-presets'),
  (s) => {
    loadSketch(s);
    // On phones the album list fills the screen; jump to the player so the sketch can be heard.
    if (panels.isMobile()) panels.show('player');
  },
  {
    mount: mountAlbum,
    unmount: (a) => void unmountAlbum(a),
    shareAlbum,
    downloadAlbum,
    ratingOf: (source) => ratings.get(source),
  },
);

// ---- diagnostics badge

player.addEventListener('diagnostics', () => {
  const ds = player.diagnostics;
  codeEditor?.setDiagnostics(ds);
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
function applyNow(): void {
  apply();
  flash('Applied');
}

editor.addEventListener('input', scheduleApply);
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    applyNow();
  }
});
// Monaco with completion and hover docs replaces the textarea on desktop; phones keep the textarea.
if (!matchMedia('(pointer: coarse)').matches) {
  import('./code-editor').then(
    ({ mountCodeEditor }) => {
      codeEditor = mountCodeEditor(editor, { onRun: applyNow });
      codeEditor.setDiagnostics(player.diagnostics);
    },
    () => {
      // keep the plain textarea
    },
  );
}

// Space toggles the transport when focus is not in a field or control.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  const t = e.target;
  if (t instanceof Element && t.closest('dialog, [role="menu"], [role="separator"], .monaco-editor')) return;
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

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
el('download-btn').addEventListener('click', () => {
  saveFile(new Blob([editor.value], { type: 'text/plain' }), `${fileStem}.tartlet`);
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
  ratingOf: (source) => ratings.get(source),
  seedRatings: (entries) => {
    ratings.seed(entries);
  },
  flash,
});
// Keep the stars on the player, album cards and library in step (also across tabs).
ratings.onChange(() => {
  ratingPanel.refresh();
  browser.refresh();
  library.refresh();
});
// ---- play queue
function loadQueueEntry(entry: QueueEntry): void {
  const known = catalog.bySource(entry.source);
  editor.value = entry.source;
  presetTitle.textContent = entry.name;
  fileStem = known?.id ?? (slugify(entry.name) || 'sketch');
  origin = known ?? null;
  if (known) current = known;
  browser.markActive(known?.id);
  library.forget();
  seedInput.value = entry.seed ?? '';
  applySeed(); // sets or clears the seed, then applies the source
}
const queue = initQueue(el('panel-queue'), {
  current() {
    if (!editor.value.trim()) return null;
    const seed = seedInput.value.trim();
    return { name: presetTitle.textContent || 'Sketch', source: editor.value, ...(seed ? { seed } : {}) };
  },
  shown: () => browser.shown().map((s) => ({ name: s.name, source: s.source, ...(s.seed ? { seed: s.seed } : {}) })),
  async play(entry) {
    loadQueueEntry(entry);
    if (!player.playing) await player.play();
  },
  stop() {
    if (player.playing) player.stop();
  },
  isPlaying: () => player.playing,
  flash,
});
// ---- installable app, background playback and lock-screen controls
function skip(dir: 1 | -1): void {
  if (queue.running() && (dir > 0 ? queue.next() : queue.previous())) return;
  const shown = browser.shown();
  const list: readonly CatalogSketch[] = shown.length > 0 ? shown : catalog.sketches;
  if (list.length === 0) return;
  const i = list.findIndex((s) => s.source === editor.value);
  const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  const next = list[j];
  if (!next) return;
  loadSketch(next);
  if (!player.playing) void player.play();
}
const background = initBackgroundAudio(el('bg-audio') as HTMLInputElement, {
  isPlaying: () => player.playing,
  async play() {
    await player.play();
  },
  stop() {
    if (player.playing) player.stop();
  },
  next() {
    skip(1);
  },
  previous() {
    skip(-1);
  },
  title: () => presetTitle.textContent || 'Sketch',
  album: () => origin?.album.name ?? '',
});
player.addEventListener('statechange', () => {
  background.sync();
});
new MutationObserver(() => {
  background.updateMetadata();
}).observe(presetTitle, { childList: true, characterData: true, subtree: true });
background.sync();
initPwa({ installButton: el('install-btn') as HTMLButtonElement, flash });
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
/** Every sketch the album agent may learn from: album sketches, library entries and the editor, with ratings. */
function references(): Reference[] {
  const out: Reference[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string, source: string, description: string, tags: readonly string[]): void => {
    if (!source.trim()) return;
    const key = sourceKey(source);
    if (seen.has(key)) return;
    seen.add(key);
    const r = ratings.get(source);
    out.push({ id, name, source, stars: r?.stars ?? 0, comment: r?.comment ?? '', description, tags });
  };
  for (const s of catalog.sketches) add(s.id, `${s.album.name} · ${s.name}`, s.source, s.description, s.tags);
  for (const s of library.entries()) add(`lib-${s.id}`, s.name, s.source, s.description ?? '', s.tags ?? []);
  add('current', presetTitle.textContent || 'Current sketch', editor.value, '', []);
  return out;
}
function keepAlbum(name: string, _description: string, tracks: readonly AlbumTrack[]): number {
  return library.add(
    tracks.map((t) => ({ name: t.name, source: t.source, description: t.description, category: name, tags: t.tags })),
    name,
  );
}
function exportAiAlbum(name: string, description: string, tracks: readonly AlbumTrack[]): void {
  const now = new Date().toISOString();
  const sketches: SketchData[] = tracks.map((t) => ({
    name: t.name,
    source: t.source,
    savedAt: now,
    category: name,
    ...(t.description ? { description: t.description } : {}),
    ...(t.tags.length > 0 ? { tags: [...t.tags] } : {}),
  }));
  const json = toAlbum(name, sketches, {
    ...(description ? { description } : {}),
    author: 'AI assistant',
  });
  saveFile(
    new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
    `${slugify(name) || 'ai-album'}.json`,
  );
  flash(`Downloaded "${name}"`);
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
        pool: () => catalog.sketches.map((s) => ({ id: s.id, name: `${s.album.name} · ${s.name}`, source: s.source })),
        references,
        keepAlbum,
        exportAlbum: exportAiAlbum,
        onSketchChange(cb) {
          player.addEventListener('diagnostics', cb);
          editor.addEventListener('input', cb);
        },
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
// ---- mounted albums: ?album=<url> (repeatable) adds albums to the catalog and makes them shareable
const ALBUM_PARAM = 'album';
function mountedFromUrl(): string[] {
  const out: string[] = [];
  for (const raw of new URLSearchParams(location.search).getAll(ALBUM_PARAM)) {
    const url = resolveAlbumUrl(raw, document.baseURI);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
let mounted = mountedFromUrl();
/** Shortens album URLs next to the page to a relative path, so links stay readable. */
function albumRef(url: string): string {
  const base = new URL('.', document.baseURI).href;
  return url.startsWith(base) ? url.slice(base.length) : url;
}
function writeMountedToUrl(): void {
  const params = new URLSearchParams(location.search);
  params.delete(ALBUM_PARAM);
  for (const url of mounted) params.append(ALBUM_PARAM, albumRef(url));
  const qs = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}
function albumLink(album: CatalogAlbum): string {
  const link = new URL(location.pathname, location.origin);
  link.searchParams.set(ALBUM_PARAM, albumRef(album.url));
  return link.href;
}
async function refreshCatalog(): Promise<string[]> {
  const { catalog: loaded, errors } = await loadCatalog(MANIFEST_URL, mounted);
  catalog = loaded;
  // Albums may carry ratings; they fill in sketches the user has not rated yet.
  ratings.seed(
    loaded.sketches
      .filter((s) => s.rating !== undefined || s.comment !== undefined)
      .map((s) => ({ source: s.source, name: s.name, stars: s.rating ?? 0, comment: s.comment ?? '' })),
  );
  browser.setCatalog(loaded, errors);
  return errors;
}
async function mountAlbum(raw: string): Promise<boolean> {
  const url = resolveAlbumUrl(raw, document.baseURI);
  if (!url) {
    flash('Enter an http(s) link to an album JSON file');
    return false;
  }
  const existing = catalog.albums.find((a) => a.url === url);
  if (existing) {
    browser.selectAlbum(existing.id);
    flash(`"${existing.name}" is already available`);
    return true;
  }
  mounted = [...mounted, url];
  await refreshCatalog();
  const album = catalog.albums.find((a) => a.url === url);
  if (!album) {
    mounted = mounted.filter((u) => u !== url);
    flash('That album could not be loaded');
    return false;
  }
  writeMountedToUrl();
  browser.selectAlbum(album.id);
  flash(`Mounted "${album.name}"`);
  return true;
}
async function unmountAlbum(album: CatalogAlbum): Promise<void> {
  mounted = mounted.filter((u) => u !== album.url);
  writeMountedToUrl();
  await refreshCatalog();
  browser.selectAlbum('');
  syncUrl(); // a sketch from the removed album is now linked by its source instead
  flash(`Unmounted "${album.name}"`);
}
function shareAlbum(album: CatalogAlbum): void {
  const link = albumLink(album);
  navigator.clipboard.writeText(link).then(
    () => {
      flash('Album link copied');
    },
    () => {
      window.prompt('Copy this album link:', link);
    },
  );
}
/** Saves an album (built in or mounted) as a JSON file with the user's ratings and comments. */
function downloadAlbum(album: CatalogAlbum): void {
  const now = new Date().toISOString();
  let rated = 0;
  const sketches: SketchData[] = album.sketches.map((s) => {
    const r = ratings.get(s.source);
    const stars = r ? r.stars : (s.rating ?? 0);
    const comment = r ? r.comment : (s.comment ?? '');
    if (stars > 0 || comment) rated++;
    return {
      name: s.name,
      source: s.source,
      savedAt: now,
      ...(s.seed ? { seed: s.seed } : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(s.category ? { category: s.category } : {}),
      ...(s.tags.length > 0 ? { tags: s.tags } : {}),
      ...(s.author ? { author: s.author } : {}),
      ...(stars > 0 ? { rating: stars } : {}),
      ...(comment ? { comment } : {}),
    };
  });
  const json = toAlbum(album.name, sketches, {
    id: album.id,
    ...(album.description ? { description: album.description } : {}),
    ...(album.author ? { author: album.author } : {}),
    ...(album.license ? { license: album.license } : {}),
    ...(album.category ? { category: album.category } : {}),
    ...(album.tags.length > 0 ? { tags: album.tags } : {}),
  });
  saveFile(
    new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
    `${slugify(album.name) || album.id}.json`,
  );
  flash(rated > 0 ? `Saved "${album.name}" with ${String(rated)} rated` : `Saved "${album.name}" (no ratings yet)`);
}

// ---- startup: discover albums, then load the sketch from the URL or the first album sketch

async function start(): Promise<void> {
  const errors = await refreshCatalog();
  if (errors.length > 0) flash('Some albums could not be loaded');
  // A shared album link opens that album.
  const linked = mounted.map((u) => catalog.albums.find((a) => a.url === u)).find((a) => a !== undefined);
  if (linked) browser.selectAlbum(linked.id);
  if (!loadFromHash()) {
    const first = linked?.sketches[0] ?? catalog.byId('groove') ?? catalog.sketches[0];
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
