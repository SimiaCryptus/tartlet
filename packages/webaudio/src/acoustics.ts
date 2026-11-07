// Acoustic rendering of impulse responses (docs/acoustic_rendering.md). Pure functions from
// quantised parameters to a sample array. They build no Web Audio objects, so they run and are
// tested in Node, and the render worker runs them unchanged. Every loop bound is a constant, and
// randomness is a counter-based draw seeded from a hash of the parameters, never Math.random.
import { CAVITY_NAMES, MATERIAL_NAMES, SPACE_MATERIALS, SPACE_SHAPES } from '@tartlet/registry';

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const finite = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const SPEED_OF_SOUND = 343;
const C = SPEED_OF_SOUND;
const TAU = 2 * Math.PI;
const SQRT3 = Math.sqrt(3);
/** Octave band centres in hertz. */
export const BANDS: readonly number[] = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const NB = BANDS.length;
export const MAX_RAYS = 4096;
export const MAX_ORDER = 64;
export const IMAGE_ORDER = 3;
export const MAX_MODES = 64;
/** Mode indices searched per axis. */
export const MODE_SEARCH = 16;
export const BIN_SECONDS = 0.001;
export const CAVITY_MAX_SECONDS = 0.1;
export const SPACE_MAX_SECONDS = 10;
/** Mode decays are floored by this absorption in every band, so no mode rings forever. */
const MIN_ALPHA = 0.01;
/** No single mode carries more than this share of a response's energy. */
const MODE_SHARE = 0.25;
/** Wall thickness of a cavity opening, for the Helmholtz neck length. */
const WALL = 0.003;
const HELMHOLTZ_Q = 20;
const RADIAL_STEPS = 64;

export interface Material {
  /** Absorption coefficient per octave band, 63 Hz to 8 kHz. */
  readonly alpha: readonly number[];
  /** Share of reflected energy scattered diffusely, 0–1. */
  readonly scatter: number;
  /** Where the typical values come from. */
  readonly source: string;
}
const VORLANDER = 'Vorlaender, Auralization (Springer 2008), Appendix A: typical values';
const COX = "Cox and D'Antonio, Acoustic Absorbers and Diffusers (2nd ed.): typical values";
const FLETCHER =
  'Fletcher and Rossing, The Physics of Musical Instruments (2nd ed.): wall losses estimated from body mode Q';
const WOOD: Material = { alpha: [0.15, 0.11, 0.1, 0.07, 0.06, 0.07, 0.07, 0.08], scatter: 0.1, source: VORLANDER };
const PLASTER: Material = {
  alpha: [0.01, 0.013, 0.015, 0.02, 0.03, 0.04, 0.05, 0.05],
  scatter: 0.1,
  source: VORLANDER,
};
/** Absorption and scattering by material name. */
export const MATERIALS: ReadonlyMap<string, Material> = new Map<string, Material>([
  ['spruce', { alpha: [0.06, 0.05, 0.04, 0.04, 0.05, 0.06, 0.08, 0.1], scatter: 0.1, source: FLETCHER }],
  ['maple', { alpha: [0.05, 0.04, 0.03, 0.03, 0.04, 0.05, 0.07, 0.09], scatter: 0.1, source: FLETCHER }],
  ['wood', WOOD],
  ['metal', { alpha: [0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.02, 0.02], scatter: 0.05, source: VORLANDER }],
  ['glass', { alpha: [0.18, 0.18, 0.06, 0.04, 0.03, 0.02, 0.02, 0.02], scatter: 0.05, source: VORLANDER }],
  ['plastic', { alpha: [0.03, 0.03, 0.03, 0.03, 0.04, 0.05, 0.05, 0.06], scatter: 0.05, source: VORLANDER }],
  ['skin', { alpha: [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4], scatter: 0.15, source: FLETCHER }],
  ['felt', { alpha: [0.08, 0.12, 0.25, 0.5, 0.7, 0.8, 0.85, 0.85], scatter: 0.3, source: COX }],
  ['concrete', { alpha: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.03, 0.04], scatter: 0.1, source: VORLANDER }],
  ['stone', { alpha: [0.02, 0.02, 0.03, 0.04, 0.05, 0.05, 0.05, 0.06], scatter: 0.3, source: VORLANDER }],
  ['brick', { alpha: [0.03, 0.03, 0.03, 0.04, 0.05, 0.07, 0.07, 0.08], scatter: 0.2, source: VORLANDER }],
  ['plaster', PLASTER],
  ['carpet', { alpha: [0.02, 0.02, 0.06, 0.14, 0.37, 0.6, 0.65, 0.65], scatter: 0.3, source: COX }],
  ['curtain', { alpha: [0.05, 0.07, 0.31, 0.49, 0.75, 0.7, 0.6, 0.6], scatter: 0.4, source: COX }],
  [
    'snow',
    {
      alpha: [0.45, 0.45, 0.75, 0.9, 0.95, 0.95, 0.95, 0.95],
      scatter: 0.5,
      source: 'Published measurements of fresh snow cover: typical values',
    },
  ],
]);
/** Air absorption per band, energy per metre, at 20 °C and 50 % humidity (ISO 9613-1, rounded). */
export const AIR_ABSORPTION: readonly number[] = [2.3e-5, 9.2e-5, 2.3e-4, 4.4e-4, 8.5e-4, 2.2e-3, 7.6e-3, 2.7e-2];

