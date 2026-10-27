import { describe, expect, it } from 'vitest';
import { runFixture, type Fixture } from '../src/run';

const fixtures = import.meta.glob<Fixture>('../fixtures/*.json', { eager: true, import: 'default' });

describe('conformance fixtures', () => {
  for (const [path, f] of Object.entries(fixtures)) {
    it(`${f.id} (${path})`, () => {
      const { actual, expected } = runFixture(f);
      expect(actual).toEqual(expected);
    });
  }
});
