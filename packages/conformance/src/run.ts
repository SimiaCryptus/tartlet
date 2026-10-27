import { check, locator } from '@tartlet/check';
import { compile, type ControlMap, type Event } from '@tartlet/core';
import { fromJson, toJson, type TimeSpan } from '@tartlet/time';

export interface Fixture {
  id: string;
  source: string;
  seed?: string;
  span: [unknown, unknown];
  expected: { whole: [unknown, unknown] | null; part: [unknown, unknown]; value: unknown }[];
}

const spanJson = (s: TimeSpan) => [toJson(s.begin), toJson(s.end)];

/** Canonical, order-independent event encoding for comparison. */
export function canon(evs: readonly { whole: unknown; part: unknown; value: unknown }[]): string[] {
  return evs.map((e) => JSON.stringify([e.whole, e.part, sortKeys(e.value)])).sort();
}

function sortKeys(v: unknown): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  const out: [string, unknown][] = Object.keys(v)
    .sort()
    .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]);
  return Object.fromEntries(out);
}

export function runSource(source: string, span: TimeSpan, seed?: string): Event<ControlMap>[] {
  const res = check(source, {
    documentId: 'conformance',
    blobIndex: '0',
    ...(seed !== undefined ? { seed } : undefined),
  });
  const program = compile(res.program, { locate: locator(source), documentId: 'conformance', blobIndex: '0' });
  return [...program.query(span, { provenance: false }).events];
}

export function runFixture(f: Fixture): { actual: string[]; expected: string[] } {
  const span = { begin: fromJson(f.span[0]), end: fromJson(f.span[1]) };
  const actual = runSource(f.source, span, f.seed).map((e) => ({
    whole: e.whole && spanJson(e.whole),
    part: spanJson(e.part),
    value: e.value,
  }));
  const expected = f.expected.map((e) => ({
    whole: e.whole && spanJson({ begin: fromJson(e.whole[0]), end: fromJson(e.whole[1]) }),
    part: spanJson({ begin: fromJson(e.part[0]), end: fromJson(e.part[1]) }),
    value: e.value,
  }));
  return { actual: canon(actual), expected: canon(expected) };
}
