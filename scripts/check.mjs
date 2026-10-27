#!/usr/bin/env node
/**
 * Fail-at-end quality gate.
 *
 * Runs every check even if earlier ones fail, streams output live, then prints a
 * consolidated report and exits non-zero if anything failed.
 *
 *   node scripts/check.mjs                  # run everything
 *   node scripts/check.mjs --only lint,test # subset
 *   node scripts/check.mjs --skip build
 *   node scripts/check.mjs --fail-fast      # stop at first failure (local convenience)
 *   node scripts/check.mjs --tail 80        # lines of failure output repeated in report
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'node_modules', '.bin');

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    skip: { type: 'string' },
    'fail-fast': { type: 'boolean', default: false },
    tail: { type: 'string', default: '40' },
  },
});

/** @type {{ name: string; cmd: string; fix?: string }[]} */
const ALL_STEPS = [
  { name: 'format', cmd: 'prettier --check .', fix: 'npm run format' },
  { name: 'lint', cmd: 'eslint . --max-warnings=0', fix: 'npm run lint:fix' },
  { name: 'typecheck', cmd: 'tsc -p tsconfig.core.json --noEmit --pretty && tsc -p tsconfig.json --noEmit --pretty' },
  { name: 'test', cmd: 'vitest run --coverage' },
  // Packages ship as TS source; the build proves the DOM-free core and bundles the apps.
  { name: 'build', cmd: 'tsc -p tsconfig.core.json --noEmit && pnpm -r --filter "./apps/*" build' },
];

const list = (/** @type {string | undefined} */ s) =>
  s
    ? s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
const only = list(args.only);
const skip = list(args.skip);
for (const n of [...only, ...skip]) {
  if (!ALL_STEPS.some((s) => s.name === n)) {
    console.error(`Unknown step "${n}". Known: ${ALL_STEPS.map((s) => s.name).join(', ')}`);
    process.exit(2);
  }
}
const steps = ALL_STEPS.filter((s) => (only.length === 0 || only.includes(s.name)) && !skip.includes(s.name));
const tailLines = Number.parseInt(args.tail ?? '40', 10) || 40;

