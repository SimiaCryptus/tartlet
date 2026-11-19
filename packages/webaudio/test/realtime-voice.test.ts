import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PARAM_EXP_FLOOR,
  attackDecayEnvelope,
  envelopeLevelAt,
  smoothParam,
  type Adsr,
  type SmoothableParam,
} from '../src/dsp';
import { AudioEngine } from '../src/engine';
import { SAFETY_WORKLET_SOURCE } from '../src/safety-worklet';

interface ParamCall {
  readonly method:
    | 'setValueAtTime'
    | 'linearRampToValueAtTime'
    | 'exponentialRampToValueAtTime'
    | 'setTargetAtTime'
    | 'setValueCurveAtTime'
    | 'cancelScheduledValues'
    | 'cancelAndHoldAtTime';
  readonly value?: number;
  readonly time: number;
  readonly tau?: number;
}

class MockAudioParam implements SmoothableParam {
  value: number;
  minValue?: number;
  maxValue?: number;
  readonly calls: ParamCall[] = [];
  cancelAndHoldAtTime?: (cancelTime: number) => unknown;

  constructor(initial = 0, opts?: { minValue?: number; maxValue?: number; withCancelAndHold?: boolean }) {
    this.value = initial;
    if (opts?.minValue !== undefined) this.minValue = opts.minValue;
    if (opts?.maxValue !== undefined) this.maxValue = opts.maxValue;
    if (opts?.withCancelAndHold) {
      this.cancelAndHoldAtTime = (cancelTime: number) => {
        this.calls.push({ method: 'cancelAndHoldAtTime', time: cancelTime });
        return this;
      };
    }
  }

  setValueAtTime(value: number, startTime: number): this {
    this.value = value;
    this.calls.push({ method: 'setValueAtTime', value, time: startTime });
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time: endTime });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.calls.push({ method: 'exponentialRampToValueAtTime', value, time: endTime });
    return this;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): this {
    this.calls.push({ method: 'setTargetAtTime', value: target, time: startTime, tau: timeConstant });
    return this;
  }

  setValueCurveAtTime(_values: Float32Array, startTime: number): this {
    this.calls.push({ method: 'setValueCurveAtTime', time: startTime });
    return this;
  }

  cancelScheduledValues(cancelTime: number): this {
    this.calls.push({ method: 'cancelScheduledValues', time: cancelTime });
    return this;
  }
}

class MockNode {
  connect<T>(dest: T): T {
    return dest;
  }
  disconnect(): void {}
}

class MockGainNode extends MockNode {
  readonly gain: MockAudioParam;
  constructor(withCancelAndHold = false) {
    super();
    this.gain = new MockAudioParam(1, { withCancelAndHold });
  }
}

class MockOscillatorNode extends MockNode {
  type: OscillatorType = 'sine';
  readonly frequency = new MockAudioParam(440);
  readonly detune = new MockAudioParam(0);
  readonly startCalls: Array<[number, number?]> = [];
  readonly stopCalls: Array<number | undefined> = [];
  periodicWave?: PeriodicWave;

  setPeriodicWave(wave: PeriodicWave): void {
    this.periodicWave = wave;
  }

  start(when = 0, offset?: number): void {
    this.startCalls.push([when, offset]);
  }

  stop(when?: number): void {
    this.stopCalls.push(when);
  }
}

class MockBufferSourceNode extends MockNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new MockAudioParam(1);
  readonly startCalls: Array<[number, number?]> = [];
  readonly stopCalls: Array<number | undefined> = [];

  start(when = 0, offset?: number): void {
    this.startCalls.push([when, offset]);
  }

  stop(when?: number): void {
    this.stopCalls.push(when);
  }
}

class MockBiquadFilterNode extends MockNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new MockAudioParam(350);
  readonly Q = new MockAudioParam(1);
  readonly gain = new MockAudioParam(0);
}

class MockStereoPannerNode extends MockNode {
  readonly pan = new MockAudioParam(0);
}

class MockPannerNode extends MockNode {
  panningModel = 'HRTF';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 50;
  rolloffFactor = 1;
  readonly positionX = new MockAudioParam(0);
  readonly positionY = new MockAudioParam(0);
  readonly positionZ = new MockAudioParam(0);
}

