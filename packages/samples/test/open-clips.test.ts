// Verifies hosted open-source WAV clips, their credits metadata, and the albums that use them.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, locator } from '@tartlet/check';
import { compile, sanity } from '@tartlet/core';
import { createCatalog } from '@tartlet/resources';
import { calibrateClip, parseWav } from '../src';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clipsDir = `${root}apps/playground/public/clips/open`;
const albumsDir = `${root}apps/playground/albums`;

interface CreditEntry {
  readonly id: string;
  readonly file: string;
  readonly group: string;
  readonly author: string;
  readonly license: string;
  readonly sourceUrl: string;
}

interface AlbumFile {
  readonly id: string;
  readonly name: string;
  readonly sketches: readonly { readonly id: string; readonly name: string; readonly source: string }[];
}

describe('hosted open-source audio clips', () => {
  const wavFiles = readdirSync(clipsDir)
    .filter((f) => f.endsWith('.wav'))
    .sort();
  const credits = JSON.parse(readFileSync(`${clipsDir}/credits.json`, 'utf8')) as {
    readonly clips: readonly CreditEntry[];
  };

  it('has credits and license metadata for every hosted WAV clip', () => {
    expect(wavFiles.length).toBeGreaterThanOrEqual(15);
    expect(existsSync(`${clipsDir}/CREDITS.md`)).toBe(true);
    const creditIds = credits.clips.map((c) => `${c.id}.wav`).sort();
    expect(creditIds).toEqual(wavFiles);
    for (const c of credits.clips) {
      expect(c.author.trim().length).toBeGreaterThan(0);
      expect(c.license.trim().length).toBeGreaterThan(0);
      expect(c.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('parses and calibrates every hosted WAV clip cleanly', () => {
    for (const f of wavFiles) {
      const wav = parseWav(readFileSync(`${clipsDir}/${f}`));
      expect(wav.channels.length).toBeGreaterThanOrEqual(1);
      expect(wav.channels[0]?.length ?? 0).toBeGreaterThan(1000);
      const cal = calibrateClip(wav, { targetSampleRate: 48000 });
      expect(cal.wav.sampleRate).toBe(48000);
      expect(cal.calibration.sourceSampleRate).toBe(wav.sampleRate);
    }
  });

  it('validates canine-chorus, feline-philharmonic and open-sfx-studio albums', () => {
    const catalog = createCatalog();
    const opts = { documentId: 'playground', blobIndex: 'album' };
    for (const file of ['canine-chorus.json', 'feline-philharmonic.json', 'open-sfx-studio.json']) {
      const album = JSON.parse(readFileSync(`${albumsDir}/${file}`, 'utf8')) as AlbumFile;
      expect(album.sketches.length).toBeGreaterThanOrEqual(3);
      for (const s of album.sketches) {
        const r = check(s.source, { ...opts, catalog });
        expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
        expect(r.program.resources.some((res) => res.kind === 'clip')).toBe(true);
        // Every referenced local clip must exist in apps/playground/public/
        for (const res of r.program.resources) {
          if (res.kind === 'clip' && res.spec.startsWith('./clips/open/')) {
            expect(existsSync(`${root}apps/playground/public/${res.spec.slice(2)}`)).toBe(true);
          }
        }
        const report = sanity(compile(r.program, { locate: locator(s.source), ...opts }));
        expect(report.silentOutputs).toEqual([]);
        expect(report.mutedOutputs).toEqual([]);
        expect(report.ok).toBe(true);
      }
    }
  });
});