const isGitHub = process.env.GITHUB_ACTIONS === 'true';
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || isGitHub);
const c = (/** @type {string} */ code) => (/** @type {string} */ s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = c('31');
const green = c('32');
const yellow = c('33');
const bold = c('1');
const dim = c('2');
// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const stripAnsi = (/** @type {string} */ s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** Build an env with node_modules/.bin on PATH (handles Windows' "Path" key). */
function childEnv() {
  const env = { ...process.env, FORCE_COLOR: useColor ? '1' : '0' };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${binDir}${path.delimiter}${env[pathKey] ?? ''}`;
  return env;
}

/**
 * @param {{ name: string; cmd: string; fix?: string }} step
 * @returns {Promise<{ name: string; cmd: string; fix?: string; status: "pass" | "fail"; code: number; ms: number; output: string }>}
 */
function run(step) {
  return new Promise((resolve) => {
    const start = performance.now();
    /** @type {Buffer[]} */
    const chunks = [];
    let settled = false;
    const finish = (/** @type {number} */ code) => {
      if (settled) return;
      settled = true;
      resolve({
        ...step,
        status: code === 0 ? 'pass' : 'fail',
        code,
        ms: performance.now() - start,
        output: Buffer.concat(chunks).toString('utf8'),
      });
    };

    const child = spawn(step.cmd, {
      cwd: root,
      shell: true,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tee = (/** @type {NodeJS.WriteStream} */ out) => (/** @type {Buffer} */ buf) => {
      chunks.push(buf);
      out.write(buf);
    };
    child.stdout.on('data', tee(process.stdout));
    child.stderr.on('data', tee(process.stderr));
    child.on('error', (err) => {
      chunks.push(Buffer.from(`\n[check] failed to start: ${err.message}\n`));
      finish(127);
    });
    child.on('close', (code, signal) => finish(code ?? (signal ? 128 : 1)));
  });
}

const fmtMs = (/** @type {number} */ ms) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
const tail = (/** @type {string} */ s, /** @type {number} */ n) => {
  const lines = s.trimEnd().split(/\r?\n/);
  return (lines.length > n ? [`… (${lines.length - n} earlier lines omitted)`] : []).concat(lines.slice(-n)).join('\n');
};
const ghEscape = (/** @type {string} */ s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

// ---------------------------------------------------------------- run steps
/** @type {Awaited<ReturnType<typeof run>>[]} */
const results = [];
/** @type {string[]} */
const skipped = [];
const totalStart = performance.now();

for (const step of steps) {
  if (args['fail-fast'] && results.some((r) => r.status === 'fail')) {
    skipped.push(step.name);
    continue;
  }
  console.log(`\n${bold(`▶ ${step.name}`)} ${dim(`$ ${step.cmd}`)}`);
  if (isGitHub) console.log(`::group::${step.name}`);
  const result = await run(step);
  if (isGitHub) console.log('::endgroup::');
  results.push(result);
  const mark = result.status === 'pass' ? green('✔') : red('✘');
  console.log(`${mark} ${step.name} ${dim(`(${fmtMs(result.ms)})`)}`);
}

const failed = results.filter((r) => r.status === 'fail');
const totalMs = performance.now() - totalStart;

// ------------------------------------------------------------------ report
console.log(`\n${bold('═'.repeat(60))}`);
console.log(bold(' Quality report'));
console.log(bold('═'.repeat(60)));
for (const r of results) {
  const mark = r.status === 'pass' ? green('✔ pass') : red(`✘ fail (exit ${r.code})`);
  console.log(` ${r.name.padEnd(12)} ${mark.padEnd(useColor ? 28 : 19)} ${dim(fmtMs(r.ms))}`);
}
for (const name of skipped) console.log(` ${name.padEnd(12)} ${yellow('- skipped')}`);

for (const r of failed) {
  console.log(`\n${red(bold(`── ${r.name} failed ──`))} ${dim(`$ ${r.cmd}`)}`);
  console.log(tail(r.output, tailLines));
  if (r.fix) console.log(yellow(`hint: try \`${r.fix}\``));
}

console.log(
  `\n${failed.length === 0 ? green(bold('All checks passed')) : red(bold(`${failed.length} of ${results.length} check(s) failed: ${failed.map((r) => r.name).join(', ')}`))} ${dim(`in ${fmtMs(totalMs)}`)}\n`,
);

// Machine-readable report.
mkdirSync(path.join(root, 'reports'), { recursive: true });
writeFileSync(
  path.join(root, 'reports', 'check-summary.json'),
  JSON.stringify(
    {
      ok: failed.length === 0,
      durationMs: Math.round(totalMs),
      steps: results.map(({ name, cmd, status, code, ms }) => ({
        name,
        cmd,
        status,
        code,
        durationMs: Math.round(ms),
      })),
      skipped,
    },
    null,
    2,
  ),
);

// GitHub annotations + job summary.
if (isGitHub) {
  for (const r of failed) {
    console.log(`::error title=check: ${r.name} failed::${ghEscape(stripAnsi(tail(r.output, 15)))}`);
  }
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const rows = results
      .map((r) => `| ${r.name} | ${r.status === 'pass' ? '✅ pass' : `❌ fail (${r.code})`} | ${fmtMs(r.ms)} |`)
      .concat(skipped.map((n) => `| ${n} | ⏭️ skipped | |`))
      .join('\n');
    const details = failed
      .map(
        (r) =>
          `<details><summary><b>${r.name}</b> output</summary>\n\n\`\`\`\n${stripAnsi(tail(r.output, tailLines))}\n\`\`\`\n\n</details>`,
      )
      .join('\n\n');
    appendFileSync(
      summaryFile,
      `## Tartlet quality report\n\n| Step | Result | Time |\n| --- | --- | --- |\n${rows}\n\n${details}\n`,
    );
  }
}

process.exit(failed.length === 0 ? 0 : 1);
