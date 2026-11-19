/** Canvas touch graphics for the theremin field: orb, light trail, sparks, sound-wave rings. */

export interface FxState {
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
  readonly gain: number;
  readonly midi: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  vr: number;
  life: number;
  max: number;
  hue: number;
  width: number;
}

interface TrailPoint {
  x: number;
  y: number;
  t: number;
  hue: number;
}

interface Label {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  hue: number;
}

const MAX_PARTICLES = 360;
const MAX_RINGS = 40;
const TRAIL_MS = 420;
const TAU = Math.PI * 2;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** Builds an `hsla()` color string; s and l are percentages, a is 0..1. */
const hsla = (h: number, s: number, l: number, a: number): string =>
  `hsla(${String(h)},${String(s)}%,${String(l)}%,${String(a)})`;

/** Unbounded hue (CSS/canvas wrap it), so sliding pitch never jumps across the color wheel. */
export function hueForMidi(midi: number): number {
  return Number.isFinite(midi) ? midi * 30 + 20 : 20;
}

export class FieldFx {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #read: () => FxState;
  readonly #observer: ResizeObserver;
  readonly #motion: number;
  #w = 0;
  #h = 0;
  #particles: Particle[] = [];
  #rings: Ring[] = [];
  #trail: TrailPoint[] = [];
  #labels: Label[] = [];
  #raf: number | null = null;
  #last = 0;
  #ringClock = 0;
  #prevX = Number.NaN;
  #prevY = Number.NaN;
  #orb = 0;

