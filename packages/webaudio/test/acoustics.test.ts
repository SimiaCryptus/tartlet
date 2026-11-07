// Acoustic rendering (docs/acoustic_rendering.md). Expectations are computed by hand from the
// acoustics formulas, never captured from the renderer.
import { describe, expect, it } from 'vitest';
import { CAVITY_NAMES, MATERIAL_NAMES, SPACE_MATERIALS, SPACE_SHAPES } from '@tartlet/registry';
import {
  BANDS,
  BIN_SECONDS,
  CAVITY_MAX_SECONDS,
  MATERIALS,
  acousticDecays,
  acousticKey,
  acousticSeed,
  acousticWorkCap,
  boxModeFrequencies,
  cavityParams,
  eyring,
  geometry,
  helmholtzFrequency,
  imageSources,
  renderAcoustic,
  shapeTail,
  spaceModelParams,
  traceRays,
  type AcousticParams,
} from '../src/acoustics';
import { AcousticRenders } from '../src/renders';

const SR = 16000;
const energy = (x: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] ?? 0) ** 2;
  return s;
};

describe('tables', () => {
  it('cover every registry name, with recorded sources', () => {
    for (const m of [...MATERIAL_NAMES, ...SPACE_MATERIALS]) {
      const t = MATERIALS.get(m);
      expect(t).toBeDefined();
      expect(t!.alpha).toHaveLength(BANDS.length);
      for (const a of t!.alpha) expect(a >= 0 && a <= 1).toBe(true);
      expect(t!.source.length).toBeGreaterThan(0);
    }
    for (const s of [...CAVITY_NAMES.filter((x) => x !== 'none'), ...SPACE_SHAPES]) {
      const g = geometry(s, 1, 0.5, 0);
      expect(g.volume).toBeGreaterThan(0);
      expect(g.surface).toBeGreaterThan(0);
    }
  });
});

describe('analytic parts', () => {
  it('image-source delays are path length over 343 m/s', () => {
    const g = geometry('box', 4, 0.5, 0); // 4 × 2 × 2 m
    const taps = imageSources(g, [1, 1, 1], [3, 1, 1], Array(8).fill(0), 0, null);
    const count = (d: number): number => taps.filter((t) => Math.abs(t.delay - d / 343) < 1e-12).length;
    expect(taps[0]!.delay).toBeCloseTo(2 / 343, 12);
    expect(taps[0]!.gains[0]).toBeCloseTo(0.5, 12);
    expect(count(Math.sqrt(8))).toBe(4);
    expect(count(Math.sqrt(12))).toBe(4);
    expect(count(4)).toBe(2);
  });
  it('box modes follow the formula: a 1 m cube starts at 171.5 Hz', () => {
    expect(boxModeFrequencies(1, 1, 1, 200)).toEqual([171.5, 171.5, 171.5]);
  });
  it('the Helmholtz frequency follows (c / 2π)·√(A / (V·L))', () => {
    expect(helmholtzFrequency(0.01, 0.01, 0.01)).toBeCloseTo(3430 / (2 * Math.PI), 6);
    expect(helmholtzFrequency(0, 0.01, 0.01)).toBe(0);
  });
  it('rays lose no energy without absorption', () => {
    const g = geometry('box', 1, 0.7, 0);
    const tr = traceRays(g, [0.3, 0.3, 0.3], [0.7, 0.4, 0.4], Array(8).fill(0), 0.5, {
      seconds: 10,
      seed: 3,
      excludeSpecular: 0,
      rays: 256,
    });
    for (const r of tr.remaining) expect(r).toBeCloseTo(1, 9);
  });
  it('a diffuse box decays at about the Eyring rate', () => {
    const g = geometry('box', 6, 0.6, 0);
    const tr = traceRays(g, [1.5, 1.8, 1.6], [4.2, 1.2, 2.0], Array(8).fill(0.2), 1, {
      seconds: 1.5,
      seed: 11,
      excludeSpecular: 0,
    });
    const h = tr.hist[3]!;
    const back = new Float64Array(h.length);
    let acc = 0;
    for (let i = h.length - 1; i >= 0; i--) {
      acc += h[i]!;
      back[i] = acc;
    }
    const at = (level: number): number => {
      for (let i = 0; i < back.length; i++) if (10 * Math.log10(back[i]! / back[0]!) <= level) return i * BIN_SECONDS;
      return NaN;
    };
    const t60 = 3 * (at(-25) - at(-5));
    const expected = eyring(g.volume, g.surface, 0.2);
    expect(t60).toBeGreaterThan(expected * 0.65);
    expect(t60).toBeLessThan(expected * 1.35);
  });
  it('more absorptive materials decay faster in every band', () => {
    const felt = acousticDecays(cavityParams({ cavity: 'box', material: 'felt' })!);
    const metal = acousticDecays(cavityParams({ cavity: 'box', material: 'metal' })!);
    felt.forEach((t, b) => {
      expect(t).toBeLessThan(metal[b]!);
    });
    const carpet = acousticDecays(spaceModelParams({ space: 'model', spacemat: 'carpet' })!);
    const concrete = acousticDecays(spaceModelParams({ space: 'model', spacemat: 'concrete' })!);
    carpet.forEach((t, b) => {
      expect(t).toBeLessThan(concrete[b]!);
    });
  });
});

