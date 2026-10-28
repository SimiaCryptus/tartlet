// Model-friendly repair payload (idea.md §10.3).
import { LineIndex } from '@tartlet/syntax';
import type { Diagnostic } from '@tartlet/ir';
import type { CheckResult } from './check';

/** Info notes and warnings that only drop a cosmetic control. They are hidden by default. */
export function isBenign(d: Diagnostic): boolean {
  return d.severity === 'info' || (d.severity === 'warning' && d.effect === 'none');
}

export function repairPayload(result: CheckResult, opts?: { includeBenign?: boolean }): string {
  const lines = new LineIndex(result.tree.source);
  const shown = result.diagnostics.filter((d) => opts?.includeBenign === true || !isBenign(d));
  const hidden = result.diagnostics.length - shown.length;
  const note = hidden > 0 ? ` (${String(hidden)} cosmetic note${hidden === 1 ? '' : 's'} not shown)` : '';
  if (shown.length === 0) return `tartlet: no issues to fix${note}`;
  // A track muted only because it uses a broken binding or function is fixed by fixing that
  // definition, so it is summarised instead of listed (TS-50).
  const primary = shown.filter((d) => d.id !== 'E-NAME-ERRORED');
  const listed = primary.length > 0 ? primary : shown;
  const knockOn = shown.length - listed.length;
  const out = [`tartlet: ${String(listed.length)} issue${listed.length === 1 ? '' : 's'} to fix${note}`];
  for (const d of listed) {
    const line = d.range.start.line;
    const where =
      d.output !== undefined
        ? `track "${d.output}", `
        : d.definition !== undefined
          ? `function "${d.definition}", `
          : '';
    out.push(
      `  ${d.id}  ${where}line ${String(line + 1)}:`,
      `      ${lines.lineText(line).trim()}`,
      `    ${d.message}`,
    );
  }
  if (knockOn > 0) {
    out.push(
      `  ${String(knockOn)} more track${knockOn === 1 ? ' is' : 's are'} muted only because ${knockOn === 1 ? 'it uses' : 'they use'} a definition listed above.`,
    );
  }
  const ls = [...new Set(listed.map((d) => d.range.start.line + 1))];
  const plural = ls.length !== 1;
  const defs = listed.filter((d) => d.definition !== undefined).length;
  const target =
    defs === listed.length
      ? plural
        ? 'definitions on lines'
        : 'definition on line'
      : defs === 0
        ? plural
          ? 'tracks on lines'
          : 'track on line'
        : plural
          ? 'lines'
          : 'line';
  const rest = defs === 0 ? 'tracks' : 'lines';
  out.push(`  Rewrite ONLY the ${target} ${ls.join(', ')}; keep all other ${rest} unchanged.`);
  return out.join('\n');
}
