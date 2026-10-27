// R and X rows for the checker (idea.md §12.4).
import { describe, expect, it } from 'vitest';
import { check, repairPayload } from '../src';

const opts = { documentId: 'd', blobIndex: '0' };
const ids = (src: string) => check(src, opts).diagnostics.map((d) => d.id);

describe('rejection rows', () => {
  it('Z-01 import is rejected; other outputs survive', () => {
    const r = check('import x from "y"\n$: s("bd")', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['E-LX-IMPORT']);
    expect(r.program.outputs.map((o) => o.status)).toEqual(['ok']);
    expect(ids('import x from "y"')).toEqual(['E-LX-IMPORT', 'E-PROGRAM-EMPTY']);
  });
  it('Z-02 host access', () => {
    expect(ids('window.location')).toContain('E-LX-HOST');
    expect(ids('fetch("https://example.com")')).toContain('E-LX-HOST');
    expect(ids('$: s("a").gain(window.x)')).toContain('E-LX-HOST');
  });
  it('Z-03 computed member', () => {
    expect(ids('note("c")["constructor"]')).toContain('E-LX-MEMBER');
  });
  it('Z-05 loops and conditionals', () => {
    expect(ids('for (let i = 0; i < 4; i++) {}')).toContain('E-LX-CONTROL');
    expect(ids('if (x) { s("a") }')).toContain('E-LX-CONTROL');
  });
  it('Z-06 lambda escapes', () => {
    expect(ids('$: s("a").every(2, x => fetch(x))')).toContain('E-LX-LAMBDA');
    expect(ids('$: s("a").every(2, x => { y(); return x; })')).toContain('E-LX-LAMBDA');
  });
  it('Z-07 prototype names', () => {
    expect(ids('$: __proto__')).toContain('E-LX-PROTO');
    expect(ids('$: s("a").constructor(1)')).toContain('E-LX-PROTO');
    expect(ids('const __proto__ = s("a")')).toContain('E-LX-PROTO');
  });
  it('Z-08 pathological size', () => {
    expect(ids('s("a*1e9")')).toContain('E-LIMIT-MULTIPLIER');
    expect(ids('x'.repeat(70000))).toEqual(['E-LIMIT-SOURCE']);
    expect(ids('('.repeat(5000) + '1' + ')'.repeat(5000))).toContain('E-LIMIT-DEPTH');
    expect(ids('s("' + '['.repeat(20000) + 'a")')).toContain('E-LIMIT-DEPTH');
  });
  it('spreads only over array literals', () => {
    expect(ids('const a = s("a")\n$: stack(...a)')).toContain('E-LX-SPREAD');
  });
});

describe('diagnostic rows', () => {
  it('Q-02 unknown transform mutes the subtree', () => {
    const r = check('$: s("bd").wobble(2)', opts);
    expect(r.diagnostics[0]?.id).toBe('E-REG-UNKNOWN');
    expect(r.program.outputs[0]?.status).toBe('muted-error');
  });
  it('Q-04 undefined binding, once per reference', () => {
    expect(ids('stack(drums, bass)')).toEqual(['E-NAME-UNDEF', 'E-NAME-UNDEF', 'E-PROGRAM-EMPTY']);
  });
  it('Q-06 out-of-range constants warn and keep the authored value', () => {
    const r = check('$: s("bd").gain(40)', opts);
    expect(r.diagnostics.map((d) => d.id)).toEqual(['W-RANGE']);
    expect(r.program.outputs[0]?.status).toBe('ok');
  });
  it('missing function arguments', () => {
    expect(ids('$: s("a").every(2, fast)')).toContain('E-ARG-MISSING');
  });
  it('§10.3 repair payload is scoped to the broken track', () => {
    const r = check('$: s("bd*4")\n$: s("bd").wobble(2)\n$: s("hh").romm(.3)', opts);
    const p = repairPayload(r);
    expect(p).toContain('tartlet: 1 issue to fix (1 cosmetic note not shown)');
    expect(p).toContain('E-REG-UNKNOWN  track "$1", line 2:');
    expect(p).toContain('s("bd").wobble(2)');
    expect(p).toContain('Rewrite ONLY the track on line 2');
    expect(repairPayload(r, { includeBenign: true })).toContain('W-REG-UNKNOWN');
  });
});
