// tartlet samples import | verify | list (docs/samples.md Part 3, TS-94).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { noteToMidi } from '@tartlet/registry';
import {
  WavError,
  encodeWav,
  normalize,
  parseManifestText,
  parseWav,
  standardIssues,
  toManifestJson,
  type Manifest,
  type ManifestEntry,
  type ManifestTake,
} from '@tartlet/samples';

export const INDEX_FORMAT = 'tartlet-sample-index';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function slugName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/[-_]+$/, '')
    .slice(0, 64);
}

export interface StemInfo {
  readonly name: string;
  readonly root?: number;
  readonly layer: number;
}

/** Guesses name, root and velocity layer from `name_c3_v2`-style file names. */
export function parseStem(stem: string): StemInfo {
  const parts = stem
    .toLowerCase()
    .split(/[_\s]+/)
    .filter((p) => p.length > 0);
  let layer = 0;
  let root: number | undefined;
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last !== undefined && /^v\d{1,2}$/.test(last)) {
    layer = Number(last.slice(1));
    parts.pop();
  }
  const note = parts[parts.length - 1];
  if (parts.length > 1 && note !== undefined && /^[a-g][#sb]?-?\d$/.test(note)) {
    const m = noteToMidi(note);
    if (m !== null) {
      root = m;
      parts.pop();
    }
  }
  return { name: slugName(parts.join('_')) || 'sample', layer, ...(root !== undefined ? { root } : {}) };
}

interface Imported {
  readonly info: StemInfo;
  readonly file: string;
  readonly sha256: string;
}

function buildEntry(
  name: string,
  list: readonly Imported[],
  forced: number | undefined,
  license: string,
  log: string[],
): ManifestEntry {
  const pitched = forced !== undefined || list.some((x) => x.info.root !== undefined);
  if (!pitched) {
    log.push(`${name}: impulse, ${String(list.length)} take(s)`);
    const takes: ManifestTake[] = list.map((x) => ({
      file: x.file,
      sha256: x.sha256,
      root: 60,
      lo: 0,
      hi: 127,
      vlo: 0,
      vhi: 1,
    }));
    return { name, kind: 'impulse', takes, loop: null, license };
  }
  const rootOf = (x: Imported): number => x.info.root ?? forced ?? 60;
  const roots = [...new Set(list.map(rootOf))].sort((a, b) => a - b);
  const takes: ManifestTake[] = list.map((x) => {
    const r = rootOf(x);
    const i = roots.indexOf(r);
    const prev = roots[i - 1];
    const next = roots[i + 1];
    const layers = [...new Set(list.filter((y) => rootOf(y) === r).map((y) => y.info.layer))].sort((a, b) => a - b);
    const j = layers.indexOf(x.info.layer);
    return {
      file: x.file,
      sha256: x.sha256,
      root: r,
      lo: prev === undefined ? 0 : Math.floor((prev + r) / 2) + 1,
      hi: next === undefined ? 127 : Math.floor((r + next) / 2),
      vlo: j / layers.length,
      vhi: (j + 1) / layers.length,
    };
  });
  log.push(`${name}: note, roots ${roots.join(', ')} (guessed from file names)`);
  return { name, kind: 'note', takes, loop: null, license };
}

function readIndex(dir: string): string[] {
  const p = join(dir, 'index.json');
  if (!existsSync(p)) return [];
  const raw = JSON.parse(readFileSync(p, 'utf8')) as { banks?: unknown };
  return Array.isArray(raw.banks) ? raw.banks.filter((b): b is string => typeof b === 'string') : [];
}

