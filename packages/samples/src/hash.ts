/** Lowercase hex SHA-256, through Web Crypto (browsers and Node 22). */
export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(src.byteLength);
  copy.set(src);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
