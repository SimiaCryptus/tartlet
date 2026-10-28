// Bundled album catalog: discovers albums through albums/manifest.json and shows them in the
// Albums window with album, category, search and tag filters.
import { parseAlbum, slugify, type ParsedAlbum } from './album-schema';

export interface CatalogSketch {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly author: string;
  readonly source: string;
  readonly seed?: string;
  readonly album: CatalogAlbum;
}

export interface CatalogAlbum {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly sketches: CatalogSketch[];
}

export interface Catalog {
  readonly albums: readonly CatalogAlbum[];
  readonly sketches: readonly CatalogSketch[];
  byId(id: string): CatalogSketch | undefined;
  bySource(source: string): CatalogSketch | undefined;
}

function makeCatalog(albums: CatalogAlbum[]): Catalog {
  const sketches = albums.flatMap((a) => a.sketches);
  const ids = new Map(sketches.map((s) => [s.id, s]));
  const sources = new Map<string, CatalogSketch>();
  for (const s of sketches) if (!sources.has(s.source)) sources.set(s.source, s);
  return {
    albums,
    sketches,
    byId: (id) => ids.get(id),
    bySource: (source) => sources.get(source),
  };
}

export const EMPTY_CATALOG: Catalog = makeCatalog([]);

// ---- loading

