// The WAV parser and encoder (docs/samples.md Testing). Files are built byte by byte by hand.
import { describe, expect, it } from 'vitest';
import { WavError, encodeWav, parseWav } from '../src';

const ascii = (s: string): number[] => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const u16 = (v: number): number[] => [v & 255, (v >> 8) & 255];
const u32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const fmt = (format: number, ch: number, rate: number, bits: number): number[] => [
  ...u16(format),
  ...u16(ch),
  ...u32(rate),
  ...u32((rate * ch * bits) / 8),
  ...u16((ch * bits) / 8),
  ...u16(bits),
];
function riff(chunks: readonly (readonly [string, readonly number[], number?])[]): Uint8Array {
  const body = ascii('WAVE');
  for (const [id, data, declared] of chunks) {
    body.push(...ascii(id), ...u32(declared ?? data.length), ...data);
    if (data.length & 1) body.push(0);
  }
  return Uint8Array.from([...ascii('RIFF'), ...u32(body.length), ...body]);
}

describe('WAV parser', () => {
  it('reads 16-bit PCM', () => {
    const w = parseWav(
      riff([
        ['fmt ', fmt(1, 1, 48000, 16)],
        ['data', [0, 0, 0, 64, 0, 128]],
      ]),
    );
    expect(w.sampleRate).toBe(48000);
    expect([...(w.channels[0] ?? [])]).toEqual([0, 0.5, -1]);
  });
  it('reads 24-bit stereo PCM', () => {
    const w = parseWav(
      riff([
        ['fmt ', fmt(1, 2, 44100, 24)],
        ['data', [0, 0, 0x40, 0, 0, 0x80]],
      ]),
    );
    expect(w.channels[0]?.[0]).toBe(0.5);
    expect(w.channels[1]?.[0]).toBe(-1);
  });
  it('reads 32-bit float and skips unknown chunks with odd sizes', () => {
    const f = new DataView(new ArrayBuffer(4));
    f.setFloat32(0, 0.25, true);
    const data = [...new Uint8Array(f.buffer)];
    const w = parseWav(
      riff([
        ['fmt ', fmt(3, 1, 48000, 32)],
        ['LIST', [1, 2, 3]],
        ['data', data],
      ]),
    );
    expect([...(w.channels[0] ?? [])]).toEqual([0.25]);
  });
  it('rejects truncated data, bad alignment and unsupported encodings', () => {
    expect(() =>
      parseWav(
        riff([
          ['fmt ', fmt(1, 1, 48000, 16)],
          ['data', [0, 0], 100],
        ]),
      ),
    ).toThrow(WavError);
    const bad = fmt(1, 1, 48000, 16);
    bad[12] = 4;
    expect(() =>
      parseWav(
        riff([
          ['fmt ', bad],
          ['data', [0, 0]],
        ]),
      ),
    ).toThrow(WavError);
    expect(() =>
      parseWav(
        riff([
          ['fmt ', fmt(2, 1, 48000, 4)],
          ['data', [0, 0]],
        ]),
      ),
    ).toThrow(WavError);
    expect(() => parseWav(Uint8Array.from(ascii('nope nope nope')))).toThrow(WavError);
    expect(() => parseWav(riff([['data', [0, 0]]]))).toThrow(WavError);
  });
  it('round-trips through the encoder', () => {
    const src = Float32Array.from([0, 0.25, -0.5, 0.75, -1]);
    for (const format of ['pcm16', 'pcm24', 'float32'] as const) {
      const back = parseWav(encodeWav({ sampleRate: 48000, channels: [src] }, format));
      src.forEach((v, i) => {
        expect(back.channels[0]?.[i]).toBeCloseTo(v, 4);
      });
    }
  });
});
