// A closed, hand-written WAV reader and writer (docs/samples.md Part 2, ADR-001 style).
// Every file is untrusted input: anything outside the supported formats is a WavError.

export interface WavData {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array<ArrayBuffer>[];
}

export type WavFormat = 'pcm16' | 'pcm24' | 'float32';

export const MAX_WAV_BYTES = 64 * 1024 * 1024;

export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavError';
  }
}

function tag(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);
}

interface Fmt {
  readonly format: number;
  readonly channels: number;
  readonly rate: number;
  readonly align: number;
  readonly bits: number;
}

/** PCM 16-bit, PCM 24-bit and IEEE float 32-bit, mono or stereo. */
export function parseWav(input: ArrayBuffer | Uint8Array): WavData {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_WAV_BYTES) throw new WavError('The file is larger than 64 MiB.');
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new WavError('Not a RIFF/WAVE file.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: Fmt | undefined;
  let data: { offset: number; length: number } | undefined;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = tag(bytes, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (body + size > bytes.length) {
      if (id === 'data' || id === 'fmt ') throw new WavError(`The ${id.trim()} chunk is truncated.`);
      break;
    }
    if (id === 'fmt ') {
      if (size < 16) throw new WavError('The fmt chunk is too short.');
      let format = view.getUint16(body, true);
      if (format === 0xfffe) {
        if (size < 40) throw new WavError('The extensible fmt chunk is too short.');
        format = view.getUint16(body + 24, true);
      }
      fmt = {
        format,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        align: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      data = { offset: body, length: size };
    }
    pos = body + size + (size & 1);
  }
  if (!fmt) throw new WavError('The file has no fmt chunk.');
  if (!data) throw new WavError('The file has no data chunk.');
  const { format, channels, rate, align, bits } = fmt;
  const float = format === 3 && bits === 32;
  const pcm = format === 1 && (bits === 16 || bits === 24);
  if (!pcm && !float) {
    throw new WavError(
      `Unsupported encoding (format ${String(format)}, ${String(bits)} bits). Use 16-bit or 24-bit PCM, or 32-bit float.`,
    );
  }
  if (channels < 1 || channels > 2) throw new WavError(`Unsupported channel count ${String(channels)}.`);
  if (rate < 8000 || rate > 192000) throw new WavError(`Unsupported sample rate ${String(rate)}.`);
  const bps = bits / 8;
  if (align !== channels * bps) throw new WavError('The block alignment does not match the format.');
  const frames = Math.floor(data.length / align);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const o = data.offset + i * align + c * bps;
      let v: number;
      if (float) v = view.getFloat32(o, true);
      else if (bits === 16) v = view.getInt16(o, true) / 32768;
      else {
        const raw = (bytes[o] ?? 0) | ((bytes[o + 1] ?? 0) << 8) | ((bytes[o + 2] ?? 0) << 16);
        v = ((raw << 8) >> 8) / 8388608;
      }
      const ch = out[c];
      if (ch) ch[i] = Number.isFinite(v) ? v : 0;
    }
  }
  return { sampleRate: rate, channels: out };
}

/** Writes a canonical RIFF/WAVE file with one fmt chunk and one data chunk. */
export function encodeWav(w: WavData, format: WavFormat = 'pcm16'): Uint8Array<ArrayBuffer> {
  const nCh = w.channels.length;
  const frames = w.channels[0]?.length ?? 0;
  const bps = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4;
  const dataLen = frames * nCh * bps;
  const buf = new ArrayBuffer(44 + dataLen + (dataLen & 1));
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, buf.byteLength - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, format === 'float32' ? 3 : 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, w.sampleRate, true);
  v.setUint32(28, w.sampleRate * nCh * bps, true);
  v.setUint16(32, nCh * bps, true);
  v.setUint16(34, bps * 8, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of w.channels) {
      const x = Math.max(-1, Math.min(1, ch[i] ?? 0));
      if (format === 'float32') v.setFloat32(o, x, true);
      else if (format === 'pcm16') v.setInt16(o, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true);
      else {
        const s = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
        bytes[o] = s & 0xff;
        bytes[o + 1] = (s >> 8) & 0xff;
        bytes[o + 2] = (s >> 16) & 0xff;
      }
      o += bps;
    }
  }
  return bytes;
}