export type Vec3 = readonly [number, number, number];
export type ShapeKind = 'box' | 'cylinder' | 'tube' | 'sphere' | 'dome';
export interface Geometry {
  readonly kind: ShapeKind;
  readonly lx: number;
  readonly ly: number;
  readonly lz: number;
  /** Radius for cylinders, tubes, spheres and domes. */
  readonly r: number;
  readonly volume: number;
  readonly surface: number;
  /** Area open to the outside: the hole, or both ends of a tube. */
  readonly open: number;
  /** Share of energy leaving through each surface, by surface index. */
  readonly escape: readonly number[];
}

/**
 * A closed analytic shape from a size (largest dimension), a ratio and a hole share. Boxes span
 * [0, lx]×[0, ly]×[0, lz]; cylinders run along x from 0 to lx around y = z = 0; spheres and
 * domes are centred on the origin, domes above z = 0.
 */
export function geometry(shape: string, size: number, ratio: number, hole: number): Geometry {
  const L = clamp(finite(size, 1), 0.01, 200);
  const q = clamp(finite(ratio, 0.5), 0.05, 1);
  const h = clamp(finite(hole, 0), 0, 1);
  switch (shape) {
    case 'cylinder':
    case 'tube': {
      const r = (L * q) / 2;
      const cap = Math.PI * r * r;
      const tube = shape === 'tube';
      return {
        kind: shape,
        lx: L,
        ly: 2 * r,
        lz: 2 * r,
        r,
        volume: cap * L,
        surface: TAU * r * L + 2 * cap,
        open: tube ? 2 * cap : h * cap,
        escape: tube ? [0, 1, 1] : [0, 0, h],
      };
    }
    case 'sphere':
    case 'dome': {
      const r = L / 2;
      const sphere = shape === 'sphere';
      return {
        kind: shape,
        lx: L,
        ly: L,
        lz: sphere ? L : r,
        r,
        volume: ((sphere ? 4 : 2) / 3) * Math.PI * r ** 3,
        surface: (sphere ? 4 : 3) * Math.PI * r * r,
        open: h * Math.PI * r * r,
        escape: sphere ? [h / 4] : [h / 2, 0],
      };
    }
    default: {
      const thin = shape === 'corridor' ? 0.3 : 1;
      const ly = L * q * thin;
      const lz = ly;
      return {
        kind: 'box',
        lx: L,
        ly,
        lz,
        r: 0,
        volume: L * ly * lz,
        surface: 2 * (L * ly + L * lz + ly * lz),
        open: h * L * ly,
        escape: [0, 0, 0, 0, 0, h],
      };
    }
  }
}

/** Area-weighted mean absorption, with open area absorbing fully. */
function meanAlpha(g: Geometry, alpha: number): number {
  const open = Math.min(g.open, g.surface);
  return (clamp(alpha, 0, 1) * (g.surface - open) + open) / g.surface;
}

/** Eyring decay time: T60 = 0.161·V / (−S·ln(1 − ᾱ) + 4·m·V). */
export function eyring(volume: number, surface: number, alphaMean: number, airM = 0): number {
  const a = clamp(alphaMean, 0, 0.999999);
  const den = -surface * Math.log(1 - a) + 4 * airM * volume;
  return den > 0 ? (0.161 * volume) / den : Infinity;
}

