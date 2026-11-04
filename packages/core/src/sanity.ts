// Event-sanity analysis (idea.md §11.4): catches programs that check cleanly but play nothing.
import { eq, rat, sub, toString as ratStr } from '@tartlet/time';
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
  /**
   * Per output label: the shortest number of cycles after which its onsets repeat exactly
   * within the cycles checked, or null when none does (docs/symphonic.md Part 7).
   */
  readonly periods: Readonly<Record<string, number | null>>;
  readonly ok: boolean;
}
function periodOf(sigs: readonly string[]): number | null {
  const n = sigs.length;
  for (let p = 1; p <= Math.floor(n / 2); p++) {
    let same = true;
    for (let i = 0; i + p < n; i++) {
      if (sigs[i] !== sigs[i + p]) {
        same = false;
        break;
      }
    }
    if (same) return p;
  }
  return null;
}

export function sanity(p: CompiledProgram, cycles = 4): SanityReport {
  const counts = new Map<string, number>();
  for (const id of p.outputs.keys()) counts.set(id, 0);
  const sigs = new Map<string, string[]>();
  for (const id of p.outputs.keys()) sigs.set(id, []);
  const muted = new Set<string>();
  let total = 0;
  let maxPer = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let c = 0; c < cycles; c++) {
    const r = p.query({ begin: rat(c), end: rat(c + 1) }, { provenance: false });
    for (const id of r.muted.keys()) muted.add(id);
    for (const id of p.outputs.keys()) {
      const at = rat(c);
      const parts = (r.byOutput.get(id) ?? [])
        .flatMap((ev) =>
          ev.whole && eq(ev.whole.begin, ev.part.begin)
            ? [
                JSON.stringify(
                  [ratStr(sub(ev.whole.begin, at)), ratStr(sub(ev.whole.end, at)), ev.value],
                  (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
                ),
              ]
            : [],
        )
        .sort();
      sigs.get(id)?.push(parts.join('\n'));
    }
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
  const periods = Object.create(null) as Record<string, number | null>;
  for (const [id, list] of sigs) periods[label(id)] = periodOf(list);
  return {
    totalEvents: total,
    eventsPerCycle: cycles > 0 ? total / cycles : 0,
    maxEventsPerCycle: maxPer,
    silentOutputs,
    mutedOutputs: [...muted].map(label),
    pitch: lo <= hi ? { min: lo, max: hi } : null,
    periods,
    ok: total > 0 && silentOutputs.length === 0 && muted.size === 0,
  };
}
