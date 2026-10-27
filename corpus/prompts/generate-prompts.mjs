// Deterministically writes ≥500 original prompts covering genre × mood × task.
import { writeFileSync } from 'node:fs';

const genres = [
  'techno',
  'house',
  'ambient',
  'drum and bass',
  'lo-fi hip hop',
  'synthwave',
  'dub',
  'jazz-inflected groove',
  'minimal',
  'breakbeat',
  'chiptune',
  'downtempo',
  'afrobeat-inspired rhythm',
  'trap',
  'folk-like arpeggio piece',
  'electro',
  'garage',
  'drone',
  'bossa-flavoured loop',
  'industrial',
];
const moods = ['moody', 'bright', 'tense', 'dreamy', 'playful'];
const tasks = [
  (g, m) => `Write a ${m} ${g} track in Strudel.`,
  (g, m) => `Make a short ${m} ${g} loop with drums and a bassline.`,
  (g, m) => `Compose a ${m} ${g} piece in D minor with a slow pad.`,
  (g, m) => `Here is my idea: a ${m} ${g} beat. Add a melody that answers the drums.`,
  (g, m) => `Create a ${m} ${g} pattern at around 120 BPM and make the second half sparser.`,
  (g, m) => `Give me a minimal ${m} ${g} sketch using only a few lines of Strudel.`,
];

const lines = [];
let id = 0;
for (const g of genres) {
  for (const m of moods) {
    for (const t of tasks) {
      lines.push(JSON.stringify({ id: `p${String(++id).padStart(4, '0')}`, genre: g, mood: m, prompt: t(g, m) }));
    }
  }
}
writeFileSync(new URL('./prompts.jsonl', import.meta.url), lines.join('\n') + '\n');
console.log(`wrote ${String(lines.length)} prompts`);
