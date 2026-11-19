import { describe, expect, it } from 'vitest';
import {
  IngestError,
  decodeProgram,
  encodeProgram,
  validateProgram,
  type LiveParamDecl,
  type LiveParamNode,
  type Program,
  type SourceRange,
} from '@tartlet/ir';
import { rat } from '@tartlet/time';

const RANGE: SourceRange = {
  start: { line: 0, col: 0, byte: 0 },
  end: { line: 0, col: 10, byte: 10 },
};

function makeProgram(opts?: { params?: readonly LiveParamDecl[]; paramNode?: LiveParamNode }): Program {
  const paramNode: LiveParamNode = opts?.paramNode ?? {
    kind: 'param',
    id: 'n-param-cutoff',
    range: RANGE,
    type: { kind: 'signal', of: 'number' },
    name: 'cutoff',
    defaultValue: 800,
    min: 100,
    max: 4000,
  };

  return {
    irVersion: 'tartlet/1',
    settings: {
      cps: rat(1, 2),
      meta: Object.create(null) as Record<string, string>,
    },
    ...(opts?.params !== undefined ? { params: opts.params } : undefined),
    bindings: [
      {
        id: 'b-cutoff',
        name: 'cutoffPat',
        expr: paramNode,
      },
    ],
    outputs: [
      {
        id: 'o-0',
        label: '$0',
        status: 'ok',
        expr: {
          kind: 'control',
          id: 'n-lpf',
          range: RANGE,
          type: { kind: 'pattern', of: 'controls' },
          control: 'lpf',
          target: {
            kind: 'control',
            id: 'n-s',
            range: RANGE,
            type: { kind: 'pattern', of: 'controls' },
            control: 's',
            target: null,
            value: { kind: 'const', value: { t: 'str', v: 'bd' } },
          },
          value: {
            kind: 'pattern',
            node: {
              kind: 'transform',
              id: 'n-mul',
              range: RANGE,
              type: { kind: 'signal', of: 'number' },
              fn: 'mul',
              target: {
                kind: 'ref',
                id: 'n-ref',
                range: RANGE,
                type: { kind: 'pattern', of: 'controls' },
                name: 'cutoffPat',
                binding: 'b-cutoff',
              },
              args: [{ kind: 'const', value: { t: 'num', v: rat(2) } }],
            },
          },
        },
      },
    ],
    resources: [],
    diagnostics: [],
  };
}

