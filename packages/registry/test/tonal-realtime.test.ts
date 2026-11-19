import { describe, expect, it } from 'vitest';
import { defaultRegistry, systemPrompt } from '../src/registry.js';
import { SCALES, freqToMidi, midiToFreq, parseScale, quantizeMidi } from '../src/tonal.js';

describe('midiToFreq and freqToMidi', () => {
  it('maps A4 (MIDI 69) to 440 Hz and back', () => {
    expect(midiToFreq(69)).toBe(440);
    expect(freqToMidi(440)).toBe(69);
  });

  it('doubles or halves frequency per octave across the MIDI range', () => {
    const octaveAs: ReadonlyArray<readonly [number, number]> = [
      [21, 27.5],
      [33, 55],
      [45, 110],
      [57, 220],
      [69, 440],
      [81, 880],
      [93, 1760],
      [105, 3520],
      [117, 7040],
    ];

    for (const [midi, hz] of octaveAs) {
      expect(midiToFreq(midi)).toBeCloseTo(hz, 10);
      expect(freqToMidi(hz)).toBeCloseTo(midi, 10);
    }

    // Middle C (C4 = MIDI 60)
    expect(midiToFreq(60)).toBeCloseTo(261.6255653005986, 10);
    expect(freqToMidi(midiToFreq(60))).toBeCloseTo(60, 10);
  });

  it('round-trips across octaves, negative MIDI notes, and fractional pitches', () => {
    for (let midi = -24; midi <= 140; midi += 0.25) {
      const freq = midiToFreq(midi);
      expect(freq).toBeGreaterThan(0);
      expect(freqToMidi(freq)).toBeCloseTo(midi, 10);
    }

    for (const freq of [16.35, 32.7, 130.81, 311.13, 1000, 4186.01, 12500]) {
      expect(midiToFreq(freqToMidi(freq))).toBeCloseTo(freq, 9);
    }
  });
});

