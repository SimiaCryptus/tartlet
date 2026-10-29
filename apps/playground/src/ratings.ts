// Personal star ratings and comments for any sketch: album sketches (built in or mounted), library
// entries, shared links and AI sketches. They are kept in localStorage and identified by the sketch's
// source text, so a rating follows the song between albums, the library and the queue.
// Album files carry them as optional `rating` (1-5) and `comment` fields on each sketch.

export interface Rating {
  /** 0 means not rated. */
  readonly stars: number;
  readonly comment: string;
  /** Name the sketch had when it was last rated (for reference only). */
  readonly name?: string;
  readonly updatedAt: string;
}

export interface RatingSeed {
  readonly source: string;
  readonly name?: string;
  readonly stars?: number;
  readonly comment?: string;
}

export interface RatingStore {
  get(source: string): Rating | undefined;
  /** Updates the stars and/or the comment. Returns false if storage failed. */
  set(source: string, input: { stars?: number; comment?: string }, name?: string): boolean;
  /** Adds ratings from album files for sketches the user has not rated yet. */
  seed(entries: readonly RatingSeed[]): void;
  /** Called after any change, including changes made in another tab. */
  onChange(cb: () => void): () => void;
}

const STORAGE_KEY = 'tartlet.ratings.v1';
export const MAX_STARS = 5;
export const MAX_COMMENT = 1000;

