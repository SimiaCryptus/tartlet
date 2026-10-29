/**
 * Per-voice noise gate (TS-87). The worklet source is composed from the self-contained kernel
 * functions in dsp.ts, which are unit-tested in Node. It is static code loaded once from a
 * blob: URL (ADR-003), never built from document content.
 */
import { createGateState, gateBlock } from './dsp';

export const GATE_WORKLET_SOURCE = `
const createGateState = (${createGateState.toString()});
const gateBlock = (${gateBlock.toString()});
class TartletGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "threshold", defaultValue: -50, minValue: -90, maxValue: 0, automationRate: "k-rate" },
      { name: "release", defaultValue: 0.1, minValue: 0.005, maxValue: 1, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.st = createGateState();
    this.idle = 0;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    this.idle = input.length === 0 ? this.idle + 1 : 0;
    gateBlock(this.st, input, output, parameters.threshold[0], parameters.release[0], sampleRate);
    return this.idle < 64;
  }
}
registerProcessor("tartlet-gate", TartletGate);
`;
