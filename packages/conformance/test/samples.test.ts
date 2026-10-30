// Host samples: the round-robin seed decided in core (TS-93). Expectations are hand-written.
import { describe, expect, it } from 'vitest';
import { rat } from '@tartlet/time';
import { runSource } from '../src/run';

const cyc = { begin: rat(0), end: rat(1) };

describe('sample seeds (TS-93)', () => {
  it('appear only when a document declares samples', () => {
    const evs = runSource('sample("kick", "./kick.wav")\n$: s("kick*2")', cyc);
    expect(evs).toHaveLength(2);
    for (const e of evs) expect(typeof e.value.rseed).toBe('number');
    expect(evs[0]?.value.rseed).not.toBe(evs[1]?.value.rseed);
    expect(runSource('$: s("bd")', cyc)[0]?.value).not.toHaveProperty('rseed');
  });
  it('are stable when a method is appended', () => {
    const a = runSource('samples("./keys/")\n$: note("c4 e4").s("rhodes")', cyc).map((e) => e.value.rseed);
    const b = runSource('samples("./keys/")\n$: note("c4 e4").s("rhodes").gain(.8)', cyc).map((e) => e.value.rseed);
    expect(b).toEqual(a);
  });
});
