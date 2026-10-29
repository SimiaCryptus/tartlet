// Personal library: named sketches saved in this browser, exportable and importable as JSON albums.
import {
  cleanName,
  cleanTags,
  parseAlbum,
  parseSketch,
  slugify,
  toAlbum,
  type SketchData,
  type SketchMeta,
} from './album-schema';
import { starText, type Rating, type RatingSeed } from './ratings';

export interface SavedSketch extends SketchData {
  readonly id: string;
}

export interface LibraryHost {
  getSource(): string;
  getSeed(): string;
  /** Name offered when the name field is empty (usually the current title). */
  suggestName(): string;
  /** Metadata offered for new entries (usually from the album sketch that was loaded). */
  suggestMeta(): SketchMeta;
  /** Puts a saved sketch into the editor and applies it. */
  load(sketch: SavedSketch): void;
  /** The user's rating and comment for a sketch source. */
  ratingOf(source: string): Rating | undefined;
  /** Adds ratings from an imported album for sketches the user has not rated yet. */
  seedRatings(entries: readonly RatingSeed[]): void;
  flash(msg: string): void;
}

export interface LibraryHandle {
  /** Called when the editor is replaced by something that is not a library entry. */
  forget(): void;
  /** Re-renders the list (for example after ratings change). */
  refresh(): void;
  /** The saved sketches. */
  entries(): readonly SavedSketch[];
  /** Adds sketches (for example an AI album). Returns the number added, or -1 if storage failed. */
  add(entries: readonly LibraryEntry[], albumName?: string): number;
}
export interface LibraryEntry {
  readonly name: string;
  readonly source: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
}

interface Store {
  album: string;
  sketches: SavedSketch[];
}

const STORAGE_KEY = 'tartlet.library.v1';
const MAX_IMPORT_BYTES = 5_000_000;

// ---- helpers

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function uniqueName(base: string, taken: readonly { name: string }[]): string {
  for (let i = 2; ; i++) {
    const candidate = `${base} (${String(i)})`;
    if (!taken.some((s) => sameName(s.name, candidate))) return candidate;
  }
}

function withMeta(m: SketchMeta, tags: readonly string[]): SketchMeta {
  return {
    ...(m.description ? { description: m.description } : {}),
    ...(m.category ? { category: m.category } : {}),
    ...(m.author ? { author: m.author } : {}),
    ...(tags.length > 0 ? { tags: [...tags] } : {}),
  };
}
/** Ratings live in the rating store, not in library entries. */
function withoutRating({ ...rest }: SketchData): SketchData {
  return rest;
}

// ---- storage

function loadStore(): Store {
  const empty: Store = { album: '', sketches: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null) return empty;
    const r = data as Record<string, unknown>;
    const items: unknown[] = Array.isArray(r.sketches) ? r.sketches : [];
    const sketches: SavedSketch[] = [];
    const ids = new Set<string>();
    for (const item of items) {
      const s = parseSketch(item);
      if (!s) continue;
      let id = str((item as Record<string, unknown>).id) || newId();
      if (ids.has(id)) id = newId();
      ids.add(id);
      sketches.push({ ...s, id });
    }
    return { album: str(r.album) ?? '', sketches };
  } catch {
    return empty;
  }
}

function saveStore(s: Store): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const plural = (n: number, w: string): string => `${String(n)} ${w}${n === 1 ? '' : 's'}`;

// ---- UI

