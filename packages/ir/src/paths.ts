// Sample path and sound name grammar (docs/samples.md §1.2, TS-90). Shared by the checker, the
// IR codec and the sample host, so hostile IR cannot smuggle in an absolute path.

export const MAX_SAMPLE_PATH = 256;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const SOUND_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

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
