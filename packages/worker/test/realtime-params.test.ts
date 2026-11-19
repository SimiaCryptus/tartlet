import type { TimeSpan } from '@tartlet/time';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface QueryOptions {
  readonly provenance?: boolean;
  readonly controls?: unknown;
  readonly params?: unknown;
}

const { querySpy, checkMock, locatorMock, compileMock } = vi.hoisted(() => {
  const querySpy = vi.fn<(span: TimeSpan, options?: QueryOptions) => { events: never[]; muted: never[] }>(() => ({
    events: [],
    muted: [],
  }));
  const checkMock = vi.fn(() => ({
    program: { body: [] },
    diagnostics: [],
  }));
  const locatorMock = vi.fn(() => () => ({ line: 1, column: 1 }));
  const compileMock = vi.fn(() => ({
    query: querySpy,
  }));
  return { querySpy, checkMock, locatorMock, compileMock };
});

vi.mock('@tartlet/check', () => ({
  check: checkMock,
  locator: locatorMock,
}));

vi.mock('@tartlet/core', () => ({
  compile: compileMock,
}));

import { InlineEvaluator, WorkerEvaluator } from '../src/client';
import { EvalCore } from '../src/core';
import { startWorkerHost, type WorkerPort } from '../src/host';
import { isRequest, type CheckRequest, type Response } from '../src/protocol';

type WorkerReply = Response | { readonly id: number; readonly type: 'ok' };

const sampleSpan = {
  begin: { num: 0n, den: 1n },
  end: { num: 1n, den: 1n },
} as unknown as TimeSpan;

const sampleCheck: CheckRequest = {
  source: 'sound "bd"',
  documentId: 'doc-1',
  blobIndex: 'blob-1',
};