class MockDynamicsCompressorNode extends MockNode {
  readonly threshold = new MockAudioParam(-24);
  readonly ratio = new MockAudioParam(12);
  readonly knee = new MockAudioParam(30);
  readonly attack = new MockAudioParam(0.003);
  readonly release = new MockAudioParam(0.25);
}

class MockDelayNode extends MockNode {
  readonly delayTime = new MockAudioParam(0);
}

class MockWaveShaperNode extends MockNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
}

class MockConvolverNode extends MockNode {
  buffer: AudioBuffer | null = null;
  normalize = true;
}

class MockWorkletNode extends MockNode {
  readonly parameters = new Map<string, MockAudioParam>();
}

function createMockAudioContext(opts?: { currentTime?: number; sampleRate?: number; withCancelAndHold?: boolean }) {
  const gains: MockGainNode[] = [];
  const oscillators: MockOscillatorNode[] = [];
  const bufferSources: MockBufferSourceNode[] = [];
  const filters: MockBiquadFilterNode[] = [];
  const panners: MockStereoPannerNode[] = [];
  const withCancelAndHold = opts?.withCancelAndHold ?? false;

  const ctx = {
    currentTime: opts?.currentTime ?? 1,
    sampleRate: opts?.sampleRate ?? 48000,
    destination: new MockNode(),
    audioWorklet: {
      addModule: vi.fn(() => Promise.resolve(undefined)),
    },
    resume: vi.fn(() => Promise.resolve(undefined)),
    createGain: () => {
      const node = new MockGainNode(withCancelAndHold);
      gains.push(node);
      return node;
    },
    createOscillator: () => {
      const node = new MockOscillatorNode();
      oscillators.push(node);
      return node;
    },
    createBufferSource: () => {
      const node = new MockBufferSourceNode();
      bufferSources.push(node);
      return node;
    },
    createBiquadFilter: () => {
      const node = new MockBiquadFilterNode();
      filters.push(node);
      return node;
    },
    createStereoPanner: () => {
      const node = new MockStereoPannerNode();
      panners.push(node);
      return node;
    },
    createPanner: () => new MockPannerNode(),
    createDynamicsCompressor: () => new MockDynamicsCompressorNode(),
    createChannelMerger: () => new MockNode(),
    createChannelSplitter: () => new MockNode(),
    createDelay: () => new MockDelayNode(),
    createWaveShaper: () => new MockWaveShaperNode(),
    createConvolver: () => new MockConvolverNode(),
    createPeriodicWave: () => ({}),
    createIIRFilter: () => new MockNode(),
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        duration: length / sampleRate,
        length,
        sampleRate,
        numberOfChannels: channels,
        getChannelData: (ch: number) => data[ch] ?? new Float32Array(length),
        copyToChannel: (src: Float32Array, ch: number) => {
          data[ch]?.set(src);
        },
      };
    },
  };

  return {
    ctx: ctx as unknown as AudioContext,
    rawCtx: ctx,
    gains,
    oscillators,
    bufferSources,
    filters,
    panners,
  };
}

function lastScheduledTarget(param: MockAudioParam, minTime: number): number | undefined {
  const matches = param.calls.filter(
    (c) =>
      c.time >= minTime &&
      c.value !== undefined &&
      (c.method === 'setTargetAtTime' ||
        c.method === 'linearRampToValueAtTime' ||
        c.method === 'exponentialRampToValueAtTime' ||
        c.method === 'setValueAtTime'),
  );
  return matches[matches.length - 1]?.value;
}

function instantiateSafetyProcessor(sampleRate = 48000): {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
} {
  let registered: (new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }) | undefined;
  class StubAudioWorkletProcessor {
    readonly port: unknown = null;
  }
  const registerProcessor = (
    name: string,
    ctor: new () => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean },
  ) => {
    if (name === 'tartlet-safety') registered = ctor;
  };
  // The worklet source is static module text (ADR-003). The test evaluates it so that the real
  // processor is exercised; nothing here is built from document content.
  /* eslint-disable @typescript-eslint/no-implied-eval, no-restricted-syntax, no-new-func, no-restricted-globals */
  const init = new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', SAFETY_WORKLET_SOURCE) as (
    ...args: unknown[]
  ) => void;
  /* eslint-enable @typescript-eslint/no-implied-eval, no-restricted-syntax, no-new-func, no-restricted-globals */
  init(StubAudioWorkletProcessor, sampleRate, registerProcessor);
  if (!registered) throw new Error('tartlet-safety processor was not registered');
  return new registered();
}

