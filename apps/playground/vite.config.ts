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
// connect-src includes the default Cognotik proxy used by the optional AI assistant; add your own
// server here if you point the assistant elsewhere (that server must also allow this origin via CORS).
// media-src allows blob: so a recorded ringtone can be previewed before download.
const CSP =
  "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; media-src 'self' blob:; connect-src 'self' https://hosted.cognotik.com; object-src 'none'; base-uri 'none'";

export default defineConfig({
  resolve: { alias },
  preview: { headers: { 'Content-Security-Policy': CSP, 'Cross-Origin-Opener-Policy': 'same-origin' } },
  build: { target: 'es2022' },
});
