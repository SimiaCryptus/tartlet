// Vocal extensions (TS-43 to TS-47). Expectations are hand-written from docs/vocals.md.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { VOCAL_SOUNDS } from '@tartlet/registry';
import { VOICES, createCatalog } from '@tartlet/resources';
import { eq, rat, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const vals = (src: string, c = 0, seed?: string) =>
  runSource(src, cyc(c), seed)
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin))
    .map((e) => ({ ...e.value }));
const ids = (src: string, extra = {}) => check(src, { ...opts, ...extra }).diagnostics.map((d) => d.id);

describe('vocal controls (TS-43)', () => {
  it('pass through as canonical controls, with a voice seed', () => {
    const src =
      'note("c4").s("voice").syl("la").voicetype("alto").formant(2).vglide(.1).ring(.5).breath(.2).effort(.7)' +
      '.jitter(.3).shimmer(.2).scoop(-2).vibdel(.4).fry(.1)';
    const [v] = vals(src);
    expect(v).toMatchObject({
      note: { kind: 'midi', value: 60 },
      s: 'voice',
      syl: 'la',
      voicetype: 'alto',
      formant: 2,
      vglide: 0.1,
      ring: 0.5,
      breath: 0.2,
      effort: 0.7,
      jitter: 0.3,
      shimmer: 0.2,
      scoop: -2,
      vibdel: 0.4,
      fry: 0.1,
    });
    expect(typeof v?.vseed).toBe('number');
    expect(ids(`$: ${src}`)).toEqual([]);
  });
  it('choir, talk and overtone controls', () => {
    const [v] = vals('note("c3").s("choir").unison(12).scatter(.04).width(1).overtone(8)');
    expect(v).toMatchObject({ s: 'choir', unison: 12, scatter: 0.04, width: 1, overtone: 8 });
    expect(ids('$: note("c3").s("choir").unison(12).scatter(.04).width(1)')).toEqual([]);
    const [w] = vals('note("c2").s("sawtooth").syl("wa").talk(1)');
    expect(w).toMatchObject({ s: 'sawtooth', syl: 'wa', talk: 1 });
    expect(typeof w?.vseed).toBe('number');
  });
  it('non-vocal events carry no voice seed', () => {
    expect(vals('note("c").s("sawtooth").vowel("a")')[0]).not.toHaveProperty('vseed');
  });
});

describe('voice seed determinism (TS-44)', () => {
  const seeds = (src: string, seed?: string) =>
    Array.from({ length: 4 }, (_, c) => vals(src, c, seed).map((v) => v.vseed)).flat();
  it('is stable, varies across events and seeds, and survives appended methods', () => {
    const src = '$: note("c4 e4 g4").s("choir")';
    const a = seeds(src);
    expect(a).toHaveLength(12);
    expect(a.every((x) => typeof x === 'number' && x >= 0 && x < 1)).toBe(true);
    expect(new Set(a).size).toBe(a.length);
    expect(seeds(src)).toEqual(a);
    expect(seeds(src, 'other')).not.toEqual(a);
    expect(seeds(`${src}.gain(.8)`)).toEqual(a);
  });
});

describe('vocal diagnostics (TS-45)', () => {
  it('accept valid syllables, vowels and voice types', () => {
    expect(ids('$: note("c4 d4 e4 [g4 e4]").s("voice").syl("la la li [lu _]")')).toEqual([]);
    expect(ids('$: note("g4").s("voice").syl("mi_a_u").vowel("oo").voicetype("child")')).toEqual([]);
    expect(ids('$: note("c").vowel("<ae ee uh>")')).toEqual([]);
  });
  it('W-ARG-PHONEME warns, offers a fix and the track plays', () => {
    const r = check('$: note("c").s("voice").syl("la lx")', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['W-ARG-PHONEME']);
    expect(r.diagnostics[0]?.fixes?.[0]?.edits[0]?.text).toBe('la');
    expect(r.diagnostics[0]?.output).toBe('$0');
    expect(r.program.outputs[0]?.status).toBe('ok');
  });
  it('W-ARG-VOWEL for unknown vowels and voice types', () => {
    expect(ids('$: note("c").s("voice").vowel("<ah zz>")')).toEqual(['W-ARG-VOWEL']);
    expect(ids('$: note("c").s("voice").voicetype("baritone")')).toEqual(['W-ARG-VOWEL']);
  });
  it('vocal sounds are kit sounds, and borrowed names fall back to them', () => {
    const catalog = createCatalog();
    expect(new Set(VOICES)).toEqual(new Set(VOCAL_SOUNDS));
    expect(ids('$: s("voice aah ooh hum whisper choir")', { catalog })).toEqual([]);
    expect(ids('$: s("vox:3")', { catalog })).toEqual(['I-RES-FALLBACK']);
  });
});
