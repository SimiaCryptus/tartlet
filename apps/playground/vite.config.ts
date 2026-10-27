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

// Production headers mirror Markdown2 (plan.md §3). There is no unsafe-eval or unsafe-inline.
// blob: is allowed for the safety worklet (ADR-003). Trusted Types are enforced from T1, once
// the worklet URL goes through a TT policy.
const CSP =
  "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'";

export default defineConfig({
  resolve: { alias },
  preview: { headers: { 'Content-Security-Policy': CSP, 'Cross-Origin-Opener-Policy': 'same-origin' } },
  build: { target: 'es2022' },
});
