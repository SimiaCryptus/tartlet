// The only layer aware of wall-clock time (idea.md §6.1 and §11.3).
import {
  type Rational,
  type TempoCurve,
  type TempoPoint,
  type TimeSpan,
  add,
  eq,
  fromFloat,
  lte,
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
  readonly query: (span: TimeSpan) => readonly Event<T>[] | Promise<readonly Event<T>[]>;
  readonly onEvent: (ev: Event<T>, time: number, duration: number) => void;
  readonly onError?: (e: unknown) => void;
  readonly now: () => number;
  readonly cps: Rational;
  /** The program's tempo map, if any (docs/long_compositions.md P5). */
  readonly tempo?: readonly TempoPoint[];
  readonly lookahead?: number;
  readonly interval?: number;
}

export class Scheduler<T> {
  private cursor: Rational = ZERO;
  private points: readonly TempoPoint[];
  private clock: ClockMapping;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private generation = 0;

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
    const gen = this.generation;
    this.busy = true;
    Promise.resolve()
      .then(() => this.opts.query({ begin, end }))
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
