// Clip pitch detection, resampling, retuning, calibration and URL clip loading.
import { describe, expect, it } from 'vitest';
import type { ResourceDecl } from '@tartlet/ir';
import {
  PEAK_TARGET,
  calibrateClip,
  detectPitch,
  encodeWav,
  loadClipFromUrl,
  loadSamples,
  measure,
  midiToHz,
  midiToNoteName,
  resampleWav,
  type WavData,
} from '../src';

const R = { start: { line: 0, col: 0, byte: 0 }, end: { line: 0, col: 0, byte: 0 } };

function makeTone(
  hz: number,
  sampleRate: number,
  seconds: number,
  opts: { amp?: number; dc?: number; leadSeconds?: number; harmonic2?: number } = {},
): WavData {
  const amp = opts.amp ?? 0.6;
  const dc = opts.dc ?? 0;
  const lead = Math.round((opts.leadSeconds ?? 0) * sampleRate);
  const body = Math.round(seconds * sampleRate);
  const h2 = opts.harmonic2 ?? 0;
  const ch = new Float32Array(lead + body);
  for (let i = 0; i < body; i++) {
    const t = i / sampleRate;
    ch[lead + i] = amp * (Math.sin(2 * Math.PI * hz * t) + h2 * Math.sin(4 * Math.PI * hz * t)) + dc;
  }
  return { sampleRate, channels: [ch] };
}

function makeNoisePerc(sampleRate: number, seconds: number): WavData {
  const frames = Math.round(seconds * sampleRate);
  const ch = new Float32Array(frames);
  let s = 0x12345678;
  for (let i = 0; i < frames; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const u = ((s >>> 0) / 0xffffffff) * 2 - 1;
    const env = Math.exp((-i / sampleRate) * 25);
    ch[i] = u * env * 0.8;
  }
  return { sampleRate, channels: [ch] };
}

describe('pitch detection and resampling', () => {
  it('detects fundamental frequency within 2 cents on pitched tones', () => {
    const a4 = detectPitch(makeTone(440, 48000, 0.4));
    expect(a4.hz).not.toBeNull();
    expect(Math.abs((a4.hz ?? 0) - 440)).toBeLessThan(0.5);
    expect(a4.midi).toBe(69);
    expect(Math.abs(a4.cents)).toBeLessThan(2);
    expect(a4.clarity).toBeGreaterThan(0.95);

    const sharpE4 = detectPitch(makeTone(334.5, 22050, 0.4, { harmonic2: 0.35 }));
    expect(sharpE4.hz).not.toBeNull();
    expect(Math.abs((sharpE4.hz ?? 0) - 334.5)).toBeLessThan(0.8);
    expect(sharpE4.midi).toBe(64); // E4 = 329.63 Hz
    expect(sharpE4.cents).toBeGreaterThan(20);
    expect(midiToNoteName(64)).toBe('E4');
    expect(midiToNoteName(60)).toBe('C4');
  });

  it('classifies noise percussion as unpitched', () => {
    const perc = detectPitch(makeNoisePerc(44100, 0.25));
    expect(perc.hz).toBeNull();
    expect(perc.midi).toBeNull();
  });

  it('resamples across sample rates while preserving frequency and duration', () => {
    const lowSr = makeTone(330, 22050, 0.5);
    const up = resampleWav(lowSr, 48000, 1);
    expect(up.sampleRate).toBe(48000);
    expect(Math.abs((up.channels[0]?.length ?? 0) / 48000 - 0.5)).toBeLessThan(0.002);
    const pUp = detectPitch(up);
    expect(Math.abs((pUp.hz ?? 0) - 330)).toBeLessThan(0.8);

    const hiSr = makeTone(440, 96000, 0.4);
    const down = resampleWav(hiSr, 44100, 1);
    expect(down.sampleRate).toBe(44100);
    const pDown = detectPitch(down);
    expect(Math.abs((pDown.hz ?? 0) - 440)).toBeLessThan(0.8);
  });
});