interface ManifestEntry {
  readonly id?: string;
  readonly file: string;
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Accepts { albums: [...] } or a bare array; entries are file names or { id?, file }. */
function readManifest(data: unknown): ManifestEntry[] {
  const list: unknown = Array.isArray(data) ? data : obj(data).albums;
  if (!Array.isArray(list)) throw new Error('it lists no albums');
  const out: ManifestEntry[] = [];
  for (const v of list as unknown[]) {
    if (typeof v === 'string') {
      out.push({ file: v });
      continue;
    }
    const r = obj(v);
    const file = typeof r.file === 'string' ? r.file : typeof r.url === 'string' ? r.url : undefined;
    if (file) out.push({ file, ...(typeof r.id === 'string' ? { id: r.id } : {}) });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  return (await res.json()) as unknown;
}

function unique(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${String(n)}`;
  used.add(id);
  return id;
}

function buildAlbum(
  entry: ManifestEntry,
  parsed: ParsedAlbum,
  albumIds: Set<string>,
  sketchIds: Set<string>,
): CatalogAlbum {
  const m = parsed.meta;
  const fallback = entry.file.replace(/^.*\//, '').replace(/\.json$/i, '');
  const id = unique(slugify(entry.id ?? m.id ?? (parsed.name || fallback)) || 'album', albumIds);
  const album: CatalogAlbum = {
    id,
    name: parsed.name || fallback || id,
    description: m.description ?? '',
    author: m.author ?? '',
    license: m.license ?? '',
    category: m.category ?? '',
    tags: m.tags ?? [],
    sketches: [],
  };
  for (const s of parsed.sketches) {
    const base = s.id ?? `${id}-${slugify(s.name) || 'sketch'}`;
    album.sketches.push({
      id: unique(base, sketchIds),
      name: s.name,
      description: s.description ?? '',
      category: s.category ?? album.category,
      tags: s.tags ?? [],
      author: s.author ?? album.author,
      source: s.source,
      ...(s.seed ? { seed: s.seed } : {}),
      album,
    });
  }
  return album;
}

/** Loads every album listed in the manifest. Never throws; failures are reported in `errors`. */
export async function loadCatalog(manifestUrl: string): Promise<{ catalog: Catalog; errors: string[] }> {
  const errors: string[] = [];
  let entries: ManifestEntry[];
  try {
    entries = readManifest(await fetchJson(manifestUrl));
  } catch (e) {
    return { catalog: EMPTY_CATALOG, errors: [`Could not read the album manifest: ${message(e)}.`] };
  }
  const loaded = await Promise.all(
    entries.map(async (entry) => {
      try {
        return { entry, parsed: parseAlbum(await fetchJson(new URL(entry.file, manifestUrl).href)) };
      } catch (e) {
        errors.push(`Could not load ${entry.file}: ${message(e)}.`);
        return null;
      }
    }),
  );
  const albumIds = new Set<string>();
  const sketchIds = new Set<string>();
  const albums: CatalogAlbum[] = [];
  for (const item of loaded) {
    if (item) albums.push(buildAlbum(item.entry, item.parsed, albumIds, sketchIds));
  }
  return { catalog: makeCatalog(albums), errors };
}

// ---- UI

export interface CatalogView {
  setCatalog(catalog: Catalog, errors?: readonly string[]): void;
  /** Highlights the sketch that is in the editor (undefined for none). */
  markActive(id: string | undefined): void;
}

const MAX_CHIPS = 24;
const ALBUM_PREF_KEY = 'tartlet.catalog.album';

function count(n: number): string {
  return `${String(n)} ${n === 1 ? 'sketch' : 'sketches'}`;
}

export function initCatalog(root: HTMLElement, onPick: (s: CatalogSketch) => void): CatalogView {
  function q<T extends HTMLElement>(sel: string, type: new () => T): T {
    const e = root.querySelector(sel);
    if (!(e instanceof type)) throw new Error(`missing ${sel}`);
    return e;
  }
  const albumSel = q('#cat-album', HTMLSelectElement);
  const categorySel = q('#cat-category', HTMLSelectElement);
  const searchInput = q('#cat-search', HTMLInputElement);
  const tagsEl = q('#cat-tags', HTMLElement);
  const infoEl = q('#cat-info', HTMLElement);
  const statusEl = q('#cat-status', HTMLElement);
  const grid = q('#presets', HTMLElement);

  let catalog = EMPTY_CATALOG;
  let problems: readonly string[] = [];
  let activeId: string | undefined;
  const activeTags = new Set<string>();
  const key = (t: string): string => t.toLowerCase();

  function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function selectedAlbum(): CatalogAlbum | undefined {
    return catalog.albums.find((a) => a.id === albumSel.value);
  }

  function scope(): readonly CatalogSketch[] {
    return selectedAlbum()?.sketches ?? catalog.sketches;
  }

  function loadPref(): string {
    try {
      return localStorage.getItem(ALBUM_PREF_KEY) ?? '';
    } catch {
      return '';
    }
  }

  function savePref(v: string): void {
    try {
      localStorage.setItem(ALBUM_PREF_KEY, v);
    } catch {
      // storage unavailable
    }
  }

  function fillCategories(): void {
    const keep = categorySel.value;
    const cats = [
      ...new Set(
        scope()
          .map((s) => s.category)
          .filter(Boolean),
      ),
    ];
    categorySel.replaceChildren(new Option('All categories', ''), ...cats.map((c) => new Option(c, c)));
    categorySel.value = cats.includes(keep) ? keep : '';
    categorySel.disabled = cats.length === 0;
  }

  function haystack(s: CatalogSketch): string {
    return [s.name, s.description, s.category, s.album.name, s.author, ...s.tags].join(' ').toLowerCase();
  }

  function filtersActive(): boolean {
    return activeTags.size > 0 || searchInput.value.trim() !== '' || categorySel.value !== '';
  }

  function renderTags(pool: readonly CatalogSketch[]): void {
    const counts = new Map<string, { label: string; n: number }>();
    for (const s of pool) {
      for (const t of s.tags) {
        const c = counts.get(key(t));
        if (c) c.n++;
        else counts.set(key(t), { label: t, n: 1 });
      }
    }
    for (const k of activeTags) if (!counts.has(k)) counts.set(k, { label: k, n: 0 });
    const list = [...counts.entries()]
      .sort(
        (a, b) =>
          Number(activeTags.has(b[0])) - Number(activeTags.has(a[0])) ||
          b[1].n - a[1].n ||
          a[1].label.localeCompare(b[1].label),
      )
      .slice(0, Math.max(MAX_CHIPS, activeTags.size));
    const chips: HTMLButtonElement[] = list.map(([k, { label, n }]) => {
      const b = make('button', 'tag-chip', label);
      b.type = 'button';
      b.dataset.tag = k;
      b.setAttribute('aria-pressed', String(activeTags.has(k)));
      b.title = count(n);
      b.addEventListener('click', () => {
        if (activeTags.has(k)) activeTags.delete(k);
        else activeTags.add(k);
        render();
        tagsEl.querySelector<HTMLButtonElement>(`[data-tag="${CSS.escape(k)}"]`)?.focus();
      });
      return b;
    });
    if (filtersActive()) {
      const clear = make('button', 'tag-chip tag-clear', 'Clear filters');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        activeTags.clear();
        searchInput.value = '';
        categorySel.value = '';
        render();
        searchInput.focus();
      });
      chips.push(clear);
    }
    tagsEl.replaceChildren(...chips);
    tagsEl.hidden = chips.length === 0;
  }

  function renderInfo(): void {
    const a = selectedAlbum();
    if (!a) {
      infoEl.hidden = true;
      infoEl.replaceChildren();
      return;
    }
    const parts: HTMLElement[] = [make('h3', 'catalog-info-name', a.name)];
    if (a.description) parts.push(make('p', 'catalog-info-desc', a.description));
    const meta = [count(a.sketches.length), a.category, a.author ? `by ${a.author}` : '', a.license].filter(Boolean);
    parts.push(make('p', 'catalog-info-meta', meta.join(' · ')));
    if (a.tags.length > 0) {
      const tags = make('span', 'preset-tags');
      for (const t of a.tags) tags.append(make('span', 'tag', t));
      parts.push(tags);
    }
    infoEl.replaceChildren(...parts);
    infoEl.hidden = false;
  }

  function card(s: CatalogSketch, showAlbum: boolean): HTMLButtonElement {
    const b = make('button', 'preset');
    b.type = 'button';
    b.dataset.id = s.id;
    b.setAttribute('aria-pressed', String(s.id === activeId));
    b.append(make('span', 'preset-name', s.name));
    if (s.description) b.append(make('span', 'preset-blurb', s.description));
    const tags = make('span', 'preset-tags');
    if (showAlbum) tags.append(make('span', 'tag tag-album', s.album.name));
    for (const t of s.tags) tags.append(make('span', activeTags.has(key(t)) ? 'tag is-match' : 'tag', t));
    if (tags.childElementCount > 0) b.append(tags);
    if (s.author && s.author !== s.album.author) b.title = `by ${s.author}`;
    b.addEventListener('click', () => {
      onPick(s);
    });
    return b;
  }

  function render(): void {
    const cat = categorySel.value;
    const query = searchInput.value.trim().toLowerCase();
    const pool = scope().filter((s) => !cat || s.category === cat);
    const shown = pool.filter(
      (s) => [...activeTags].every((k) => s.tags.some((t) => key(t) === k)) && (!query || haystack(s).includes(query)),
    );
    renderTags(pool);
    renderInfo();

    const showAlbum = !albumSel.value && catalog.albums.length > 1;
    const groups = new Map<string, CatalogSketch[]>();
    for (const s of shown) {
      const g = s.category || 'Other';
      const list = groups.get(g);
      if (list) list.push(s);
      else groups.set(g, [s]);
    }
    const nodes: HTMLElement[] = [];
    for (const [g, list] of groups) nodes.push(make('h3', 'preset-group', g), ...list.map((s) => card(s, showAlbum)));
    grid.replaceChildren(...nodes);

    let status = '';
    if (problems.length > 0) status = problems.join(' ');
    else if (catalog.sketches.length === 0) status = 'No albums are available.';
    else if (shown.length === 0) status = 'No sketches match these filters.';
    else if (shown.length < scope().length) status = `Showing ${String(shown.length)} of ${count(scope().length)}.`;
    statusEl.textContent = status;
    statusEl.classList.toggle('error', problems.length > 0);
  }

  albumSel.addEventListener('change', () => {
    savePref(albumSel.value);
    fillCategories();
    render();
  });
  categorySel.addEventListener('change', render);
  searchInput.addEventListener('input', render);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.preventDefault();
      searchInput.value = '';
      render();
    }
  });

  return {
    setCatalog(c, errors = []) {
      catalog = c;
      problems = errors;
      const keep = albumSel.value || loadPref();
      albumSel.replaceChildren(
        new Option('All albums', ''),
        ...c.albums.map((a) => new Option(`${a.name} (${String(a.sketches.length)})`, a.id)),
      );
      albumSel.value = c.albums.some((a) => a.id === keep) ? keep : '';
      albumSel.disabled = c.albums.length === 0;
      fillCategories();
      render();
    },
    markActive(id) {
      activeId = id;
      for (const b of grid.querySelectorAll<HTMLButtonElement>('button.preset')) {
        b.setAttribute('aria-pressed', String(b.dataset.id === id));
      }
    },
  };
}
