// Frequency-domain filters (docs/dsp.md Part 1, TS-77 to TS-80). Expectations are hand-written.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { SPECTRAL_MODES, defaultRegistry } from '@tartlet/registry';
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
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('native spectral shaping (TS-77, TS-78)', () => {
  it('pass through as canonical controls', () => {
    const src =
      's("bd").lowshelf(3).highshelf(-2).lsfreq(150).hsfreq(5000).peak(4).peakfreq(800).peakq(2)' +
      '.bandf(1200).bandq(3).notch(3000).notchq(6).tilt(-2).fshift(50).ringmod(200).ringmix(.5)';
    expect(ids(`$: ${src}`)).toEqual([]);
    expect(vals(src)).toEqual([
      {
        s: 'bd',
        lowshelf: 3,
        highshelf: -2,
        lsfreq: 150,
        hsfreq: 5000,
        peak: 4,
        peakfreq: 800,
        peakq: 2,
        bandf: 1200,
        bandq: 3,
        notch: 3000,
        notchq: 6,
        tilt: -2,
        fshift: 50,
        ringmod: 200,
        ringmix: 0.5,
      },
    ]);
  });
  it('warn outside their ranges and keep the authored value', () => {
    expect(ids('$: s("bd").peak(20)')).toEqual(['W-RANGE']);
    expect(vals('s("bd").peak(20)')[0]?.peak).toBe(20);
  });
  it('are L3 extensions', () => {
    const names = ['lowshelf', 'peak', 'notch', 'tilt', 'fshift', 'ringmod', 'spectral', 'samount', 'ssend'];
    for (const n of names) expect(defaultRegistry.lookup(n)?.entry.level).toBe('L3');
  });
});

describe('spectral processing (TS-79, TS-80)', () => {
  it('controls pass through with a seed', () => {
    const [v] = vals('note("c").s("sine").spectral("whisper").samount(.5).sgate(-40).scomb(110).sshift(3).ssend(.2)');
    expect(v).toMatchObject({ spectral: 'whisper', samount: 0.5, sgate: -40, scomb: 110, sshift: 3, ssend: 0.2 });
    expect(typeof v?.dseed).toBe('number');
    expect(vals('s("cp").spectral("none")')[0]).not.toHaveProperty('dseed');
  });
  it('the spectral seed is stable, varies, and survives appended methods', () => {
    const seeds = (src: string, seed?: string) =>
      Array.from({ length: 4 }, (_, c) => vals(src, c, seed).map((v) => v.dseed)).flat();
    const src = '$: s("cp*4").spectral("whisper")';
    const a = seeds(src);
    expect(a).toHaveLength(16);
    expect(a.every((x) => typeof x === 'number' && x >= 0 && x < 1)).toBe(true);
    expect(new Set(a).size).toBe(16);
    expect(seeds(src)).toEqual(a);
    expect(seeds(src, 'other')).not.toEqual(a);
    expect(seeds(`${src}.gain(.8)`)).toEqual(a);
  });
  it('unknown modes warn softly', () => {
    expect(ids('$: s("bd").spectral("crystal")')).toEqual(['W-ARG-MODE']);
    expect(check('$: s("bd").spectral("crystal")', opts).program.outputs[0]?.status).toBe('ok');
    expect(ids('$: s("bd").spectral("<freeze blur gate robot whisper comb shift none>")')).toEqual(['I-DSP-LATENCY']);
  });
  it('mode-specific controls warn without their mode', () => {
    expect(ids('$: s("pink").scomb(200)')).toEqual(['W-ARG-UNSUPPORTED']);
    expect(ids('$: s("pink").spectral("blur").sshift(3)')).toEqual(['I-DSP-LATENCY', 'W-ARG-UNSUPPORTED']);
    expect(ids('$: s("pink").spectral("comb").scomb(200)')).toEqual(['I-DSP-LATENCY']);
    expect(ids('$: s("pink").spectral("<comb gate>").scomb(200).sgate(-30)')).toEqual(['I-DSP-LATENCY']);
    expect(ids('$: s("pink").spectral(cat("comb", "blur")).sshift(2)')).toEqual([]);
  });
  it('the mode list', () => {
    expect(SPECTRAL_MODES).toEqual(['none', 'freeze', 'blur', 'gate', 'robot', 'whisper', 'comb', 'shift']);
  });
});