export function initLibrary(root: HTMLElement, host: LibraryHost): LibraryHandle {
  function q<T extends HTMLElement>(sel: string, type: new () => T): T {
    const e = root.querySelector(sel);
    if (!(e instanceof type)) throw new Error(`missing ${sel}`);
    return e;
  }

  const countEl = q('#lib-count', HTMLElement);
  const nameInput = q('#lib-name', HTMLInputElement);
  const tagsInput = q('#lib-tags', HTMLInputElement);
  const saveBtn = q('#lib-save', HTMLButtonElement);
  const filterInput = q('#lib-filter', HTMLInputElement);
  const list = q('#lib-list', HTMLUListElement);
  const emptyEl = q('#lib-empty', HTMLElement);
  const albumInput = q('#lib-album', HTMLInputElement);
  const exportBtn = q('#lib-export', HTMLButtonElement);
  const importBtn = q('#lib-import', HTMLButtonElement);
  const fileInput = q('#lib-file', HTMLInputElement);
  const clearBtn = q('#lib-clear', HTMLButtonElement);
  const statusEl = q('#lib-status', HTMLElement);

  let store = loadStore();
  let activeId: string | null = null;
  albumInput.value = store.album;

  function note(msg: string, isError = false): void {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  }

  function commit(next: Store): boolean {
    if (!saveStore(next)) {
      note('Could not save: browser storage is full or unavailable. Export an album to keep your work.', true);
      return false;
    }
    store = next;
    return true;
  }

  function sorted(): SavedSketch[] {
    return [...store.sketches].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  function button(cls: string, text: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    b.textContent = text;
    return b;
  }

  function span(cls: string, text: string): HTMLSpanElement {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function item(s: SavedSketch): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'library-item';
    if (s.id === activeId) li.setAttribute('aria-current', 'true');

    const load = button('library-load', '');
    load.title = s.description ? `${s.description}\n\nLoad into the editor` : 'Load into the editor';
    const lines = s.source.split('\n').filter((l) => l.trim()).length;
    const meta = [s.category ?? '', formatDate(s.savedAt), plural(lines, 'line')].filter(Boolean);
    if (s.seed) meta.push(`seed ${s.seed}`);
    const rating = host.ratingOf(s.source);
    if (rating && rating.stars > 0) meta.unshift(starText(rating.stars));
    if (rating?.comment) load.title = `${rating.comment}\n\n${load.title}`;
    load.append(span('library-name', s.name), span('library-meta', meta.join(' · ')));
    if (s.tags && s.tags.length > 0) {
      const tags = span('library-tags', '');
      for (const t of s.tags) tags.append(span('tag', t));
      load.append(tags);
    }
    load.addEventListener('click', () => {
      loadEntry(s);
    });

    const rename = button('', 'Rename');
    rename.setAttribute('aria-label', `Rename ${s.name}`);
    rename.addEventListener('click', () => {
      renameEntry(s);
    });

    const del = button('library-delete', 'Delete');
    del.setAttribute('aria-label', `Delete ${s.name}`);
    del.addEventListener('click', () => {
      deleteEntry(s);
    });

    li.append(load, rename, del);
    return li;
  }

  function matches(s: SavedSketch, f: string): boolean {
    return [s.name, s.source, s.category ?? '', s.description ?? '', ...(s.tags ?? [])].some((v) =>
      v.toLowerCase().includes(f),
    );
  }

  function render(): void {
    const f = filterInput.value.trim().toLowerCase();
    const all = sorted();
    const shown = f ? all.filter((s) => matches(s, f)) : all;
    list.replaceChildren(...shown.map(item));
    countEl.textContent = `${String(store.sketches.length)} saved`;
    emptyEl.hidden = shown.length > 0;
    emptyEl.textContent =
      store.sketches.length > 0
        ? 'No saved sketches match the filter.'
        : 'Nothing saved yet. Name a sketch and save it.';
    exportBtn.disabled = store.sketches.length === 0;
    clearBtn.disabled = store.sketches.length === 0;
    filterInput.hidden = store.sketches.length === 0;
    nameInput.placeholder = cleanName(host.suggestName()) || 'Untitled';
    const hint = host.suggestMeta().tags ?? [];
    tagsInput.placeholder = hint.length > 0 ? hint.join(', ') : 'comma separated';
  }

  function save(): void {
    const source = host.getSource();
    if (!source.trim()) {
      note('The editor is empty; there is nothing to save.', true);
      return;
    }
    const name = cleanName(nameInput.value) || cleanName(host.suggestName()) || 'Untitled';
    const existing = store.sketches.find((s) => sameName(s.name, name));
    if (
      existing &&
      existing.id !== activeId &&
      existing.source !== source &&
      !confirm(`Replace the saved sketch "${existing.name}"?`)
    ) {
      return;
    }
    const seed = host.getSeed().trim();
    const suggested = host.suggestMeta();
    const typed = cleanTags(tagsInput.value);
    // The tags field is authoritative for the loaded entry; otherwise an empty field keeps or suggests tags.
    const tags =
      typed.length > 0
        ? typed
        : existing
          ? existing.id === activeId
            ? []
            : (existing.tags ?? [])
          : (suggested.tags ?? []);
    const entry: SavedSketch = {
      id: existing?.id ?? newId(),
      name,
      source,
      ...(seed ? { seed } : {}),
      savedAt: new Date().toISOString(),
      ...withMeta(existing ?? suggested, tags),
    };
    const sketches = existing
      ? store.sketches.map((s) => (s.id === existing.id ? entry : s))
      : [...store.sketches, entry];
    if (!commit({ ...store, sketches })) return;
    activeId = entry.id;
    nameInput.value = name;
    tagsInput.value = tags.join(', ');
    render();
    note(existing ? `Updated "${name}".` : `Saved "${name}".`);
    host.flash(existing ? 'Sketch updated in library' : 'Saved to library');
  }

  function loadEntry(s: SavedSketch): void {
    host.load(s);
    activeId = s.id;
    nameInput.value = s.name;
    tagsInput.value = (s.tags ?? []).join(', ');
    render();
    note(`Loaded "${s.name}".`);
    host.flash(`Loaded "${s.name}"`);
  }

  function renameEntry(s: SavedSketch): void {
    const answer = prompt('New name for this sketch:', s.name);
    if (answer === null) return;
    const name = cleanName(answer);
    if (!name || name === s.name) return;
    if (store.sketches.some((o) => o.id !== s.id && sameName(o.name, name))) {
      note(`A sketch called "${name}" already exists.`, true);
      return;
    }
    const sketches = store.sketches.map((o) => (o.id === s.id ? { ...o, name } : o));
    if (!commit({ ...store, sketches })) return;
    if (activeId === s.id) nameInput.value = name;
    render();
    note(`Renamed to "${name}".`);
  }

  function deleteEntry(s: SavedSketch): void {
    if (!confirm(`Delete "${s.name}" from your library?`)) return;
    if (!commit({ ...store, sketches: store.sketches.filter((o) => o.id !== s.id) })) return;
    if (activeId === s.id) activeId = null;
    render();
    note(`Deleted "${s.name}".`);
  }

  function clearAll(): void {
    const n = store.sketches.length;
    if (n === 0) return;
    if (!confirm(`Delete all ${plural(n, 'saved sketch')}? Export an album first if you want a backup.`)) return;
    if (!commit({ ...store, sketches: [] })) return;
    activeId = null;
    render();
    note('Library cleared.');
  }
  /** Adds the user's current rating and comment to an entry for export. */
  function withRating(s: SavedSketch): SketchData {
    const r = host.ratingOf(s.source);
    return {
      ...withoutRating(s),
      ...(r && r.stars > 0 ? { rating: r.stars } : {}),
      ...(r?.comment ? { comment: r.comment } : {}),
    };
  }

  function exportAlbum(): void {
    const n = store.sketches.length;
    if (n === 0) return;
    const albumName = cleanName(albumInput.value) || 'My Tartlet album';
    const sketches = sorted().map(withRating);
    const rated = sketches.filter((s) => s.rating || s.comment).length;
    const json = JSON.stringify(toAlbum(albumName, sketches), null, 2);
    download(new Blob([json], { type: 'application/json' }), `${slugify(albumName) || 'tartlet-album'}.json`);
    note(
      `Exported ${plural(n, 'sketch')} as "${albumName}"${rated > 0 ? `, with ${plural(rated, 'rating')} and notes` : ''}.`,
    );
  }

  async function importFile(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_BYTES) {
      note('That file is too large to be a Tartlet album.', true);
      return;
    }
    let album: { name: string; sketches: SketchData[] };
    try {
      album = parseAlbum(JSON.parse(await file.text()) as unknown);
    } catch (e) {
      note(
        e instanceof SyntaxError ? 'That file is not valid JSON.' : e instanceof Error ? e.message : 'Import failed.',
        true,
      );
      return;
    }
    const sketches = [...store.sketches];
    let added = 0;
    let renamed = 0;
    let skipped = 0;
    const seeds: RatingSeed[] = [];
    for (const raw of album.sketches) {
      if (raw.rating || raw.comment) {
        seeds.push({ source: raw.source, name: raw.name, stars: raw.rating ?? 0, comment: raw.comment ?? '' });
      }
      const s = withoutRating(raw);
      if (sketches.some((e) => sameName(e.name, s.name) && e.source === s.source)) {
        skipped++;
        continue;
      }
      let name = s.name;
      if (sketches.some((e) => sameName(e.name, name))) {
        name = uniqueName(name, sketches);
        renamed++;
      }
      sketches.push({ ...s, name, id: newId() });
      added++;
    }
    const albumName = store.album || album.name;
    if (!commit({ album: albumName, sketches })) return;
    host.seedRatings(seeds);
    albumInput.value = albumName;
    render();
    const parts = [`Imported ${plural(added, 'sketch')}${album.name ? ` from "${album.name}"` : ''}`];
    if (renamed > 0) parts.push(`${String(renamed)} renamed to avoid clashes`);
    if (skipped > 0) parts.push(`${String(skipped)} already saved`);
    if (seeds.length > 0) parts.push(`${plural(seeds.length, 'rating')} read (yours are kept)`);
    note(`${parts.join(', ')}.`);
    host.flash(`Imported ${plural(added, 'sketch')}`);
  }

  saveBtn.addEventListener('click', save);
  for (const input of [nameInput, tagsInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
  }
  filterInput.addEventListener('input', render);
  albumInput.addEventListener('change', () => {
    commit({ ...store, album: cleanName(albumInput.value) });
    albumInput.value = store.album;
  });
  exportBtn.addEventListener('click', exportAlbum);
  importBtn.addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void importFile(file);
  });
  clearBtn.addEventListener('click', clearAll);
  // The window manager fires panelshow when this window becomes visible (shown, expanded or tabbed to).
  root.addEventListener('panelshow', render);

  // Ctrl/Cmd+S saves the current sketch to the library.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's') return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    save();
  });

  // Keep several open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    store = loadStore();
    albumInput.value = store.album;
    if (activeId && !store.sketches.some((s) => s.id === activeId)) activeId = null;
    render();
  });

  render();

  return {
    forget() {
      activeId = null;
      nameInput.value = '';
      tagsInput.value = '';
      render();
    },
    refresh: render,
    entries: () => store.sketches,
    add(entries, albumName) {
      const sketches = [...store.sketches];
      const base = Date.now();
      let added = 0;
      for (const e of entries) {
        if (!e.source.trim() || sketches.some((s) => s.source === e.source)) continue;
        let name = cleanName(e.name) || 'Untitled';
        if (sketches.some((s) => sameName(s.name, name))) name = uniqueName(name, sketches);
        const description = e.description?.replace(/\s+/g, ' ').trim().slice(0, 600) ?? '';
        const category = cleanName(e.category ?? '');
        const meta: SketchMeta = {
          ...(description ? { description } : {}),
          ...(category ? { category } : {}),
        };
        // Newest first in the list, so the first track gets the latest time.
        const savedAt = new Date(base - added).toISOString();
        sketches.push({ id: newId(), name, source: e.source, savedAt, ...withMeta(meta, cleanTags(e.tags ?? [])) });
        added++;
      }
      if (added === 0) return 0;
      const album = store.album || cleanName(albumName ?? '');
      if (!commit({ album, sketches })) return -1;
      albumInput.value = store.album;
      render();
      note(`Added ${plural(added, 'sketch')}${albumName ? ` from "${albumName}"` : ''}.`);
      return added;
    },
  };
}