/** Helmholtz resonance f = (c / 2π)·√(A / (V·L)) for opening area A and neck length L. */
export function helmholtzFrequency(area: number, volume: number, neck: number): number {
  return area > 0 && volume > 0 && neck > 0 ? (C / TAU) * Math.sqrt(area / (volume * neck)) : 0;
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function axisPoint(g: Geometry, f: number, a: number, b: number): Vec3 {
  const u = clamp(f, 0.05, 0.95);
  switch (g.kind) {
    case 'box':
      return [u * g.lx, (0.5 + 0.3 * a) * g.ly, (0.5 + 0.3 * b) * g.lz];
    case 'cylinder':
    case 'tube':
      return [u * g.lx, 0.5 * a * g.r, 0.5 * b * g.r];
    case 'sphere':
      return [(2 * u - 1) * 0.6 * g.r, 0.3 * a * g.r, 0.3 * b * g.r];
    case 'dome':
      return [(2 * u - 1) * 0.6 * g.r, 0.3 * a * g.r, (0.35 + 0.15 * b) * g.r];
  }
}

/** Source and listener positions, always inside the shape. */
export function placements(
  g: Geometry,
  p: Pick<AcousticParams, 'space' | 'src' | 'mic'>,
): { readonly src: Vec3; readonly mic: Vec3 } {
  if (p.space) {
    return {
      mic: axisPoint(g, 0.2, 0.1, -0.4),
      src: axisPoint(g, 0.2 + 0.75 * clamp(p.src, 0, 1), -0.2, -0.4),
    };
  }
  return { src: axisPoint(g, p.src, 0.4, -0.3), mic: axisPoint(g, p.mic, -0.35, 0.25) };
}

function mix32(x: number): number {
  let a = x | 0;
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
  return (a ^ (a >>> 16)) >>> 0;
}
/** A counter-based draw in [0, 1): it depends only on (seed, stream, counter). */
export function counterDraw(seed: number, stream: number, counter: number): number {
  return mix32(seed ^ mix32(Math.imul(stream, 0x9e3779b9) ^ mix32(counter + 0x632be5ab))) / 4294967296;
}
/** A 32-bit FNV-1a hash of a string's UTF-16 code units, finished with mix32. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

interface Hit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  s: number;
}

/** The nearest wall along a ray from inside, with its inward normal and surface index. */
function intersect(g: Geometry, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, h: Hit): void {
  h.t = Infinity;
  const take = (t: number, s: number, nx: number, ny: number, nz: number): void => {
    if (t > 1e-12 && t < h.t) {
      h.t = t;
      h.s = s;
      h.nx = nx;
      h.ny = ny;
      h.nz = nz;
    }
  };
  if (g.kind === 'box') {
    if (dx > 0) take((g.lx - ox) / dx, 1, -1, 0, 0);
    else if (dx < 0) take(-ox / dx, 0, 1, 0, 0);
    if (dy > 0) take((g.ly - oy) / dy, 3, 0, -1, 0);
    else if (dy < 0) take(-oy / dy, 2, 0, 1, 0);
    if (dz > 0) take((g.lz - oz) / dz, 5, 0, 0, -1);
    else if (dz < 0) take(-oz / dz, 4, 0, 0, 1);
    return;
  }
  if (g.kind === 'cylinder' || g.kind === 'tube') {
    const a = dy * dy + dz * dz;
    if (a > 1e-15) {
      const b = oy * dy + oz * dz;
      const c = oy * oy + oz * oz - g.r * g.r;
      const disc = b * b - a * c;
      if (disc >= 0) {
        const t = (-b + Math.sqrt(disc)) / a;
        const py = oy + t * dy;
        const pz = oz + t * dz;
        take(t, 0, 0, -py / g.r, -pz / g.r);
      }
    }
    if (dx > 0) take((g.lx - ox) / dx, 2, -1, 0, 0);
    else if (dx < 0) take(-ox / dx, 1, 1, 0, 0);
    return;
  }
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - g.r * g.r;
  const disc = b * b - c;
  if (disc >= 0) {
    const t = -b + Math.sqrt(disc);
    take(t, 0, -(ox + t * dx) / g.r, -(oy + t * dy) / g.r, -(oz + t * dz) / g.r);
  }
  if (g.kind === 'dome' && dz < 0) take(-oz / dz, 1, 0, 0, 1);
}

/** One early reflection: delay in seconds and a pressure gain per band. */
export interface EarlyTap {
  readonly delay: number;
  readonly gains: readonly number[];
  readonly order: number;
}

/**
 * Exact specular reflections of a box by the image-source method, up to IMAGE_ORDER. Other
 * shapes get the direct sound only; their reflections come from the ray tracer.
 */
export function imageSources(
  g: Geometry,
  src: Vec3,
  mic: Vec3,
  alpha: readonly number[],
  scatter: number,
  air: readonly number[] | null,
): EarlyTap[] {
  const out: EarlyTap[] = [];
  const n = g.kind === 'box' ? IMAGE_ORDER : 0;
  const top = g.escape[5] ?? 0;
  const img = (l: number, s: number, L: number): number => (l % 2 === 0 ? l * L + s : (l + 1) * L - s);
  const keep = 1 - clamp(scatter, 0, 1);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      for (let k = -n; k <= n; k++) {
        const order = Math.abs(i) + Math.abs(j) + Math.abs(k);
        if (order > n) continue;
        const pos: Vec3 = [img(i, src[0], g.lx), img(j, src[1], g.ly), img(k, src[2], g.lz)];
        const d = Math.max(dist(pos, mic), 1e-3);
        const tops = k > 0 ? Math.ceil(k / 2) : Math.floor(-k / 2);
        const gains = BANDS.map((_, b) => {
          const r = ((1 - clamp(alpha[b] ?? 0, 0, 1)) * keep) ** order * (1 - top) ** tops;
          const a = air ? Math.exp((-(air[b] ?? 0) * d) / 2) : 1;
          return (Math.sqrt(r) * a) / d;
        });
        out.push({ delay: d / C, gains, order });
      }
    }
  }
  return out.sort((a, b) => a.delay - b.delay);
}

export interface TraceOptions {
  readonly seconds: number;
  readonly seed: number;
  /** Purely specular paths up to this order are not counted (the image sources cover them). */
  readonly excludeSpecular: number;
  readonly air?: readonly number[] | null;
  readonly rays?: number;
  readonly detector?: number;
}
export interface TraceResult {
  /** Energy per 1 ms bin, per band, in the units of a squared tap gain. */
  readonly hist: Float64Array[];
  /** Energy per band left in rays stopped by the order cap. */
  readonly remaining: number[];
  /** The earliest time a ray reached the order cap, or Infinity. */
  readonly cut: number;
  readonly work: number;
}

/**
 * Traces rays from the source with specular or scattered reflection, and accumulates the energy
 * crossing a detector sphere around the listener into 1 ms bins per band.
 */
