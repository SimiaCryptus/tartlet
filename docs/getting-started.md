# Getting started

## Requirements

- Node 22 or newer. The repo declares `"engines": { "node": ">=22" }`.
- pnpm 9. Run `corepack enable` to get the version pinned in `packageManager`.
- Optional: Deno 2 for the Deno smoke test, Playwright browsers for e2e tests, and the AWS CLI
  plus Terraform for deployment.

```sh
git clone https://github.com/SimiaCryptus/tartlet
cd tartlet
pnpm install
```

There is no library build step. Every package's `exports` points at `src/index.ts`. Vitest and
Vite resolve `@tartlet/*` through aliases that mirror `tsconfig.base.json` `paths`. Those
aliases are in `vitest.config.ts` and `apps/playground/vite.config.ts`.

## Everyday scripts

All commands run from the repository root.

- `pnpm test`: runs every Vitest suite under `packages/*/test` once.
- `pnpm test:watch`: runs Vitest in watch mode.
- `pnpm coverage`: runs the tests with V8 coverage over `packages/*/src`.
- `pnpm lint` and `pnpm lint:fix`: ESLint with zero warnings allowed.
- `pnpm format` and `pnpm format:check`: Prettier. This includes Markdown, so run `pnpm format`
  after editing docs.
- `pnpm fix`: Prettier, then ESLint autofix.
- `pnpm typecheck`: two TypeScript passes. The first, `tsconfig.core.json`, uses no DOM lib, so
  a DOM reference in a core package is a type error. The second, `tsconfig.json`, covers
  everything, including tests and apps.
- `pnpm build`: builds the apps (`apps/*`) with Vite.
- `pnpm e2e`: runs the Playwright tests. They start `vite preview` on port 4173 and need a
  prior `pnpm build`.
- `pnpm --filter playground dev`: starts the playground dev server.
- `pnpm cleanroom:log "<model>" "<task>" "<inputs>"`: creates a clean-room log entry. See
  [CONTRIBUTING](../CONTRIBUTING.md).
- `pnpm corpus:prompts`: regenerates `corpus/prompts/prompts.jsonl`.

## The quality gate

`pnpm check` runs `scripts/check.mjs`. It runs the format, lint, typecheck, test (with
coverage) and build steps. It always runs every step, prints a consolidated report at the end,
and writes `reports/check-summary.json`. Useful flags:

```sh
pnpm check --only lint,test
pnpm check --skip build
pnpm check --fail-fast
pnpm check --tail 80        # lines of failing output repeated in the report
```

On GitHub Actions it also emits error annotations and a job summary. `deploy.sh` and
`prepublishOnly` run it too.

CI (`.github/workflows/ci.yml`) runs:

- a DCO sign-off check on pull requests;
- lint, typecheck and test on Node 22, plus a grep that fails on `eval(` or `new Function(`;
- the Deno smoke test;
- Playwright e2e tests on Chromium, Firefox and WebKit.

## The CLI

`packages/cli/src/main.ts` is the headless reference tool. It ships as TypeScript with
extensionless imports, so run it with a TypeScript-aware runner. For example, with `tsx`
(not a project dependency):

```sh
npx tsx packages/cli/src/main.ts <command> [file] [...]
```

Commands:

- `check <file> [--json] [--all]`: prints the model-friendly repair payload. `--all` includes
  benign notes. `--json` prints the raw diagnostics. Exits with 1 if any error exists.
- `ir <file>`: prints the lowered program as `tartlet/1` JSON.
- `events <file> [begin] [end]`: prints the events in a span, one JSON line each. The span ends
  are decimal cycles and default to `0` and `1`.
- `sanity <file>`: prints the event-sanity report over 4 cycles. Exits with 1 when the report
  is not ok.
- `corpus <runs-dir>`: classifies every `*.json` run record found recursively under the
  directory. It extracts the longest fenced code block from each record's `output`, then
  prints bucket counts and the top 50 frequency-ranked misses.
- `prompt`: prints the system-prompt snippet, which is generated from the registry.

## The Deno smoke test

```sh
deno run --unstable-sloppy-imports --config deno.json scripts/deno-smoke.ts
```

This proves that the core path runs without a DOM. `deno.json` maps the core packages to their
sources.

## The corpus

See [`corpus/README.md`](../corpus/README.md). In short:

1. Run `pnpm corpus:prompts` to write about 600 original prompts.
2. Write a git-ignored `corpus/adapters.local.mjs` that exports
   `adapters: { name, generate(prompt) }[]`. Keys never enter the repo.
3. Run `node corpus/collect.mjs` (set `SAMPLES` to the number of samples per prompt) to write
   `corpus/runs/<date>/<model>/*.json`.
4. Run `npx tsx packages/cli/src/main.ts corpus corpus/runs` to classify the results.

## Deploying the playground

`./deploy.sh` checks the prerequisites, installs dependencies, runs `pnpm check`, builds, then
uploads. Hashed assets are uploaded with long-lived immutable caching and are never deleted.
Everything else is uploaded with `no-cache`, after which the script invalidates CloudFront.

```sh
./deploy.sh              # standard deploy
./deploy.sh --infra      # apply terraform/ first
SKIP_CHECK=1 ./deploy.sh # skip the quality gate (not recommended)
BUCKET=… DISTRIBUTION_ID=… ./deploy.sh
```

The infrastructure is in `terraform/`: an S3 bucket behind CloudFront with origin access
control, an ACM certificate, Route 53 records, an index-rewrite function and a CORS response
function.

## Editor setup

- Enable ESLint and Prettier integration in your editor. The project uses
  `typescript-eslint` `strictTypeChecked` with the project service.
- TypeScript settings include `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  Expect `arr[i]` to be `T | undefined`. Build optional properties with conditional spreads,
  for example `...(x ? { x } : undefined)`.

- `samples import <dir> --into <collection> [--bank b] [--license spdx] [--root note]`:
  validates and normalises every WAV in a directory and writes it into a bank of the
  collection, with a manifest. Every guess about roots and velocity layers is printed.
- `samples verify <collection>`: re-hashes and re-validates every file. Exits with 1 on any
  problem, including entries whose licence is `UNKNOWN`.
- `samples list <collection> [--json]`: lists every bank entry.