/** Index into an array, throwing if the slot is empty (satisfies noUncheckedIndexedAccess). */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected an item at index ${String(index)}, but found none.`);
  }
  return item;
}

function readParam(params: unknown, key: string): unknown {
  if (params instanceof Map) return params.get(key);
  if (typeof params === 'object' && params !== null) {
    return (params as Record<string, unknown>)[key];
  }
  return undefined;
}

/** The options passed to the n-th `CompiledProgram.query` call. */
function optionsOf(call: number): QueryOptions | undefined {
  return querySpy.mock.calls[call]?.[1];
}

class MockWorker {
  readonly posted: unknown[] = [];
  terminated = false;
  onPost?: (msg: unknown) => void;
  readonly #listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, listener: (e: unknown) => void): void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener);
  }

  postMessage(msg: unknown): void {
    this.posted.push(msg);
    this.onPost?.(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: WorkerReply): void {
    for (const listener of this.#listeners.get('message') ?? []) {
      listener({ data });
    }
  }

  emitError(): void {
    const event = { preventDefault: vi.fn() };
    for (const listener of this.#listeners.get('error') ?? []) {
      listener(event);
    }
  }
}

class HostedWorker extends MockWorker {
  hang = false;

  constructor() {
    super();
    const hostListeners: Array<(e: { data: unknown }) => void> = [];
    const port: WorkerPort = {
      postMessage: (msg) => {
        if (this.terminated) return;
        queueMicrotask(() => {
          if (!this.terminated) {
            this.emitMessage(msg as WorkerReply);
          }
        });
      },
      addEventListener: (_type, listener) => {
        hostListeners.push(listener);
      },
    };

    startWorkerHost(port);

    this.onPost = (msg) => {
      if (this.hang || this.terminated) return;
      queueMicrotask(() => {
        if (this.hang || this.terminated) return;
        for (const listener of hostListeners) {
          listener({ data: msg });
        }
      });
    };
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('isRequest validation for setParams', () => {
  it('accepts valid setParams requests with entry arrays', () => {
    expect(
      isRequest({
        id: 1,
        type: 'setParams',
        params: [
          ['cutoff', 0.5],
          ['mode', 'lp'],
        ],
      }),
    ).toBe(true);

    expect(
      isRequest({
        id: 0,
        type: 'setParams',
        params: [],
      }),
    ).toBe(true);
  });

  it('rejects setParams requests with missing or non-array params', () => {
    expect(isRequest({ id: 1, type: 'setParams' })).toBe(false);
    expect(isRequest({ id: 1, type: 'setParams', params: null })).toBe(false);
    expect(isRequest({ id: 1, type: 'setParams', params: { cutoff: 0.5 } })).toBe(false);
    expect(isRequest({ id: 1, type: 'setParams', params: 'cutoff' })).toBe(false);
  });

  it('rejects setParams requests with missing or non-numeric id', () => {
    expect(isRequest({ type: 'setParams', params: [] })).toBe(false);
    expect(isRequest({ id: '1', type: 'setParams', params: [] })).toBe(false);
    expect(isRequest(null)).toBe(false);
  });
});

describe('EvalCore parameter storage and query forwarding', () => {
  it('returns empty events when queried before check even after setParams', () => {
    const core = new EvalCore();
    core.setParams({ cutoff: 0.5 });

    expect(core.query(sampleSpan, true)).toEqual({ events: [], muted: [] });
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('forwards Record, Map, and entry-array params into CompiledProgram.query', () => {
    const core = new EvalCore();
    core.check(sampleCheck);

    core.setParams({ cutoff: 0.5, mode: 'lp' });
    core.query(sampleSpan, true);

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0]?.[0]).toBe(sampleSpan);
    expect(optionsOf(0)?.provenance).toBe(true);
    expect(readParam(optionsOf(0)?.params, 'cutoff')).toBe(0.5);
    expect(readParam(optionsOf(0)?.params, 'mode')).toBe('lp');

    core.setParams(new Map<string, unknown>([['cutoff', 0.9]]));
    core.query(sampleSpan, false);

    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(optionsOf(1)?.provenance).toBe(false);
    expect(readParam(optionsOf(1)?.params, 'cutoff')).toBe(0.9);
    expect(readParam(optionsOf(1)?.params, 'mode')).toBeUndefined();

    core.setParams([
      ['rate', 2],
      ['wet', 0.25],
    ]);
    core.query(sampleSpan, false);

    expect(querySpy).toHaveBeenCalledTimes(3);
    expect(readParam(optionsOf(2)?.params, 'rate')).toBe(2);
    expect(readParam(optionsOf(2)?.params, 'wet')).toBe(0.25);
    expect(readParam(optionsOf(2)?.params, 'cutoff')).toBeUndefined();
  });

  it('preserves stored params when setParams is called before or across check calls', () => {
    const core = new EvalCore();
    core.setParams({ gain: 0.75 });

    core.check(sampleCheck);
    core.query(sampleSpan, false);

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(readParam(optionsOf(0)?.params, 'gain')).toBe(0.75);

    core.check({ ...sampleCheck, source: 'sound "hh"' });
    core.query(sampleSpan, true);

    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(readParam(optionsOf(1)?.params, 'gain')).toBe(0.75);
  });
});

describe('InlineEvaluator.setParams', () => {
  it('stores Record and Map params and forwards them to CompiledProgram.query', async () => {
    const evaluator = new InlineEvaluator();

    await evaluator.check(sampleCheck);
    await expect(evaluator.setParams({ drive: 1.5, mix: 0.4 })).resolves.toBeUndefined();
    await evaluator.query(sampleSpan, true);

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(optionsOf(0)?.provenance).toBe(true);
    expect(readParam(optionsOf(0)?.params, 'drive')).toBe(1.5);
    expect(readParam(optionsOf(0)?.params, 'mix')).toBe(0.4);

    await expect(evaluator.setParams(new Map([['drive', 3.0]]))).resolves.toBeUndefined();
    await evaluator.query(sampleSpan, false);

    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(readParam(optionsOf(1)?.params, 'drive')).toBe(3.0);
    expect(readParam(optionsOf(1)?.params, 'mix')).toBeUndefined();

    evaluator.dispose();
  });
});

describe('WorkerEvaluator.setParams and restart replay', () => {
  it('sends serialized entries for Record and Map inputs and resolves on ok reply', async () => {
    const workers: MockWorker[] = [];
    const evaluator = new WorkerEvaluator(() => {
      const w = new MockWorker();
      workers.push(w);
      return w as unknown as Worker;
    });

    const p1 = evaluator.setParams({ cutoff: 0.6, mode: 'hp' });
    const msg1 = at(at(workers, 0).posted, 0) as { id: number; type: string; params: unknown };
    expect(msg1).toEqual({
      id: msg1.id,
      type: 'setParams',
      params: [
        ['cutoff', 0.6],
        ['mode', 'hp'],
      ],
    });
    at(workers, 0).emitMessage({ id: msg1.id, type: 'ok' });
    await expect(p1).resolves.toBeUndefined();

    const p2 = evaluator.setParams(new Map<string, unknown>([['tempo', 128]]));
    const msg2 = at(at(workers, 0).posted, 1) as { id: number; type: string; params: unknown };
    expect(msg2).toEqual({
      id: msg2.id,
      type: 'setParams',
      params: [['tempo', 128]],
    });
    at(workers, 0).emitMessage({ id: msg2.id, type: 'ok' });
    await expect(p2).resolves.toBeUndefined();

    evaluator.dispose();
  });

  it('rejects when worker replies with an error or unexpected response type', async () => {
    const workers: MockWorker[] = [];
    const evaluator = new WorkerEvaluator(() => {
      const w = new MockWorker();
      workers.push(w);
      return w as unknown as Worker;
    });

    const pErr = evaluator.setParams({ a: 1 });
    const mErr = at(at(workers, 0).posted, 0) as { id: number };
    at(workers, 0).emitMessage({ id: mErr.id, type: 'error', message: 'invalid param' });
    await expect(pErr).rejects.toThrow('invalid param');

    const pBad = evaluator.setParams({ a: 2 });
    const mBad = at(at(workers, 0).posted, 1) as { id: number };
    at(workers, 0).emitMessage({ id: mBad.id, type: 'events', events: [], muted: [] });
    await expect(pBad).rejects.toThrow('Unexpected worker reply.');

    evaluator.dispose();
  });

  it('preserves and replays #last and #lastParams after a query timeout', async () => {
    vi.useFakeTimers();
    const workers: MockWorker[] = [];
    const evaluator = new WorkerEvaluator(
      () => {
        const w = new MockWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      { check: 1000, query: 200 },
    );

    const checkP = evaluator.check(sampleCheck);
    const checkMsg = at(at(workers, 0).posted, 0) as { id: number };
    at(workers, 0).emitMessage({
      id: checkMsg.id,
      type: 'checked',
      program: { body: [] } as never,
      diagnostics: [],
    });
    await checkP;

    const paramsP = evaluator.setParams({ cutoff: 0.4, wet: 0.8 });
    const paramsMsg = at(at(workers, 0).posted, 1) as { id: number };
    at(workers, 0).emitMessage({ id: paramsMsg.id, type: 'ok' });
    await paramsP;

    const stalledQuery = evaluator.query(sampleSpan, false);
    const stalledAssert = expect(stalledQuery).rejects.toThrow('time budget');

    await vi.advanceTimersByTimeAsync(200);
    await stalledAssert;

    expect(at(workers, 0).terminated).toBe(true);
    expect(workers).toHaveLength(2);

    const replayed = at(workers, 1).posted as Array<{
      id: number;
      type: string;
      source?: string;
      params?: unknown;
    }>;
    expect(replayed).toHaveLength(2);
    const replayedCheck = at(replayed, 0);
    const replayedParams = at(replayed, 1);
    expect(replayedCheck).toMatchObject({ type: 'check', ...sampleCheck });
    expect(replayedParams).toMatchObject({
      type: 'setParams',
      params: [
        ['cutoff', 0.4],
        ['wet', 0.8],
      ],
    });

    at(workers, 1).emitMessage({
      id: replayedCheck.id,
      type: 'checked',
      program: { body: [] } as never,
      diagnostics: [],
    });
    at(workers, 1).emitMessage({ id: replayedParams.id, type: 'ok' });

    const recoveredQuery = evaluator.query(sampleSpan, true);
    const q2Msg = at(at(workers, 1).posted, 2) as { id: number; type: string };
    expect(q2Msg.type).toBe('query');
    at(workers, 1).emitMessage({ id: q2Msg.id, type: 'events', events: [], muted: [] });
    await expect(recoveredQuery).resolves.toEqual({ events: [], muted: [] });

    evaluator.dispose();
  });

  it('replays the latest #lastParams even if setParams timed out or worker errored without check', async () => {
    vi.useFakeTimers();
    const workers: MockWorker[] = [];
    const evaluator = new WorkerEvaluator(
      () => {
        const w = new MockWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      { check: 1000, query: 200 },
    );

    const firstSet = evaluator.setParams({ old: 1 });
    const firstMsg = at(at(workers, 0).posted, 0) as { id: number };
    at(workers, 0).emitMessage({ id: firstMsg.id, type: 'ok' });
    await firstSet;

    const timedOutSet = evaluator.setParams(new Map<string, unknown>([['latest', 42]]));
    const timedOutAssert = expect(timedOutSet).rejects.toThrow('time budget');

    await vi.advanceTimersByTimeAsync(200);
    await timedOutAssert;

    expect(at(workers, 0).terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(at(workers, 1).posted).toHaveLength(1);
    expect(at(at(workers, 1).posted, 0)).toMatchObject({
      type: 'setParams',
      params: [['latest', 42]],
    });

    const replayMsg = at(at(workers, 1).posted, 0) as { id: number };
    at(workers, 1).emitMessage({ id: replayMsg.id, type: 'ok' });

    at(workers, 1).emitError();

    expect(at(workers, 1).terminated).toBe(true);
    expect(workers).toHaveLength(3);
    expect(at(workers, 2).posted).toHaveLength(1);
    expect(at(at(workers, 2).posted, 0)).toMatchObject({
      type: 'setParams',
      params: [['latest', 42]],
    });

    evaluator.dispose();
  });

  it('replays check and params onto a restarted WorkerHost and forwards them on subsequent queries', async () => {
    vi.useFakeTimers();
    const workers: HostedWorker[] = [];
    const evaluator = new WorkerEvaluator(
      () => {
        const w = new HostedWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      { check: 1000, query: 200 },
    );

    await evaluator.check(sampleCheck);
    await evaluator.setParams({ cutoff: 0.35, resonance: 0.7 });

    at(workers, 0).hang = true;
    const stalledQuery = evaluator.query(sampleSpan, true);
    const stalledAssert = expect(stalledQuery).rejects.toThrow('time budget');

    await vi.advanceTimersByTimeAsync(200);
    await stalledAssert;

    expect(at(workers, 0).terminated).toBe(true);
    expect(workers).toHaveLength(2);

    querySpy.mockClear();
    await evaluator.query(sampleSpan, false);

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(optionsOf(0)?.provenance).toBe(false);
    expect(readParam(optionsOf(0)?.params, 'cutoff')).toBe(0.35);
    expect(readParam(optionsOf(0)?.params, 'resonance')).toBe(0.7);

    evaluator.dispose();
  });
});
