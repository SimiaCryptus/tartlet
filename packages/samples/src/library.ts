// Host-side loading (docs/samples.md §1.3, TS-91). The core never touches files; hosts hand in
// a byte fetcher confined to their root, and get decoded samples and host diagnostics back.
import type { ResourceDecl } from '@tartlet/ir';
import { DEFAULT_CLIP_SAMPLE_RATE, calibrateClip, type CalibrateOptions, type ClipCalibration } from './calibrate';
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
  /** Present for clips imported via URL and calibrated (resampled + retuned) by the runtime. */
  readonly calibration?: ClipCalibration;
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

/** Optional fallback decoder (e.g. Web Audio `decodeAudioData`) for non-WAV clip formats. */
export type DecodeAudio = (bytes: ArrayBuffer) => Promise<WavData | null>;

export interface LoadOptions {
  readonly library?: SampleLibrary;
  /** Check manifest hashes (default true). */
  readonly verifyHash?: boolean;
  /** Target sample rate for calibrated URL clip imports (default 48000). */
  readonly targetSampleRate?: number;
  /** Optional fetcher for `clip` URL resources; falls back to `fetchBytes`. */
  readonly fetchUrl?: FetchBytes;
  /** Optional fallback decoder for non-WAV clip formats. */
  readonly decodeAudio?: DecodeAudio;
}

export interface ImportClipOptions extends CalibrateOptions {
  /** Optional fallback decoder for non-WAV audio formats. */
  readonly decodeAudio?: DecodeAudio;
  /** Optional library to register the calibrated clip into. */
  readonly library?: SampleLibrary;
}

export interface LoadClipUrlOptions extends ImportClipOptions {
  /** Optional byte fetcher (defaults to `globalThis.fetch`). */
  readonly fetchBytes?: FetchBytes;
}

/** The resources a host should load: single files, banks and URL clips. */
export function sampleResources(rs: readonly ResourceDecl[]): ResourceDecl[] {
  return rs.filter((r) => r.kind === 'wav' || r.kind === 'bank' || r.kind === 'clip');
}

/** Decodes WAV bytes strictly, falling back to `decodeAudio` for other formats when provided. */
export async function decodeClipBytes(bytes: ArrayBuffer, decodeAudio?: DecodeAudio): Promise<WavData> {
  try {
    return parseWav(bytes);
  } catch (e) {
    if (!(e instanceof WavError)) throw e;
    if (decodeAudio) {
      const decoded = await decodeAudio(bytes);
      if (decoded) return decoded;
    }
    throw e;
  }
}

/**
 * Decodes, resamples and retunes raw clip bytes into a calibrated `SampleEntry`.
 * Optionally inserts the entry into `opts.library`.
 */
export async function importClipBytes(
  name: string,
  url: string,
  bytes: ArrayBuffer,
  opts: ImportClipOptions = {},
): Promise<SampleEntry> {
  const raw = await decodeClipBytes(bytes, opts.decodeAudio);
  const { wav, calibration } = calibrateClip(raw, opts);
  const entry: SampleEntry = {
    name,
    kind: calibration.kind,
    license: '',
    takes: [{ file: url, wav, root: calibration.root ?? 60, lo: 0, hi: 127, vlo: 0, vhi: 1 }],
    calibration,
  };
  opts.library?.set(entry);
  return entry;
}

/**
 * Fetches an audio clip from `url` (WAV or any format supported by `decodeAudio`), resamples and
 * retunes it for calibrated musical use, and returns the resulting `SampleEntry`.
 */
export async function loadClipFromUrl(name: string, url: string, opts: LoadClipUrlOptions = {}): Promise<SampleEntry> {
  const fetcher: FetchBytes =
    opts.fetchBytes ??
    (async (u) => {
      const res = await fetch(u);
      return res.ok ? await res.arrayBuffer() : null;
    });
  const bytes = await fetcher(url);
  if (!bytes) throw new Error(`Clip at \`${url}\` could not be loaded.`);
  return importClipBytes(name, url, bytes, opts);
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
    private readonly targetSampleRate: number,
    private readonly fetchUrl: FetchBytes,
    private readonly decodeAudio: DecodeAudio | undefined,
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

  async clip(r: ResourceDecl): Promise<void> {
    const name = r.name;
    if (name === undefined) return;
    const bytes = await safeFetch(this.fetchUrl, r.spec);
    if (!bytes) {
      this.note('W-RES-MISSING', `\`${r.spec}\` could not be loaded, so \`${name}\` is silent.`, r);
      this.library.clearPending(name);
      return;
    }
    try {
      await importClipBytes(name, r.spec, bytes, {
        targetSampleRate: this.targetSampleRate,
        ...(r.root !== undefined ? { targetRoot: r.root } : undefined),
        ...(this.decodeAudio ? { decodeAudio: this.decodeAudio } : undefined),
        library: this.library,
      });
    } catch (e) {
      if (!(e instanceof WavError)) throw e;
      this.note('W-RES-FORMAT', `\`${r.spec}\`: ${e.message} It is not played.`, r);
      this.library.clearPending(name);
    }
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

/** Loads every sample file, bank and URL clip in `resources`. Never throws for bad files. */
export async function loadSamples(
  resources: readonly ResourceDecl[],
  fetchBytes: FetchBytes,
  opts: LoadOptions = {},
): Promise<{ library: SampleLibrary; diagnostics: HostDiagnostic[] }> {
  const loader = new Loader(
    fetchBytes,
    opts.library ?? new SampleLibrary(),
    opts.verifyHash !== false,
    opts.targetSampleRate ?? DEFAULT_CLIP_SAMPLE_RATE,
    opts.fetchUrl ?? fetchBytes,
    opts.decodeAudio,
  );
  const list = sampleResources(resources);
  for (const r of list) {
    if ((r.kind === 'wav' || r.kind === 'clip') && r.name !== undefined) loader.library.markPending(r.name);
  }
  for (const r of list) {
    if (r.kind === 'wav') await loader.wav(r);
    else if (r.kind === 'clip') await loader.clip(r);
    else await loader.bank(r);
  }
  return { library: loader.library, diagnostics: loader.diagnostics };
}
