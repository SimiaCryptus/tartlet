// Tier 0 and Tier 1 synthesis controls (TS-41, TS-42). Expectations are hand-written.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { createCatalog } from '@tartlet/resources';
import { eq, rat, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const vals = (src: string, c = 0) =>
  runSource(src, cyc(c))
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin))
    .map((e) => ({ ...e.value }));
const ids = (src: string, extra = {}) => check(src, { ...opts, ...extra }).diagnostics.map((d) => d.id);

describe('synthesis controls', () => {
  it('Tier 0 controls pass through as canonical controls (TS-41)', () => {
    const src =
      's("bd").speed(2).hpf(400).shape(.3).crush(6).vowel("a").room(.4).size(.8).delay(.3).delaytime(.2).delayfeedback(.6).orbit(2)';
    expect(vals(src)).toEqual([
      {
        s: 'bd',
        speed: 2,
        hcutoff: 400,
        shape: 0.3,
        crush: 6,
        vowel: 'a',
        room: 0.4,
        size: 0.8,
        delay: 0.3,
        delaytime: 0.2,
        delayfeedback: 0.6,
        orbit: 2,
      },
    ]);
  });
  it('Tier 1 controls pass through as canonical controls (TS-42)', () => {
    const src =
      'note("c").s("square").lpenv(2).lpattack(.01).lpdecay(.2).lpsustain(.3).lprelease(.4).penv(12).pdecay(.1)' +
      '.vib(5).vibdepth(.3).trem(4).tremdepth(.5).fm(2).fmh(1.5).pw(.25).unison(3).detune(20).timbre("organ").mono(1).glide(.1)';
    expect(ids(`$: ${src}`)).toEqual([]);
    expect(vals(src)).toEqual([
      {
        note: { kind: 'midi', value: 48 },
        s: 'square',
        lpenv: 2,
        lpattack: 0.01,
        lpdecay: 0.2,
        lpsustain: 0.3,
        lprelease: 0.4,
        penv: 12,
        pdecay: 0.1,
        vib: 5,
        vibdepth: 0.3,
        trem: 4,
        tremdepth: 0.5,
        fm: 2,
        fmh: 1.5,
        pw: 0.25,
        unison: 3,
        detune: 20,
        timbre: 'organ',
        mono: 1,
        glide: 0.1,
      },
    ]);
  });
  it('borrowed names resolve, with a note for compatibility aliases', () => {
    const src = '$: note("c").vibrato(5).tremolo(4).portamento(.1).mono(0).fmi(2)';
    expect(ids(src)).toEqual(['I-REG-ALIAS', 'I-REG-ALIAS', 'I-REG-ALIAS']);
    expect(vals(src.slice(3))).toEqual([
      { note: { kind: 'midi', value: 48 }, vib: 5, trem: 4, glide: 0.1, mono: 0, fm: 2 },
    ]);
  });
  it('out-of-range constants warn and keep the authored value', () => {
    expect(ids('$: note("c").s("square").pw(2)')).toEqual(['W-RANGE']);
    expect(ids('$: note("c").unison(20)')).toEqual(['W-RANGE']);
    expect(vals('note("c").unison(20)')[0]?.unison).toBe(20);
  });
  it('synthesis controls accept patterns', () => {
    expect([0, 1].map((c) => vals('s("square*2").pw("<.1 .9>")', c).map((v) => v.pw))).toEqual([
      [0.1, 0.1],
      [0.9, 0.9],
    ]);
    expect(vals('s("sine*2").timbre("organ glass")').map((v) => v.timbre)).toEqual(['organ', 'glass']);
  });
  it('noise sources are kit sounds', () => {
    expect(ids('$: s("white pink brown")', { catalog: createCatalog() })).toEqual([]);
    expect(ids('$: s("noise")', { catalog: createCatalog() })).toEqual(['I-RES-FALLBACK']);
  });
});