describe('two-phase ADSR helpers', () => {
  const adsr: Adsr = { a: 0.05, d: 0.1, s: 0.6, r: 0.3 };

  describe('attackDecayEnvelope', () => {
    it('builds attack and decay breakpoints down to sustain without a release tail', () => {
      const pts = attackDecayEnvelope(2, adsr, 0.8);
      expect(pts).toHaveLength(3);
      expect(pts[0]).toEqual([2, 0]);
      expect(pts[1]).toEqual([2.05, 0.8]);
      expect(pts[2]?.[0]).toBeCloseTo(2.15, 6);
      expect(pts[2]?.[1]).toBeCloseTo(0.48, 6);
    });

    it('omits the decay segment when sustain is >= 1', () => {
      const pts = attackDecayEnvelope(1, { a: 0.02, d: 0.2, s: 1, r: 0.5 }, 0.7);
      expect(pts).toEqual([
        [1, 0],
        [1.02, 0.7],
      ]);
      expect(attackDecayEnvelope(1, { a: 0.02, d: 0.2, s: 1.4, r: 0.5 }, 0.7)).toEqual([
        [1, 0],
        [1.02, 0.7],
      ]);
    });

    it('clamps negative attack, negative sustain, and sub-millisecond decay', () => {
      const pts = attackDecayEnvelope(0.5, { a: -0.1, d: 0, s: -0.5, r: 0.1 }, 1);
      expect(pts[0]).toEqual([0.5, 0]);
      expect(pts[1]).toEqual([0.5, 1]);
      expect(pts[2]?.[0]).toBeCloseTo(0.501, 6);
      expect(pts[2]?.[1]).toBe(0);
    });
  });

  describe('envelopeLevelAt', () => {
    it('returns 0 at or before onset', () => {
      expect(envelopeLevelAt(1, 0.5, adsr, 0.8)).toBe(0);
      expect(envelopeLevelAt(1, 1, adsr, 0.8)).toBe(0);
    });

    it('interpolates linearly through attack and decay and holds at sustain', () => {
      expect(envelopeLevelAt(1, 1.025, adsr, 0.8)).toBeCloseTo(0.4, 6);
      expect(envelopeLevelAt(1, 1.05, adsr, 0.8)).toBeCloseTo(0.8, 6);
      expect(envelopeLevelAt(1, 1.1, adsr, 0.8)).toBeCloseTo(0.64, 6);
      expect(envelopeLevelAt(1, 1.15, adsr, 0.8)).toBeCloseTo(0.48, 6);
      expect(envelopeLevelAt(1, 3, adsr, 0.8)).toBeCloseTo(0.48, 6);
    });

    it('holds at peak when sustain is 1 and enforces minimum decay of 1 ms', () => {
      const full: Adsr = { a: 0.1, d: 0.2, s: 1, r: 0.2 };
      expect(envelopeLevelAt(0, 0.05, full, 0.5)).toBeCloseTo(0.25, 6);
      expect(envelopeLevelAt(0, 0.2, full, 0.5)).toBeCloseTo(0.5, 6);

      const zeroA: Adsr = { a: 0, d: 0, s: 0.2, r: 0.1 };
      expect(envelopeLevelAt(1, 1.0005, zeroA, 1)).toBeCloseTo(0.6, 6);
      expect(envelopeLevelAt(1, 1.002, zeroA, 1)).toBeCloseTo(0.2, 6);
    });
  });
});

