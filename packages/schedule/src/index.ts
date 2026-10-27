// The only layer aware of wall-clock time (idea.md §6.1 and §11.3).
import { type Rational, type TimeSpan, add, eq, fromFloat, lte, sub, toNumber, ZERO } from "@tartlet/time";
import type { Event } from "@tartlet/core";

export interface ClockMapping {
  readonly t0: number;
  readonly cycle0: Rational;
  readonly cps: Rational;
}

/** t = t0 + (cycle − cycle0) / cps. Each onset is converted once, from exact cycle time. */
export function cycleToTime(m: ClockMapping, cycle: Rational): number {
  return m.t0 + toNumber(sub(cycle, m.cycle0)) / toNumber(m.cps);
}

export interface SchedulerOptions<T> {
  /** May be asynchronous, for example when evaluation runs in a worker (idea.md §11.3). */
  readonly query: (span: TimeSpan) => readonly Event<T>[] | Promise<readonly Event<T>[]>;
  readonly onEvent: (ev: Event<T>, time: number, duration: number) => void;
  readonly onError?: (e: unknown) => void;
  readonly now: () => number;
  readonly cps: Rational;
  readonly lookahead?: number;
  readonly interval?: number;
}

export class Scheduler<T> {
  private cursor: Rational = ZERO;
  private clock: ClockMapping;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private generation = 0;

  constructor(private readonly opts: SchedulerOptions<T>) {
    this.clock = { t0: 0, cycle0: ZERO, cps: opts.cps };
  }

  get mapping(): ClockMapping {
    return this.clock;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** The current cycle position (approximate, for display only). */
  position(): number {
    return toNumber(this.clock.cycle0) + (this.opts.now() - this.clock.t0) * toNumber(this.clock.cps);
  }

  start(atCycle: Rational = this.cursor): void {
    if (this.timer !== undefined) return;
    this.generation++;
    this.cursor = atCycle;
    this.clock = { t0: this.opts.now() + 0.05, cycle0: atCycle, cps: this.clock.cps };
    this.tick();
    this.timer = setInterval(() => {
      this.tick();
    }, (this.opts.interval ?? 0.025) * 1000);
  }

  stop(): void {
    this.generation++;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Re-anchors at the cursor. The event graph is untouched. */
  setCps(cps: Rational): void {
    if (eq(cps, this.clock.cps)) return;
    this.clock = { t0: cycleToTime(this.clock, this.cursor), cycle0: this.cursor, cps };
  }

  private tick(): void {
    if (this.busy) return;
    const horizon = this.opts.now() + (this.opts.lookahead ?? 0.1);
    const ahead = (horizon - this.clock.t0) * toNumber(this.clock.cps);
    const end = add(this.clock.cycle0, fromFloat(Math.max(0, ahead), 1000));
    if (lte(end, this.cursor)) return;
    const begin = this.cursor;
    this.cursor = end;
    const gen = this.generation;
    const clock = this.clock;
    this.busy = true;
    Promise.resolve()
      .then(() => this.opts.query({ begin, end }))
      .then(
        (events) => {
          if (gen !== this.generation) return;
          for (const ev of events) {
            if (!ev.whole || !eq(ev.part.begin, ev.whole.begin)) continue; // onsets only
            const time = cycleToTime(clock, ev.whole.begin);
            const duration = toNumber(sub(ev.whole.end, ev.whole.begin)) / toNumber(clock.cps);
            this.opts.onEvent(ev, time, duration);
          }
        },
        (e: unknown) => this.opts.onError?.(e),
      )
      .finally(() => {
        this.busy = false;
      });
  }
}