/** The directory part of a relative path, ending in `/`, or empty. */
export function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

/** Joins a directory from `dirOf` and a relative path that follows the sample path grammar. */
export function joinPath(dir: string, rel: string): string {
  const d = dir.startsWith('./') ? dir.slice(2) : dir;
  const r = rel.startsWith('./') ? rel.slice(2) : rel;
  return `${d}${r}`;
}