export function traceRays(
  g: Geometry,
  src: Vec3,
  mic: Vec3,
  alpha: readonly number[],
  scatter: number,
  o: TraceOptions,
): TraceResult {
  const rays = clamp(Math.floor(o.rays ?? MAX_RAYS), 1, MAX_RAYS);
  const bins = Math.max(1, Math.ceil(o.seconds / BIN_SECONDS));
  const hist = Array.from({ length: NB }, () => new Float64Array(bins));
  const rd = o.detector ?? Math.max(1e-3, 0.2 * Math.cbrt(g.volume));
  const gain = (4 * Math.PI) / ((4 / 3) * Math.PI * rd ** 3);
  const remaining = new Array<number>(NB).fill(0);
  const e = new Float64Array(NB);
  const loss = BANDS.map((_, b) => 1 - clamp(alpha[b] ?? 0, 0, 1));
  const air = o.air ?? null;
  const sc = clamp(scatter, 0, 1);
  const h: Hit = { t: 0, nx: 0, ny: 0, nz: 0, s: 0 };
  const eps = 1e-7 * Math.max(g.lx, g.ly, g.lz);
  const floor = 1e-6 / rays;
  const [mx, my, mz] = mic;
  let cut = Infinity;
  let work = 0;
  for (let i = 0; i < rays; i++) {
    const z0 = 2 * counterDraw(o.seed, i, 0) - 1;
    const phi0 = TAU * counterDraw(o.seed, i, 1);
    const s0 = Math.sqrt(Math.max(0, 1 - z0 * z0));
    let dx = s0 * Math.cos(phi0);
    let dy = s0 * Math.sin(phi0);
    let dz = z0;
    let ox = src[0];
    let oy = src[1];
    let oz = src[2];
    e.fill(1 / rays);
    let travelled = 0;
    let specular = true;
    let order = 0;
    let alive = true;
    let k = 2;
    while (order < MAX_ORDER) {
      work++;
      intersect(g, ox, oy, oz, dx, dy, dz, h);
      if (!Number.isFinite(h.t)) {
        alive = false;
        break;
      }
      const t = h.t;
      if (!(specular && order <= o.excludeSpecular)) {
        const qx = mx - ox;
        const qy = my - oy;
        const qz = mz - oz;
        const b = qx * dx + qy * dy + qz * dz;
        const c2 = qx * qx + qy * qy + qz * qz - b * b;
        if (c2 < rd * rd) {
          const half = Math.sqrt(rd * rd - c2);
          const lo = Math.max(0, b - half);
          const hi = Math.min(t, b + half);
          if (hi > lo) {
            const bin = Math.floor((travelled + (lo + hi) / 2) / C / BIN_SECONDS);
            if (bin < bins) {
              for (let bb = 0; bb < NB; bb++) {
                const hb = hist[bb];
                if (hb) hb[bin] = (hb[bin] ?? 0) + gain * (e[bb] ?? 0) * (hi - lo);
              }
            }
          }
        }
      }
      travelled += t;
      if (air) for (let bb = 0; bb < NB; bb++) e[bb] = (e[bb] ?? 0) * Math.exp(-(air[bb] ?? 0) * t);
      if (travelled / C > o.seconds) {
        alive = false;
        break;
      }
      ox += t * dx;
      oy += t * dy;
      oz += t * dz;
      const esc = g.escape[h.s] ?? 0;
      let peak = 0;
      for (let bb = 0; bb < NB; bb++) {
        const v = (e[bb] ?? 0) * (loss[bb] ?? 1) * (1 - esc);
        e[bb] = v;
        peak = Math.max(peak, v);
      }
      order++;
      if (peak < floor) {
        alive = false;
        break;
      }
      if (counterDraw(o.seed, i, k++) < sc) {
        const z = 2 * counterDraw(o.seed, i, k++) - 1;
        const phi = TAU * counterDraw(o.seed, i, k++);
        const sz = Math.sqrt(Math.max(0, 1 - z * z));
        let ux = h.nx + sz * Math.cos(phi);
        let uy = h.ny + sz * Math.sin(phi);
        let uz = h.nz + z;
        const len = Math.hypot(ux, uy, uz);
        if (len < 1e-9) {
          ux = h.nx;
          uy = h.ny;
          uz = h.nz;
        } else {
          ux /= len;
          uy /= len;
          uz /= len;
        }
        dx = ux;
        dy = uy;
        dz = uz;
        specular = false;
      } else {
        const dn = dx * h.nx + dy * h.ny + dz * h.nz;
        dx -= 2 * dn * h.nx;
        dy -= 2 * dn * h.ny;
        dz -= 2 * dn * h.nz;
      }
      ox += eps * h.nx;
      oy += eps * h.ny;
      oz += eps * h.nz;
    }
    if (alive && order >= MAX_ORDER) {
      for (let bb = 0; bb < NB; bb++) remaining[bb] = (remaining[bb] ?? 0) + (e[bb] ?? 0);
      cut = Math.min(cut, travelled / C);
    }
  }
  return { hist, remaining, cut, work };
}

/** Bessel function of the first kind J_m(x), by its power series. */
export function besselJ(m: number, x: number): number {
  let f = 1;
  for (let i = 2; i <= m; i++) f *= i;
  let term = (x / 2) ** m / f;
  let sum = term;
  const q = -(x * x) / 4;
  for (let k = 1; k < 80; k++) {
    term *= q / (k * (k + m));
    sum += term;
    if (Math.abs(term) < 1e-16 * Math.abs(sum) && k > x) break;
  }
  return sum;
}
/** Spherical Bessel function j_l(x), by its power series. */
export function sphericalBesselJ(l: number, x: number): number {
  let df = 1;
  for (let i = 3; i <= 2 * l + 1; i += 2) df *= i;
  let term = x ** l / df;
  let sum = term;
  const q = -(x * x) / 2;
  for (let k = 1; k < 80; k++) {
    term *= q / (k * (2 * l + 2 * k + 1));
    sum += term;
    if (Math.abs(term) < 1e-16 * Math.abs(sum) && k > x) break;
  }
  return sum;
}
function legendre(l: number, x: number): number {
  let p0 = 1;
  if (l === 0) return p0;
  let p1 = x;
  for (let n = 1; n < l; n++) {
    const p2 = ((2 * n + 1) * x * p1 - n * p0) / (n + 1);
    p0 = p1;
    p1 = p2;
  }
  return p1;
}

