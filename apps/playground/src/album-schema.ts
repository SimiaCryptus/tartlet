// Album file format, shared by the bundled catalog (albums/*.json, listed in albums/manifest.json)
// and the personal library's import/export.
//
// Version 2 adds optional metadata. Albums: id, description, author, license, category, tags.
// Sketches: id, description, category, tags, author. Version 1 files still load; `blurb` and
// `group` are read as aliases of `description` and `category`.
// Sketches may also carry the user's `rating` (1-5 stars) and `comment`.

export const ALBUM_FORMAT = 'tartlet-album';
export const ALBUM_VERSION = 2;
export const MANIFEST_FORMAT = 'tartlet-album-manifest';

const MAX_NAME = 80;
const MAX_TEXT = 600;
const MAX_TAG = 32;
const MAX_TAGS = 16;
const MAX_COMMENT = 1000;

export interface SketchMeta {
  readonly description?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly author?: string;
}

export interface AlbumMeta extends SketchMeta {
  readonly id?: string;
  readonly license?: string;
}

export interface SketchData extends SketchMeta {
  readonly id?: string;
  readonly name: string;
  readonly source: string;
  readonly seed?: string;
  /** ISO 8601 timestamp of the last save. */
  readonly savedAt: string;
  /** The user's star rating, 1 to 5. */
  readonly rating?: number;
  /** The user's comment. */
  readonly comment?: string;
}

export interface ParsedAlbum {
  readonly name: string;
  readonly meta: AlbumMeta;
  readonly sketches: SketchData[];
}

export interface SketchJson {
  id?: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  author?: string;
  source: string;
  seed?: string;
  savedAt: string;
  rating?: number;
  comment?: string;
}

export interface AlbumJson {
  format: typeof ALBUM_FORMAT;
  version: number;
  id?: string;
  name: string;
  description?: string;
  author?: string;
  license?: string;
  category?: string;
  tags?: string[];
  exportedAt: string;
  sketches: SketchJson[];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function cleanText(v: unknown, max = MAX_TEXT): string | undefined {
  const s = str(v)?.replace(/\s+/g, ' ').trim().slice(0, max);
  return s ? s : undefined;
}

/** Accepts an array of strings or a comma-separated string; trims and de-duplicates (case-insensitive). */
export function cleanTags(v: unknown): string[] {
  const raw: unknown[] = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function readMeta(r: Record<string, unknown>): SketchMeta {
  const description = cleanText(r.description) ?? cleanText(r.blurb);
  const category = cleanText(r.category, MAX_NAME) ?? cleanText(r.group, MAX_NAME);
  const author = cleanText(r.author, MAX_NAME);
  const tags = cleanTags(r.tags);
  return {
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(author ? { author } : {}),
  };
}
function readRating(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const r = Math.min(5, Math.max(0, Math.round(n)));
  return r > 0 ? r : undefined;
}
function readComment(v: unknown): string | undefined {
  const s = str(v)?.replace(/\r\n?/g, '\n').trim().slice(0, MAX_COMMENT);
  return s ? s : undefined;
}

export function parseSketch(v: unknown): SketchData | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const source = str(r.source) ?? str(r.code);
  if (source === undefined || !source.trim()) return null;
  const name = cleanName(str(r.name) ?? str(r.title) ?? '') || 'Untitled';
  const seed = str(r.seed)?.trim();
  const at = str(r.savedAt);
  const savedAt =
    at !== undefined && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();
  const id = slugify(str(r.id) ?? '');
  const rating = readRating(r.rating);
  const comment = readComment(r.comment);
  return {
    ...(id ? { id } : {}),
    name,
    source,
    ...(seed ? { seed } : {}),
    savedAt,
    ...readMeta(r),
    ...(rating ? { rating } : {}),
    ...(comment ? { comment } : {}),
  };
}

/** Reads an album file. Also accepts a bare array of sketches or a single { name, source } object. */
export function parseAlbum(data: unknown): ParsedAlbum {
  let name = '';
  let meta: AlbumMeta = {};
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (typeof data === 'object' && data !== null) {
    const r = data as Record<string, unknown>;
    if (Array.isArray(r.sketches)) {
      items = r.sketches;
      name = cleanName(str(r.name) ?? '');
      const id = slugify(str(r.id) ?? '');
      const license = cleanText(r.license, MAX_NAME);
      meta = { ...readMeta(r), ...(id ? { id } : {}), ...(license ? { license } : {}) };
    } else {
      items = [data];
    }
  }
  const sketches = items.map((v) => parseSketch(v)).filter((s): s is SketchData => s !== null);
  if (sketches.length === 0) throw new Error('No sketches were found in that file.');
  return { name, meta, sketches };
}

function sketchJson(s: SketchData): SketchJson {
  return {
    name: s.name,
    ...(s.description ? { description: s.description } : {}),
    ...(s.category ? { category: s.category } : {}),
    ...(s.tags && s.tags.length > 0 ? { tags: [...s.tags] } : {}),
    ...(s.author ? { author: s.author } : {}),
    source: s.source,
    ...(s.seed ? { seed: s.seed } : {}),
    savedAt: s.savedAt,
    ...(s.rating ? { rating: s.rating } : {}),
    ...(s.comment ? { comment: s.comment } : {}),
  };
}

export function toAlbum(name: string, sketches: readonly SketchData[], meta: AlbumMeta = {}): AlbumJson {
  return {
    format: ALBUM_FORMAT,
    version: ALBUM_VERSION,
    ...(meta.id ? { id: meta.id } : {}),
    name,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    ...(meta.license ? { license: meta.license } : {}),
    ...(meta.category ? { category: meta.category } : {}),
    ...(meta.tags && meta.tags.length > 0 ? { tags: [...meta.tags] } : {}),
    exportedAt: new Date().toISOString(),
    sketches: sketches.map(sketchJson),
  };
}
