import { defineConfig, type Plugin } from 'vite';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Mirror tsconfig.base.json `paths` so the build never depends on workspace linking.
const pkgs = fileURLToPath(new URL('../../packages/', import.meta.url));
const alias = Object.fromEntries(
  readdirSync(pkgs)
    .filter((name) => existsSync(`${pkgs}${name}/src/index.ts`))
    .map((name) => [`@tartlet/${name}`, `${pkgs}${name}/src/index.ts`]),
);

function encodeDemoWav(sampleRate: number, samples: Float32Array): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
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

const DEMO_CLIPS: Record<string, () => Buffer> = {
  'detuned-chime.wav': () => {
    // 22050 Hz, 449 Hz (A4 + 35.1 cents sharp), quiet with 15 ms leading silence.
    const sr = 22050;
    const lead = Math.round(sr * 0.015);
    const body = Math.round(sr * 0.7);
    const out = new Float32Array(lead + body);
    for (let i = 0; i < body; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 3.8) * Math.min(1, t / 0.003);
      out[lead + i] =
        (Math.sin(2 * Math.PI * 449 * t) + 0.35 * Math.sin(2 * Math.PI * 898 * t) * Math.exp(-t * 6)) * env * 0.35;
    }
    return encodeDemoWav(sr, out);
  },
  'flat-pluck.wav': () => {
    // 32000 Hz, 256 Hz (C4 - 37.7 cents flat), DC offset.
    const sr = 32000;
    const body = Math.round(sr * 0.6);
    const out = new Float32Array(body);
    for (let i = 0; i < body; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 4.2) * Math.min(1, t / 0.004);
      out[i] =
        (Math.sin(2 * Math.PI * 256 * t) +
          0.45 * Math.sin(2 * Math.PI * 512 * t) * Math.exp(-t * 5) +
          0.2 * Math.sin(2 * Math.PI * 768 * t) * Math.exp(-t * 8)) *
          env *
          0.32 +
        0.04;
    }
    return encodeDemoWav(sr, out);
  },
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
    name: 'tartlet-sfx-demo-clips',
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

// The minimal CSP from docs/embedding.md: blob: is needed for the static audio worklets (ADR-003).
const CSP =
  "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; connect-src 'self' blob: data: https:; object-src 'none'; base-uri 'none'";

export default defineConfig({
  base: './',
  resolve: { alias },
  plugins: [demoClips()],
  preview: { headers: { 'Content-Security-Policy': CSP } },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
