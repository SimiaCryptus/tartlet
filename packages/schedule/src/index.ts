// The only layer aware of wall-clock time (idea.md §6.1 and §11.3).
import {
  type Rational,
  type TempoCurve,
  type TempoPoint,
  type TimeSpan,
  add,
  ceil,
  div,
  eq,
  fromFloat,
  gt,
  lt,
  lte,
  max,
  mul,
  ONE,
  sub,
  tempoCurve,
  toNumber,
  ZERO,
} from '@tartlet/time';
import type { Event } from '@tartlet/core';

export interface ClockMapping {
  readonly t0: number;
  readonly cycle0: Rational;
  readonly cps: Rational;
  /** Set when the program has a tempo map; `cps` is then the tempo before its first point. */
  readonly tempo?: TempoCurve;
}

/** t = t0 + (cycle − cycle0) / cps, or through the tempo map. Each onset is converted once. */
export function cycleToTime(m: ClockMapping, cycle: Rational): number {
  if (m.tempo) return m.t0 + m.tempo.seconds(toNumber(cycle)) - m.tempo.seconds(toNumber(m.cycle0));
  return m.t0 + toNumber(sub(cycle, m.cycle0)) / toNumber(m.cps);
}

/** The cycle playing at `time` (a float, for lookahead and display). */
export function timeToCycle(m: ClockMapping, time: number): number {
  if (m.tempo) return m.tempo.cycle(m.tempo.seconds(toNumber(m.cycle0)) + time - m.t0);
  return toNumber(m.cycle0) + (time - m.t0) * toNumber(m.cps);
}

function samePoints(a: readonly TempoPoint[], b: readonly TempoPoint[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i];
      return q !== undefined && eq(p.cycle, q.cycle) && eq(p.cps, q.cps);
    })
  );
}

export interface SchedulerOptions<T> {
  /** May be asynchronous, for example when evaluation runs in a worker (idea.md §11.3). */
  readonly query: (
    span: TimeSpan,
    controls: ReadonlyMap<string, unknown>,
  ) => readonly Event<T>[] | Promise<readonly Event<T>[]>;
  readonly onEvent: (ev: Event<T>, time: number, duration: number) => void;
  readonly onControls?: (controls: ReadonlyMap<string, unknown>) => void;
  readonly onError?: (e: unknown) => void;
  readonly now: () => number;
  readonly cps: Rational;
  /** The program's tempo map, if any (docs/long_compositions.md P5). */
  readonly tempo?: readonly TempoPoint[];
  readonly lookahead?: number;
  readonly interval?: number;
}
export type ControlPatch = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;
export interface InjectOptions {
  /** Event duration in cycles. Defaults to 1 cycle when neither duration option is set. */
  readonly durationCycles?: Rational;
  /** Event duration in seconds, converted through the active ClockMapping. */
  readonly durationSeconds?: number;
  /** Cycle grid size to quantize the injected onset to. */
  readonly quantize?: Rational;
}
interface QueuedEvent<T> {
  readonly begin: Rational;
  readonly value: T;
  readonly durationCycles?: Rational;
  readonly durationSeconds?: number;
}
function isReadonlyMap(v: ControlPatch): v is ReadonlyMap<string, unknown> {
  return v instanceof Map;
}

export class Scheduler<T> {
  private cursor: Rational = ZERO;
  private points: readonly TempoPoint[];
  private clock: ClockMapping;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private generation = 0;
  private currentControls: ReadonlyMap<string, unknown> = new Map();
  private injected: QueuedEvent<T>[] = [];

  constructor(private readonly opts: SchedulerOptions<T>) {
    this.points = opts.tempo ?? [];
    this.clock = this.anchored(0, ZERO, opts.cps);
  }

  get mapping(): ClockMapping {
    return this.clock;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }
  get controls(): ReadonlyMap<string, unknown> {
    return this.currentControls;
  }

  /** The current cycle position (approximate, for display only). */
  position(): number {
    return timeToCycle(this.clock, this.opts.now());
  }

  start(atCycle: Rational = this.cursor): void {
    if (this.timer !== undefined) return;
    this.generation++;
    this.cursor = atCycle;
    this.clock = this.anchored(this.opts.now() + 0.05, atCycle, this.clock.cps);
    this.tick();
    this.timer = setInterval(
      () => {
        this.tick();
      },
      (this.opts.interval ?? 0.025) * 1000,
    );
  }

