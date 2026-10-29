// Response curves and dynamics (docs/dsp.md Part 3, TS-86 to TS-89). Expectations are hand-written.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { CURVE_NAMES, defaultRegistry } from '@tartlet/registry';
import { eq, rat } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const vals = (src: string) =>
  runSource(src, { begin: rat(0), end: rat(1) })
    .filter(isOnset)
    .map((e) => ({ ...e.value }));
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('transfer curves and dynamics (TS-86 to TS-88)', () => {
  it('pass through as canonical controls', () => {
    const src =
      's("bd").curve("tube").drive(12).bias(.1).curvemix(.5).comp(-20).compratio(4).compknee(6)' +
      '.compattack(.01).comprelease(.2).gate(-40).gaterelease(.1).envcurve("exp").velcurve(2)';
    expect(ids(`$: ${src}`)).toEqual([]);
    expect(vals(src)).toEqual([
      {
        s: 'bd',
        curve: 'tube',
        drive: 12,
        bias: 0.1,
        curvemix: 0.5,
        comp: -20,
        compratio: 4,
        compknee: 6,
        compattack: 0.01,
        comprelease: 0.2,
        gate: -40,
        gaterelease: 0.1,
        envcurve: 'exp',
        velcurve: 2,
      },
    ]);
  });
  it('every curve is accepted; unknown modes warn softly', () => {
    for (const c of CURVE_NAMES) expect(ids(`$: s("bd").curve("${c}")`)).toEqual([]);
    expect(ids('$: s("bd").curve("fuzz")')).toEqual(['W-ARG-MODE']);
    expect(ids('$: s("bd").envcurve("cubic")')).toEqual(['W-ARG-MODE']);
    expect(check('$: s("bd").curve("fuzz")', opts).program.outputs[0]?.status).toBe('ok');
  });
  it('curve controls warn without a curve', () => {
    expect(ids('$: s("bd").drive(6)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd").curve("none").bias(.2)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd").curve("soft").drive(6).curvemix(.5)')).toEqual([]);
  });
  it('notes compressor settings that clash on one orbit (TS-87)', () => {
    expect(ids('$: s("bd").comp(-20)\n$: s("hh").comp(-10)')).toContain('I-DSP-ORBIT');
    expect(ids('$: s("bd").comp(-20)\n$: s("hh").comp(-10).orbit(1)')).not.toContain('I-DSP-ORBIT');
    expect(ids('$: s("bd").comp(-20)\n$: s("hh").comp(-20)')).toEqual([]);
  });
  it('are L3 extensions', () => {
    const names = ['curve', 'drive', 'bias', 'curvemix', 'comp', 'compratio', 'gate', 'envcurve', 'velcurve'];
    for (const n of names) expect(defaultRegistry.lookup(n)?.entry.level).toBe('L3');
  });
});