/** Zeros of J_m′, by m. The first zero of J_0′ is the plane-wave mode at zero. */
const BESSEL_DERIV_ZEROS: readonly (readonly number[])[] = [
  [0, 3.8317, 7.0156, 10.1735, 13.3237],
  [1.8412, 5.3314, 8.5363, 11.706],
  [3.0542, 6.7061, 9.9695],
  [4.2012, 8.0152, 11.3459],
  [5.3176, 9.2824],
  [6.4156, 10.5199],
  [7.5013],
  [8.5778],
];
/** Zeros of j_l′, by l. */
const SPHERICAL_DERIV_ZEROS: readonly (readonly number[])[] = [
  [4.4934, 7.7253, 10.9041],
  [2.0816, 5.9404, 9.2058],
  [3.3421, 7.2899, 10.6139],
  [4.5141, 8.5838],
  [5.6467, 9.8404],
  [6.7565],
  [7.8511],
  [8.9348],
];

/** Mode frequencies of a rigid box, f = (c/2)·√((l/Lx)² + (m/Ly)² + (n/Lz)²), below `fmax`. */
export function boxModeFrequencies(lx: number, ly: number, lz: number, fmax: number): number[] {
  const out: number[] = [];
  for (let l = 0; l <= MODE_SEARCH; l++)
    for (let m = 0; m <= MODE_SEARCH; m++)
      for (let n = 0; n <= MODE_SEARCH; n++) {
        if (l === 0 && m === 0 && n === 0) continue;
        const f = (C / 2) * Math.sqrt((l / lx) ** 2 + (m / ly) ** 2 + (n / lz) ** 2);
        if (f < fmax) out.push(f);
      }
  return out.sort((a, b) => a - b);
}

interface ModeEntry {
  readonly f: number;
  /** ψ(source)·ψ(listener)/Λ, with Λ the mean of ψ² over the volume. */
  readonly coupling: number;
}

/** Analytic modes below `fmax`, sorted by frequency, and the frequency up to which the list is complete. */
function modes(g: Geometry, s: Vec3, m: Vec3, fmax: number): { list: ModeEntry[]; limit: number; work: number } {
  const list: ModeEntry[] = [];
  let work = 0;
  let limit: number;
  if (g.kind === 'box') {
    limit = ((MODE_SEARCH + 1) * C) / (2 * Math.max(g.lx, g.ly, g.lz));
    for (let l = 0; l <= MODE_SEARCH; l++)
      for (let mm = 0; mm <= MODE_SEARCH; mm++)
        for (let nn = 0; nn <= MODE_SEARCH; nn++) {
          work++;
          if (l === 0 && mm === 0 && nn === 0) continue;
          const f = (C / 2) * Math.sqrt((l / g.lx) ** 2 + (mm / g.ly) ** 2 + (nn / g.lz) ** 2);
          if (f >= fmax) continue;
          const psi = (p: Vec3): number =>
            Math.cos((l * Math.PI * p[0]) / g.lx) *
            Math.cos((mm * Math.PI * p[1]) / g.ly) *
            Math.cos((nn * Math.PI * p[2]) / g.lz);
          const lam = (l === 0 ? 1 : 0.5) * (mm === 0 ? 1 : 0.5) * (nn === 0 ? 1 : 0.5);
          list.push({ f, coupling: (psi(s) * psi(m)) / lam });
        }
  } else if (g.kind === 'cylinder' || g.kind === 'tube') {
    const tube = g.kind === 'tube';
    limit = Math.min((8.5 * C) / (TAU * g.r), ((MODE_SEARCH + 1) * C) / (2 * g.lx));
    const rs = Math.hypot(s[1], s[2]);
    const rm = Math.hypot(m[1], m[2]);
    const dphi = Math.atan2(s[2], s[1]) - Math.atan2(m[2], m[1]);
    BESSEL_DERIV_ZEROS.forEach((zeros, order) => {
      for (const j of zeros) {
        for (let q = 0; q <= MODE_SEARCH; q++) {
          work++;
          if ((tube && q === 0) || (!tube && j === 0 && q === 0)) continue;
          const f = (C / TAU) * Math.sqrt((j / g.r) ** 2 + ((q * Math.PI) / g.lx) ** 2);
          if (f >= fmax) continue;
          const axial = (x: number): number =>
            tube ? Math.sin((q * Math.PI * x) / g.lx) : Math.cos((q * Math.PI * x) / g.lx);
          const radial = j === 0 ? 1 : (1 - (order * order) / (j * j)) * besselJ(order, j) ** 2;
          const lam = radial * (order > 0 ? 0.5 : 1) * (tube || q > 0 ? 0.5 : 1);
          const c =
            besselJ(order, (j * rs) / g.r) *
            besselJ(order, (j * rm) / g.r) *
            Math.cos(order * dphi) *
            axial(s[0]) *
            axial(m[0]);
          if (lam > 1e-12) list.push({ f, coupling: c / lam });
        }
      }
    });
  } else {
    limit = (7.8 * C) / (TAU * g.r);
    const rs = Math.hypot(s[0], s[1], s[2]);
    const rm = Math.hypot(m[0], m[1], m[2]);
    const cg = rs > 0 && rm > 0 ? clamp((s[0] * m[0] + s[1] * m[1] + s[2] * m[2]) / (rs * rm), -1, 1) : 1;
    SPHERICAL_DERIV_ZEROS.forEach((zeros, l) => {
      for (const z of zeros) {
        work += 1 + RADIAL_STEPS;
        const f = (C * z) / (TAU * g.r);
        if (f >= fmax) continue;
        const k = z / g.r;
        let norm = 0;
        for (let i = 0; i < RADIAL_STEPS; i++) {
          const rho = ((i + 0.5) / RADIAL_STEPS) * g.r;
          norm += sphericalBesselJ(l, k * rho) ** 2 * rho * rho;
        }
        norm *= (3 * (g.r / RADIAL_STEPS)) / g.r ** 3;
        const c = (2 * l + 1) * sphericalBesselJ(l, k * rs) * sphericalBesselJ(l, k * rm) * legendre(l, cg);
        if (norm > 1e-12) list.push({ f, coupling: c / norm });
      }
    });
  }
  list.sort((a, b) => a.f - b.f);
  return { list, limit, work };
}

