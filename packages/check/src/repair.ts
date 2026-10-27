// Model-friendly repair payload (idea.md §10.3).
import { LineIndex } from '@tartlet/syntax';
import type { Diagnostic } from '@tartlet/ir';
import type { CheckResult } from './check';

/** Info notes and warnings that only drop a cosmetic control. They are hidden by default. */
export function isBenign(d: Diagnostic): boolean {
  return d.severity === 'info' || (d.severity === 'warning' && d.effect === 'none');
}

export function repairPayload(result: CheckResult, opts: { includeBenign?: boolean } = {}): string {
  const lines = new LineIndex(result.tree.source);
  const shown = result.diagnostics.filter((d) => opts.includeBenign === true || !isBenign(d));
  const hidden = result.diagnostics.length - shown.length;
  const note = hidden > 0 ? ` (${String(hidden)} cosmetic note${hidden === 1 ? '' : 's'} not shown)` : '';
  if (shown.length === 0) return `tartlet: no issues to fix${note}`;
  const out = [`tartlet: ${String(shown.length)} issue${shown.length === 1 ? '' : 's'} to fix${note}`];
  for (const d of shown) {
    const line = d.range.start.line;
    const track = d.output !== undefined ? `track "${d.output}", ` : '';
    out.push(
      `  ${d.id}  ${track}line ${String(line + 1)}:`,
      `      ${lines.lineText(line).trim()}`,
      `    ${d.message}`,
    );
  }
  const ls = [...new Set(shown.map((d) => d.range.start.line + 1))];
  out.push(
    `  Rewrite ONLY the ${ls.length === 1 ? 'track on line' : 'tracks on lines'} ${ls.join(', ')}; keep all other tracks unchanged.`,
  );
  return out.join('\n');
}
