// Creates a clean-room log entry from the template (idea.md §4, rule 5).
// Usage: node scripts/log-session.mjs "<model and version>" "<task>" "<inputs, comma-separated>"
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const [model = '', task = '', inputs = ''] = process.argv.slice(2);
if (!model || !task) {
  console.error('usage: log-session "<model and version>" "<task>" "<inputs>"');
  process.exit(1);
}
const n = readdirSync('clean-room-log').filter((f) => /^\d{4}-/.test(f)).length + 1;
const id = String(n).padStart(4, '0');
const slug = task
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .slice(0, 40);
const file = `clean-room-log/${id}-${slug}.md`;
const body = readFileSync('clean-room-log/TEMPLATE.md', 'utf8')
  .replaceAll('{{n}}', id)
  .replaceAll('{{date}}', new Date().toISOString().slice(0, 10))
  .replaceAll('{{model}}', model)
  .replaceAll('{{task}}', task)
  .replace(
    '{{inputs}}',
    inputs
      .split(',')
      .map((s) => `  - ${s.trim()}`)
      .join('\n'),
  );
writeFileSync(file, body);
console.log(`created ${file}`);
