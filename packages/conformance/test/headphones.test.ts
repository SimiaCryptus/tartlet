// Headphone advisories (TS-61) and per-ear controls (TS-62). Expectations are hand-written.
import { describe, expect, it } from 'vitest';
import { check, repairPayload } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { decodeProgram, encodeProgram } from '@tartlet/ir';
import { DRUM_SOUNDS, NOISE_SOUNDS, OSCILLATOR_SOUNDS } from '@tartlet/registry';
import { DRUMS, NOISES, OSCILLATORS } from '@tartlet/resources';
import { eq, rat } from '@tartlet/time';
import { runSource } from '../src/run';

const opts = { documentId: 'd', blobIndex: '0' };
const cyc = (c: number) => ({ begin: rat(c), end: rat(c + 1) });
const isOnset = (e: Event<ControlMap>): boolean => e.whole !== null && eq(e.whole.begin, e.part.begin);
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);
const vals = (src: string, c = 0, seed?: string) =>
  runSource(src, cyc(c), seed)
    .filter(isOnset)
    .map((e) => ({ ...e.value }));

describe('per-ear controls (TS-62)', () => {
  it('pass through as canonical controls', () => {
    const src = 'note("a").s("sine").earsh(10).itd(.5).ild(3).iphase(90).earswap(1)';
    const evs = runSource(src, { begin: rat(0), end: rat(1) }).filter(isOnset);
    expect(evs.map((e) => ({ ...e.value }))).toEqual([
      { note: { kind: 'midi', value: 57 }, s: 'sine', earsh: 10, itd: 0.5, ild: 3, iphase: 90, earswap: 1 },
    ]);
  });
  it('warn outside their ranges and keep the authored value', () => {
    const r = check('$: s("a").itd(50).ild(-20)', opts);
    expect(r.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.id)).toEqual(['W-RANGE', 'W-RANGE']);
    expect(r.program.outputs[0]?.status).toBe('ok');
  });
});