  #tick = (now: number): void => {
    this.#raf = null;
    const dt = Math.min(0.05, Math.max(0, (now - this.#last) / 1000));
    this.#last = now;
    const st = this.#read();
    this.#step(st, dt, now);
    this.#draw(st, now);
    const busy =
      st.active ||
      this.#orb > 0.005 ||
      this.#particles.length > 0 ||
      this.#rings.length > 0 ||
      this.#trail.length > 0 ||
      this.#labels.length > 0;
    if (busy && !document.hidden) this.#raf = window.requestAnimationFrame(this.#tick);
  };

  constructor(canvas: HTMLCanvasElement, read: () => FxState) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#read = read;
    this.#motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;
    this.#observer = new ResizeObserver(() => {
      this.resize();
    });
    this.#observer.observe(canvas);
    this.resize();
  }

  resize(): void {
    const rect = this.#canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.#w = rect.width;
    this.#h = rect.height;
    const pw = Math.max(1, Math.round(rect.width * dpr));
    const ph = Math.max(1, Math.round(rect.height * dpr));
    if (this.#canvas.width !== pw || this.#canvas.height !== ph) {
      this.#canvas.width = pw;
      this.#canvas.height = ph;
    }
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.wake();
  }

  wake(): void {
    if (this.#raf !== null || document.hidden) return;
    this.#last = performance.now();
    this.#raf = window.requestAnimationFrame(this.#tick);
  }

  /** Touch-down shockwave. */
  burst(): void {
    const st = this.#read();
    const { px, py } = this.#pos(st);
    const hue = hueForMidi(st.midi);
    this.#trail = [];
    this.#rings.push({ x: px, y: py, r: 8, vr: 520, life: 0.7, max: 0.7, hue, width: 3 });
    this.#rings.push({ x: px, y: py, r: 4, vr: 300, life: 0.9, max: 0.9, hue: hue + 40, width: 2 });
    this.#spray(px, py, Math.round(28 * this.#motion), hue, 260);
    this.wake();
  }

  /** Floating note label + ping, used when snapping onto a new scale degree. */
  noteChange(text: string): void {
    const st = this.#read();
    const { px, py } = this.#pos(st);
    const hue = hueForMidi(st.midi);
    this.#labels.push({ x: px, y: py - 52, text, life: 0.9, max: 0.9, hue });
    if (this.#labels.length > 6) this.#labels.shift();
    this.#rings.push({ x: px, y: py, r: 14, vr: 220, life: 0.5, max: 0.5, hue, width: 2 });
    this.#spray(px, py, Math.round(10 * this.#motion), hue, 160);
    this.wake();
  }

  dispose(): void {
    if (this.#raf !== null) window.cancelAnimationFrame(this.#raf);
    this.#raf = null;
    this.#observer.disconnect();
  }

  #pos(st: FxState): { px: number; py: number } {
    return { px: st.x * this.#w, py: (1 - st.y) * this.#h };
  }

  #spray(x: number, y: number, n: number, hue: number, speed: number): void {
    for (let i = 0; i < n && this.#particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.65);
      const life = 0.5 + Math.random() * 0.6;
      this.#particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size: 1.2 + Math.random() * 2.4,
        hue: hue + (Math.random() - 0.5) * 40,
      });
    }
  }

  #step(st: FxState, dt: number, now: number): void {
    const { px, py } = this.#pos(st);
    const level = st.active ? clamp01(st.gain * 1.25) : 0;
    const target = st.active ? 0.3 + 0.7 * level : 0;
    this.#orb += (target - this.#orb) * Math.min(1, dt * 9);
    const hue = hueForMidi(st.midi);

    if (st.active) {
      this.#trail.push({ x: px, y: py, t: now, hue });
      if (Number.isFinite(this.#prevX) && dt > 0) {
        const dx = px - this.#prevX;
        const dy = py - this.#prevY;
        const dist = Math.hypot(dx, dy);
        const n = Math.min(8, Math.floor((dist / 14) * this.#motion + Math.random() * (0.4 + level) * this.#motion));
        for (let i = 0; i < n && this.#particles.length < MAX_PARTICLES; i++) {
          const life = 0.4 + Math.random() * 0.7;
          this.#particles.push({
            x: px + (Math.random() - 0.5) * 10,
            y: py + (Math.random() - 0.5) * 10,
            vx: (Math.random() - 0.5) * 80 - (dx / dt) * 0.08,
            vy: (Math.random() - 0.5) * 80 - (dy / dt) * 0.08,
            life,
            max: life,
            size: 1 + Math.random() * 2.2 * (0.5 + level),
            hue: hue + (Math.random() - 0.5) * 30,
          });
        }
      }
      this.#prevX = px;
      this.#prevY = py;

      if (level > 0.02) {
        const pitchNorm = clamp01((st.midi - 36) / 60);
        this.#ringClock += dt * (1 + pitchNorm * 5);
        while (this.#ringClock >= 1) {
          this.#ringClock -= 1;
          if (this.#rings.length < MAX_RINGS) {
            this.#rings.push({
              x: px,
              y: py,
              r: 10 + 30 * this.#orb,
              vr: 70 + 110 * level,
              life: 1.3,
              max: 1.3,
              hue,
              width: 1 + 2 * level,
            });
          }
        }
      }
    } else {
      this.#prevX = Number.NaN;
      this.#prevY = Number.NaN;
      this.#ringClock = 0;
    }

    const oldest = now - TRAIL_MS;
    while (this.#trail.length > 0 && (this.#trail[0]?.t ?? now) < oldest) this.#trail.shift();
    if (this.#trail.length > 90) this.#trail.splice(0, this.#trail.length - 90);

    const drag = Math.exp(-dt * 2.2);
    for (const p of this.#particles) {
      p.vx *= drag;
      p.vy = p.vy * drag - 60 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.#particles = this.#particles.filter((p) => p.life > 0);

    const ringDrag = Math.exp(-dt * 0.6);
    for (const r of this.#rings) {
      r.r += r.vr * dt;
      r.vr *= ringDrag;
      r.life -= dt;
    }
    this.#rings = this.#rings.filter((r) => r.life > 0);

    for (const l of this.#labels) {
      l.y -= 36 * dt;
      l.life -= dt;
    }
    this.#labels = this.#labels.filter((l) => l.life > 0);
  }

  #draw(st: FxState, now: number): void {
    const ctx = this.#ctx;
    const w = this.#w;
    const h = this.#h;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    if (w <= 0 || h <= 0) return;

    const { px, py } = this.#pos(st);
    const hue = hueForMidi(st.midi);
    const orb = this.#orb;

    if (orb > 0.01) {
      const beam = ctx.createLinearGradient(0, 0, 0, h);
      beam.addColorStop(0, hsla(hue, 100, 70, 0));
      beam.addColorStop(clamp01(py / h), hsla(hue, 100, 72, 0.4 * orb));
      beam.addColorStop(1, hsla(hue, 100, 70, 0.1 * orb));
      ctx.fillStyle = beam;
      ctx.fillRect(px - 1, 0, 2, h);

      const column = ctx.createLinearGradient(px - 48, 0, px + 48, 0);
      column.addColorStop(0, hsla(hue, 100, 60, 0));
      column.addColorStop(0.5, hsla(hue, 100, 60, 0.09 * orb));
      column.addColorStop(1, hsla(hue, 100, 60, 0));
      ctx.fillStyle = column;
      ctx.fillRect(px - 48, 0, 96, h);

      const levelLine = ctx.createLinearGradient(0, 0, w, 0);
      levelLine.addColorStop(0, hsla(hue, 100, 70, 0));
      levelLine.addColorStop(clamp01(px / w), hsla(hue, 100, 72, 0.3 * orb));
      levelLine.addColorStop(1, hsla(hue, 100, 70, 0));
      ctx.fillStyle = levelLine;
      ctx.fillRect(0, py - 0.5, w, 1);
    }

    ctx.globalCompositeOperation = 'lighter';

    for (const r of this.#rings) {
      const a = r.life / r.max;
      ctx.strokeStyle = hsla(r.hue, 100, 68, 0.55 * a * a);
      ctx.lineWidth = r.width * (0.5 + a);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < this.#trail.length; i++) {
      const a = this.#trail[i - 1];
      const b = this.#trail[i];
      if (!a || !b) continue;
      const age = 1 - (now - b.t) / TRAIL_MS;
      if (age <= 0) continue;
      ctx.strokeStyle = hsla(b.hue, 100, 60 + 25 * age, 0.7 * age);
      ctx.lineWidth = 2 + 16 * age * (0.4 + orb);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const p of this.#particles) {
      const a = p.life / p.max;
      ctx.fillStyle = hsla(p.hue, 100, 70, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, TAU);
      ctx.fill();
    }

    if (orb > 0.01) {
      const pulse = 1 + 0.05 * Math.sin(now * 0.0345);
      const radius = (26 + 54 * orb) * pulse;
      const g = ctx.createRadialGradient(px, py, 0, px, py, radius);
      g.addColorStop(0, hsla(hue, 100, 92, 0.95 * orb));
      g.addColorStop(0.25, hsla(hue, 100, 65, 0.6 * orb));
      g.addColorStop(1, hsla(hue, 100, 50, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, TAU);
      ctx.fill();

      ctx.fillStyle = `rgba(255,255,255,${String(0.9 * orb)})`;
      ctx.beginPath();
      ctx.arc(px, py, 4 + 5 * orb, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of this.#labels) {
      const a = l.life / l.max;
      ctx.font = `800 ${String(Math.round(22 + 10 * (1 - a)))}px system-ui, sans-serif`;
      ctx.fillStyle = hsla(l.hue, 100, 85, a);
      ctx.fillText(l.text, l.x, l.y);
    }
  }
}
