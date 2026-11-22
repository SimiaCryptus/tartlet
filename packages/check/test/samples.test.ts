// Sample directives and the path grammar (docs/samples.md §1, TS-90, TS-91).
import { describe, expect, it } from 'vitest';
import { check, type SoundCatalog } from '../src';

const opts = { documentId: 'd', blobIndex: '0' };
const ids = (src: string, extra = {}) => check(src, { ...opts, ...extra }).diagnostics.map((d) => d.id);
const missing: SoundCatalog = { resolve: () => ({ status: 'missing' }) };

describe('sample directives', () => {
  it('accepts relative paths and records resources', () => {
    const src =
      'sample("kick", "./drums/kick.wav")\nsample("snare", "drums/snare.WAV")\nsamples("./keys/")\nsamples("strings.json")\n$: s("kick snare")';
    const r = check(src, opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['I-RES-DECLARED', 'I-RES-DECLARED']);
    expect(r.program.resources.map((x) => [x.kind, x.name ?? '', x.spec])).toEqual([
      ['wav', 'kick', './drums/kick.wav'],
      ['wav', 'snare', 'drums/snare.WAV'],
      ['bank', '', './keys/'],
      ['bank', '', 'strings.json'],
    ]);
  });
  it('rejects bad paths with E-RES-PATH at the literal', () => {
    for (const bad of [
      '/abs/kick.wav',
      'https://e.com/kick.wav',
      'file:kick.wav',
      'C:\\\\kick.wav',
      '../other/kick.wav',
      'drums//kick.wav',
      'kick.mp3',
      'drüms/kick.wav',
      `${'a'.repeat(260)}.wav`,
    ]) {
      expect(ids(`sample("kick", "${bad}")\n$: s("bd")`)).toContain('E-RES-PATH');
    }
    const d = check('sample("kick", "/abs/kick.wav")\n$: s("bd")', opts).diagnostics[0];
    expect(d).toMatchObject({ id: 'E-RES-PATH', range: { start: { line: 0, col: 15 } } });
    expect(ids('samples("keys.wav")\n$: s("bd")')).toEqual(['E-RES-PATH']);
  });
  it('keeps remote declarations (X-31)', () => {
    const r = check('samples("github:example/bank")\n$: s("bd")', opts);
    expect(r.program.resources[0]?.kind).toBe('samples');
  });
  it('reports duplicates, overrides and bad names', () => {
    expect(ids('sample("kick", "a.wav")\nsample("kick", "b.wav")\n$: s("kick")')).toEqual(['E-NAME-DUP']);
    expect(ids('sample("bd", "a.wav")\n$: s("bd")')).toEqual(['I-RES-OVERRIDE']);
    expect(ids('sample("9x", "a.wav")\n$: s("bd")')).toEqual(['E-ARG-TYPE']);
  });
  it('declared names are known sounds (TS-91)', () => {
    expect(ids('$: s("kick")', { catalog: missing })).toEqual(['W-RES-MISSING']);
    expect(ids('sample("kick", "./kick.wav")\n$: s("kick")', { catalog: missing })).toEqual([]);
    expect(ids('samples("./keys/")\n$: s("rhodes")', { catalog: missing })).toEqual(['I-RES-DECLARED']);
    expect(ids('importClip("bell", "https://example.com/bell.wav")\n$: s("bell")', { catalog: missing })).toEqual([]);
  });
});

describe('importClip directive', () => {
  it('accepts http(s), blob, data:audio and relative URLs with optional root note', () => {
    const src = [
      'importClip("bell", "https://example.com/clips/bell.wav")',
      'importClip("brass", "./clips/brass.wav", "c4")',
      'importClip("vox", "blob:https://example.com/abc-123", 69)',
      'importClip("tiny", "data:audio/wav;base64,UklGRg==")',
      '$: note("c4 e4 g4").s("bell")',
    ].join('\n');
    const r = check(src, opts);
    expect(r.diagnostics).toEqual([]);
    expect(r.program.resources.map((x) => [x.kind, x.name ?? '', x.spec, x.root])).toEqual([
      ['clip', 'bell', 'https://example.com/clips/bell.wav', undefined],
      ['clip', 'brass', './clips/brass.wav', 60],
      ['clip', 'vox', 'blob:https://example.com/abc-123', 69],
      ['clip', 'tiny', 'data:audio/wav;base64,UklGRg==', undefined],
    ]);
  });

  it('rejects unsafe clip URLs with E-RES-PATH', () => {
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://example.com/a.wav',
      '../secret.wav',
      '//evil.example/a.wav',
      'https://example.com/has space.wav',
    ]) {
      expect(ids(`importClip("x", "${bad}")\n$: s("bd")`)).toContain('E-RES-PATH');
    }
  });

  it('reports duplicate names, bad roots and kit overrides', () => {
    expect(
      ids('importClip("bell", "https://a.com/1.wav")\nimportClip("bell", "https://a.com/2.wav")\n$: s("bd")'),
    ).toEqual(['E-NAME-DUP']);
    expect(ids('sample("bell", "./a.wav")\nimportClip("bell", "https://a.com/2.wav")\n$: s("bd")')).toEqual([
      'E-NAME-DUP',
    ]);
    expect(ids('importClip("bd", "https://a.com/bd.wav")\n$: s("bd")')).toEqual(['I-RES-OVERRIDE']);
    expect(ids('importClip("bell", "https://a.com/1.wav", "notanote")\n$: s("bd")')).toEqual(['E-ARG-TYPE']);
    expect(ids('importClip("bell", "https://a.com/1.wav", 999)\n$: s("bd")')).toEqual(['E-ARG-TYPE']);
  });
});