describe('smoothParam', () => {
  it('uses setTargetAtTime by default, linearRamp for linear, and exponentialRamp for exponential', () => {
    const targetParam = new MockAudioParam(0);
    smoothParam(targetParam, 500, 1.5, 0.02);
    expect(targetParam.calls).toEqual([{ method: 'setTargetAtTime', value: 500, time: 1.5, tau: 0.02 }]);

    const linParam = new MockAudioParam(0);
    smoothParam(linParam, 0.75, 2, 0.1, 'linear');
    expect(linParam.calls).toEqual([{ method: 'linearRampToValueAtTime', value: 0.75, time: 2.1 }]);

    const expParam = new MockAudioParam(440);
    smoothParam(expParam, 880, 1, 0.05, 'exponential');
    expect(expParam.calls).toEqual([{ method: 'exponentialRampToValueAtTime', value: 880, time: 1.05 }]);
  });

  it('clamps exponential targets to PARAM_EXP_FLOOR or maxValue when below floor', () => {
    const p1 = new MockAudioParam(1);
    smoothParam(p1, 0, 1, 0.05, 'exponential');
    expect(p1.calls[0]).toEqual({
      method: 'exponentialRampToValueAtTime',
      value: PARAM_EXP_FLOOR,
      time: 1.05,
    });

    const p2 = new MockAudioParam(1e-5, { maxValue: 5e-5 });
    smoothParam(p2, -1, 1, 0.05, 'exponential');
    expect(p2.calls[0]).toEqual({
      method: 'exponentialRampToValueAtTime',
      value: 5e-5,
      time: 1.05,
    });
  });

  it('snaps with setValueAtTime when tau <= 0 and clamps time, tau, and min/max bounds', () => {
    const p = new MockAudioParam(0, { minValue: 20, maxValue: 20000 });
    smoothParam(p, 5, -1, 0);
    expect(p.calls[0]).toEqual({ method: 'setValueAtTime', value: 20, time: 0 });

    smoothParam(p, 30000, 1, 100, 'linear');
    expect(p.calls[1]).toEqual({ method: 'linearRampToValueAtTime', value: 20000, time: 31 });
  });

  it('ignores non-finite value or time', () => {
    const p = new MockAudioParam(1);
    smoothParam(p, Number.NaN, 1, 0.1);
    smoothParam(p, 1, Number.POSITIVE_INFINITY, 0.1);
    expect(p.calls).toHaveLength(0);
  });
});

describe('TartletSafety multi-channel stability', () => {
  it('produces finite outputs on the very first frame for more than 2 channels', () => {
    const proc = instantiateSafetyProcessor(48000);
    const chans = 6;
    const frames = 128;
    const inputs = Array.from({ length: chans }, () => new Float32Array(frames).fill(0.25));
    const outputs = Array.from({ length: chans }, () => new Float32Array(frames));

    const alive = proc.process([inputs], [outputs]);
    expect(alive).toBe(true);
    for (let c = 0; c < chans; c++) {
      const out = outputs[c]!;
      expect(Number.isFinite(out[0])).toBe(true);
      expect(out[0]).toBeCloseTo(0.25, 5);
      for (let i = 0; i < frames; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        expect(Math.abs(out[i]!)).toBeLessThanOrEqual(0.98);
      }
    }
  });

  it('limits spikes and recovers from non-finite input on channels >= 2', () => {
    const proc = instantiateSafetyProcessor(48000);
    const chans = 4;
    const frames = 8;
    const inputs = Array.from({ length: chans }, () => new Float32Array(frames).fill(0.5));
    inputs[3]![0] = 3.0;
    inputs[2]![2] = Number.NaN;
    const outputs = Array.from({ length: chans }, () => new Float32Array(frames));

    proc.process([inputs], [outputs]);
    for (let c = 0; c < chans; c++) {
      for (let i = 0; i < frames; i++) {
        const v = outputs[c]![i]!;
        expect(Number.isFinite(v)).toBe(true);
        // The ceiling is 0.98 in double precision; the output buffer is float32.
        expect(Math.abs(v)).toBeLessThanOrEqual(Math.fround(0.98));
      }
    }
    expect(outputs[2]![2]).toBe(0);
  });
});

