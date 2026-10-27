// Event-sanity analysis (idea.md §11.4): catches programs that check cleanly but play nothing.
import { eq, rat } from '@tartlet/time';
import type { CompiledProgram } from './compile';

export interface SanityReport {
  readonly totalEvents: number;
  readonly eventsPerCycle: number;
  readonly maxEventsPerCycle: number;
  /** Labels of unmuted outputs with no onsets. */
  readonly silentOutputs: readonly string[];
  /** Labels of outputs muted by runtime limits. */
  readonly mutedOutputs: readonly string[];
  readonly pitch: { readonly min: number; readonly max: number } | null;
  readonly ok: boolean;
}

export function sanity(p: CompiledProgram, cycles = 4): SanityReport {
  const counts = new Map<string, number>();
  for (const id of p.outputs.keys()) counts.set(id, 0);
  const muted = new Set<string>();
  let total = 0;
  let maxPer = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let c = 0; c < cycles; c++) {
    const r = p.query({ begin: rat(c), end: rat(c + 1) }, { provenance: false });
    for (const id of r.muted.keys()) muted.add(id);
    let per = 0;
    for (const [id, evs] of r.byOutput) {
      for (const ev of evs) {
        if (!ev.whole || !eq(ev.whole.begin, ev.part.begin)) continue;
        per++;
        counts.set(id, (counts.get(id) ?? 0) + 1);
        const note = ev.value.note as { value?: unknown } | undefined;
        if (typeof note?.value === 'number') {
          lo = Math.min(lo, note.value);
          hi = Math.max(hi, note.value);
        }
      }
    }
    total += per;
    maxPer = Math.max(maxPer, per);
  }
  const label = (id: string): string => p.labels.get(id) ?? id;
  const silentOutputs = [...counts].filter(([id, n]) => n === 0 && !muted.has(id)).map(([id]) => label(id));
  return {
    totalEvents: total,
    eventsPerCycle: cycles > 0 ? total / cycles : 0,
    maxEventsPerCycle: maxPer,
    silentOutputs,
    mutedOutputs: [...muted].map(label),
    pitch: lo <= hi ? { min: lo, max: hi } : null,
    ok: total > 0 && silentOutputs.length === 0 && muted.size === 0,
  };
}
