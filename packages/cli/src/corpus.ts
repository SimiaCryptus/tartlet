// Corpus harness v1 (idea.md §12.5): classification plus the event-sanity check.
import { check, locator } from '@tartlet/check';
import { compile, sanity, type SanityReport } from '@tartlet/core';
import type { Diagnostic } from '@tartlet/ir';
import { createCatalog } from '@tartlet/resources';
const CATALOG = createCatalog();

export type Bucket = 'clean' | 'degraded' | 'partial' | 'rejected';

export interface Classification {
  readonly bucket: Bucket;
  readonly diagnostics: readonly Diagnostic[];
  readonly sanity: SanityReport;
  /** Frequency keys: diagnostic id plus the source text it points at. */
  readonly misses: readonly string[];
}

/** Takes the longest fenced code block from a model reply, or the whole reply if there is none. */
export function extractCode(output: string): string {
  const blocks = [...output.matchAll(/```[A-Za-z0-9_-]*[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  if (blocks.length === 0) return output;
  return blocks.reduce((a, b) => (b.length > a.length ? b : a), '');
}

function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function classify(source: string): Classification {
  const r = check(source, { documentId: 'corpus', blobIndex: '0', catalog: CATALOG });
  const compiled = compile(r.program, { locate: locator(source), documentId: 'corpus', blobIndex: '0' });
  const s = sanity(compiled);
  const ok = r.program.outputs.filter((o) => o.status === 'ok').length;
  const errors = r.diagnostics.some((d) => d.severity === 'error');
  const warnings = r.diagnostics.some((d) => d.severity === 'warning');
  let bucket: Bucket;
  if (ok === 0) bucket = 'rejected';
  else if (errors || ok < r.program.outputs.length || !s.ok) bucket = 'partial';
  else if (warnings) bucket = 'degraded';
  else bucket = 'clean';
  const starts = lineStarts(source);
  const misses = r.diagnostics
    .filter((d) => d.severity !== 'info' || d.id === 'I-REG-ALIAS' || d.id === 'I-RES-FALLBACK')
    .map((d) => {
      const a = (starts[d.range.start.line] ?? 0) + d.range.start.col;
      const b = (starts[d.range.end.line] ?? 0) + d.range.end.col;
      return `${d.id} ${source.slice(a, Math.min(b, a + 40))}`;
    });
  return { bucket, diagnostics: r.diagnostics, sanity: s, misses };
}

export interface CorpusSummary {
  readonly total: number;
  readonly buckets: Readonly<Record<Bucket, number>>;
  readonly ranking: readonly (readonly [string, number])[];
}

export function summarise(results: readonly Classification[]): CorpusSummary {
  const buckets: Record<Bucket, number> = { clean: 0, degraded: 0, partial: 0, rejected: 0 };
  const freq = new Map<string, number>();
  for (const r of results) {
    buckets[r.bucket]++;
    for (const m of new Set(r.misses)) freq.set(m, (freq.get(m) ?? 0) + 1);
  }
  return { total: results.length, buckets, ranking: [...freq].sort((a, b) => b[1] - a[1]) };
}