/** A stable key for a sketch's source (line endings and outer whitespace do not matter). */
export function sourceKey(source: string): string {
  const s = source.replace(/\r\n?/g, '\n').trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}-${s.length.toString(36)}`;
}

export function clampStars(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_STARS, Math.max(0, Math.round(n)));
}

export function cleanComment(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, MAX_COMMENT) : '';
}

export function starText(stars: number): string {
  const n = clampStars(stars);
  return '★'.repeat(n) + '☆'.repeat(MAX_STARS - n);
}

export function hasRating(r: Rating | undefined): r is Rating {
  return r !== undefined && (r.stars > 0 || r.comment !== '');
}

function readStore(): Map<string, Rating> {
  const out = new Map<string, Rating>();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const data = JSON.parse(raw) as unknown;
    const items = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).ratings : undefined;
    if (typeof items !== 'object' || items === null) return out;
    for (const [key, v] of Object.entries(items as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const r = v as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
      out.set(key, {
        stars: clampStars(r.stars),
        comment: cleanComment(r.comment),
        ...(name ? { name } : {}),
        updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
      });
    }
  } catch {
    // unreadable storage: start empty
  }
  return out;
}

export function createRatingStore(): RatingStore {
  let map = readStore();
  const listeners = new Set<() => void>();

  function persist(): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ratings: Object.fromEntries(map) }));
      return true;
    } catch {
      return false;
    }
  }

  function emit(): void {
    for (const cb of listeners) cb();
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    map = readStore();
    emit();
  });

  return {
    get(source) {
      if (!source.trim()) return undefined;
      return map.get(sourceKey(source));
    },
    set(source, input, name) {
      if (!source.trim()) return false;
      const key = sourceKey(source);
      const prev = map.get(key);
      const stars = input.stars === undefined ? (prev?.stars ?? 0) : clampStars(input.stars);
      const comment = input.comment === undefined ? (prev?.comment ?? '') : cleanComment(input.comment);
      if (prev ? prev.stars === stars && prev.comment === comment : stars === 0 && comment === '') return true;
      const label = name?.trim().slice(0, 80) || prev?.name || '';
      // A cleared rating is kept (as 0 stars and no comment) so album files do not re-seed it.
      map.set(key, { stars, comment, ...(label ? { name: label } : {}), updatedAt: new Date().toISOString() });
      const ok = persist();
      emit();
      return ok;
    },
    seed(entries) {
      let changed = false;
      for (const e of entries) {
        if (!e.source.trim()) continue;
        const key = sourceKey(e.source);
        if (map.has(key)) continue;
        const stars = clampStars(e.stars ?? 0);
        const comment = cleanComment(e.comment);
        if (stars === 0 && !comment) continue;
        const label = e.name?.trim().slice(0, 80) ?? '';
        map.set(key, { stars, comment, ...(label ? { name: label } : {}), updatedAt: new Date().toISOString() });
        changed = true;
      }
      if (!changed) return;
      persist();
      emit();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

// ---- rating panel (stars and a comment box for the sketch in the editor)

export interface RatingPanelHost {
  /** Source of the sketch being rated (the editor). */
  source(): string;
  /** Its display name. */
  name(): string;
}

export interface RatingPanel {
  /** Call whenever the sketch may have changed; it saves any pending comment for the previous one. */
  refresh(): void;
}

export function initRatingPanel(root: HTMLElement, store: RatingStore, host: RatingPanelHost): RatingPanel {
  function q<T extends HTMLElement>(sel: string, type: new () => T): T {
    const e = root.querySelector(sel);
    if (!(e instanceof type)) throw new Error(`missing ${sel}`);
    return e;
  }
  const starsEl = q('#rating-stars', HTMLElement);
  const commentEl = q('#rating-comment', HTMLTextAreaElement);
  const statusEl = q('#rating-status', HTMLElement);

  let bound = host.source();
  let boundName = host.name();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failed = false;

  const buttons = Array.from({ length: MAX_STARS }, (_, i) => {
    const n = i + 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rating-star';
    b.textContent = '★';
    b.setAttribute('aria-label', `${String(n)} star${n === 1 ? '' : 's'}`);
    b.title = `Rate ${String(n)} of ${String(MAX_STARS)} (click again to clear)`;
    b.addEventListener('click', () => {
      rate(n);
    });
    return b;
  });
  starsEl.replaceChildren(...buttons);

  function paint(stars: number): void {
    buttons.forEach((b, i) => {
      b.classList.toggle('is-on', i < stars);
      b.setAttribute('aria-pressed', String(i < stars));
    });
  }

  function showStatus(): void {
    const empty = !bound.trim();
    for (const b of buttons) b.disabled = empty;
    commentEl.disabled = empty;
    if (empty) {
      statusEl.textContent = 'Nothing to rate yet';
      return;
    }
    if (failed) {
      statusEl.textContent = 'Could not save: browser storage is full or unavailable';
      return;
    }
    if (timer !== undefined) {
      statusEl.textContent = 'Saving…';
      return;
    }
    const r = store.get(bound);
    const parts: string[] = [];
    parts.push(r && r.stars > 0 ? `${String(r.stars)} of ${String(MAX_STARS)}` : 'Not rated');
    if (r?.comment) parts.push('note saved');
    statusEl.textContent = parts.join(' · ');
  }

  function save(input: { stars?: number; comment?: string }): void {
    failed = !store.set(bound, input, boundName);
  }

  function flush(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    save({ comment: commentEl.value });
    showStatus();
  }

  function rate(n: number): void {
    if (!bound.trim()) return;
    flush();
    const current = store.get(bound)?.stars ?? 0;
    const next = current === n ? 0 : n;
    save({ stars: next });
    paint(next);
    showStatus();
  }

  starsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const current = store.get(bound)?.stars ?? 0;
    const next = clampStars(current + (e.key === 'ArrowRight' ? 1 : -1));
    if (next === current) return;
    flush();
    save({ stars: next });
    paint(next);
    showStatus();
    buttons[Math.max(0, next - 1)]?.focus();
  });

  commentEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
    showStatus();
  });
  commentEl.addEventListener('blur', flush);

  function refresh(): void {
    const src = host.source();
    const changed = sourceKey(src) !== sourceKey(bound);
    if (changed) flush();
    bound = src;
    boundName = host.name();
    const r = store.get(bound);
    paint(r?.stars ?? 0);
    // Keep what the user is typing unless the sketch itself changed.
    if (changed || (document.activeElement !== commentEl && timer === undefined)) {
      commentEl.value = r?.comment ?? '';
    }
    showStatus();
  }

  refresh();
  return { refresh };
}
