#!/usr/bin/env node
// tartlet check | ir | events | sanity | corpus | prompt (plan.md §1).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { check, formatDuration, locator, pieceLength, repairPayload } from '@tartlet/check';
import { compile, sanity } from '@tartlet/core';
import { encodeProgram } from '@tartlet/ir';
import { systemPrompt } from '@tartlet/registry';
import { parseDecimal, rat, toJson } from '@tartlet/time';
import { classify, extractCode, summarise, type Classification } from './corpus';
import { importSamples, listCollection, verifyCollection } from './samples';

const [cmd, file, ...rest] = process.argv.slice(2);
const opts = { documentId: 'cli', blobIndex: '0' };

function load(path: string | undefined): string {
  if (!path) {
    console.error('missing file argument');
    process.exit(2);
  }
  return readFileSync(path, 'utf8');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

switch (cmd) {
  case 'check': {
    const src = load(file);
    const mi = rest.indexOf('--min-seconds');
    const min = mi >= 0 ? Number(rest[mi + 1]) : NaN;
    const target = Number.isFinite(min) && min > 0 ? min : undefined;
    const r = check(src, { ...opts, ...(target !== undefined ? { minSeconds: target } : {}) });
    if (rest.includes('--json')) {
      console.log(JSON.stringify(r.diagnostics, null, 2));
    } else {
      console.log(
        repairPayload(r, {
          includeBenign: rest.includes('--all'),
          ...(target !== undefined ? { show: ['W-SONG-SHORT'] } : {}),
        }),
      );
      const len = pieceLength(r.program);
      if (len)
        console.log(`piece: ${String(Math.round(len.cycles * 1000) / 1000)} cycles, ${formatDuration(len.seconds)}`);
    }
    process.exitCode = r.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
    break;
  }
  case 'ir':
    console.log(encodeProgram(check(load(file), opts).program));
    break;
  case 'events': {
    const src = load(file);
    const b = parseDecimal(rest[0] ?? '0') ?? rat(0);
    const e = parseDecimal(rest[1] ?? '1') ?? rat(1);
    const p = compile(check(src, opts).program, { locate: locator(src), ...opts });
    for (const ev of p.query({ begin: b, end: e }, { provenance: false }).events) {
      console.log(
        JSON.stringify({
          whole: ev.whole && [toJson(ev.whole.begin), toJson(ev.whole.end)],
          part: [toJson(ev.part.begin), toJson(ev.part.end)],
          value: ev.value,
        }),
      );
    }
    break;
  }
  case 'sanity': {
    const src = load(file);
    const ci = rest.indexOf('--cycles');
    const asked = ci >= 0 ? Number(rest[ci + 1]) : 4;
    const cycles = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 4096) : 4;
    const program = check(src, opts).program;
    const report = sanity(compile(program, { locate: locator(src), ...opts }), cycles);
    const len = pieceLength(program, report.periods);
    console.log(JSON.stringify({ ...report, length: len && { ...len, text: formatDuration(len.seconds) } }, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    break;
  }
  case 'corpus': {
    if (!file) {
      console.error('usage: tartlet corpus <runs-dir>');
      process.exit(2);
    }
    const results: Classification[] = [];
    for (const path of walk(file)) {
      const rec = JSON.parse(readFileSync(path, 'utf8')) as { output?: unknown };
      if (typeof rec.output !== 'string') continue;
      results.push(classify(extractCode(rec.output)));
    }
    const s = summarise(results);
    console.log(JSON.stringify({ total: s.total, buckets: s.buckets, top: s.ranking.slice(0, 50) }, null, 2));
    break;
  }
  case 'prompt':
    console.log(systemPrompt());
    break;
  case 'samples': {
    const target = rest[0];
    const flag = (n: string): string | undefined => {
      const i = rest.indexOf(`--${n}`);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    if (file === 'import') {
      const into = flag('into');
      if (!target || !into) {
        console.error(
          'usage: tartlet samples import <dir> --into <collection> [--bank b] [--license spdx] [--root note]',
        );
        process.exit(2);
      }
      const bank = flag('bank');
      const license = flag('license');
      const root = flag('root');
      const lines = importSamples(target, {
        into,
        ...(bank !== undefined ? { bank } : {}),
        ...(license !== undefined ? { license } : {}),
        ...(root !== undefined ? { root } : {}),
      });
      for (const line of lines) console.log(line);
    } else if (file === 'verify' && target) {
      const problems = verifyCollection(target);
      for (const p of problems) console.log(p);
      console.log(problems.length === 0 ? 'collection ok' : `${String(problems.length)} problem(s)`);
      process.exitCode = problems.length === 0 ? 0 : 1;
    } else if (file === 'list' && target) {
      const rows = listCollection(target);
      if (rest.includes('--json')) console.log(JSON.stringify(rows, null, 2));
      else
        for (const r of rows) {
          const roots = r.roots.length > 0 ? ` roots ${r.roots.join(',')}` : '';
          console.log(`${r.bank}/${r.name}  ${r.kind}  ${String(r.takes)} take(s)${roots}  ${r.license}`);
        }
    } else {
      console.error('usage: tartlet samples <import|verify|list> <dir> [...]');
      process.exitCode = 2;
    }
    break;
  }
  default:
    console.error('usage: tartlet <check|ir|events|sanity|corpus|prompt|samples> [file] [...]');
    process.exitCode = 2;
}
