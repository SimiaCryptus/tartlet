import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@tartlet/core';
import { type TimeSpan, add, div, eq, fromFloat, ONE, sub, toNumber, ZERO } from '@tartlet/time';
import { Scheduler, cycleToTime } from '@tartlet/schedule';

const TWO = add(ONE, ONE);
const THREE = add(TWO, ONE);
const FIVE = add(TWO, THREE);
const HALF = div(ONE, TWO);
const THIRD = div(ONE, THREE);
const QUARTER = div(ONE, add(TWO, TWO));
const FIFTH = div(ONE, FIVE);
const EIGHTH = div(QUARTER, TWO);

interface Dispatched<T> {
  readonly ev: Event<T>;
  readonly time: number;
  readonly duration: number;
}

describe('Scheduler imperative inject and live controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches immediate injected events with default, cycle, and second durations', async () => {
    const dispatched: Dispatched<string>[] = [];
    const queriedSpans: TimeSpan[] = [];

    const scheduler = new Scheduler<string>({
      cps: TWO, // 2 cycles/sec -> 1 cycle = 0.5s
      lookahead: 0.1,
      interval: 0.025,
      now: () => Date.now() / 1000,
      query: (span) => {
        queriedSpans.push(span);
        return [];
      },
      onEvent: (ev, time, duration) => {
        dispatched.push({ ev, time, duration });
      },
    });

    scheduler.start(ZERO);
    // Initial tick at now=0 queries [0, 0.1] because t0 = 0.05 and horizon = 0.1.
    await vi.advanceTimersByTimeAsync(0);
    expect(queriedSpans).toHaveLength(1);

    scheduler.inject('default-dur');
    scheduler.inject('cycle-dur', { durationCycles: QUARTER });
    scheduler.inject('sec-dur', { durationSeconds: 0.3 });
    scheduler.inject('neg-cycle', { durationCycles: sub(ZERO, ONE) });
    scheduler.inject('neg-sec', { durationSeconds: -1 });

    // Advance 25ms -> now=0.025, horizon=0.125, end=(0.125-0.05)*2 = 0.15 > 0.1.
    await vi.advanceTimersByTimeAsync(25);
    scheduler.stop();

    expect(dispatched.map((d) => d.ev.value)).toEqual(['default-dur', 'cycle-dur', 'sec-dur', 'neg-cycle', 'neg-sec']);

    for (const { ev, time, duration } of dispatched) {
      expect(ev.whole).toBeDefined();
      expect(ev.part).toEqual(ev.whole);
      expect(ev.provenance).toEqual([]);
      expect(eq(ev.whole!.begin, fromFloat(0.1, 1000))).toBe(true);
      expect(time).toBeCloseTo(cycleToTime(scheduler.mapping, ev.whole!.begin), 9);
      expect(time + duration).toBeCloseTo(cycleToTime(scheduler.mapping, ev.whole!.end), 9);
    }

    const [dDefault, dCycle, dSec, dNegCycle, dNegSec] = dispatched;
    expect(dDefault?.duration).toBeCloseTo(0.5, 9);
    expect(dCycle?.duration).toBeCloseTo(0.125, 9);
    expect(dSec?.duration).toBeCloseTo(0.3, 6);
    expect(dNegCycle?.duration).toBe(0);
    expect(dNegSec?.duration).toBe(0);

    // Query spans remain contiguous across ticks.
    expect(queriedSpans).toHaveLength(2);
    expect(eq(queriedSpans[0]!.end, queriedSpans[1]!.begin)).toBe(true);
  });

  it('validates inject options and clears queued injections on stop()', async () => {
    const dispatched: string[] = [];
    const scheduler = new Scheduler<string>({
      cps: ONE,
      lookahead: 0.1,
      interval: 0.025,
      now: () => Date.now() / 1000,
      query: () => [],
      onEvent: (ev) => dispatched.push(ev.value),
    });

    expect(() => {
      scheduler.inject('bad-q', { quantize: sub(ZERO, QUARTER) });
    }).toThrow(RangeError);
    expect(() => {
      scheduler.inject('bad-nan', { durationSeconds: Number.NaN });
    }).toThrow(RangeError);
    expect(() => {
      scheduler.inject('bad-inf', { durationSeconds: Number.POSITIVE_INFINITY });
    }).toThrow(RangeError);

    scheduler.inject('stale');
    scheduler.stop();

    scheduler.inject('queued-before-start');
    scheduler.start(ZERO);
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();

    expect(dispatched).toEqual(['queued-before-start']);
  });

  it('quantizes injected events onto exact Rational grids without skipping already-aligned positions', async () => {
    const dispatched: Dispatched<string>[] = [];
    const scheduler = new Scheduler<string>({
      cps: ONE,
      lookahead: 0.3,
      interval: 0.025,
      now: () => Date.now() / 1000,
      query: () => [],
      onEvent: (ev, time, duration) => {
        dispatched.push({ ev, time, duration });
      },
    });

    scheduler.start(ZERO);
    // now=0, t0=0.05, horizon=0.3 -> cursor=0.25 (1/4).
    await vi.advanceTimersByTimeAsync(0);

    // Exact match on 1/4 grid at cursor=0.25 should schedule at 1/4, not 1/2.
    scheduler.inject('exact-quarter', { quantize: QUARTER });
    // quantize=0 behaves as unquantized (cursor=0.25).
    scheduler.inject('zero-quantize', { quantize: ZERO });

    // Advance 50ms -> now=0.05, horizon=0.35, cursor=0.30 (off 1/8, 1/4, 1/3 grids).
    await vi.advanceTimersByTimeAsync(50);

    scheduler.inject('grid-quarter', { quantize: QUARTER }); // ceil(0.3 / 0.25)*0.25 = 1/2
    scheduler.inject('grid-eighth', { quantize: EIGHTH }); // ceil(0.3 / 0.125)*0.125 = 3/8
    scheduler.inject('grid-third', { quantize: THIRD }); // ceil(0.3 / (1/3))*(1/3) = 1/3

    // Advance enough for cursor > 0.5 (at now=0.35, horizon=0.65, end=0.60).
    await vi.advanceTimersByTimeAsync(300);
    scheduler.stop();

    expect(dispatched.map((d) => d.ev.value)).toEqual([
      'exact-quarter',
      'zero-quantize',
      'grid-third',
      'grid-eighth',
      'grid-quarter',
    ]);

    const byName = new Map(dispatched.map((d) => [d.ev.value, d]));
    expect(eq(byName.get('exact-quarter')!.ev.whole!.begin, QUARTER)).toBe(true);
    expect(eq(byName.get('zero-quantize')!.ev.whole!.begin, QUARTER)).toBe(true);
    expect(eq(byName.get('grid-third')!.ev.whole!.begin, THIRD)).toBe(true);
    expect(eq(byName.get('grid-eighth')!.ev.whole!.begin, add(QUARTER, EIGHTH))).toBe(true);
    expect(eq(byName.get('grid-quarter')!.ev.whole!.begin, HALF)).toBe(true);
  });

  it('merges injected events with async pattern-queried events in strict onset time order', async () => {
    const dispatched: Dispatched<string>[] = [];

    const mkSpan = (b: number, e: number): TimeSpan => ({
      begin: fromFloat(b, 1000),
      end: fromFloat(e, 1000),
    });

    const scheduler = new Scheduler<string>({
      cps: ONE,
      lookahead: 0.1,
      interval: 0.25,
      now: () => Date.now() / 1000,
      query: async (span) => {
        await Promise.resolve();
        // Second tick spans [0.05, 0.30].
        if (toNumber(span.begin) <= 0.05 && toNumber(span.end) >= 0.3) {
          const events: Event<string>[] = [
            { whole: mkSpan(0.28, 0.3), part: mkSpan(0.28, 0.3), value: 'pat-0.28', provenance: [] },
            // Non-onset fragment (part.begin !== whole.begin) must be ignored.
            { whole: mkSpan(0, 0.3), part: mkSpan(0.1, 0.3), value: 'pat-fragment', provenance: [] },
            // Continuous event (no whole) must be ignored.
            { whole: undefined, part: mkSpan(0.1, 0.3), value: 'pat-continuous', provenance: [] },
            { whole: mkSpan(0.18, 0.2), part: mkSpan(0.18, 0.2), value: 'pat-0.18', provenance: [] },
            { whole: mkSpan(0.22, 0.24), part: mkSpan(0.22, 0.24), value: 'pat-0.22', provenance: [] },
          ];
          return events;
        }
        return [];
      },
      onEvent: (ev, time, duration) => {
        dispatched.push({ ev, time, duration });
      },
    });

    scheduler.start(ZERO);
    // Tick 1 at now=0 queries [0, 0.05].
    await vi.advanceTimersByTimeAsync(0);

    // Both quantized events fall inside tick 2's [0.05, 0.30) window.
    scheduler.inject('inj-0.25', { quantize: QUARTER });
    scheduler.inject('inj-0.20', { quantize: FIFTH });

    // Tick 2 at now=0.25 queries [0.05, 0.30].
    await vi.advanceTimersByTimeAsync(250);
    scheduler.stop();

    expect(dispatched.map((d) => d.ev.value)).toEqual(['pat-0.18', 'inj-0.20', 'pat-0.22', 'inj-0.25', 'pat-0.28']);

    for (let i = 1; i < dispatched.length; i++) {
      expect(dispatched[i]!.time).toBeGreaterThanOrEqual(dispatched[i - 1]!.time);
    }
  });

  it('converts durationSeconds accurately through an active tempo curve', async () => {
    const dispatched: Dispatched<string>[] = [];

    const scheduler = new Scheduler<string>({
      cps: ONE,
      tempo: [{ cycle: ONE, cps: TWO }],
      lookahead: 0.1,
      interval: 0.025,
      now: () => Date.now() / 1000,
      query: () => [],
      onEvent: (ev, time, duration) => {
        dispatched.push({ ev, time, duration });
      },
    });

    scheduler.start(HALF);
    // Tick 1 queries [0.5, 0.55].
    await vi.advanceTimersByTimeAsync(0);

    // At cycle 0.75, 0.5s spans 0.25 cycles at 1 cps (0.25s) + 0.5 cycles at 2 cps (0.25s) -> end=1.5.
    scheduler.inject('cross-tempo', { quantize: QUARTER, durationSeconds: 0.5 });

    await vi.advanceTimersByTimeAsync(300);
    scheduler.stop();

    expect(dispatched).toHaveLength(1);
    const item = dispatched[0]!;
    expect(toNumber(item.ev.whole!.begin)).toBeCloseTo(0.75, 9);
    expect(toNumber(item.ev.whole!.end)).toBeCloseTo(1.5, 5);
    expect(item.time).toBeCloseTo(cycleToTime(scheduler.mapping, item.ev.whole!.begin), 9);
    expect(item.duration).toBeCloseTo(0.5, 5);
  });

  it('manages live control maps, forwards snapshots to query and onControls, and isolates in-flight ticks', async () => {
    const controlHistory: ReadonlyMap<string, unknown>[] = [];
    const seenByQuery: Array<Record<string, unknown>> = [];
    let resolveDeferred: (() => void) | undefined;
    let tickCount = 0;

    const scheduler = new Scheduler<string>({
      cps: ONE,
      lookahead: 0.1,
      interval: 0.025,
      now: () => Date.now() / 1000,
      query: async (_span, controls) => {
        tickCount++;
        if (tickCount === 2) {
          await new Promise<void>((resolve) => {
            resolveDeferred = resolve;
          });
        }
        seenByQuery.push(Object.fromEntries(controls.entries()));
        return [];
      },
      onEvent: () => {},
      onControls: (controls) => {
        controlHistory.push(controls);
      },
    });

    expect(scheduler.controls.size).toBe(0);

    const inputRecord: Record<string, unknown> = { cutoff: 800, res: 0.4, ignored: undefined };
    scheduler.setControls(inputRecord);
    inputRecord['cutoff'] = 9999; // External mutation must not affect Scheduler state.

    expect(Object.fromEntries(scheduler.controls.entries())).toEqual({ cutoff: 800, res: 0.4 });
    expect(controlHistory).toHaveLength(1);
    expect(Object.fromEntries(controlHistory[0]!.entries())).toEqual({ cutoff: 800, res: 0.4 });

    scheduler.updateControls({ res: 0.7, drive: 2 });
    expect(Object.fromEntries(scheduler.controls.entries())).toEqual({
      cutoff: 800,
      res: 0.7,
      drive: 2,
    });

    scheduler.updateControls(
      new Map<string, unknown>([
        ['drive', undefined],
        ['pan', -0.5],
      ]),
    );
    expect(Object.fromEntries(scheduler.controls.entries())).toEqual({
      cutoff: 800,
      res: 0.7,
      pan: -0.5,
    });

    // Tick 1 receives current controls snapshot.
    scheduler.start(ZERO);
    await vi.advanceTimersByTimeAsync(0);
    expect(seenByQuery[0]).toEqual({ cutoff: 800, res: 0.7, pan: -0.5 });

    // Tick 2 starts and pauses inside query; update controls while tick 2 is in flight.
    await vi.advanceTimersByTimeAsync(25);
    const replacementMap = new Map<string, unknown>([['gain', 0.5]]);
    scheduler.setControls(replacementMap);
    replacementMap.set('gain', 0.1); // External mutation must not affect Scheduler state.

    resolveDeferred?.();
    await vi.advanceTimersByTimeAsync(0);
    // Tick 2 saw the controls captured when tick 2 began.
    expect(seenByQuery[1]).toEqual({ cutoff: 800, res: 0.7, pan: -0.5 });

    // Tick 3 sees the replaced controls map.
    await vi.advanceTimersByTimeAsync(25);
    scheduler.stop();
    expect(seenByQuery[2]).toEqual({ gain: 0.5 });
  });
});