function writeIndex(dir: string, banks: readonly string[]): void {
  const data = { format: INDEX_FORMAT, v: 1, banks: [...new Set(banks)].sort() };
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(data, null, 2)}\n`);
}

/** Bank directories of a collection: from index.json, or every subdirectory with a manifest. */
export function collectionBanks(dir: string): string[] {
  const listed = readIndex(dir);
  if (listed.length > 0) return listed;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    (d) => statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, 'manifest.json')),
  );
}

export interface ImportOptions {
  readonly into: string;
  readonly bank?: string;
  readonly license?: string;
  readonly root?: string;
}

/** Validates, normalises and copies every WAV in `dir` into a bank of the collection. */
export function importSamples(dir: string, opts: ImportOptions): string[] {
  const log: string[] = [];
  const files = readdirSync(dir)
    .filter((f) => /\.wav$/i.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No .wav files in ${dir}.`);
  const bank = slugName(opts.bank ?? basename(resolve(dir))) || 'bank';
  const bankDir = join(opts.into, bank);
  mkdirSync(bankDir, { recursive: true });
  let forced: number | undefined;
  if (opts.root !== undefined) {
    const m = noteToMidi(opts.root);
    if (m === null) throw new Error(`Unknown root note ${opts.root}.`);
    forced = m;
  }
  const groups = new Map<string, Imported[]>();
  for (const f of files) {
    const stem = f.replace(/\.wav$/i, '');
    let wav;
    try {
      wav = parseWav(readFileSync(join(dir, f)));
    } catch (e) {
      if (!(e instanceof WavError)) throw e;
      log.push(`skipped ${f}: ${e.message}`);
      continue;
    }
    if (wav.sampleRate !== 44100 && wav.sampleRate !== 48000) {
      log.push(`I-RES-RATE ${f}: ${String(wav.sampleRate)} Hz; the engine resamples it`);
    }
    const info = parseStem(stem);
    const bytes = encodeWav(normalize(wav), 'pcm24');
    const out = `${stem
      .toLowerCase()
      .replace(/#/g, 's')
      .replace(/[^a-z0-9_.-]+/g, '-')}.wav`;
    writeFileSync(join(bankDir, out), bytes);
    const list = groups.get(info.name) ?? [];
    list.push({ info, file: out, sha256: sha(bytes) });
    groups.set(info.name, list);
  }
  const entries = [...groups].map(([name, list]) => buildEntry(name, list, forced, opts.license ?? 'UNKNOWN', log));
  const manifestPath = join(bankDir, 'manifest.json');
  let kept: readonly ManifestEntry[] = [];
  let gm = false;
  if (existsSync(manifestPath)) {
    const old = parseManifestText(readFileSync(manifestPath, 'utf8'));
    kept = old.entries.filter((e) => !groups.has(e.name));
    gm = old.gm;
  }
  const manifest: Manifest = { v: 1, bank, gm, entries: [...kept, ...entries] };
  writeFileSync(manifestPath, `${JSON.stringify(toManifestJson(manifest), null, 2)}\n`);
  writeIndex(opts.into, [...readIndex(opts.into), bank]);
  if (opts.license === undefined) log.push('no --license given: entries are marked UNKNOWN and verify will fail');
  log.push(`wrote ${String(entries.length)} entr${entries.length === 1 ? 'y' : 'ies'} to ${manifestPath}`);
  return log;
}

/** Re-hashes and re-validates every file; returns the problems (empty when all is well). */
export function verifyCollection(dir: string): string[] {
  const problems: string[] = [];
  const banks = collectionBanks(dir);
  if (banks.length === 0) problems.push(`no banks found in ${dir}`);
  for (const bank of banks) {
    const mpath = join(dir, bank, 'manifest.json');
    if (!existsSync(mpath)) {
      problems.push(`${bank}: manifest.json is missing`);
      continue;
    }
    let m: Manifest;
    try {
      m = parseManifestText(readFileSync(mpath, 'utf8'));
    } catch (e) {
      problems.push(`${bank}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const e of m.entries) {
      if (e.license === 'UNKNOWN') problems.push(`I-RES-LICENSE ${bank}/${e.name}: no licence recorded`);
      for (const t of e.takes) {
        const p = join(dir, bank, t.file);
        if (!existsSync(p)) {
          problems.push(`${bank}/${t.file}: file is missing`);
          continue;
        }
        const bytes = readFileSync(p);
        if (sha(bytes) !== t.sha256) problems.push(`W-RES-HASH ${bank}/${t.file}: hash does not match the manifest`);
        try {
          const issues = standardIssues(parseWav(bytes), e.kind);
          if (issues.length > 0) problems.push(`W-RES-FORMAT ${bank}/${t.file}: ${issues.join('; ')}`);
        } catch (err) {
          problems.push(`W-RES-FORMAT ${bank}/${t.file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  return problems;
}

export interface CollectionRow {
  readonly bank: string;
  readonly name: string;
  readonly kind: string;
  readonly takes: number;
  readonly roots: readonly number[];
  readonly license: string;
}

export function listCollection(dir: string): CollectionRow[] {
  return collectionBanks(dir).flatMap((bank) => {
    const m = parseManifestText(readFileSync(join(dir, bank, 'manifest.json'), 'utf8'));
    return m.entries.map((e) => ({
      bank,
      name: e.name,
      kind: e.kind,
      takes: e.takes.length,
      roots: e.kind === 'note' ? [...new Set(e.takes.map((t) => t.root))] : [],
      license: e.license,
    }));
  });
}
