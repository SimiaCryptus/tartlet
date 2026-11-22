// Sample path and sound name grammar (docs/samples.md §1.2, TS-90). Shared by the checker, the
// IR codec and the sample host, so hostile IR cannot smuggle in an absolute path.

export const MAX_SAMPLE_PATH = 256;
export const MAX_CLIP_URL = 2048;
export const MAX_DATA_CLIP_URL = 2 * 1024 * 1024;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const SOUND_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ASCII_VISIBLE = /^[\x21-\x7E]+$/;
const HOST_CHARS = /^[A-Za-z0-9._~:%+-]+$/;
const DIGITS = /^\d{1,5}$/;
const BASE64_CHARS = /^[A-Za-z0-9+/=]+$/;
const MIME_SUBTYPE = /^[A-Za-z0-9.+-]+$/;

function hasForbiddenUrlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '<' || c === '>' || c === '\\') return true;
  }
  return false;
}

function isHttpClipUrl(u: string): boolean {
  const lower = u.toLowerCase();
  const rest = lower.startsWith('https://') ? u.slice(8) : lower.startsWith('http://') ? u.slice(7) : '';
  if (rest.length === 0 || hasForbiddenUrlChars(rest)) return false;
  let cut = rest.length;
  for (const sep of ['/', '?', '#']) {
    const idx = rest.indexOf(sep);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  const authority = rest.slice(0, cut);
  if (authority.length === 0) return false;
  const colon = authority.lastIndexOf(':');
  if (colon >= 0) {
    const host = authority.slice(0, colon);
    const port = authority.slice(colon + 1);
    return host.length > 0 && HOST_CHARS.test(host) && DIGITS.test(port);
  }
  return HOST_CHARS.test(authority);
}

function isBlobClipUrl(u: string): boolean {
  const rest = u.slice(5);
  if (hasForbiddenUrlChars(rest)) return false;
  if (rest.toLowerCase().startsWith('null/')) return rest.length > 5;
  if (!isHttpClipUrl(rest)) return false;
  const slash = rest.indexOf('/', rest.indexOf('://') + 3);
  return slash >= 0 && slash < rest.length - 1;
}

function isDataAudioUrl(u: string): boolean {
  if (u.length > MAX_DATA_CLIP_URL) return false;
  const comma = u.indexOf(',');
  if (comma < 0) return false;
  const header = u.slice(5, comma).toLowerCase();
  const payload = u.slice(comma + 1);
  if (!header.startsWith('audio/') || !header.endsWith(';base64') || payload.length === 0) return false;
  const media = header.slice(6, -7);
  const subtype = media.split(';', 1)[0] ?? '';
  return MIME_SUBTYPE.test(subtype) && BASE64_CHARS.test(payload);
}

/**
 * path := ("./")? segment ("/" segment)* "/"?, with segment := [A-Za-z0-9_.-]+ but not "." or "..".
 * ASCII only, at most 256 bytes. No scheme, no absolute path, nothing that escapes the root.
 */
export function isSamplePath(p: string): boolean {
  if (p.length === 0 || p.length > MAX_SAMPLE_PATH) return false;
  let body = p.startsWith('./') ? p.slice(2) : p;
  if (body.endsWith('/')) body = body.slice(0, -1);
  if (body.length === 0) return false;
  return body.split('/').every((seg) => SEGMENT.test(seg) && seg !== '.' && seg !== '..');
}

/** A name a document can bind a sample to: a letter, then letters, digits, `_` or `-`. */
export function isSoundName(name: string): boolean {
  return SOUND_NAME.test(name);
}

/** A bank path names a directory (ending in `/`) or a manifest file (ending in `.json`). */
export function isBankPath(p: string): boolean {
  return isSamplePath(p) && (p.endsWith('/') || /\.json$/i.test(p));
}

/** A single sample path names a `.wav` file. */
export function isWavPath(p: string): boolean {
  return isSamplePath(p) && !p.endsWith('/') && /\.wav$/i.test(p);
}

/**
 * A clip URL accepted by `importClip(name, url)`: `https://`, `http://`, `blob:`, `data:audio/...;base64,...`,
 * or a relative / root-relative path without `..`. Rejects `file:`, `javascript:`, whitespace and control chars.
 */
export function isClipUrl(u: string): boolean {
  if (u.length === 0) return false;
  const lower = u.toLowerCase();
  if (lower.startsWith('data:')) return isDataAudioUrl(u);
  if (u.length > MAX_CLIP_URL || !ASCII_VISIBLE.test(u)) return false;
  if (lower.startsWith('https://') || lower.startsWith('http://')) return isHttpClipUrl(u);
  if (lower.startsWith('blob:')) return isBlobClipUrl(u);
  if (u.startsWith('//') || u.includes(':')) return false;
  const rel = u.startsWith('/') ? u.slice(1) : u;
  const pathOnly = rel.split(/[?#]/, 1)[0] ?? '';
  return isSamplePath(pathOnly) && !pathOnly.endsWith('/');
}
