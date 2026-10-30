// Host-side loading (docs/samples.md §1.3, TS-91). The core never touches files; hosts hand in
// a byte fetcher confined to their root, and get decoded samples and host diagnostics back.
import type { ResourceDecl } from '@tartlet/ir';
import { sha256Hex } from './hash';
import { GM_DRUMS, type Zone } from './interpret';
import { ManifestError, parseManifestText } from './manifest';
import { normalize, standardIssues, type SampleKind } from './normalize';
import { dirOf, joinPath } from './path';
import { WavError, parseWav, type WavData } from './wav';

export interface DecodedTake extends Zone {
  readonly file: string;
  readonly wav: WavData;
  /** Loop points in frames of `wav`. */
  readonly loop?: { readonly start: number; readonly end: number };
}

export interface SampleEntry {
  readonly name: string;
  readonly kind: SampleKind;
  readonly takes: readonly DecodedTake[];
  readonly license: string;
  readonly gm?: number;
}

/** Decoded samples by sound name, plus the names still loading. */
export class SampleLibrary {
  readonly #entries = new Map<string, SampleEntry>();
  readonly #pending = new Set<string>();
  #gm = false;

  get(name: string): SampleEntry | undefined {
    return this.#entries.get(name);
  }
  set(entry: SampleEntry): void {
    this.#entries.set(entry.name, entry);
    this.#pending.delete(entry.name);
  }
  markPending(name: string): void {
    if (!this.#entries.has(name)) this.#pending.add(name);
  }
  clearPending(name: string): void {
    this.#pending.delete(name);
  }
  isPending(name: string): boolean {
    return this.#pending.has(name);
  }
  get pendingCount(): number {
    return this.#pending.size;
  }
  enableGm(): void {
    this.#gm = true;
  }
  /** The entry a General MIDI percussion note plays, if any. */
  gmName(note: number): string | undefined {
    for (const e of this.#entries.values()) if (e.gm === note) return e.name;
    if (!this.#gm) return undefined;
    const name = GM_DRUMS.get(note);
    return name !== undefined && this.#entries.has(name) ? name : undefined;
  }
  names(): string[] {
    return [...this.#entries.keys()];
  }
  get size(): number {
    return this.#entries.size;
  }
}

/** Problems found while loading. They depend on files, so they never change `check` results. */
export interface HostDiagnostic {
  readonly id: 'W-RES-MISSING' | 'W-RES-FORMAT' | 'W-RES-HASH' | 'I-RES-LICENSE';
  readonly severity: 'warning' | 'info';
  readonly message: string;
  readonly resource: ResourceDecl;
}

/** Returns the bytes at a path relative to the host's root, or null. Must never leave the root. */
export type FetchBytes = (path: string) => Promise<ArrayBuffer | null>;

export interface LoadOptions {
  readonly library?: SampleLibrary;
  /** Check manifest hashes (default true). */
  readonly verifyHash?: boolean;
}

/** The resources a host should load: single files and banks. */
export function sampleResources(rs: readonly ResourceDecl[]): ResourceDecl[] {
  return rs.filter((r) => r.kind === 'wav' || r.kind === 'bank');
}

async function safeFetch(f: FetchBytes, path: string): Promise<ArrayBuffer | null> {
  try {
    return await f(path);
  } catch {
    return null;
  }
}

class Loader {
  readonly diagnostics: HostDiagnostic[] = [];
  constructor(
    private readonly fetchBytes: FetchBytes,
    readonly library: SampleLibrary,
    private readonly verifyHash: boolean,
  ) {}

  private note(id: HostDiagnostic['id'], message: string, resource: ResourceDecl): void {
    this.diagnostics.push({ id, severity: id === 'I-RES-LICENSE' ? 'info' : 'warning', message, resource });
  }

  private decode(bytes: ArrayBuffer, kind: SampleKind, label: string, r: ResourceDecl): WavData | undefined {
    let wav: WavData;
    try {
      wav = parseWav(bytes);
    } catch (e) {
      if (!(e instanceof WavError)) throw e;
      this.note('W-RES-FORMAT', `\`${label}\`: ${e.message} It is not played.`, r);
      return undefined;
    }
    const issues = standardIssues(wav, kind);
    if (issues.length === 0) return wav;
    this.note('W-RES-FORMAT', `\`${label}\` breaks the sample standard (${issues.join('; ')}); it is normalised.`, r);
    return normalize(wav);
  }

  async wav(r: ResourceDecl): Promise<void> {
    const name = r.name;
    if (name === undefined) return;
    const bytes = await safeFetch(this.fetchBytes, r.spec);
    const wav = bytes ? this.decode(bytes, 'impulse', r.spec, r) : undefined;
    if (!bytes) this.note('W-RES-MISSING', `\`${r.spec}\` could not be loaded, so \`${name}\` is silent.`, r);
    if (!wav) {
      this.library.clearPending(name);
      return;
    }
    this.library.set({
      name,
      kind: 'impulse',
      license: '',
      takes: [{ file: r.spec, wav, root: 60, lo: 0, hi: 127, vlo: 0, vhi: 1 }],
    });
  }

  async bank(r: ResourceDecl): Promise<void> {
    const manifestPath = r.spec.endsWith('/') ? `${r.spec}manifest.json` : r.spec;
    const dir = dirOf(manifestPath);
    const bytes = await safeFetch(this.fetchBytes, manifestPath);
    if (!bytes) {
      this.note('W-RES-MISSING', `The bank manifest \`${manifestPath}\` could not be loaded.`, r);
      return;
    }
    let manifest;
    try {
      manifest = parseManifestText(new TextDecoder().decode(bytes));
    } catch (e) {
      if (!(e instanceof ManifestError || e instanceof SyntaxError)) throw e;
      this.note('W-RES-FORMAT', `The bank manifest \`${manifestPath}\` is invalid: ${e.message}`, r);
      return;
    }
    if (manifest.gm) this.library.enableGm();
    for (const entry of manifest.entries) {
      if (entry.license === 'UNKNOWN') {
        this.note('I-RES-LICENSE', `\`${entry.name}\` in bank \`${manifest.bank}\` has no licence recorded.`, r);
      }
      const takes: DecodedTake[] = [];
      for (const t of entry.takes) {
        const path = joinPath(dir, t.file);
        const raw = await safeFetch(this.fetchBytes, path);
        if (!raw) {
          this.note('W-RES-MISSING', `\`${path}\` could not be loaded.`, r);
          continue;
        }
        if (this.verifyHash && (await sha256Hex(raw)) !== t.sha256) {
          this.note('W-RES-HASH', `\`${path}\` does not match its manifest hash, so it is not played.`, r);
          continue;
        }
        const wav = this.decode(raw, entry.kind, path, r);
        if (!wav) continue;
        const frames = wav.channels[0]?.length ?? 0;
        const loop =
          entry.loop && Math.min(entry.loop.end, frames) > entry.loop.start
            ? { start: entry.loop.start, end: Math.min(entry.loop.end, frames) }
            : undefined;
        takes.push({
          file: path,
          wav,
          root: t.root,
          lo: t.lo,
          hi: t.hi,
          vlo: t.vlo,
          vhi: t.vhi,
          ...(loop ? { loop } : {}),
        });
      }
      if (takes.length > 0) {
        this.library.set({
          name: entry.name,
          kind: entry.kind,
          takes,
          license: entry.license,
          ...(entry.gm !== undefined ? { gm: entry.gm } : {}),
        });
      }
    }
  }
}

/** Loads every sample file and bank in `resources` through `fetchBytes`. Never throws for bad files. */
export async function loadSamples(
  resources: readonly ResourceDecl[],
  fetchBytes: FetchBytes,
  opts: LoadOptions = {},
): Promise<{ library: SampleLibrary; diagnostics: HostDiagnostic[] }> {
  const loader = new Loader(fetchBytes, opts.library ?? new SampleLibrary(), opts.verifyHash !== false);
  const list = sampleResources(resources);
  for (const r of list) if (r.kind === 'wav' && r.name !== undefined) loader.library.markPending(r.name);
  for (const r of list) {
    if (r.kind === 'wav') await loader.wav(r);
    else await loader.bank(r);
  }
  return { library: loader.library, diagnostics: loader.diagnostics };
}
