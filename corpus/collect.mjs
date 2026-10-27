// Collection driver. Adapters live in corpus/adapters.local.mjs, which is git-ignored and
// exports { name, generate(prompt): Promise<string> }[].
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const { adapters } = await import('./adapters.local.mjs');
const samples = Number(process.env.SAMPLES ?? 2);
const date = new Date().toISOString().slice(0, 10);
const prompts = readFileSync(new URL('./prompts/prompts.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

for (const a of adapters) {
  const dir = new URL(`./runs/${date}/${a.name}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const p of prompts) {
    for (let s = 0; s < samples; s++) {
      const output = await a.generate(p.prompt);
      writeFileSync(
        new URL(`${p.id}-${String(s)}.json`, dir),
        JSON.stringify({ model: a.name, date, prompt: p, sample: s, output }, null, 2),
      );
    }
  }
}
