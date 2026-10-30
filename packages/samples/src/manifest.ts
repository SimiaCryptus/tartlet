// Bank manifests (docs/samples.md §3.2). Untrusted input, validated with the same rules as IR
// ingestion: no prototype keys, bounded sizes, every file inside the bank directory.
import { isSoundName, isWavPath } from '@tartlet/ir';
import type { SampleKind } from './normalize';

export const MANIFEST_VERSION = 1;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ENTRIES = 1024;
const MAX_TAKES = 128;
const HEX64 = /^[0-9a-f]{64}$/;

export interface ManifestTake {
  readonly file: string;
  readonly sha256: string;
  readonly root: number;
  readonly lo: number;
  readonly hi: number;
  readonly vlo: number;
  readonly vhi: number;
}

export interface ManifestEntry {
  readonly name: string;
  readonly kind: SampleKind;
  readonly takes: readonly ManifestTake[];
  /** Loop points in sample frames, or null. */
  readonly loop: { readonly start: number; readonly end: number } | null;
  readonly license: string;
  readonly consent?: string;
  /** A General MIDI percussion note that plays this entry. */
  readonly gm?: number;
}

export interface Manifest {
  readonly v: 1;
  readonly bank: string;
  /** Map General MIDI percussion notes onto drum names (docs/samples.md §4.1). */
  readonly gm: boolean;
  readonly entries: readonly ManifestEntry[];
}

export class ManifestError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ManifestError';
  }
}

type Obj = Readonly<Record<string, unknown>>;

function fail(path: string, msg: string): never {
  throw new ManifestError(path, msg);
}

function obj(v: unknown, p: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(p, 'expected an object');
  for (const k of Object.keys(v)) if (FORBIDDEN.has(k)) fail(`${p}.${k}`, 'forbidden key');
  return v as Obj;
}

function arr(v: unknown, p: string, max: number): readonly unknown[] {
  if (!Array.isArray(v)) fail(p, 'expected an array');
  if (v.length > max) fail(p, `more than ${String(max)} items`);
  return v as readonly unknown[];
}

function str(v: unknown, p: string): string {
  if (typeof v !== 'string') fail(p, 'expected a string');
  return v;
}

function int(v: unknown, p: string, lo: number, hi: number, dflt?: number): number {
  if (v === undefined && dflt !== undefined) return dflt;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
    fail(p, `expected an integer in [${String(lo)}, ${String(hi)}]`);
  }
  return v;
}

function unit(v: unknown, p: string, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) fail(p, 'expected a number in [0, 1]');
  return v;
}

function take(v: unknown, p: string): ManifestTake {
  const o = obj(v, p);
  const file = str(o.file, `${p}.file`);
  if (!isWavPath(file)) fail(`${p}.file`, 'not a relative .wav path inside the bank');
  const sha256 = str(o.sha256, `${p}.sha256`);
  if (!HEX64.test(sha256)) fail(`${p}.sha256`, 'expected 64 lowercase hex digits');
  const lo = int(o.lo, `${p}.lo`, 0, 127, 0);
  const hi = int(o.hi, `${p}.hi`, 0, 127, 127);
  if (lo > hi) fail(p, 'lo is above hi');
  const vlo = unit(o.vlo, `${p}.vlo`, 0);
  const vhi = unit(o.vhi, `${p}.vhi`, 1);
  if (vlo > vhi) fail(p, 'vlo is above vhi');
  return { file, sha256, root: int(o.root, `${p}.root`, 0, 127, 60), lo, hi, vlo, vhi };
}

function entry(v: unknown, p: string, names: Set<string>): ManifestEntry {
  const o = obj(v, p);
  const name = str(o.name, `${p}.name`);
  if (!isSoundName(name)) fail(`${p}.name`, 'not a sound name');
  if (names.has(name)) fail(`${p}.name`, `duplicate name ${name}`);
  names.add(name);
  const kind = o.kind === 'impulse' || o.kind === 'note' ? o.kind : fail(`${p}.kind`, 'expected impulse or note');
  const takes = arr(o.takes, `${p}.takes`, MAX_TAKES).map((t, i) => take(t, `${p}.takes[${String(i)}]`));
  if (takes.length === 0) fail(`${p}.takes`, 'expected at least one take');
  let loop: ManifestEntry['loop'] = null;
  if (o.loop !== undefined && o.loop !== null) {
    const l = obj(o.loop, `${p}.loop`);
    const start = int(l.start, `${p}.loop.start`, 0, 2 ** 31);
    const end = int(l.end, `${p}.loop.end`, 1, 2 ** 31);
    if (end <= start) fail(`${p}.loop`, 'end must be after start');
    loop = { start, end };
  }
  const license = str(o.license, `${p}.license`).trim();
  if (!license) fail(`${p}.license`, 'a licence is required (use "UNKNOWN" until it is known)');
  return {
    name,
    kind,
    takes,
    loop,
    license,
    ...(o.consent !== undefined ? { consent: str(o.consent, `${p}.consent`) } : {}),
    ...(o.gm !== undefined ? { gm: int(o.gm, `${p}.gm`, 0, 127) } : {}),
  };
}

export function parseManifest(raw: unknown): Manifest {
  const o = obj(raw, '$');
  if (o.v !== MANIFEST_VERSION) fail('$.v', 'unsupported manifest version');
  const bank = str(o.bank, '$.bank');
  if (!isSoundName(bank)) fail('$.bank', 'not a bank name');
  const gm = o.gm === undefined ? false : typeof o.gm === 'boolean' ? o.gm : fail('$.gm', 'expected a boolean');
  const names = new Set<string>();
  const entries = arr(o.entries, '$.entries', MAX_ENTRIES).map((e, i) => entry(e, `$.entries[${String(i)}]`, names));
  return { v: 1, bank, gm, entries };
}

export function parseManifestText(text: string): Manifest {
  const raw: unknown = JSON.parse(text, (k, v: unknown) => {
    if (FORBIDDEN.has(k)) fail(k, 'forbidden key');
    return v;
  });
  return parseManifest(raw);
}

/** The JSON form written by the importer. */
export function toManifestJson(m: Manifest): unknown {
  return {
    v: m.v,
    bank: m.bank,
    ...(m.gm ? { gm: true } : {}),
    entries: m.entries.map((e) => ({
      name: e.name,
      kind: e.kind,
      takes: e.takes.map((t) => ({
        file: t.file,
        sha256: t.sha256,
        ...(e.kind === 'note' ? { root: t.root, lo: t.lo, hi: t.hi } : {}),
        ...(t.vlo !== 0 || t.vhi !== 1 ? { vlo: t.vlo, vhi: t.vhi } : {}),
      })),
      loop: e.loop,
      license: e.license,
      ...(e.consent !== undefined ? { consent: e.consent } : {}),
      ...(e.gm !== undefined ? { gm: e.gm } : {}),
    })),
  };
}
