// Space and environment (TS-69 to TS-72) and sound textures (TS-73 to TS-76).
// Expectations are hand-written from docs/instruments.md Tiers 5 and 7.
import { describe, expect, it } from 'vitest';
import { check } from '@tartlet/check';
import type { ControlMap, Event } from '@tartlet/core';
import { AMBIENCE_SOUNDS, CREATURE_SOUNDS, FOLEY_SOUNDS, TEXTURE_SOUNDS, defaultRegistry } from '@tartlet/registry';
import { AMBIENCES, CREATURES, FOLEY, createCatalog, resolveSound } from '@tartlet/resources';
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

describe('space and environment controls (TS-69 to TS-72)', () => {
  it('pass through as canonical controls', () => {
    expect(vals('s("bd").space("hall").room(.5).occlude(.4).azimuth(30).distance(8).posglide(.2)')).toEqual([
      { s: 'bd', space: 'hall', room: 0.5, occlude: 0.4, azimuth: 30, distance: 8, posglide: 0.2 },
    ]);
  });
  it('accept every space and warn softly on unknown ones', () => {
    expect(ids('$: s("bd").space("<room hall plate church outdoor>")')).toEqual([]);
    expect(ids('$: s("bd").space("cave")')).toEqual(['W-ARG-MODE']);
    const r = check('$: s("bd").space("cave")', opts);
    expect(r.program.outputs[0]?.status).toBe('ok');
  });
  it('warn outside their ranges and keep the authored value', () => {
    expect(ids('$: s("bd").occlude(2)')).toEqual(['W-RANGE']);
    expect(vals('s("bd").occlude(2)')[0]?.occlude).toBe(2);
  });
  it('are L3 extensions', () => {
    for (const n of ['space', 'occlude', 'posglide', 'intensity', 'density', 'grain', 'gdensity', 'gjitter', 'gpos']) {
      expect(defaultRegistry.lookup(n)?.entry.level).toBe('L3');
    }
  });
});

describe('sound textures (TS-73 to TS-76)', () => {
  it('kit sounds check cleanly', () => {
    const catalog = createCatalog();
    expect(ids(`$: s("${TEXTURE_SOUNDS.join(' ')}")`, { catalog })).toEqual([]);
  });
  it('borrowed names fall back to textures', () => {
    expect(resolveSound('ocean')).toMatchObject({ to: 'surf' });
    expect(resolveSound('chatter')).toMatchObject({ to: 'crowd' });
    expect(resolveSound('birdsong')).toMatchObject({ to: 'bird' });
    expect(resolveSound('campfire')).toMatchObject({ to: 'fire' });
    expect(resolveSound('thunderstorm')).toMatchObject({ to: 'rain' });
    expect(ids('$: s("ocean footsteps")', { catalog: createCatalog() })).toEqual(['I-RES-FALLBACK', 'I-RES-FALLBACK']);
  });
  it('ambience and grain controls pass through', () => {
    expect(vals('s("rain").intensity(.7).density(20)')[0]).toMatchObject({ s: 'rain', intensity: 0.7, density: 20 });
    expect(vals('note("c").s("sine").grain(30).gdensity(40).gjitter(.3).gpos(.5)')[0]).toMatchObject({
      grain: 30,
      gdensity: 40,
      gjitter: 0.3,
      gpos: 0.5,
    });
  });
  it('textures and grains carry a seed; drums and plain synths do not', () => {
    expect(typeof vals('s("rain")')[0]?.tseed).toBe('number');
    expect(typeof vals('s("drip")')[0]?.tseed).toBe('number');
    expect(typeof vals('s("bird")')[0]?.tseed).toBe('number');
    expect(typeof vals('note("c").s("sine").grain(30)')[0]?.tseed).toBe('number');
    expect(vals('s("bd")')[0]).not.toHaveProperty('tseed');
    expect(vals('note("c").s("sine")')[0]).not.toHaveProperty('tseed');
  });
  it('the texture seed is stable, varies, and survives appended methods', () => {
    const seeds = (src: string, seed?: string) =>
      Array.from({ length: 4 }, (_, c) => vals(src, c, seed).map((v) => v.tseed)).flat();
    const src = '$: s("drip*4")';
    const a = seeds(src);
    expect(a).toHaveLength(16);
    expect(a.every((x) => typeof x === 'number' && x >= 0 && x < 1)).toBe(true);
    expect(new Set(a).size).toBe(16);
    expect(seeds(src)).toEqual(a);
    expect(seeds(src, 'other')).not.toEqual(a);
    expect(seeds(`${src}.gain(.8)`)).toEqual(a);
  });
  it('registry texture kinds match the general kit', () => {
    expect(new Set(AMBIENCE_SOUNDS)).toEqual(new Set(AMBIENCES));
    expect(new Set(FOLEY_SOUNDS)).toEqual(new Set(FOLEY));
    expect(new Set(CREATURE_SOUNDS)).toEqual(new Set(CREATURES));
  });
});
