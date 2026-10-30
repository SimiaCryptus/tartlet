import { describe, expect, it } from 'vitest';
import { parseStem } from '../src/samples';

describe('sample import guesses (TS-94)', () => {
  it('reads name, root and layer from file names', () => {
    expect(parseStem('Rhodes_C3_v2')).toEqual({ name: 'rhodes', root: 48, layer: 2 });
    expect(parseStem('rhodes_c#4')).toEqual({ name: 'rhodes', root: 61, layer: 0 });
    expect(parseStem('kick')).toEqual({ name: 'kick', layer: 0 });
    expect(parseStem('808 kick')).toEqual({ name: 'kick', layer: 0 });
  });
});
