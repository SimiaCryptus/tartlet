/**
 * Short-time spectral processor (TS-79). The worklet source is composed from the self-contained
 * kernel functions in dsp.ts, which are unit-tested in Node. It is static code loaded once from a
 * blob: URL (ADR-003), never built from document content.
 */
import { STFT_HOP, STFT_SIZE, createStftState, fftInPlace, stftBlock } from './dsp';

export const SPECTRAL_WORKLET_SOURCE = `
const fftInPlace = (${fftInPlace.toString()});
const createStftState = (${createStftState.toString()});
const stftBlock = (${stftBlock.toString()});
class TartletSpectral extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "mode", defaultValue: 0, minValue: 0, maxValue: 7, automationRate: "k-rate" },
      { name: "amount", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "gate", defaultValue: -40, minValue: -90, maxValue: 0, automationRate: "k-rate" },
      { name: "comb", defaultValue: 110, minValue: 20, maxValue: 2000, automationRate: "k-rate" },
      { name: "shift", defaultValue: 0, minValue: -24, maxValue: 24, automationRate: "k-rate" },
    ];
  }
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.persist = o.persist === true;
    const seed = typeof o.seed === "number" ? o.seed : 1;
    this.st = [
      createStftState(${String(STFT_SIZE)}, ${String(STFT_HOP)}, sampleRate, seed),
      createStftState(${String(STFT_SIZE)}, ${String(STFT_HOP)}, sampleRate, seed ^ 0x5bd1e995),
    ];
    this.idle = 0;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const silent = input.length === 0;
    this.idle = silent ? this.idle + 1 : 0;
    const p = {
      mode: parameters.mode[0],
      amount: parameters.amount[0],
      gate: parameters.gate[0],
      comb: parameters.comb[0],
      shift: parameters.shift[0],
    };
    for (let c = 0; c < output.length; c++) {
      const src = silent ? null : input[c] || input[0] || null;
      stftBlock(this.st[c % 2], src, output[c], p, fftInPlace);
    }
    return this.persist || this.idle < 64;
  }
}
registerProcessor("tartlet-spectral", TartletSpectral);
`;
