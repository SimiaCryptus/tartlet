// Personal library: named sketches saved in this browser, exportable and importable as JSON albums.

export interface SavedSketch {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly seed?: string;
  /** ISO 8601 timestamp of the last save. */
  readonly savedAt: string;
}

export interface LibraryHost {
  getSource(): string;
  getSeed(): string;
  /** Name offered when the name field is empty (usually the current title). */
  suggestName(): string;
  /** Puts a saved sketch into the editor and applies it. */
  load(sketch: SavedSketch): void;
  flash(msg: string): void;
}

export interface LibraryHandle {
  /** Called when the editor is replaced by something that is not a library entry. */
  forget(): void;
}

type SketchData = Omit<SavedSketch, 'id'>;

interface Store {
  album: string;
  sketches: SavedSketch[];
}

export interface AlbumJson {
  format: typeof ALBUM_FORMAT;
  version: 1;
  name: string;
  exportedAt: string;
  sketches: { name: string; source: string; seed?: string; savedAt: string }[];
}

const STORAGE_KEY = 'tartlet.library.v1';
export const ALBUM_FORMAT = 'tartlet-album';
const MAX_NAME = 80;
const MAX_IMPORT_BYTES = 5_000_000;

// ---- helpers

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

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

function parseSketch(v: unknown): SketchData | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const source = str(r.source) ?? str(r.code);
  if (source === undefined || !source.trim()) return null;
  const name = cleanName(str(r.name) ?? str(r.title) ?? '') || 'Untitled';
  const seed = str(r.seed)?.trim();
  const at = str(r.savedAt);
  const savedAt =
    at !== undefined && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();
  return { name, source, ...(seed ? { seed } : {}), savedAt };
}

/** Reads an album file. Also accepts a bare array of sketches or a single { name, source } object. */
export function parseAlbum(data: unknown): { name: string; sketches: SketchData[] } {
  let name = '';
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (typeof data === 'object' && data !== null) {
    const r = data as Record<string, unknown>;
    if (Array.isArray(r.sketches)) {
      items = r.sketches;
      name = cleanName(str(r.name) ?? '');
    } else {
      items = [data];
    }
  }
  const sketches = items.map((v) => parseSketch(v)).filter((s): s is SketchData => s !== null);
  if (sketches.length === 0) throw new Error('No sketches were found in that file.');
  return { name, sketches };
}

export function toAlbum(albumName: string, sketches: readonly SavedSketch[]): AlbumJson {
  return {
    format: ALBUM_FORMAT,
    version: 1,
    name: albumName,
    exportedAt: new Date().toISOString(),
    sketches: sketches.map((s) => ({
      name: s.name,
      source: s.source,
      ...(s.seed ? { seed: s.seed } : {}),
      savedAt: s.savedAt,
    })),
  };
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
    load.title = 'Load into the editor';
    const lines = s.source.split('\n').filter((l) => l.trim()).length;
    const meta = [formatDate(s.savedAt), plural(lines, 'line')].filter(Boolean);
    if (s.seed) meta.push(`seed ${s.seed}`);
    load.append(span('library-name', s.name), span('library-meta', meta.join(' · ')));
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

  function render(): void {
    const f = filterInput.value.trim().toLowerCase();
    const all = sorted();
    const shown = f ? all.filter((s) => s.name.toLowerCase().includes(f) || s.source.toLowerCase().includes(f)) : all;
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
    const entry: SavedSketch = {
      id: existing?.id ?? newId(),
      name,
      source,
      ...(seed ? { seed } : {}),
      savedAt: new Date().toISOString(),
    };
    const sketches = existing
      ? store.sketches.map((s) => (s.id === existing.id ? entry : s))
      : [...store.sketches, entry];
    if (!commit({ ...store, sketches })) return;
    activeId = entry.id;
    nameInput.value = name;
    render();
    note(existing ? `Updated "${name}".` : `Saved "${name}".`);
    host.flash(existing ? 'Sketch updated in library' : 'Saved to library');
  }

  function loadEntry(s: SavedSketch): void {
    host.load(s);
    activeId = s.id;
    nameInput.value = s.name;
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

  function exportAlbum(): void {
    const n = store.sketches.length;
    if (n === 0) return;
    const albumName = cleanName(albumInput.value) || 'My Tartlet album';
    const json = JSON.stringify(toAlbum(albumName, sorted()), null, 2);
    download(new Blob([json], { type: 'application/json' }), `${slugify(albumName) || 'tartlet-album'}.json`);
    note(`Exported ${plural(n, 'sketch')} as "${albumName}".`);
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
    for (const s of album.sketches) {
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
    albumInput.value = albumName;
    render();
    const parts = [`Imported ${plural(added, 'sketch')}${album.name ? ` from "${album.name}"` : ''}`];
    if (renamed > 0) parts.push(`${String(renamed)} renamed to avoid clashes`);
    if (skipped > 0) parts.push(`${String(skipped)} already saved`);
    note(`${parts.join(', ')}.`);
    host.flash(`Imported ${plural(added, 'sketch')}`);
  }

  saveBtn.addEventListener('click', save);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
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
  root.addEventListener('toggle', render);

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
      render();
    },
  };
}
