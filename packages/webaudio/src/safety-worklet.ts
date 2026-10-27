/**
 * Master-bus safety processor (idea.md §11.5). It applies a DC blocker, a NaN/Infinity guard
 * and a brickwall limiter with instant attack, then a final clamp below 0 dBFS.
 * This is static module source, loaded once from a blob: URL (ADR-003). It is never built
 * from document content.
 */
export const SAFETY_WORKLET_SOURCE = `
const CEILING = 0.98;
class TartletSafety extends AudioWorkletProcessor {
  constructor() {
    super();
    this.env = 1;
    this.x1 = [0, 0];
    this.y1 = [0, 0];
    this.rel = Math.exp(-1 / (0.08 * sampleRate));
    this.tmp = [0, 0];
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const frames = output[0] ? output[0].length : 128;
    const chans = output.length;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < chans; c++) {
        const src = input[c] || input[0];
        let x = src ? src[i] : 0;
        if (!Number.isFinite(x)) { x = 0; this.x1[c] = 0; this.y1[c] = 0; }
        const y = x - this.x1[c] + 0.995 * this.y1[c];
        this.x1[c] = x;
        this.y1[c] = Number.isFinite(y) ? y : 0;
        this.tmp[c] = this.y1[c];
        const a = Math.abs(this.tmp[c]);
        if (a > peak) peak = a;
      }
      const target = peak > CEILING ? CEILING / peak : 1;
      this.env = target < this.env ? target : target + (this.env - target) * this.rel;
      for (let c = 0; c < chans; c++) {
        const v = this.tmp[c] * this.env;
        output[c][i] = v > CEILING ? CEILING : v < -CEILING ? -CEILING : v;
      }
    }
    return true;
  }
}
registerProcessor("tartlet-safety", TartletSafety);
`;