function bandpass(x: Float64Array, fc: number, sr: number): void {
  const w0 = (TAU * fc) / sr;
  const al = Math.sin(w0) / (2 * Math.SQRT2);
  const a0 = 1 + al;
  const b0 = al / a0;
  const b2 = -al / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - al) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    const y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** A cavity or a modelled space, after quantisation. */
export interface AcousticParams {
  readonly space: boolean;
  readonly shape: string;
  readonly size: number;
  readonly ratio: number;
  readonly material: string;
  readonly hole: number;
  readonly src: number;
  readonly mic: number;
}
export interface AcousticRender {
  /** Unit energy; all zeros when `ok` is false. */
  readonly data: Float32Array<ArrayBuffer>;
  readonly ok: boolean;
  /** Work units spent; never above acousticWorkCap of the sample cap. */
  readonly work: number;
  /** Decay time per band in seconds, with absorption floored for safety. */
  readonly decay: readonly number[];
  /** The Schroeder frequency in hertz. */
  readonly schroeder: number;
}

/** The most work a render of at most `samples` samples can take, whatever the parameters. */
export function acousticWorkCap(samples: number): number {
  const s = Math.max(1, Math.round(samples));
  return (
    MAX_RAYS * MAX_ORDER + 2 * (MODE_SEARCH + 1) ** 3 + 9 * (2 * IMAGE_ORDER + 1) ** 3 + s * (4 * NB + MAX_MODES + 16)
  );
}

function materialOf(p: Pick<AcousticParams, 'material' | 'space'>): Material {
  return MATERIALS.get(p.material) ?? (p.space ? PLASTER : WOOD);
}

/** Eyring decay per band from the material table, without the safety floor. */
export function acousticDecays(p: AcousticParams): number[] {
  const g = geometry(p.shape, p.size, p.ratio, p.space ? 0 : p.hole);
  const mat = materialOf(p);
  return BANDS.map((_, b) =>
    eyring(g.volume, g.surface, meanAlpha(g, mat.alpha[b] ?? 0), p.space ? (AIR_ABSORPTION[b] ?? 0) : 0),
  );
}

const bandOf = (f: number): number => clamp(Math.round(Math.log2(Math.max(f, 1) / 63)), 0, NB - 1);

/**
 * Renders an impulse response: exact early reflections, a ray-traced diffuse tail per band and
 * analytic modes below the Schroeder frequency, crossfaded there. The result is unit energy and at
 * most `maxSeconds` long, trimmed where it falls 60 dB below its peak.
 */
