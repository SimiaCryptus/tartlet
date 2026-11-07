// Acoustic rendering controls (docs/acoustic_rendering.md, Tiers A1 and A2). Expectations are
// hand-written from the proposal.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { defaultRegistry } from '@tartlet/registry';
import { eq, rat } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const vals = (src: string) =>
  runSource(src, { begin: rat(0), end: rat(1) })
    .filter(isOnset)
    .map((e) => ({ ...e.value }));
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('cavities (Tier A1)', () => {
  it('pass through as canonical controls', () => {
    const src =
      's("bd").cavity("box").cavsize(.45).cavratio(.5).material("spruce").cavhole(.3).cavsrc(.3).cavmic(.7).cavmix(.8)';
    expect(ids(`$: ${src}`)).toEqual(['I-DSP-RENDER']);
    expect(vals(src)).toEqual([
      {
        s: 'bd',
        cavity: 'box',
        cavsize: 0.45,
        cavratio: 0.5,
        material: 'spruce',
        cavhole: 0.3,
        cavsrc: 0.3,
        cavmic: 0.7,
        cavmix: 0.8,
      },
    ]);
  });
  it('unknown values warn softly', () => {
    expect(ids('$: s("bd").cavity("cone")')).toEqual(['W-ARG-MODE']);
    expect(ids('$: s("bd").cavity("box").material("stone")')).toEqual(['W-ARG-MODE', 'I-DSP-RENDER']);
    expect(check('$: s("bd").cavity("cone")', opts).program.outputs[0]?.status).toBe('ok');
  });
  it('cavity controls warn without a cavity', () => {
    expect(ids('$: s("bd").cavsize(.4)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd").cavity("none").material("felt")')).toEqual(['W-ARG-UNSUPPORTED']);
  });
  it('a cavity replaces body', () => {
    expect(ids('$: s("bd").body("guitar").cavity("box")')).toEqual(['W-ARG-UNSUPPORTED', 'I-DSP-RENDER']);
  });
  it('positions take constants only', () => {
    expect(ids('$: s("bd").cavity("box").cavsrc("<.2 .8>")')).toEqual(['W-ARG-UNSUPPORTED', 'I-DSP-RENDER']);
    expect(vals('s("bd").cavity("box").cavsrc("<.2 .8>")')).toEqual([{ s: 'bd', cavity: 'box' }]);
  });
});

describe('modelled spaces (Tier A2)', () => {
  it('pass through as canonical controls', () => {
    const src = 's("cp").space("model").spaceshape("dome").spacesize(24).spacemat("stone").spacesrc(.4).room(.5)';
    expect(ids(`$: ${src}`)).toEqual(['I-DSP-RENDER']);
    expect(vals(src)).toEqual([
      { s: 'cp', space: 'model', spaceshape: 'dome', spacesize: 24, spacemat: 'stone', spacesrc: 0.4, room: 0.5 },
    ]);
    expect(ids('$: s("bd").space("model").spacepre(40)')).toEqual(['I-DSP-RENDER']);
  });
  it('unknown values and missing models warn softly', () => {
    expect(ids('$: s("cp").space("model").spaceshape("cave")')).toEqual(['W-ARG-MODE', 'I-DSP-RENDER']);
    expect(ids('$: s("bd").space("hall").spacesize(20)')).toEqual(['W-ARG-UNSUPPORTED']);
  });
  it('notes different models on one orbit', () => {
    expect(ids('$: s("bd").space("model").spacesize(10)\n$: s("hh").space("model").spacesize(30)')).toContain(
      'I-DSP-ORBIT',
    );
    expect(ids('$: s("bd").space("model").spacesize(10)\n$: s("hh").space("model").spacesize(10)')).toEqual([
      'I-DSP-RENDER',
      'I-DSP-RENDER',
    ]);
    expect(
      ids('$: s("bd").space("model").spacesize(10)\n$: s("hh").space("model").spacesize(30).orbit(1)'),
    ).not.toContain('I-DSP-ORBIT');
  });
  it('are L3 extensions', () => {
    for (const n of ['cavity', 'cavsize', 'material', 'cavhole', 'cavsrc', 'spaceshape', 'spacesize', 'spacemat']) {
      expect(defaultRegistry.lookup(n)?.entry.level).toBe('L3');
    }
  });
});
