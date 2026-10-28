// Every playground preset must check cleanly and play on every track (idea.md §11.4).
import { describe, expect, it } from 'vitest';
import { check, locator } from '@tartlet/check';
import { compile, sanity } from '@tartlet/core';
import { createCatalog } from '@tartlet/resources';
import { PRESETS } from '../../../apps/playground/src/presets';

const catalog = createCatalog();
const opts = { documentId: 'playground', blobIndex: 'example' };

describe('playground presets', () => {
  it('have unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
  for (const p of PRESETS) {
    it(`${p.id} checks cleanly and every track plays`, () => {
      const r = check(p.source, { ...opts, catalog });
      expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
      expect(r.program.outputs.map((o) => o.status).filter((s) => s !== 'ok')).toEqual([]);
      const report = sanity(compile(r.program, { locate: locator(p.source), ...opts }));
      expect(report.silentOutputs).toEqual([]);
      expect(report.mutedOutputs).toEqual([]);
      expect(report.ok).toBe(true);
    });
  }
});
