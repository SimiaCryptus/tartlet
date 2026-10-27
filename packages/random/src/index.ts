/**
 * Synchronous 64-bit structural hash for node ids and seed paths (plan.md §3).
 * Each part is length-prefixed, so ("ab","c") and ("a","bc") differ.
 */
export function hash64(...parts: readonly string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const feed = (byte: number): void => {
    h1 = Math.imul(h1 ^ byte, 0x01000193);
    h2 = Math.imul(h2 ^ byte, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  };
  for (const p of parts) {
    const len = p.length;
    feed(len & 0xff);
    feed((len >>> 8) & 0xff);
    feed((len >>> 16) & 0xff);
    for (let i = 0; i < len; i++) {
      const c = p.charCodeAt(i);
      feed(c & 0xff);
      feed(c >>> 8);
    }
  }
  h1 = fmix(h1 ^ h2);
  h2 = fmix(h2 ^ h1);
  return hex(h1) + hex(h2);
}

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hex(x: number): string {
  return (x >>> 0).toString(16).padStart(8, "0");
}

/** root seed = hash(document id, blob index, user seed | "default") (idea.md §8.4). */
export function rootSeed(documentId: string, blobIndex: string, seed?: string): string {
  return hash64("tartlet-root", documentId, blobIndex, seed ?? "default");
}

/**
 * Counter-based uniform draw in [0, 1). The result depends only on the parts, so there is
 * no hidden state (idea.md §8.4). It uses 52 bits of the hash.
 */
export function draw(...parts: readonly string[]): number {
  return parseInt(hash64(...parts).slice(0, 13), 16) / 0x10000000000000;
}