export function renderAcoustic(
  p: AcousticParams,
  sampleRate: number,
  maxSeconds: number,
  seed: number,
): AcousticRender {
  const sr = clamp(finite(sampleRate, 48000), 8000, 192000);
  const cap = clamp(finite(maxSeconds, CAVITY_MAX_SECONDS), 0.001, SPACE_MAX_SECONDS);
  const mat = materialOf(p);
  const g = geometry(p.shape, p.size, p.ratio, p.space ? 0 : p.hole);
  const air = p.space ? AIR_ABSORPTION : null;
  const { src, mic } = placements(g, p);
  const airAt = (b: number): number => (air ? (air[b] ?? 0) : 0);
  const decay = BANDS.map((_, b) =>
    eyring(g.volume, g.surface, meanAlpha(g, Math.max(mat.alpha[b] ?? 0, MIN_ALPHA)), airAt(b)),
  );
  const mid = ((decay[3] ?? 1) + (decay[4] ?? 1)) / 2;
  const fs = 2000 * Math.sqrt(mid / g.volume);
  const top = 0.45 * sr;
  const direct = dist(src, mic) / C;
  const seconds = clamp(direct + 1.1 * Math.max(...decay) + 0.02, 0.002, cap);
  const n = Math.max(1, Math.round(seconds * sr));
  let work = 0;

  // Modes below the Schroeder frequency, and the Helmholtz air mode of an opening.
  const found = modes(g, src, mic, Math.min(fs, top));
  work += found.work;
  const list = found.list
    .slice(0, MAX_MODES)
    .map((m) => ({ f: m.f, coupling: m.coupling, delta: 6.9 / (decay[bandOf(m.f)] ?? 1) }));
  const last = list[list.length - 1];
  const fx = Math.min(fs, found.limit, list.length >= MAX_MODES && last ? last.f : Infinity);
  if (g.open > 0 && g.kind !== 'tube') {
    const a = Math.sqrt(g.open / Math.PI);
    const fh = helmholtzFrequency(g.open, g.volume, WALL + 1.7 * a);
    if (fh > 0 && fh < top) list.push({ f: fh, coupling: 1, delta: (Math.PI * fh) / HELMHOLTZ_Q });
  }
  const diffuseShare = (f: number): number => clamp(Math.log2(f / fx) + 0.5, 0, 1);

  // Ray-traced energy per band, extended at the Eyring rate past the order cap.
  const trace = traceRays(g, src, mic, mat.alpha, mat.scatter, {
    seconds,
    seed,
    excludeSpecular: g.kind === 'box' ? IMAGE_ORDER : 0,
    air,
  });
  work += trace.work;
  const bins = trace.hist[0]?.length ?? 1;
  const cutBin = Number.isFinite(trace.cut) ? Math.max(1, Math.floor((0.8 * trace.cut) / BIN_SECONDS)) : bins;
  const env = trace.hist.map((h, b) => {
    const e = new Float64Array(bins);
    for (let k = 0; k < bins; k++) e[k] = ((h[k - 1] ?? 0) + (h[k] ?? 0) + (h[k + 1] ?? 0)) / 3;
    if (cutBin < bins) {
      let sum = 0;
      let cnt = 0;
      for (let k = Math.max(0, cutBin - 10); k < cutBin; k++) {
        sum += e[k] ?? 0;
        cnt++;
      }
      const level = cnt > 0 ? sum / cnt : 0;
      const rate = (13.8 * BIN_SECONDS) / (decay[b] ?? 1);
      for (let k = cutBin; k < bins; k++) e[k] = level * Math.exp(-rate * (k - cutBin));
    }
    return e;
  });
  work += 2 * bins * NB;

  const taps = imageSources(g, src, mic, mat.alpha, mat.scatter, air);
  work += (2 * IMAGE_ORDER + 1) ** 3;

  // Diffuse part: seeded noise shaped by each band's envelope, plus the taps, band-passed.
  const out = new Float64Array(n);
  const sig = new Float64Array(n);
  const binLen = sr * BIN_SECONDS;
  for (let b = 0; b < NB; b++) {
    const fc = BANDS[b] ?? 1000;
    if (fc * Math.SQRT2 > top) continue;
    const w = diffuseShare(fc);
    if (w <= 0) continue;
    const e = env[b];
    for (let i = 0; i < n; i++) {
      const pos = (i + 0.5) / binLen - 0.5;
      const k = Math.max(0, Math.floor(pos));
      const t = clamp(pos - k, 0, 1);
      const here = e?.[k] ?? 0;
      const en = here * (1 - t) + (e?.[k + 1] ?? here) * t;
      sig[i] = Math.sqrt(Math.max(0, en) / binLen) * SQRT3 * (2 * counterDraw(seed ^ 0x5bd1e995, b + 1, i) - 1);
    }
    for (const tap of taps) {
      const idx = Math.round(tap.delay * sr);
      if (idx < n) sig[idx] = (sig[idx] ?? 0) + (tap.gains[b] ?? 0);
    }
    bandpass(sig, fc, sr);
    for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) + w * (sig[i] ?? 0);
    work += 3 * n + taps.length;
  }
  let diffuse = 0;
  for (const v of out) diffuse += v * v;
  work += n;

  // Modal part: decaying sinusoids from the modal Green's function, capped in level.
  const amps = list.map(
    (m) => (4 * Math.PI * C * C * m.coupling * (1 - diffuseShare(m.f))) / (sr * g.volume * TAU * m.f),
  );
  const energies = list.map((m, i) => ((amps[i] ?? 0) ** 2 * sr) / (4 * m.delta));
  const total = diffuse + energies.reduce((s, x) => s + x, 0);
  list.forEach((m, i) => {
    let A = amps[i] ?? 0;
    const en = energies[i] ?? 0;
    if (en > MODE_SHARE * total && en > 0) A *= Math.sqrt((MODE_SHARE * total) / en);
    if (A === 0 || !Number.isFinite(A)) return;
    const r = Math.exp(-m.delta / sr);
    const ph = (TAU * m.f) / sr;
    const zr = r * Math.cos(ph);
    const zi = r * Math.sin(ph);
    let re = 1;
    let im = 0;
    for (let k = 0; k < n; k++) {
      out[k] = (out[k] ?? 0) + A * im;
      const nr = re * zr - im * zi;
      im = re * zi + im * zr;
      re = nr;
    }
    work += n;
  });

  // Finish: remove DC, trim 60 dB below the peak, fade, normalise to unit energy.
  let mean = 0;
  for (const v of out) mean += v;
  mean /= n;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = (out[i] ?? 0) - mean;
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  let end = n;
  if (peak > 0) {
    const floor = peak * 1e-3;
    while (end > 1 && Math.abs(out[end - 1] ?? 0) < floor) end--;
  }
  const fade = Math.min(Math.round(0.005 * sr), Math.floor(end / 4));
  for (let j = 0; j < fade; j++) {
    const i = end - fade + j;
    out[i] = (out[i] ?? 0) * (0.5 + 0.5 * Math.cos((Math.PI * (j + 1)) / fade));
  }
  let energy = 0;
  for (let i = 0; i < end; i++) energy += (out[i] ?? 0) ** 2;
  work += 4 * n;
  const data = new Float32Array(end);
  const result = { work, decay, schroeder: fs };
  if (!(energy > 0) || !Number.isFinite(energy)) return { data, ok: false, ...result };
  const g0 = 1 / Math.sqrt(energy);
  let ok = true;
  for (let i = 0; i < end; i++) {
    const v = (out[i] ?? 0) * g0;
    if (!Number.isFinite(v)) ok = false;
    data[i] = v;
  }
  return { data: ok ? data : new Float32Array(end), ok, ...result, work: work + end };
}

/** Renders without throwing; a failure gives `ok: false`. */
export function safeRender(
  p: AcousticParams,
  sampleRate: number,
  seconds: number,
  seed: number,
): { readonly data: Float32Array<ArrayBuffer>; readonly ok: boolean } {
  try {
    const r = renderAcoustic(p, sampleRate, seconds, seed);
    return { data: r.data, ok: r.ok };
  } catch {
    return { data: new Float32Array(1), ok: false };
  }
}

