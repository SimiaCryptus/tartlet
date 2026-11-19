/**
 * Lightweight full-screen particle layer for touch feedback.
 * Coordinates are CSS pixels (clientX / clientY). The animation loop only runs while particles are alive.
 */

type ParticleKind = 'spark' | 'ring' | 'mote';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  hue: number;
  kind: ParticleKind;
}

export interface FxOptions {
  readonly reducedMotion?: boolean;
}

const MAX_PARTICLES = 800;
const TAU = Math.PI * 2;

export class FxLayer {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D | null;
  readonly #reduced: boolean;
  #particles: Particle[] = [];
  #raf = 0;
  #last = 0;
  #w = 0;
  #h = 0;
  #dpr = 1;

  constructor(canvas: HTMLCanvasElement, opts: FxOptions = {}) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#reduced = opts.reducedMotion ?? false;
    this.#resize();
    window.addEventListener('resize', () => {
      this.#resize();
    });
  }

  /** Big hit: shockwave rings plus a shower of sparks. `intensity` scales size and count (0.5–3). */
  burst(x: number, y: number, hue: number, intensity = 1): void {
    const k = Math.max(0.5, Math.min(3, intensity));
    this.#push({ x, y, vx: 0, vy: 0, life: 0, ttl: 0.5, size: 46 * k, hue, kind: 'ring' });
    if (!this.#reduced) {
      this.#push({ x, y, vx: 0, vy: 0, life: 0, ttl: 0.8, size: 84 * k, hue: hue + 30, kind: 'ring' });
      const count = Math.round(12 + 10 * k);
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * TAU;
        const speed = 120 + Math.random() * 300 * k;
        this.#push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 80,
          life: 0,
          ttl: 0.4 + Math.random() * 0.5,
          size: 1.2 + Math.random() * 2.4,
          hue: hue + (Math.random() - 0.5) * 50,
          kind: 'spark',
        });
      }
    }
    this.#ensureRunning();
  }

  /** Soft glowing motes left behind while a finger slides. */
  trail(x: number, y: number, hue: number): void {
    if (this.#reduced) return;
    for (let i = 0; i < 2; i += 1) {
      this.#push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 40,
        life: 0,
        ttl: 0.5 + Math.random() * 0.3,
        size: 2 + Math.random() * 3,
        hue,
        kind: 'mote',
      });
    }
    this.#ensureRunning();
  }

  #push(p: Particle): void {
    if (this.#particles.length >= MAX_PARTICLES) return;
    this.#particles.push(p);
  }

  #resize(): void {
    this.#dpr = Math.min(2, window.devicePixelRatio || 1);
    this.#w = window.innerWidth;
    this.#h = window.innerHeight;
    this.#canvas.width = Math.round(this.#w * this.#dpr);
    this.#canvas.height = Math.round(this.#h * this.#dpr);
    this.#ctx?.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
  }

  #ensureRunning(): void {
    if (this.#raf !== 0) return;
    this.#last = performance.now();
    this.#raf = requestAnimationFrame(this.#tick);
  }

  readonly #tick = (now: number): void => {
    const ctx = this.#ctx;
    if (!ctx) {
      this.#raf = 0;
      this.#particles.length = 0;
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - this.#last) / 1000));
    this.#last = now;

    ctx.clearRect(0, 0, this.#w, this.#h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const drag = Math.exp(-2.8 * dt);

    let alive = 0;
    for (const p of this.#particles) {
      p.life += dt;
      if (p.life >= p.ttl) continue;
      const t = p.life / p.ttl;
      const alpha = 1 - t;

      if (p.kind === 'ring') {
        const eased = 1 - (1 - t) ** 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size * eased), 0, TAU);
        ctx.lineWidth = 1 + 4 * alpha;
        ctx.strokeStyle = `hsla(${String(p.hue)}, 100%, 68%, ${String(alpha * 0.9)})`;
        ctx.stroke();
      } else {
        p.vx *= drag;
        p.vy = p.vy * drag + (p.kind === 'spark' ? 420 : -30) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === 'spark') {
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
          ctx.lineTo(p.x, p.y);
          ctx.lineWidth = p.size;
          ctx.strokeStyle = `hsla(${String(p.hue)}, 100%, 72%, ${String(alpha)})`;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, TAU);
          ctx.fillStyle = `hsla(${String(p.hue)}, 100%, 70%, ${String(alpha * 0.7)})`;
          ctx.fill();
        }
      }
      this.#particles[alive] = p;
      alive += 1;
    }
    this.#particles.length = alive;
    ctx.globalCompositeOperation = 'source-over';

    if (alive > 0) {
      this.#raf = requestAnimationFrame(this.#tick);
    } else {
      this.#raf = 0;
      ctx.clearRect(0, 0, this.#w, this.#h);
    }
  };
}