describe('clip calibration (resample + retune)', () => {
  it('normalises, resamples and retunes a sharp low-rate clip to exact concert pitch', () => {
    // 22050 Hz, quiet, DC-offset, 20 ms leading silence, 448 Hz (A4 + 31.2 cents)
    const raw = makeTone(448, 22050, 0.5, { amp: 0.25, dc: 0.08, leadSeconds: 0.02, harmonic2: 0.25 });
    const cal = calibrateClip(raw, { targetSampleRate: 48000 });

    expect(cal.calibration.sourceSampleRate).toBe(22050);
    expect(cal.calibration.sampleRate).toBe(48000);
    expect(cal.calibration.kind).toBe('note');
    expect(cal.calibration.root).toBe(69); // A4
    expect(cal.calibration.retuneCents).toBeLessThan(-25);
    expect(cal.calibration.retuneCents).toBeGreaterThan(-38);

    const m = measure(cal.wav);
    expect(m.peak).toBeCloseTo(PEAK_TARGET, 1);
    expect(m.dc).toBeLessThan(1e-3);
    expect(m.leadIn).toBeLessThan(0.002);

    // Re-measuring the calibrated waveform confirms it is tuned to concert A4 = 440 Hz.
    const after = detectPitch(cal.wav);
    expect(after.hz).not.toBeNull();
    expect(Math.abs((after.hz ?? 0) - 440)).toBeLessThan(1.0);
    expect(after.midi).toBe(69);
    expect(Math.abs(after.cents)).toBeLessThan(3);
  });

  it('retunes to an explicit targetRoot when requested', () => {
    const raw = makeTone(330, 44100, 0.5); // ~E4
    const cal = calibrateClip(raw, { targetSampleRate: 48000, targetRoot: 60 }); // C4 = 261.63 Hz
    expect(cal.calibration.root).toBe(60);
    const after = detectPitch(cal.wav);
    expect(Math.abs((after.hz ?? 0) - midiToHz(60))).toBeLessThan(1.0);
  });

  it('resamples unpitched clips as impulses without inventing a pitch', () => {
    const raw = makeNoisePerc(22050, 0.2);
    const cal = calibrateClip(raw, { targetSampleRate: 48000 });
    expect(cal.calibration.kind).toBe('impulse');
    expect(cal.calibration.detectedHz).toBeNull();
    expect(cal.calibration.root).toBeNull();
    expect(cal.calibration.retuneCents).toBe(0);
    expect(cal.wav.sampleRate).toBe(48000);
  });

  it('is deterministic across repeated calibrations', () => {
    const raw = makeTone(257, 32000, 0.35, { amp: 0.4, dc: -0.05 });
    const a = encodeWav(calibrateClip(raw, { targetSampleRate: 48000 }).wav);
    const b = encodeWav(calibrateClip(raw, { targetSampleRate: 48000 }).wav);
    expect(a).toEqual(b);
  });
});

describe('URL clip loading', () => {
  it('loads, resamples and retunes a WAV clip via loadClipFromUrl and loadSamples', async () => {
    const wavBytes = encodeWav(makeTone(257, 22050, 0.4, { amp: 0.5 })).slice().buffer;
    const url = 'https://example.com/clips/flat-c4.wav';
    const fetchBytes = (u: string) => Promise.resolve(u === url ? wavBytes : null);

    const direct = await loadClipFromUrl('pluck', url, { fetchBytes, targetSampleRate: 48000 });
    expect(direct.kind).toBe('note');
    expect(direct.calibration?.sampleRate).toBe(48000);
    expect(direct.calibration?.sourceSampleRate).toBe(22050);
    expect(direct.calibration?.root).toBe(60); // C4 = 261.63 Hz
    expect(direct.calibration?.retuneCents ?? 0).toBeGreaterThan(20);

    const resources: ResourceDecl[] = [
      { kind: 'clip', name: 'pluck', spec: url, range: R },
      { kind: 'clip', name: 'missingClip', spec: 'https://example.com/missing.wav', range: R },
    ];
    const { library, diagnostics } = await loadSamples(resources, () => Promise.resolve(null), {
      fetchUrl: fetchBytes,
      targetSampleRate: 48000,
    });
    expect(library.get('pluck')?.calibration?.root).toBe(60);
    expect(library.get('missingClip')).toBeUndefined();
    expect(diagnostics.map((d) => d.id)).toEqual(['W-RES-MISSING']);
  });

  it('supports decodeAudio fallback for non-WAV bytes', async () => {
    const fakeOgg = new TextEncoder().encode('OggS-not-a-wav').buffer;
    const entry = await loadClipFromUrl('pad', 'https://example.com/pad.ogg', {
      fetchBytes: () => Promise.resolve(fakeOgg),
      decodeAudio: () => Promise.resolve(makeTone(442, 44100, 0.4)),
      targetSampleRate: 48000,
    });
    expect(entry.kind).toBe('note');
    expect(entry.calibration?.root).toBe(69);
    expect(entry.calibration?.sampleRate).toBe(48000);
  });
});