describe('IR codec: realtime params', () => {
  it('round-trips LiveParamDecl and LiveParamNode through encodeProgram, decodeProgram, and validateProgram', () => {
    const decls: LiveParamDecl[] = [
      { name: 'cutoff', defaultValue: 800, min: 100, max: 4000 },
      { name: 'offset', defaultValue: -0.25 },
      { name: 'floorOnly', defaultValue: 10, min: 10 },
      { name: 'ceilOnly', defaultValue: 50, max: 50 },
    ];
    const program = makeProgram({ params: decls });

    const encoded = encodeProgram(program);
    const decoded = decodeProgram(encoded);
    const validated = validateProgram(JSON.parse(encoded));

    expect(decoded).toEqual(program);
    expect(validated).toEqual(program);
    expect(decoded.params).toEqual(decls);
  });

  it('allows programs without params and param nodes without optional min/max', () => {
    const program = makeProgram({
      paramNode: {
        kind: 'param',
        id: 'n-param-free',
        range: RANGE,
        type: { kind: 'signal', of: 'number' },
        name: 'free',
        defaultValue: 0,
      },
    });

    const decoded = decodeProgram(encodeProgram(program));
    expect(decoded).toEqual(program);
    expect(decoded.params).toBeUndefined();
  });

  it('rejects invalid LiveParamDecl shapes, non-finite numbers, and invalid bounds', () => {
    const baseRaw = (): Record<string, unknown> =>
      JSON.parse(
        encodeProgram(makeProgram({ params: [{ name: 'cutoff', defaultValue: 800, min: 100, max: 4000 }] })),
      ) as Record<string, unknown>;

    const notArray = baseRaw();
    notArray.params = { cutoff: 800 };
    expect(() => validateProgram(notArray)).toThrow(IngestError);

    const badName = baseRaw();
    badName.params = [{ name: 42, defaultValue: 800 }];
    expect(() => validateProgram(badName)).toThrow(IngestError);

    for (const badVal of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '800', null]) {
      const badDefault = baseRaw();
      badDefault.params = [{ name: 'cutoff', defaultValue: badVal }];
      expect(() => validateProgram(badDefault)).toThrow(IngestError);

      const badMin = baseRaw();
      badMin.params = [{ name: 'cutoff', defaultValue: 800, min: badVal, max: 4000 }];
      expect(() => validateProgram(badMin)).toThrow(IngestError);

      const badMax = baseRaw();
      badMax.params = [{ name: 'cutoff', defaultValue: 800, min: 100, max: badVal }];
      expect(() => validateProgram(badMax)).toThrow(IngestError);
    }

    const invertedBounds = baseRaw();
    invertedBounds.params = [{ name: 'cutoff', defaultValue: 500, min: 1000, max: 200 }];
    expect(() => validateProgram(invertedBounds)).toThrow(IngestError);

    const belowMin = baseRaw();
    belowMin.params = [{ name: 'cutoff', defaultValue: 50, min: 100, max: 4000 }];
    expect(() => validateProgram(belowMin)).toThrow(IngestError);

    const aboveMax = baseRaw();
    aboveMax.params = [{ name: 'cutoff', defaultValue: 5000, min: 100, max: 4000 }];
    expect(() => validateProgram(aboveMax)).toThrow(IngestError);

    const belowMinOnly = baseRaw();
    belowMinOnly.params = [{ name: 'cutoff', defaultValue: 0, min: 10 }];
    expect(() => validateProgram(belowMinOnly)).toThrow(IngestError);

    const aboveMaxOnly = baseRaw();
    aboveMaxOnly.params = [{ name: 'cutoff', defaultValue: 11, max: 10 }];
    expect(() => validateProgram(aboveMaxOnly)).toThrow(IngestError);
  });

  it('rejects invalid LiveParamNode fields and bounds', () => {
    const withParamNode = (patch: Record<string, unknown>): unknown => {
      const raw = JSON.parse(encodeProgram(makeProgram())) as {
        bindings: { expr: Record<string, unknown> }[];
      };
      Object.assign(raw.bindings[0]!.expr, patch);
      return raw;
    };

    expect(() => validateProgram(withParamNode({ name: 123 }))).toThrow(IngestError);
    expect(() => validateProgram(withParamNode({ defaultValue: Number.NaN }))).toThrow(IngestError);
    expect(() => validateProgram(withParamNode({ defaultValue: Number.POSITIVE_INFINITY }))).toThrow(IngestError);
    expect(() => validateProgram(withParamNode({ min: Number.NEGATIVE_INFINITY }))).toThrow(IngestError);
    expect(() => validateProgram(withParamNode({ max: Number.NaN }))).toThrow(IngestError);
    expect(() => validateProgram(withParamNode({ min: 500, max: 100, defaultValue: 300 }))).toThrow(IngestError);
    expect(() => validateProgram(withParamNode({ min: 100, max: 400, defaultValue: 50 }))).toThrow(IngestError);
    expect(() => validateProgram(withParamNode({ min: 100, max: 400, defaultValue: 500 }))).toThrow(IngestError);

    expect(() => validateProgram(withParamNode({ min: 250, max: 250, defaultValue: 250 }))).not.toThrow();
  });

  it('rejects forbidden prototype keys in decodeProgram and validateProgram', () => {
    const baseJson = encodeProgram(
      makeProgram({ params: [{ name: 'cutoff', defaultValue: 800, min: 100, max: 4000 }] }),
    );

    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const injectedParamDecl = baseJson.replace('"name":"cutoff"', `"${key}":{"polluted":true},"name":"cutoff"`);
      expect(() => decodeProgram(injectedParamDecl)).toThrow(IngestError);

      const injectedParamNode = baseJson.replace('"kind":"param"', `"kind":"param","${key}":1`);
      expect(() => decodeProgram(injectedParamNode)).toThrow(IngestError);
    }

    for (const key of ['constructor', 'prototype']) {
      const rawDecl = JSON.parse(baseJson) as { params: Record<string, unknown>[] };
      Object.defineProperty(rawDecl.params[0], key, { enumerable: true, value: 1 });
      expect(() => validateProgram(rawDecl)).toThrow(IngestError);

      const rawNode = JSON.parse(baseJson) as { bindings: { expr: Record<string, unknown> }[] };
      Object.defineProperty(rawNode.bindings[0]!.expr, key, { enumerable: true, value: 1 });
      expect(() => validateProgram(rawNode)).toThrow(IngestError);
    }

    const rawProto = JSON.parse(baseJson) as { params: Record<string, unknown>[] };
    Object.defineProperty(rawProto.params[0], '__proto__', { enumerable: true, value: { admin: true } });
    expect(() => validateProgram(rawProto)).toThrow(IngestError);
  });
});
