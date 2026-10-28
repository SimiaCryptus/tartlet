// Taps whatever the page sends to the speakers so a sketch can be recorded (for ringtones).
// The player exposes no render API, so we patch AudioNode.connect: every connection to an
// AudioContext's destination is mirrored into a per-context tap node we can record from.
// installCaptureTap() must run before the player creates its audio graph (main.ts does this first).

type NodeFn = (this: AudioNode, ...args: unknown[]) => unknown;

let rawConnect: NodeFn | null = null;
let rawDisconnect: NodeFn | null = null;
const taps = new WeakMap<BaseAudioContext, GainNode>();
const contexts = new Map<AudioContext, number>();

function tapFor(ctx: BaseAudioContext): GainNode {
  let tap = taps.get(ctx);
  if (!tap) {
    tap = ctx.createGain();
    taps.set(ctx, tap);
  }
  return tap;
}

function link(from: AudioNode, to: AudioNode): void {
  if (!rawConnect) throw new Error('Audio capture is not available in this browser.');
  rawConnect.call(from, to);
}

function unlink(from: AudioNode, to?: AudioNode): void {
  if (!rawDisconnect) return;
  try {
    if (to) rawDisconnect.call(from, to);
    else rawDisconnect.call(from);
  } catch {
    // already disconnected
  }
}

export function installCaptureTap(): boolean {
  if (rawConnect) return true;
  if (typeof AudioNode === 'undefined' || typeof AudioContext === 'undefined') return false;
  const proto = AudioNode.prototype as unknown as { connect: NodeFn; disconnect: NodeFn };
  const connect = proto.connect;
  const disconnect = proto.disconnect;
  rawConnect = connect;
  rawDisconnect = disconnect;

  proto.connect = function (this: AudioNode, ...args: unknown[]): unknown {
    const result = connect.apply(this, args);
    const dest = args[0];
    if (dest instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      const tap = tapFor(this.context);
      if (this !== tap) {
        try {
          connect.call(this, tap, typeof args[1] === 'number' ? args[1] : 0);
        } catch {
          // never let the tap break playback
        }
      }
      contexts.set(this.context, performance.now());
    }
    return result;
  };

  proto.disconnect = function (this: AudioNode, ...args: unknown[]): unknown {
    if (args[0] instanceof AudioDestinationNode) {
      const tap = taps.get(this.context);
      if (tap) {
        try {
          disconnect.call(this, tap);
        } catch {
          // not connected to the tap
        }
      }
    }
    return disconnect.apply(this, args);
  };
  return true;
}

/** The most recently used audio context that is currently running. */
function activeContext(): AudioContext | null {
  let best: AudioContext | null = null;
  let bestAt = -Infinity;
  for (const [ctx, at] of contexts) {
    if (ctx.state === 'closed') {
      contexts.delete(ctx);
      continue;
    }
    if (ctx.state === 'running' && at > bestAt) {
      best = ctx;
      bestAt = at;
    }
  }
  return best;
}

function abortError(): DOMException {
  return new DOMException('Recording cancelled', 'AbortError');
}

/** Resolves once some page audio is routed to the speakers, or rejects after timeoutMs. */
export async function waitForOutput(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!activeContext()) {
    if (signal?.aborted) throw abortError();
    if (performance.now() > deadline) {
      throw new Error('No audio output was detected. Press play once, then try again.');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

export interface Recording {
  readonly sampleRate: number;
  readonly channels: Float32Array[];
  /** AAC/MP4 encoding made at the same time, when the browser supports it (used for .m4r). */
  readonly compressed: Blob | null;
}

function pickCompressedType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac']) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return null;
}

export function canRecordCompressed(): boolean {
  return pickCompressedType() !== null;
}
/* eslint-disable @typescript-eslint/no-deprecated -- ScriptProcessorNode is deprecated, but AudioWorklet
    needs a separately loaded module, which our CSP and Trusted Types make awkward. All use is confined here. */
interface PcmTap {
  readonly node: AudioNode;
  detach(): void;
}
/** Creates a node that hands each block of stereo input to `onBlock` and outputs silence. */
function createPcmTap(ctx: AudioContext, onBlock: (left: Float32Array, right: Float32Array) => void): PcmTap {
  const proc = ctx.createScriptProcessor(4096, 2, 2);
  proc.onaudioprocess = (e) => {
    const out = e.outputBuffer;
    for (let c = 0; c < out.numberOfChannels; c++) out.getChannelData(c).fill(0);
    const input = e.inputBuffer;
    const inL = input.getChannelData(0);
    const inR = input.numberOfChannels > 1 ? input.getChannelData(1) : inL;
    onBlock(inL, inR);
  };
  return {
    node: proc,
    detach() {
      proc.onaudioprocess = null;
    },
  };
}
/* eslint-enable @typescript-eslint/no-deprecated */

/** Records `seconds` of the page's audio output in real time. */
export function recordOutput(
  seconds: number,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<Recording> {
  const ctx = activeContext();
  if (!ctx) return Promise.reject(new Error('Nothing is playing yet.'));
  const tap = tapFor(ctx);
  const frames = Math.max(1, Math.round(seconds * ctx.sampleRate));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let written = 0;

  let onBlock: ((inL: Float32Array, inR: Float32Array) => void) | null = null;
  const pcm = createPcmTap(ctx, (inL, inR) => {
    onBlock?.(inL, inR);
  });
  const proc = pcm.node;
  link(tap, proc);
  link(proc, ctx.destination);

  let recorder: MediaRecorder | null = null;
  let streamDest: MediaStreamAudioDestinationNode | null = null;
  const chunks: Blob[] = [];
  const type = pickCompressedType();
  if (type) {
    try {
      streamDest = ctx.createMediaStreamDestination();
      link(tap, streamDest);
      recorder = new MediaRecorder(streamDest.stream, { mimeType: type });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
    } catch {
      recorder = null;
    }
  }

  return new Promise<Recording>((resolve, reject) => {
    let done = false;
    const cleanup = (): void => {
      onBlock = null;
      pcm.detach();
      unlink(tap, proc);
      unlink(proc);
      if (streamDest) unlink(tap, streamDest);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const stopRecorder = (): Promise<Blob | null> =>
      new Promise((res) => {
        if (!recorder || recorder.state === 'inactive') {
          res(null);
          return;
        }
        const r = recorder;
        r.onstop = () => {
          res(chunks.length > 0 ? new Blob(chunks, { type: r.mimeType || type || 'audio/mp4' }) : null);
        };
        r.stop();
      });
    const onAbort = (): void => {
      if (done) return;
      done = true;
      cleanup();
      void stopRecorder();
      reject(abortError());
    };
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    onBlock = (inL, inR) => {
      if (done) return;
      const n = Math.min(inL.length, frames - written);
      left.set(inL.subarray(0, n), written);
      right.set(inR.subarray(0, n), written);
      written += n;
      opts.onProgress?.(written / frames);
      if (written >= frames) {
        done = true;
        cleanup();
        void stopRecorder().then((compressed) => {
          resolve({ sampleRate: ctx.sampleRate, channels: [left, right], compressed });
        });
      }
    };
  });
}
