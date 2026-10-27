import { describe, expect, it } from 'vitest';
import { classify, extractCode, summarise } from '../src/corpus';

describe('corpus classification', () => {
  it('buckets programs', () => {
    expect(classify('$: s("bd*4")').bucket).toBe('clean');
    expect(classify('$: s("bd").romm(.4)').bucket).toBe('degraded');
    expect(classify('$: s("bd")\n$: s("a").wobble(1)').bucket).toBe('partial');
    expect(classify('import x from "y"').bucket).toBe('rejected');
  });
  it('Q-09 a clean program that plays nothing counts as partial', () => {
    const c = classify('$: s("~ ~")');
    expect(c.diagnostics).toEqual([]);
    expect(c.sanity.silentOutputs).toEqual(['$0']);
    expect(c.bucket).toBe('partial');
  });
  it('extracts the longest code block and ranks misses', () => {
    expect(extractCode('Here:\n```js\ns("bd")\n```\nand\n```\nx\n```')).toBe('s("bd")\n');
    const s = summarise([classify('$: s("a").wobble(1)\n$: s("b")'), classify('$: s("c").wobble(2)\n$: s("d")')]);
    expect(s.buckets.partial).toBe(2);
    expect(s.ranking[0]?.[0]).toMatch(/^E-REG-UNKNOWN wobble/);
  });
});