describe('rendered responses', () => {
  const render = (p: AcousticParams, seconds: number) => renderAcoustic(p, SR, seconds, acousticSeed(p));
  it('are unit energy, within the caps, finite and repeatable', () => {
    for (const cavity of ['box', 'cylinder', 'sphere', 'tube']) {
      const p = cavityParams({ cavity, cavsize: 0.45, material: 'spruce', cavhole: 0.3 })!;
      const a = render(p, CAVITY_MAX_SECONDS);
      expect(a.ok).toBe(true);
      expect(a.data.length).toBeLessThanOrEqual(CAVITY_MAX_SECONDS * SR);
      expect(energy(a.data)).toBeCloseTo(1, 4);
      for (const v of a.data) expect(Number.isFinite(v)).toBe(true);
      expect(render(p, CAVITY_MAX_SECONDS).data).toEqual(a.data);
    }
    const s = spaceModelParams({ space: 'model', spacesize: 6, spacemat: 'carpet' })!;
    const r = render(s, 2);
    expect(r.ok).toBe(true);
    expect(r.data.length).toBeLessThanOrEqual(2 * SR);
    expect(energy(r.data)).toBeCloseTo(1, 4);
  });
  it('never exceed the work cap', () => {
    const params: AcousticParams[] = [
      ...['box', 'cylinder', 'sphere', 'tube'].map((cavity) =>
        cavityParams({ cavity, cavsize: 0.8, material: 'metal', cavhole: 0.5 })!,
      ),
      ...SPACE_SHAPES.map((spaceshape) =>
        spaceModelParams({ space: 'model', spaceshape, spacesize: 10, spacemat: 'brick' })!,
      ),
    ];
    for (const p of params) {
      const seconds = p.space ? 1 : CAVITY_MAX_SECONDS;
      const r = render(p, seconds);
      expect(r.work).toBeLessThanOrEqual(acousticWorkCap(Math.round(seconds * SR)));
    }
  });
  it('quantise parameters for the cache', () => {
    expect(acousticKey(cavityParams({ cavity: 'box', cavsize: 0.44 })!)).toBe(
      acousticKey(cavityParams({ cavity: 'box', cavsize: 0.45 })!),
    );
    expect(cavityParams({ cavity: 'cone' })).toBeNull();
    expect(cavityParams({ cavity: 'none' })).toBeNull();
    expect(spaceModelParams({ space: 'hall' })).toBeNull();
  });
  it('tail shaping adds predelay and keeps unit energy', () => {
    const data = Float32Array.from({ length: 1000 }, (_, i) => Math.exp(-i / 200) * Math.sin(i));
    const out = shapeTail(data, 1000, { predelay: 0.05, damping: 0.5 });
    expect(out.length).toBe(1050);
    expect(out.slice(0, 50).every((v) => v === 0)).toBe(true);
    expect(energy(out)).toBeCloseTo(1, 4);
  });
});

describe('render cache and rate limit', () => {
  it('renders once, caches, and falls back to the nearest render', async () => {
    let now = 0;
    const r = new AcousticRenders(8000, { clock: () => now, worker: false });
    const ps = [0.2, 0.4, 0.8, 1.6].map((cavsize) => cavityParams({ cavity: 'box', cavsize })!);
    for (const p of ps) expect(r.lookup('voice', p)).toBeUndefined();
    await r.idle();
    expect(r.lookup('voice', ps[0]!)?.data.length).toBeGreaterThan(0);
    expect(r.lookup('voice', ps[3]!)).toBeUndefined();
    expect(r.nearest('voice', ps[3]!)?.params.size).toBe(ps[2]!.size);
    now = 2000;
    r.lookup('voice', ps[3]!);
    await r.idle();
    expect(r.lookup('voice', ps[3]!)).toBeDefined();
  });
});
