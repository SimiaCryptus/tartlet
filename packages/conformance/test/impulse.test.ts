// Impulse-response filters (docs/dsp.md Part 2, TS-81 to TS-85). Expectations are hand-written.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { defaultRegistry } from '@tartlet/registry';
import { eq, rat, toNumber } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const vals = (src: string) =>
  runSource(src, cyc(0))
    .filter(isOnset)
    .sort((a, b) => toNumber(a.whole!.begin) - toNumber(b.whole!.begin))
    .map((e) => ({ ...e.value }));
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('impulse-response controls (TS-81 to TS-84)', () => {
  it('pass through as canonical controls', () => {
    const src =
      's("bd").fir("lowpass").firfreq(2000).firwidth(1).firlen("short").body("guitar").bodysize(1.5).bodymix(.5)' +
      '.cab("combo").space("hall").room(.4).spacepre(40).spacedamp(.6)';
    expect(vals(src)).toEqual([
      {
        s: 'bd',
        fir: 'lowpass',
        firfreq: 2000,
        firwidth: 1,
        firlen: 'short',
        body: 'guitar',
        bodysize: 1.5,
        bodymix: 0.5,
        cab: 'combo',
        space: 'hall',
        room: 0.4,
        spacepre: 40,
        spacedamp: 0.6,
      },
    ]);
  });
  it('unknown modes warn softly', () => {
    expect(ids('$: s("bd").fir("comb")')).toEqual(['W-ARG-MODE']);
    expect(ids('$: s("bd").body("piano")')).toEqual(['W-ARG-MODE']);
    expect(ids('$: s("bd").cab("huge")')).toEqual(['W-ARG-MODE']);
    expect(ids('$: s("bd").fir("lowpass").firlen("tiny")')).toEqual(['W-ARG-MODE', 'I-DSP-LATENCY']);
    expect(check('$: s("bd").cab("huge")', opts).program.outputs[0]?.status).toBe('ok');
  });
  it('dependent controls warn without their owner', () => {
    expect(ids('$: s("bd").fir("lowpass").firwidth(2)')).toEqual(['I-DSP-LATENCY', 'W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd").fir("bandpass").firwidth(2)')).toEqual(['I-DSP-LATENCY']);
    expect(ids('$: s("bd").bodysize(2)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd").body("can").bodysize(2)')).toEqual([]);
    expect(ids('$: s("bd").body("none").bodymix(.5)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd").spacepre(40)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd").space("hall").spacepre(40).spacedamp(.5)')).toEqual([]);
  });
  it('latency is noted for compensated stages (TS-85)', () => {
    expect(ids('$: s("bd").fir("lowpass")')).toEqual(['I-DSP-LATENCY']);
    expect(ids('$: s("bd").fir("none")')).toEqual([]);
    expect(ids('$: s("bd").spectral("freeze").ssend(.5)')).toEqual([]);
    expect(ids('$: s("bd").spectral("freeze")')).toEqual(['I-DSP-LATENCY']);
  });
  it('are L3 extensions', () => {
    for (const n of ['fir', 'firfreq', 'firwidth', 'firlen', 'body', 'bodysize', 'bodymix', 'cab', 'spacepre']) {
      expect(defaultRegistry.lookup(n)?.entry.level).toBe('L3');
    }
  });
});