describe('AudioEngine real-time voice lifecycle (mocked AudioContext)', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
    vi.stubGlobal('AudioBufferSourceNode', MockBufferSourceNode);
    if (typeof URL.createObjectURL !== 'function') {
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: () => 'blob:mock',
        revokeObjectURL: () => undefined,
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('noteOn starts a sustained voice with two-phase ADSR and no pre-scheduled stop', async () => {
    const mock = createMockAudioContext({ currentTime: 1 });
    const engine = await AudioEngine.create(mock.ctx);
    const gainCountBefore = mock.gains.length;

    const handle = engine.noteOn(
      { s: 'sawtooth', freq: 440, gain: 1, attack: 0.05, decay: 0.1, sustain: 0.5, release: 0.2 },
      1,
    );
    expect(handle).toBeDefined();
    expect(mock.oscillators).toHaveLength(1);
    const osc = mock.oscillators[0]!;
    expect(osc.startCalls).toHaveLength(1);
    expect(osc.startCalls[0]?.[0]).toBe(1);
    expect(osc.stopCalls).toHaveLength(0);

    const noteGains = mock.gains.slice(gainCountBefore);
    const ampGain = noteGains.find(
      (g) =>
        g.gain.calls.some((c) => c.method === 'setValueAtTime' && c.value === 0) &&
        g.gain.calls.some((c) => c.method === 'linearRampToValueAtTime'),
    );
    expect(ampGain).toBeDefined();
    const ramps = ampGain!.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime');
    expect(ramps).toHaveLength(2);
    expect(ramps[0]?.time).toBeCloseTo(1.05, 5);
    expect(ramps[0]?.value).toBeCloseTo(0.3, 5);
    expect(ramps[1]?.time).toBeCloseTo(1.15, 5);
    expect(ramps[1]?.value).toBeCloseTo(0.15, 5);
  });

  it('VoiceHandle.update scales frequency across unison copies and binaural ears', async () => {
    const mock = createMockAudioContext({ currentTime: 1 });
    const engine = await AudioEngine.create(mock.ctx);

    const unisonHandle = engine.noteOn({ s: 'sawtooth', freq: 440, unison: 3, detune: 24 }, 1);
    expect(unisonHandle).toBeDefined();
    expect(mock.oscillators).toHaveLength(3);

    unisonHandle!.update({ freq: 880 }, 1.5);
    const unisonTargets = mock.oscillators
      .map((o) => lastScheduledTarget(o.frequency, 1.5))
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(unisonTargets[0]).toBeCloseTo(880 * 2 ** (-12 / 1200), 3);
    expect(unisonTargets[1]).toBeCloseTo(880, 3);
    expect(unisonTargets[2]).toBeCloseTo(880 * 2 ** (12 / 1200), 3);

    const oscStartIdx = mock.oscillators.length;
    const binauralHandle = engine.noteOn({ s: 'sine', freq: 200, binaural: 10 }, 1);
    expect(binauralHandle).toBeDefined();
    const binOscs = mock.oscillators.slice(oscStartIdx);
    expect(binOscs).toHaveLength(2);

    binauralHandle!.update({ freq: 400 }, 1.6);
    const binTargets = binOscs.map((o) => lastScheduledTarget(o.frequency, 1.6)).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(binTargets[0]).toBeCloseTo(395, 3);
    expect(binTargets[1]).toBeCloseTo(405, 3);

    const comboIdx = mock.oscillators.length;
    const comboHandle = engine.noteOn({ s: 'sawtooth', freq: 200, unison: 2, detune: 20, binaural: 8 }, 1);
    expect(comboHandle).toBeDefined();
    const comboOscs = mock.oscillators.slice(comboIdx);
    expect(comboOscs).toHaveLength(4);

    comboHandle!.update({ freq: 400 }, 1.7);
    const comboTargets = comboOscs
      .map((o) => lastScheduledTarget(o.frequency, 1.7))
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(comboTargets[0]).toBeCloseTo(396 * 2 ** (-10 / 1200), 3);
    expect(comboTargets[1]).toBeCloseTo(396 * 2 ** (10 / 1200), 3);
    expect(comboTargets[2]).toBeCloseTo(404 * 2 ** (-10 / 1200), 3);
    expect(comboTargets[3]).toBeCloseTo(404 * 2 ** (10 / 1200), 3);
  });

  it('VoiceHandle.noteOff schedules release ramp via envelopeLevelAt fallback and delays stop', async () => {
    const mock = createMockAudioContext({ currentTime: 1, withCancelAndHold: false });
    const engine = await AudioEngine.create(mock.ctx);
    const gainCountBefore = mock.gains.length;

    const handle = engine.noteOn(
      { s: 'triangle', freq: 440, gain: 1, attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.25 },
      1,
    );
    expect(handle).toBeDefined();
    const osc = mock.oscillators[0]!;
    expect(osc.stopCalls).toHaveLength(0);

    handle!.noteOff(1.2);

    const noteGains = mock.gains.slice(gainCountBefore);
    const ampGain = noteGains.find((g) => g.gain.calls.some((c) => c.method === 'cancelScheduledValues'));
    expect(ampGain).toBeDefined();
    const calls = ampGain!.gain.calls;
    const cancelIdx = calls.findIndex((c) => c.method === 'cancelScheduledValues' && c.time === 1.2);
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    const holdSet = calls.slice(cancelIdx + 1).find((c) => c.method === 'setValueAtTime');
    expect(holdSet?.time).toBeCloseTo(1.2, 5);
    // At t=1.2 (halfway through 0.2s decay from 0.3 peak to 0.15 sustain), level is 0.225.
    expect(holdSet?.value).toBeCloseTo(0.225, 5);
    const releaseRamp = calls.slice(cancelIdx + 1).find((c) => c.method === 'linearRampToValueAtTime');
    expect(releaseRamp?.value).toBe(0);
    expect(releaseRamp?.time).toBeCloseTo(1.45, 5);

    expect(osc.stopCalls).toHaveLength(1);
    expect(osc.stopCalls[0]).toBeGreaterThanOrEqual(1.45);

    // Subsequent noteOff and update calls are idempotent / ignored after release.
    handle!.noteOff(1.3);
    handle!.update({ freq: 880 }, 1.3);
    expect(osc.stopCalls).toHaveLength(1);
    expect(lastScheduledTarget(osc.frequency, 1.3)).toBeUndefined();
  });

  it('VoiceHandle.noteOff uses cancelAndHoldAtTime when available', async () => {
    const mock = createMockAudioContext({ currentTime: 1, withCancelAndHold: true });
    const engine = await AudioEngine.create(mock.ctx);
    const gainCountBefore = mock.gains.length;

    const handle = engine.noteOn({ s: 'sine', freq: 440, release: 0.3 }, 1);
    expect(handle).toBeDefined();
    handle!.noteOff(1.4);

    const ampGain = mock.gains
      .slice(gainCountBefore)
      .find((g) => g.gain.calls.some((c) => c.method === 'cancelAndHoldAtTime'));
    expect(ampGain).toBeDefined();
    const releaseRamp = ampGain!.gain.calls.find(
      (c) => c.method === 'linearRampToValueAtTime' && c.time >= 1.7 - 1e-6 && c.value === 0,
    );
    expect(releaseRamp).toBeDefined();
    expect(mock.oscillators[0]!.stopCalls[0]).toBeGreaterThanOrEqual(1.7);
  });

  it('admit() protects held voices from being stolen when one-shot voices exceed MAX_COST', async () => {
    const mock = createMockAudioContext({ currentTime: 1 });
    const engine = await AudioEngine.create(mock.ctx);

    const held = engine.noteOn({ s: 'sine', freq: 440 }, 1);
    expect(held).toBeDefined();
    const heldOsc = mock.oscillators[0]!;
    expect(heldOsc.stopCalls).toHaveLength(0);

    // Schedule 10 unison=8 one-shot notes (cost 80 > MAX_COST 64).
    for (let i = 0; i < 10; i++) {
      engine.play({ s: 'sawtooth', freq: 220, unison: 8 }, 1, 4);
    }

    // The held voice must not be stolen, while oldest one-shots are stopped.
    expect(heldOsc.stopCalls).toHaveLength(0);
    const stoppedEarly = mock.oscillators
      .slice(1, 1 + 8)
      .some((o) => o.stopCalls.some((t) => t === undefined || t < 5));
    expect(stoppedEarly).toBe(true);

    held!.noteOff(2);
    expect(heldOsc.stopCalls).toHaveLength(1);
  });
});