/** Sizes to quarter-octave steps, ratios, holes and positions to steps of 1/8. */
export function quantiseAcoustic(p: AcousticParams): AcousticParams {
  const [lo, hi] = p.space ? [2, 100] : [0.05, 2];
  const step = (x: number): number => Math.round(clamp(finite(x, 0), 0, 1) * 8) / 8;
  return {
    ...p,
    size: 2 ** (Math.round(Math.log2(clamp(finite(p.size, lo), lo, hi)) * 4) / 4),
    ratio: Math.max(1 / 8, step(p.ratio)),
    hole: step(p.hole),
    src: step(p.src),
    mic: step(p.mic),
  };
}

/** The cache key of quantised parameters. */
export function acousticKey(p: AcousticParams): string {
  return [
    p.space ? 'space' : 'cavity',
    p.shape,
    p.material,
    String(Math.round(Math.log2(p.size) * 4)),
    String(p.ratio),
    String(p.hole),
    String(p.src),
    String(p.mic),
  ].join(':');
}

/** The ray and noise seed: a hash of the quantised parameters and a constant. */
export function acousticSeed(p: AcousticParams): number {
  return (hashString(`tartlet-acoustic\u0000${acousticKey(p)}`) | 1) >>> 0;
}

const CAVITY_SET: ReadonlySet<string> = new Set(CAVITY_NAMES.filter((x) => x !== 'none'));
const MATERIAL_SET: ReadonlySet<string> = new Set(MATERIAL_NAMES);
const SHAPE_SET: ReadonlySet<string> = new Set(SPACE_SHAPES);
const SPACE_MATERIAL_SET: ReadonlySet<string> = new Set(SPACE_MATERIALS);

/** The quantised cavity of an event, or null when it has none (Tier A1). */
export function cavityParams(c: Readonly<Record<string, unknown>>): AcousticParams | null {
  const shape = typeof c.cavity === 'string' && CAVITY_SET.has(c.cavity) ? c.cavity : null;
  if (shape === null) return null;
  const material = typeof c.material === 'string' && MATERIAL_SET.has(c.material) ? c.material : 'wood';
  return quantiseAcoustic({
    space: false,
    shape,
    size: finite(c.cavsize, 0.4),
    ratio: finite(c.cavratio, 0.5),
    material,
    hole: finite(c.cavhole, 0),
    src: finite(c.cavsrc, 0.3),
    mic: finite(c.cavmic, 0.7),
  });
}

/** The quantised modelled space of an event, or null unless `space` is `model` (Tier A2). */
export function spaceModelParams(c: Readonly<Record<string, unknown>>): AcousticParams | null {
  if (c.space !== 'model') return null;
  const shape = typeof c.spaceshape === 'string' && SHAPE_SET.has(c.spaceshape) ? c.spaceshape : 'box';
  const material = typeof c.spacemat === 'string' && SPACE_MATERIAL_SET.has(c.spacemat) ? c.spacemat : 'plaster';
  return quantiseAcoustic({
    space: true,
    shape,
    size: finite(c.spacesize, 15),
    ratio: finite(c.spaceratio, 0.6),
    material,
    hole: 0,
    src: finite(c.spacesrc, 0.3),
    mic: 0,
  });
}

/** The generated body that stands in for a cavity until its render is ready. */
export function cavityFallback(p: AcousticParams): { readonly body: string; readonly size: number } {
  const woody = p.material === 'spruce' || p.material === 'maple' || p.material === 'wood';
  const body = p.shape === 'tube' ? 'tube' : p.material === 'metal' ? 'can' : p.hole > 0 && woody ? 'guitar' : 'box';
  return { body, size: clamp(p.size / 0.45, 0.25, 4) };
}

/** The generated space preset that stands in for a modelled space. */
export function spaceFallback(p: AcousticParams): string {
  if (p.shape === 'dome') return 'church';
  if (p.size < 8) return 'room';
  return p.size < 30 ? 'hall' : 'church';
}

/** Applies predelay, extra darkening and a length share to a rendered space, keeping unit energy. */
export function shapeTail(
  data: ArrayLike<number>,
  sampleRate: number,
  opts: { readonly predelay?: number; readonly damping?: number; readonly length?: number },
): Float32Array<ArrayBuffer> {
  const keep = Math.max(1, Math.round(data.length * clamp(opts.length ?? 1, 0.05, 1)));
  const pre = Math.round(clamp(opts.predelay ?? 0, 0, 0.5) * sampleRate);
  const damping = clamp(opts.damping ?? 0, 0, 1);
  const out = new Float32Array(pre + keep);
  let y = 0;
  for (let i = 0; i < keep; i++) {
    const x = data[i] ?? 0;
    y += (1 - damping * 0.9 * (i / keep)) * (x - y);
    out[pre + i] = damping > 0 ? y : x;
  }
  const fade = Math.min(Math.round(0.005 * sampleRate), Math.floor(keep / 4));
  for (let j = 0; j < fade; j++) {
    const i = out.length - fade + j;
    out[i] = (out[i] ?? 0) * (0.5 + 0.5 * Math.cos((Math.PI * (j + 1)) / fade));
  }
  let e = 0;
  for (const v of out) e += v * v;
  if (e > 0) {
    const g = 1 / Math.sqrt(e);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * g;
  }
  return out;
}

/** Hand-written validator for parameters arriving in the render worker. */
export function isAcousticParams(v: unknown): v is AcousticParams {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.space === 'boolean' &&
    typeof o.shape === 'string' &&
    typeof o.material === 'string' &&
    ['size', 'ratio', 'hole', 'src', 'mic'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]))
  );
}