describe('quantizeMidi', () => {
  it('quantizes positive, negative, and fractional MIDI inputs in C:major', () => {
    const cMajor = parseScale('C:major');
    expect(cMajor).not.toBeNull();
    if (!cMajor) return;

    // Exact scale degrees remain unchanged across octaves (C:major root is C3 = 48).
    for (const pitch of [0, 12, 48, 50, 52, 53, 55, 57, 59, 60, 72, 84]) {
      expect(quantizeMidi(pitch, cMajor)).toBe(pitch);
    }

    // Fractional pitches snap to nearest C major tone.
    expect(quantizeMidi(60.4, cMajor)).toBe(60);
    expect(quantizeMidi(61.2, cMajor)).toBe(62);
    expect(quantizeMidi(64.4, cMajor)).toBe(64);
    expect(quantizeMidi(64.6, cMajor)).toBe(65);
    expect(quantizeMidi(70.7, cMajor)).toBe(71);

    // Chromatic tie (equidistant between two scale tones) picks the earlier interval in the scale.
    expect(quantizeMidi(61, cMajor)).toBe(60);
    expect(quantizeMidi(63, cMajor)).toBe(62);

    // Negative MIDI values (e.g. -12 is C-2, -10 is D-2).
    expect(quantizeMidi(-12, cMajor)).toBe(-12);
    expect(quantizeMidi(-11.6, cMajor)).toBe(-12);
    expect(quantizeMidi(-10.8, cMajor)).toBe(-10);
  });

  it('quantizes positive, negative, and fractional MIDI inputs in D:minor', () => {
    const dMinor = parseScale('D:minor');
    expect(dMinor).not.toBeNull();
    if (!dMinor) return;

    // D minor (root D3 = 50): D, E, F, G, A, Bb, C -> ..., 50, 52, 53, 55, 57, 58, 60, 62
    for (const pitch of [50, 52, 53, 55, 57, 58, 60, 62]) {
      expect(quantizeMidi(pitch, dMinor)).toBe(pitch);
    }

    expect(quantizeMidi(51.4, dMinor)).toBe(52);
    expect(quantizeMidi(58.4, dMinor)).toBe(58);
    expect(quantizeMidi(59.3, dMinor)).toBe(60);
    // 59 is equidistant from 58 (interval 8) and 60 (interval 10); interval 8 is checked first.
    expect(quantizeMidi(59, dMinor)).toBe(58);

    // Negative MIDI values: 50 - 60 = -10 (D-2), 53 - 60 = -7 (F-2), 58 - 60 = -2 (Bb-2).
    expect(quantizeMidi(-10, dMinor)).toBe(-10);
    expect(quantizeMidi(-9.4, dMinor)).toBe(-10);
    expect(quantizeMidi(-7.3, dMinor)).toBe(-7);
    expect(quantizeMidi(-2.4, dMinor)).toBe(-2);
  });

  it('quantizes positive, negative, and fractional MIDI inputs in C4:minor pentatonic', () => {
    const c4MinPent = parseScale('C4:minor pentatonic');
    expect(c4MinPent).not.toBeNull();
    if (!c4MinPent) return;

    // C4 minor pentatonic: C4=60, Eb4=63, F4=65, G4=67, Bb4=70
    expect(quantizeMidi(60, c4MinPent)).toBe(60);
    expect(quantizeMidi(61, c4MinPent)).toBe(60);
    expect(quantizeMidi(62, c4MinPent)).toBe(63);
    expect(quantizeMidi(64.2, c4MinPent)).toBe(65);
    expect(quantizeMidi(68.4, c4MinPent)).toBe(67);
    expect(quantizeMidi(68.6, c4MinPent)).toBe(70);

    // Negative MIDI values: 60 - 60 = 0 (C-1), 70 - 72 = -2 (Bb-2), 67 - 72 = -5 (G-2).
    expect(quantizeMidi(-2, c4MinPent)).toBe(-2);
    expect(quantizeMidi(-3.6, c4MinPent)).toBe(-5);
    expect(quantizeMidi(-0.4, c4MinPent)).toBe(0);
  });

  it('always produces a pitch class present in the target scale across SCALES', () => {
    const scaleSpecs = ['C:chromatic', 'F#:whole tone', 'A:blues', 'E:hirajoshi', 'G:lydian dominant', 'Bb:phrygian'];

    for (const spec of scaleSpecs) {
      const scale = parseScale(spec);
      expect(scale).not.toBeNull();
      if (!scale) continue;

      const allowedClasses = new Set(scale.intervals.map((i) => (((scale.root + i) % 12) + 12) % 12));
      for (let midi = -24.5; midi <= 108.5; midi += 0.35) {
        const q = quantizeMidi(midi, scale);
        const pc = ((q % 12) + 12) % 12;
        expect(allowedClasses.has(pc)).toBe(true);
      }
    }

    expect(SCALES.size).toBeGreaterThanOrEqual(20);
  });

  it('returns the input unchanged for empty scales or non-finite MIDI values', () => {
    const cMajor = parseScale('C:major')!;
    expect(quantizeMidi(61.5, { root: 60, intervals: [] })).toBe(61.5);
    expect(Number.isNaN(quantizeMidi(Number.NaN, cMajor))).toBe(true);
    expect(quantizeMidi(Number.POSITIVE_INFINITY, cMajor)).toBe(Number.POSITIVE_INFINITY);
    expect(quantizeMidi(Number.NEGATIVE_INFINITY, cMajor)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('registry param entry', () => {
  it('resolves param canonically with the expected signal signature', () => {
    const lookup = defaultRegistry.lookup('param');
    expect(lookup).toBeDefined();
    expect(lookup?.via).toBe('canonical');
    expect(lookup?.typed).toBe('param');

    const entry = lookup?.entry;
    expect(entry).toBeDefined();
    expect(defaultRegistry.get('param')).toBe(entry);
    expect(entry).toMatchObject({
      id: 'param',
      names: ['param'],
      form: 'constructor',
      returns: { kind: 'signal', of: 'number' },
      level: 'L2',
      deterministic: 'pure',
      since: '0.17.0',
      category: 'signal',
    });

    expect(entry?.params).toEqual([
      { name: 'name', type: 'string', patternable: false },
      { name: 'fallback', type: 'number', patternable: false, optional: true },
      { name: 'min', type: 'number', patternable: false, optional: true },
      { name: 'max', type: 'number', patternable: false, optional: true },
    ]);
  });

  it('includes L2 signal param in the generated system prompt', () => {
    const prompt = systemPrompt(defaultRegistry);
    expect(prompt).toContain('Signals:');
    expect(prompt).toMatch(/Signals:.*\bparam\b/);
  });
});
