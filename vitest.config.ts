import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirror tsconfig.base.json `paths` so tests never depend on workspace linking.
const pkgs = fileURLToPath(new URL('./packages/', import.meta.url));
const alias = Object.fromEntries(
  readdirSync(pkgs)
    .filter((name) => existsSync(`${pkgs}${name}/src/index.ts`))
    .map((name) => [`@tartlet/${name}`, `${pkgs}${name}/src/index.ts`]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
