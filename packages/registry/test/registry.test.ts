import { describe, expect, it } from 'vitest';
import {
  defaultRegistry,
  noteToMidi,
  parseScale,
  degreeToMidi,
  systemPrompt,
  parseSyllable,
  suggestSyllable,
  normalizeVowel,
} from '../src';

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
    expect(p).toContain('syl(');
    expect(p.split(/\s+/).length).toBeLessThan(260);
  });
});

describe('singing alphabet (TS-45)', () => {
  it('parses onset, vowel and coda with longest match', () => {
    expect(parseSyllable('la')).toEqual({ hold: false, onset: ['l'], vowels: ['a'], coda: [] });
    expect(parseSyllable('lah')?.vowels).toEqual(['ah']);
    expect(parseSyllable('shee')).toEqual({ hold: false, onset: ['sh'], vowels: ['i'], coda: [] });
    expect(parseSyllable('sing')).toEqual({ hold: false, onset: ['s'], vowels: ['i'], coda: ['ng'] });
    expect(parseSyllable('you')?.vowels).toEqual(['oo']);
  });
  it('holds and vowel sequences', () => {
    expect(parseSyllable('_')).toEqual({ hold: true, onset: [], vowels: [], coda: [] });
    expect(parseSyllable('mi_a_u')).toEqual({ hold: false, onset: ['m'], vowels: ['i', 'a', 'u'], coda: [] });
  });
  it('rejects text outside the alphabet', () => {
    for (const bad of ['', 'strong', 'lala', 'a__b', 'xyz', 'é', 'l', 'a'.repeat(17), 'm_la']) {
      expect(parseSyllable(bad)).toBeNull();
    }
  });
  it('suggests a one-edit repair', () => {
    expect(suggestSyllable('lx')).toBe('la');
    expect(normalizeVowel('EE')).toBe('i');
    expect(normalizeVowel('zz')).toBeUndefined();
  });
});
