#!/usr/bin/env node
// tartlet check | ir | events | sanity | corpus | prompt (plan.md §1).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { check, locator, repairPayload } from '@tartlet/check';
import { compile, sanity } from '@tartlet/core';
import { encodeProgram } from '@tartlet/ir';
import { systemPrompt } from '@tartlet/registry';
import { parseDecimal, rat, toJson } from '@tartlet/time';
import { classify, extractCode, summarise, type Classification } from './corpus';

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
    const r = check(src, opts);
    console.log(
      rest.includes('--json')
        ? JSON.stringify(r.diagnostics, null, 2)
        : repairPayload(r, { includeBenign: rest.includes('--all') }),
    );
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
    const report = sanity(compile(check(src, opts).program, { locate: locator(src), ...opts }));
    console.log(JSON.stringify(report, null, 2));
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
  default:
    console.error('usage: tartlet <check|ir|events|sanity|corpus|prompt> [file] [...]');
    process.exitCode = 2;
}