  stop(): void {
    this.generation++;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.injected = [];
  }
  /** Replaces the live control map and forwards it to `onControls` (if provided). */
  setControls(controls: ControlPatch): void {
    const next = new Map<string, unknown>();
    const entries = isReadonlyMap(controls) ? controls.entries() : Object.entries(controls);
    for (const [k, v] of entries) {
      if (v !== undefined) next.set(k, v);
    }
    this.currentControls = next;
    this.opts.onControls?.(next);
  }
  /** Merges control updates into the live control map and forwards the result to `onControls`. */
  updateControls(patch: ControlPatch): void {
    const next = new Map(this.currentControls);
    const entries = isReadonlyMap(patch) ? patch.entries() : Object.entries(patch);
    for (const [k, v] of entries) {
      if (v === undefined) next.delete(k);
      else next.set(k, v);
    }
    this.currentControls = next;
    this.opts.onControls?.(next);
  }
  /** Queues an imperative one-shot or grid-quantized event for dispatch in time order. */
  inject(value: T, opts?: InjectOptions): void {
    const q = opts?.quantize;
    if (q !== undefined && lt(q, ZERO)) {
      throw new RangeError('Scheduler.inject: quantize must be non-negative');
    }
    if (opts?.durationSeconds !== undefined && !Number.isFinite(opts.durationSeconds)) {
      throw new RangeError('Scheduler.inject: durationSeconds must be finite');
    }
    let ref = this.cursor;
    if (this.running) {
      const nowCycle = fromFloat(Math.max(toNumber(this.clock.cycle0), timeToCycle(this.clock, this.opts.now())), 1000);
      ref = max(ref, nowCycle);
    }
    const begin = q !== undefined && gt(q, ZERO) ? mul(ceil(div(ref, q)), q) : ref;
    this.injected.push({
      begin,
      value,
      ...(opts?.durationCycles !== undefined ? { durationCycles: opts.durationCycles } : {}),
      ...(opts?.durationSeconds !== undefined ? { durationSeconds: opts.durationSeconds } : {}),
    });
  }

  /** Re-anchors at the cursor. The event graph is untouched. */
  setCps(cps: Rational): void {
    this.setTempo(cps, this.points);
  }

  /** Re-anchors at the cursor with a new base tempo and tempo map. */
  setTempo(cps: Rational, points: readonly TempoPoint[] = []): void {
    if (eq(cps, this.clock.cps) && samePoints(points, this.points)) return;
    const t0 = cycleToTime(this.clock, this.cursor);
    this.points = points;
    this.clock = this.anchored(t0, this.cursor, cps);
  }

  private anchored(t0: number, cycle0: Rational, cps: Rational): ClockMapping {
    return this.points.length > 0 ? { t0, cycle0, cps, tempo: tempoCurve(this.points, cps) } : { t0, cycle0, cps };
  }

  private tick(): void {
    if (this.busy) return;
    const clock = this.clock;
    const horizon = this.opts.now() + (this.opts.lookahead ?? 0.1);
    const ahead = clock.tempo
      ? timeToCycle(clock, horizon) - toNumber(clock.cycle0)
      : (horizon - clock.t0) * toNumber(clock.cps);
    const end = add(clock.cycle0, fromFloat(Math.max(0, ahead), 1000));
    if (lte(end, this.cursor)) return;
    const begin = this.cursor;
    this.cursor = end;
    const controls = this.currentControls;
    const gen = this.generation;
    this.busy = true;
    Promise.resolve()
      .then(() => this.opts.query({ begin, end }, controls))
      .then(
        (events) => {
          if (gen !== this.generation) return;
          // Onsets are dispatched in time order, which mono lines rely on (TS-42).
          const due: [Event<T>, number, number][] = [];
          for (const ev of events) {
            if (!ev.whole || !eq(ev.part.begin, ev.whole.begin)) continue; // onsets only
            const time = cycleToTime(clock, ev.whole.begin);
            const duration = clock.tempo
              ? cycleToTime(clock, ev.whole.end) - time
              : toNumber(sub(ev.whole.end, ev.whole.begin)) / toNumber(clock.cps);
            due.push([ev, time, duration]);
          }
          if (this.injected.length > 0) {
            const remaining: QueuedEvent<T>[] = [];
            for (const item of this.injected) {
              if (!lt(item.begin, end)) {
                remaining.push(item);
                continue;
              }
              const time = cycleToTime(clock, item.begin);
              let spanEnd: Rational;
              if (item.durationCycles !== undefined) {
                spanEnd = add(item.begin, lt(item.durationCycles, ZERO) ? ZERO : item.durationCycles);
              } else if (item.durationSeconds !== undefined) {
                const sec = Math.max(0, item.durationSeconds);
                const durCycles = clock.tempo
                  ? fromFloat(Math.max(0, timeToCycle(clock, time + sec) - toNumber(item.begin)), 1_000_000)
                  : fromFloat(sec * toNumber(clock.cps), 1_000_000);
                spanEnd = add(item.begin, durCycles);
              } else {
                spanEnd = add(item.begin, ONE);
              }
              const span: TimeSpan = { begin: item.begin, end: spanEnd };
              const ev: Event<T> = { whole: span, part: span, value: item.value, provenance: [] };
              const duration = clock.tempo
                ? cycleToTime(clock, spanEnd) - time
                : toNumber(sub(spanEnd, item.begin)) / toNumber(clock.cps);
              due.push([ev, time, duration]);
            }
            this.injected = remaining;
          }
          due.sort((a, b) => a[1] - b[1]);
          for (const [ev, time, duration] of due) this.opts.onEvent(ev, time, duration);
        },
        (e: unknown) => this.opts.onError?.(e),
      )
      .finally(() => {
        this.busy = false;
      });
  }
}
