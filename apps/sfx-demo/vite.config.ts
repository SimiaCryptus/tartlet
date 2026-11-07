import { defineConfig } from 'vite';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Mirror tsconfig.base.json `paths` so the build never depends on workspace linking.
const pkgs = fileURLToPath(new URL('../../packages/', import.meta.url));
const alias = Object.fromEntries(
  readdirSync(pkgs)
    .filter((name) => existsSync(`${pkgs}${name}/src/index.ts`))
    .map((name) => [`@tartlet/${name}`, `${pkgs}${name}/src/index.ts`]),
);

// The minimal CSP from docs/embedding.md: blob: is needed for the static audio worklets (ADR-003).
const CSP =
  "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'";

export default defineConfig({
  base: './',
  resolve: { alias },
  preview: { headers: { 'Content-Security-Policy': CSP } },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});