describe('advisories (TS-61)', () => {
  it('note headphone controls and steady pulses', () => {
    const r = check('$: note("a").s("sine").binaural(6)', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['I-EXT-HEADPHONES', 'I-EXT-PULSE']);
    expect(r.diagnostics[0]?.output).toBe('$0');
    expect(r.program.advisories).toEqual([{ output: '$0', headphones: true, pulse: [6, 6] }]);
  });
  it('record rates outside 3–30 Hz without a pulse note', () => {
    const r = check('$: note("a").s("sine").binaural(40)', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['I-EXT-HEADPHONES']);
    expect(r.program.advisories?.[0]?.pulse).toEqual([40, 40]);
  });
  it('read patterned rates and follow bindings', () => {
    expect(ids('$: note("a").s("sine").binaural("<1 8>")')).toEqual(['I-EXT-HEADPHONES', 'I-EXT-PULSE']);
    const r = check('const d = note("a").s("sine").itd(.3)\npad: d', opts);
    expect(r.program.advisories).toEqual([{ output: 'pad', headphones: true }]);
  });
  it('stay quiet for ordinary tracks and out of the repair payload', () => {
    expect(check('$: s("bd*4").pan(.3)', opts).program.advisories).toBeUndefined();
    const r = check('$: note("a").s("sine").binaural(6)', opts);
    expect(repairPayload(r)).toBe('tartlet: no issues to fix (2 cosmetic notes not shown)');
  });
  it('survive the tartlet/1 encoding', () => {
    const p = check('$: note("a").s("sine").binaural("<4 12>")', opts).program;
    expect(decodeProgram(encodeProgram(p)).advisories).toEqual([{ output: '$0', headphones: true, pulse: [4, 12] }]);
  });
});
describe('per-ear filters, correlation, splits and pulses (TS-64 to TS-67)', () => {
  it('pass through as canonical controls', () => {
    const [v] = vals(
      's("pink").lcutoff(800).rcutoff(1200).lhcutoff(100).rhcutoff(200).icorr(.5).dichotic(600).dichoticq(20).isochronic(10).isodepth(.5)',
    );
    expect(v).toMatchObject({
      s: 'pink',
      lcutoff: 800,
      rcutoff: 1200,
      lhcutoff: 100,
      rhcutoff: 200,
      icorr: 0.5,
      dichotic: 600,
      dichoticq: 20,
      isochronic: 10,
      isodepth: 0.5,
    });
    expect(typeof v?.iseed).toBe('number');
    expect(vals('note("a").s("sawtooth").earsplit("harmonics").splitfreq(800).irate(1)')).toEqual([
      { note: { kind: 'midi', value: 57 }, s: 'sawtooth', earsplit: 'harmonics', splitfreq: 800, irate: 1 },
    ]);
    expect(vals('s("pink").dichotic(500)')[0]).not.toHaveProperty('iseed');
  });
  it('the interaural seed is stable, varies, and survives appended methods (TS-64)', () => {
    const seeds = (src: string, seed?: string) =>
      Array.from({ length: 4 }, (_, c) => vals(src, c, seed).map((v) => v.iseed)).flat();
    const src = '$: s("pink*2").icorr(.3)';
    const a = seeds(src);
    expect(a).toHaveLength(8);
    expect(a.every((x) => typeof x === 'number' && x >= 0 && x < 1)).toBe(true);
    expect(new Set(a).size).toBe(8);
    expect(seeds(src)).toEqual(a);
    expect(seeds(src, 'other')).not.toEqual(a);
    expect(seeds(`${src}.gain(.8)`)).toEqual(a);
  });
  it('isochronic and irate count as pulses (TS-67)', () => {
    const r = check('$: note("a").s("sine").isochronic(8)', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['I-EXT-PULSE']);
    expect(r.program.advisories).toEqual([{ output: '$0', headphones: false, pulse: [8, 8] }]);
    expect(ids('$: note("a").s("sine").irate(4)')).toEqual(['I-EXT-HEADPHONES', 'I-EXT-PULSE']);
  });
  it('notes opposite phase that cancels in mono (TS-68)', () => {
    expect(ids('$: note("c2").s("sawtooth").iphase(180)')).toEqual(['I-EXT-HEADPHONES', 'I-EXT-MONO']);
    expect(ids('$: note("c2").s("sawtooth").iphase(90)')).toEqual(['I-EXT-HEADPHONES']);
  });
  it('warns when a control cannot affect the sound (TS-68)', () => {
    expect(ids('$: s("white").iphase(90)')).toEqual(['I-EXT-HEADPHONES', 'W-ARG-UNSUPPORTED']);
    expect(ids('$: s("bd*2").earsplit("harmonics")')).toEqual(['I-EXT-HEADPHONES', 'W-ARG-UNSUPPORTED']);
    expect(ids('$: note("a").s("sine").icorr(.2)')).toEqual(['I-EXT-HEADPHONES', 'W-ARG-UNSUPPORTED']);
    expect(ids('$: s("pink").icorr(.2).dichotic(500)')).toEqual(['I-EXT-HEADPHONES']);
    expect(ids('$: s("bd").earsplit("bands")')).toEqual(['I-EXT-HEADPHONES']);
    const r = check('$: s("white").iphase(90)', opts);
    expect(r.program.outputs[0]?.status).toBe('ok');
  });
  it('rejects unknown earsplit modes softly', () => {
    expect(ids('$: s("a").earsplit("middle")')).toEqual(['W-ARG-MODE', 'I-EXT-HEADPHONES']);
  });
  it('registry sound kinds match the general kit', () => {
    expect(new Set(OSCILLATOR_SOUNDS)).toEqual(new Set(OSCILLATORS));
    expect(new Set(NOISE_SOUNDS)).toEqual(new Set(NOISES));
    expect(new Set(DRUM_SOUNDS)).toEqual(new Set(DRUMS));
  });
});
