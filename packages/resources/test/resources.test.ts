import { describe, expect, it } from 'vitest';
import { GENERAL_KIT, createCatalog, resolveSound } from '../src';

describe('resources', () => {
  it('resolves kit names and maps common names to the kit', () => {
    expect(resolveSound('bd').status).toBe('ok');
    expect(resolveSound('808bd')).toEqual({ status: 'fallback', name: '808bd', to: 'bd' });
    expect(resolveSound('rhodes')).toMatchObject({ to: 'triangle' });
    expect(resolveSound('zzq').status).toBe('missing');
  });
  it('disabling fallback reports missing names', () => {
    expect(createCatalog({ fallback: false }).resolve('808bd').status).toBe('missing');
  });
  it('every kit asset carries a license and provenance', () => {
    for (const k of GENERAL_KIT) {
      expect(k.license).toBe('Apache-2.0');
      expect(k.provenance.length).toBeGreaterThan(0);
    }
  });
});
