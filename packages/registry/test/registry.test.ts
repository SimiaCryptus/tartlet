import { describe, expect, it } from 'vitest';
import { defaultRegistry, noteToMidi, parseScale, degreeToMidi, systemPrompt } from '../src';

describe('registry', () => {
  it('resolves aliases and compatibility aliases', () => {
    expect(defaultRegistry.lookup('sound')?.entry.id).toBe('s');
    expect(defaultRegistry.lookup('reverb')?.via).toBe('compat');
  });
  it('never resolves prototype names (Z-07)', () => {
    for (const n of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
      expect(defaultRegistry.lookup(n)).toBeUndefined();
    }
  });
  it('suggests room for romm', () => {
    expect(defaultRegistry.suggest('romm')?.name).toBe('room');
  });
  it('M-26 note names', () => {
    expect(['c3', 'eb3', 'f#4', 'bb2'].map(noteToMidi)).toEqual([48, 51, 66, 46]);
  });
  it('scales (TS-11)', () => {
    const s = parseScale('C:minor')!;
    expect([0, 2, 4, 7].map((d) => degreeToMidi(d, s))).toEqual([48, 51, 55, 60]);
  });
  it('resolves T1 transforms and aliases', () => {
    expect(defaultRegistry.lookup('firstOf')?.entry.id).toBe('every');
    expect(defaultRegistry.lookup('degradeBy')?.entry.deterministic).toBe('seeded');
  });
  it('system prompt stays short (idea.md §10.3)', () => {
    const p = systemPrompt();
    expect(p).toContain('degradeBy');
    expect(p.split(/\s+/).length).toBeLessThan(220);
  });
});
