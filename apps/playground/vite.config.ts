import { defineConfig, type Plugin } from 'vite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
// The shared sample collection (docs/samples.md §3.3): repo-root collection/ is served and
// copied under /samples/, next to the playground. Nothing is uploaded from the browser.
const collectionDir = fileURLToPath(new URL('../../collection/', import.meta.url));
function collectionFile(rel: string): string | undefined {
  if (rel.split('/').includes('..')) return undefined;
  const file = `${collectionDir}${rel}`;
  return existsSync(file) && statSync(file).isFile() ? file : undefined;
}
/** Every file under `dir` (which ends in `/`), as paths relative to it with `/` separators. */
function walkFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = `${prefix}${name}`;
    return statSync(`${dir}${name}`).isDirectory() ? walkFiles(`${dir}${name}/`, `${rel}/`) : [rel];
  });
}
function collection(): Plugin {
  return {
    name: 'tartlet-samples',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const rel = /\/samples\/([\w./-]+)$/.exec(path)?.[1];
        const file = rel === undefined ? undefined : collectionFile(rel);
        if (rel === undefined || file === undefined) {
          next();
          return;
        }
        res.setHeader('Content-Type', rel.endsWith('.json') ? 'application/json' : 'audio/wav');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (!existsSync(collectionDir)) return;
      for (const rel of walkFiles(collectionDir)) {
        const file = collectionFile(rel);
        if (file) this.emitFile({ type: 'asset', fileName: `samples/${rel}`, source: readFileSync(file) });
      }
    },
  };
}

// Demo audio clips for URL clip import + runtime calibration (resample & retune).
// Generated deterministically as PCM16 WAVs so there are no binary fixtures in the repo.
function encodeDemoWav(sampleRate: number, samples: Float32Array): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), 44 + i * 2);
  }
  return buf;
}

function makeDetunedKalimbaWav(): Buffer {
  // 22050 Hz, quiet, 18 ms leading silence, DC offset, 334.5 Hz (E4 + 25.4 cents sharp).
  const sr = 22050;
  const lead = Math.round(sr * 0.018);
  const body = Math.round(sr * 0.65);
  const out = new Float32Array(lead + body);
  for (let i = 0; i < body; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 4.5) * Math.min(1, t / 0.004);
    const tone =
      Math.sin(2 * Math.PI * 334.5 * t) +
      0.32 * Math.sin(2 * Math.PI * 669 * t) * Math.exp(-t * 7) +
      0.14 * Math.sin(2 * Math.PI * 1003.5 * t) * Math.exp(-t * 11);
    out[lead + i] = tone * env * 0.32 + 0.05;
  }
  return encodeDemoWav(sr, out);
}

function makeFlatBrassWav(): Buffer {
  // 32000 Hz, warm brass harmonic tone at 257.0 Hz (C4 - 30.9 cents flat).
  const sr = 32000;
  const body = Math.round(sr * 0.75);
  const out = new Float32Array(body);
  for (let i = 0; i < body; i++) {
    const t = i / sr;
    const attack = Math.min(1, t / 0.035);
    const decay = Math.exp(-t * 1.8);
    const tone =
      Math.sin(2 * Math.PI * 257 * t) +
      0.55 * Math.sin(2 * Math.PI * 514 * t) +
      0.3 * Math.sin(2 * Math.PI * 771 * t) +
      0.15 * Math.sin(2 * Math.PI * 1028 * t);
    out[i] = tone * attack * decay * 0.28;
  }
  return encodeDemoWav(sr, out);
}

function makeVinylPercWav(): Buffer {
  // 22050 Hz, unpitched crisp percussive hit with 12 ms leading silence.
  const sr = 22050;
  const lead = Math.round(sr * 0.012);
  const body = Math.round(sr * 0.22);
  const out = new Float32Array(lead + body);
  let s = 0x51a7c3d1;
  for (let i = 0; i < body; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const noise = ((s >>> 0) / 0xffffffff) * 2 - 1;
    const t = i / sr;
    out[lead + i] = noise * Math.exp(-t * 28) * 0.55;
  }
  return encodeDemoWav(sr, out);
}

const DEMO_CLIPS: Record<string, () => Buffer> = {
  'detuned-kalimba.wav': makeDetunedKalimbaWav,
  'flat-brass.wav': makeFlatBrassWav,
  'vinyl-perc.wav': makeVinylPercWav,
};

function demoClips(): Plugin {
  const cache = new Map<string, Buffer>();
  const get = (name: string): Buffer | undefined => {
    const make = DEMO_CLIPS[name];
    if (!make) return undefined;
    let wav = cache.get(name);
    if (!wav) {
      wav = make();
      cache.set(name, wav);
    }
    return wav;
  };
  return {
    name: 'tartlet-demo-clips',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const name = /\/clips\/([\w-]+\.wav)$/.exec(path)?.[1];
        const wav = name ? get(name) : undefined;
        if (!wav) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'audio/wav');
        res.end(wav);
      });
    },
    generateBundle() {
      for (const name of Object.keys(DEMO_CLIPS)) {
        const wav = get(name);
        if (wav) this.emitFile({ type: 'asset', fileName: `clips/${name}`, source: wav });
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
        if (
          fileName.endsWith('.map') ||
          fileName === 'sw.js' ||
          fileName.startsWith('samples/') ||
          fileName.startsWith('clips/open/')
        )
          continue;
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
// style-src allows 'unsafe-inline' (styles only, never scripts) because the Monaco code editor creates
// <style> elements at runtime for its theme and decorations. Its worker and fonts are same-origin.
// When Trusted Types are enforced, allow Monaco's policies (e.g. trusted-types tartlet editorViewLayer ...).
const CSP =
  "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self' blob: data: https:; object-src 'none'; base-uri 'none'";

export default defineConfig({
  resolve: { alias },
  plugins: [albums(), collection(), demoClips(), pwa()],
  preview: { headers: { 'Content-Security-Policy': CSP, 'Cross-Origin-Opener-Policy': 'same-origin' } },
  // Workers are created with { type: 'module' }, so build them as ES modules (IIFE cannot code-split).
  worker: { format: 'es' },
  // Monaco is loaded lazily as its own large chunk.
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
