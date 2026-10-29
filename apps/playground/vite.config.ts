import { defineConfig, type Plugin } from 'vite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
// Mirror tsconfig.base.json `paths` so the build never depends on workspace linking.
const pkgs = fileURLToPath(new URL('../../packages/', import.meta.url));
const alias = Object.fromEntries(
  readdirSync(pkgs)
    .filter((name) => existsSync(`${pkgs}${name}/src/index.ts`))
    .map((name) => [`@tartlet/${name}`, `${pkgs}${name}/src/index.ts`]),
);
// Album catalog: albums/manifest.json lists the album files the playground fetches at runtime.
// The dev server serves them from the project root; this copies them into the build output.
const albumsDir = fileURLToPath(new URL('./albums/', import.meta.url));
function albums(): Plugin {
  return {
    name: 'tartlet-albums',
    apply: 'build',
    generateBundle() {
      if (!existsSync(albumsDir)) return;
      for (const name of readdirSync(albumsDir)) {
        if (!name.endsWith('.json')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `albums/${name}`,
          source: readFileSync(`${albumsDir}${name}`, 'utf8'),
        });
      }
    },
  };
}

// ---- PWA: app icons are drawn here (no binary files in the repo), and sw.js gets a precache list.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size: number, rgba: Uint8Array): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * stride + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

type Rgb = readonly [number, number, number];
const STOPS: readonly [Rgb, Rgb, Rgb] = [
  [0x8b, 0x5c, 0xf6],
  [0xff, 0x4f, 0x6d],
  [0xff, 0xa4, 0x5b],
];
function gradient(t: number): Rgb {
  const s = Math.min(1, Math.max(0, t)) * 2;
  const i = Math.min(1, Math.floor(s));
  const f = s - i;
  const a: Rgb = STOPS[i] ?? STOPS[0];
  const b = STOPS[i + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
/** The "TT" logo inside a unit box. */
function inGlyph(x: number, y: number): boolean {
  const t = (x0: number): boolean =>
    (y >= 0.2 && y <= 0.36 && x >= x0 && x <= x0 + 0.4) || (x >= x0 + 0.135 && x <= x0 + 0.265 && y >= 0.2 && y <= 0.8);
  return t(0.06) || t(0.54);
}
function inRounded(u: number, v: number, r: number): boolean {
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
}
function drawIcon(size: number, rounded: boolean, glyphScale: number): Buffer {
  const SS = 4;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (rounded && !inRounded(u, v, 0.22)) continue;
          const white = inGlyph((u - 0.5) / glyphScale + 0.5, (v - 0.5) / glyphScale + 0.5);
          const c: Rgb = white ? [255, 255, 255] : gradient((u + v) / 2);
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      if (a === 0) continue;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / a);
      rgba[i + 1] = Math.round(g / a);
      rgba[i + 2] = Math.round(b / a);
      rgba[i + 3] = Math.round((255 * a) / (SS * SS));
    }
  }
  return encodePng(size, rgba);
}
const ICONS: Record<string, () => Buffer> = {
  'icon-192.png': () => drawIcon(192, true, 0.62),
  'icon-512.png': () => drawIcon(512, true, 0.62),
  // Maskable and Apple icons are full-bleed; the OS applies its own mask.
  'icon-maskable-512.png': () => drawIcon(512, false, 0.5),
  'apple-touch-icon.png': () => drawIcon(180, false, 0.6),
};

const swSource = fileURLToPath(new URL('./sw.js', import.meta.url));
function pwa(): Plugin {
  const made = new Map<string, Buffer>();
  const icon = (name: string): Buffer | undefined => {
    const make = ICONS[name];
    if (!make) return undefined;
    let png = made.get(name);
    if (!png) {
      png = make();
      made.set(name, png);
    }
    return png;
  };
  return {
    name: 'tartlet-pwa',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/icons\/([\w-]+\.png)(?:\?.*)?$/.exec(req.url ?? '');
        const png = m?.[1] ? icon(m[1]) : undefined;
        if (!png) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'image/png');
        res.end(png);
      });
    },
    generateBundle(_options, bundle) {
      for (const name of Object.keys(ICONS)) {
        this.emitFile({ type: 'asset', fileName: `icons/${name}`, source: icon(name) });
      }
      const hash = createHash('sha256');
      const files: string[] = ['./', 'manifest.webmanifest'];
      for (const [fileName, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (fileName.endsWith('.map') || fileName === 'sw.js') continue;
        files.push(fileName === 'index.html' ? './' : fileName);
        hash.update(fileName);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      const precache = [...new Set(files)];
      const sw = readFileSync(swSource, 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('/*__PRECACHE__*/ []', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

// Production headers mirror Markdown2 (plan.md §3). There is no unsafe-eval or unsafe-inline.
// blob: is allowed for the safety worklet (ADR-003). Trusted Types are enforced from T1, once
// the worklet URL goes through a TT policy.
// connect-src includes the default Cognotik proxy used by the optional AI assistant; add your own
// server here if you point the assistant elsewhere (that server must also allow this origin via CORS).
// Albums mounted with ?album=<url> are fetched too: raw.githubusercontent.com is allowed by default;
// add any other album hosts here (they must also send CORS headers).
// media-src allows blob: so a recorded ringtone can be previewed before download.
// The service worker (sw.js), manifest and icons are same-origin, so 'self' covers them.
const CSP =
  "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; media-src 'self' blob:; connect-src 'self' https://hosted.cognotik.com https://raw.githubusercontent.com; object-src 'none'; base-uri 'none'";

export default defineConfig({
  resolve: { alias },
  plugins: [albums(), pwa()],
  preview: { headers: { 'Content-Security-Policy': CSP, 'Cross-Origin-Opener-Policy': 'same-origin' } },
  build: { target: 'es2022' },
});
