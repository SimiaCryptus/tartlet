// Optional AI assistant: generates and edits sketches through a Cognotik API proxy.
// Loaded lazily by main.ts the first time the assistant window is shown (see the panelshow event).

import {
  CognotikClient,
  CognotikError,
  Conversation,
  DEFAULT_URL,
  UsageTracker,
  buildRequest,
  chooseDefaultModel,
  extractText,
  isTextModel,
  providerName,
  textPart,
  type ChatModel,
} from './cognotik-client.mjs';
import {
  AMBIENCE_SOUNDS,
  CREATURE_SOUNDS,
  DRUM_SOUNDS,
  FOLEY_SOUNDS,
  NOISE_SOUNDS,
  OSCILLATOR_SOUNDS,
  SCALES,
  SPACE_NAMES,
  VOCAL_SOUNDS,
  VOWELS,
  defaultRegistry,
  type Category,
} from '@tartlet/registry';
import { PRESETS, type Preset } from './presets';

export interface Problem {
  readonly severity: string;
  readonly text: string;
}
/** A sketch the recombinant agent can use as a second parent. */
export interface PoolSketch {
  readonly id: string;
  readonly name: string;
  readonly source: string;
}

export interface AssistantHost {
  getSource(): string;
  /** Replaces the editor contents, applies them and resolves with the resulting problems. */
  setSource(source: string, title?: string): Promise<Problem[]>;
  /** Current errors and warnings reported by the player. */
  problems(): Problem[];
  flash(msg: string): void;
  /** Sketches available as partners for recombination (usually the album catalog). */
  pool(): readonly PoolSketch[];
}

type Kind = 'generate' | 'edit' | 'fix';
/** Population agents: vary mutates the current sketch, recombine crosses it with another. */
type Breed = 'vary' | 'recombine';

const MAX_REPAIRS = 1;
const MAX_CANDIDATES = 4;
const BREED_TEMPERATURE = 0.9;
const SETTINGS_KEY = 'tartlet.assistant.v1';
const API_KEY_KEY = 'tartlet.assistant.apiKey';

// ---- prompts

const EXAMPLES = ['groove', 'layers', 'functions', 'library']
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter((p): p is Preset => p !== undefined);

const FENCE = '```';

/** Names of one registry category, canonical name first with aliases joined by "/". */
function vocabulary(...categories: Category[]): string {
  return [...defaultRegistry.entries()]
    .filter((e) => categories.includes(e.category))
    .map((e) => e.names.join('/'))
    .join(' ');
}

const words = (xs: readonly string[]): string => xs.join(' ');

const SYSTEM_PROMPT = `You write music sketches for Tartlet, a deterministic runtime for a safe subset of Strudel-style code. Tartlet never runs JavaScript: it parses a small, closed language and reports anything outside it as an error, muting only the broken track.

Program shape:
- First line: the tempo. setcpm(bpm/4) makes one cycle a 4/4 bar; setcps(x) sets cycles per second.
- "$: <pattern>" plays a track; "name: <pattern>" plays a named track (names must be unique).
- One statement per line. A method chain may continue on following lines that start with ".".
- const name = <pattern> binds a pattern for reuse; declare it before use. Constant arithmetic (1/8, 2 * 2) is exact.
- const f = (x, n = 2) => x.ply(n).gain(.7) defines a function. Use it as a method (pat.f(3)), as a function value (.every(4, f(3)), extra arguments follow the pattern), through .apply(f, 3), or as a builder when it takes no pattern (const beat = k => s("bd").euclid(k, 8), then beat(3)). Defaults must be constants. Call a function parameter with x.apply(g), never g(x).
- Binding and function names must not reuse built-in names (fast, swing, run, chunk, echo, ...).
- // and /* */ comments are fine.

Mini-notation, inside strings:
- "a b c" splits the cycle evenly; ~ is a rest; [a b] squeezes a group into one step; <a b> takes one item per cycle; "a, b" layers.
- a*2 and a/2 change speed (the factor may be a pattern, a*<2 3>); a!3 repeats a step; a@2 gives it more weight.
- a? or a?0.3 drops at random (seeded); a(3,8) or a(3,8,2) is a Euclidean rhythm; {a b c, d e} is a polymeter and {a b c}%4 sets steps per cycle.
- a | b picks one option per cycle; a lone . splits the cycle into equal groups; bd:2 picks a variant.
- Notes: c d e f g a b with # or b and an octave (c3 = MIDI 48; a bare letter is octave 3). Numbers also work.

Starting a pattern: s("bd sd") or sound(...), note("c3 e3"), n("0 2 4").scale("D:minor"), freq("220 330"), any other control, stack(a, b), cat(a, b) (one per cycle), seq(a, b) (all in one cycle), run(8) (0..7), silence.
Signals give values from 0 to 1 sampled at each note: ${vocabulary('signal')}. Shape them with .range(lo, hi), .slow(n), .segment(n); irand(n) gives whole numbers below n. Example: .lpf(sine.range(300, 2000).slow(4)).

Vocabulary (generated from Tartlet's registry; nothing else exists):
- Controls: ${vocabulary('control')}.
- Transforms: ${vocabulary('transform', 'tonal')}.
- Combinators: ${vocabulary('combinator')}.
- Scales (as "Root:name"): ${[...SCALES.keys()].join(', ')}.

Sounds:
- Drums: ${words(DRUM_SOUNDS)}. Synths: ${words(OSCILLATOR_SOUNDS)}. Noise: ${words(NOISE_SOUNDS)}.
- Voices: ${words(VOCAL_SOUNDS)}. .syl("la li [lu _]") sings phonetic syllables: up to two consonants, then a vowel from ${words(VOWELS)} (ee also works); "_" holds the previous vowel.
- Ambiences (use long notes, e.g. .slow(4), with .intensity and .density): ${words(AMBIENCE_SOUNDS)}. Foley one-shots: ${words(FOLEY_SOUNDS)}. Creatures and machines: ${words(CREATURE_SOUNDS)}.
- Reverb characters for .space(): ${words(SPACE_NAMES)}; .room sets the amount and .size the length.
- Other names (piano, 808bd, rhodes, ...) fall back to the nearest kit sound with a note.

Rules that often trip models:
- These arguments must be plain constant numbers, not strings or patterns: every(n, f), lastOf(n, f), sometimesBy(p, f), euclid(k, n, r), iter(n), chunk(n, f), shuffle(n), segment(n), range(lo, hi), within(b, e, f), echo(times, time, feedback).
- A function argument is a transform name (rev), a partial application (fast(2)), or a one-parameter lambda that starts from its parameter (x => x.add(7)). A block body may only be { return ...; }.
- .scale, .transpose and .octave need pitched events (note, n or freq), never drums.
- Not allowed: loops, if, ternaries, import, new, function, class, var, a[b], object literals, template interpolation, member chains like .add.squeeze, window, fetch or any other host API.
- Keep gain at or below 1 (0.3 to 0.6 for dense layers). Constants outside a control's range are clamped with a warning.
- Steady pulsing between 3 and 30 Hz (binaural, isochronic, irate) triggers a safety warning before playback; use it only when asked. Headphone controls (binaural, azimuth, itd, iphase, icorr, ...) only work on headphones.

Rules for your reply:
- Reply with the complete sketch in a single ${FENCE}tartlet code block, followed by at most one short sentence.
- Keep it musical and concise: usually 2 to 6 tracks. Prefer named tracks (drums:, bass:, lead:) for clarity.
- When editing, keep everything the user did not ask to change.
- When fixing, change only what the reported problems point at.

Examples:
${EXAMPLES.map((p) => `${p.name}: ${p.blurb}\n${FENCE}tartlet\n${p.source.trim()}\n${FENCE}`).join('\n\n')}`;

function listProblems(problems: readonly Problem[]): string {
  return problems.map((p) => `- ${p.text}`).join('\n');
}

function fenced(source: string): string {
  return `${FENCE}tartlet\n${source.trim()}\n${FENCE}`;
}

function userMessage(kind: Kind, prompt: string, source: string, problems: readonly Problem[]): string {
  switch (kind) {
    case 'generate':
      return `Write a new sketch: ${prompt}`;
    case 'edit':
      return `Current sketch:\n${fenced(source)}\n\nChange it: ${prompt}`;
    case 'fix':
      return (
        `Current sketch:\n${fenced(source)}\n\nTartlet reported these problems:\n${listProblems(problems)}\n\n` +
        `Fix them while keeping the musical idea.${prompt ? ` Also: ${prompt}` : ''}`
      );
  }
}

function repairMessage(problems: readonly Problem[]): string {
  return (
    `Tartlet rejected that sketch:\n${listProblems(problems)}\n\n` +
    'Return the corrected complete sketch. Change only the lines the problems point at and keep every working track unchanged.'
  );
}
// ---- population agents (variation and recombination)
interface Strategy {
  readonly name: string;
  readonly hint: string;
}
const MUTATIONS: readonly [Strategy, ...Strategy[]] = [
  { name: 'rhythm', hint: 'the rhythm: drum patterns, syncopation, Euclidean hits or swing' },
  { name: 'harmony', hint: 'the harmony: chord progression, voicings, scale or key, keeping the mood' },
  { name: 'melody', hint: 'the melody: rewrite, ornament or answer the lead line' },
  { name: 'timbre', hint: 'the sound: synths, envelopes, filters, effects and space' },
  { name: 'form', hint: 'the form: development across cycles with every, lastOf, within, chunk or mask' },
  { name: 'texture', hint: 'the texture: thin the arrangement out or add one new layer' },
];
const CROSSOVERS: readonly [Strategy, ...Strategy[]] = [
  { name: 'A drums × B tune', hint: 'the rhythm section of parent A with the harmony and melody of parent B' },
  { name: 'B drums × A tune', hint: 'the rhythm section of parent B with the harmony and melody of parent A' },
  { name: 'interleave', hint: 'tracks alternately from A and B, in the tempo and key of A' },
  { name: 'reharmonise', hint: 'the ideas of B transposed and adapted into the tempo, key and sound world of A' },
];
interface Brief {
  readonly label: string;
  readonly title: string | undefined;
  readonly message: string;
}
interface Candidate {
  readonly label: string;
  readonly source: string;
  readonly title: string | undefined;
  problems: Problem[];
}
const plural = (n: number, w: string): string => `${String(n)} ${w}${n === 1 ? '' : 's'}`;
function variationMessage(source: string, s: Strategy, prompt: string, index: number, total: number): string {
  return (
    `Current sketch:\n${fenced(source)}\n\n` +
    `Write variation ${String(index)} of ${String(total)}. Mutate mainly ${s.hint}; keep the rest close to the original.` +
    (prompt ? ` Direction from the user: ${prompt}` : '')
  );
}
function recombineMessage(a: PoolSketch, b: PoolSketch, s: Strategy, prompt: string): string {
  return (
    `Parent A (${a.name}):\n${fenced(a.source)}\n\nParent B (${b.name}):\n${fenced(b.source)}\n\n` +
    `Breed one new sketch from these parents, taking ${s.hint}. It must sound like one coherent piece, ` +
    'not two pasted together: use a single tempo line, keep track and binding names unique, and keep it to 3 to 7 tracks.' +
    (prompt ? ` Direction from the user: ${prompt}` : '')
  );
}
function countErrors(ps: readonly Problem[]): number {
  return ps.filter((p) => p.severity === 'error').length;
}
/** Lower is better: errors dominate, warnings break ties. */
function score(ps: readonly Problem[]): number {
  const e = countErrors(ps);
  return e * 100 + (ps.length - e);
}
function describeProblems(ps: readonly Problem[]): string {
  const e = countErrors(ps);
  const w = ps.length - e;
  if (e === 0 && w === 0) return 'no issues';
  return [e > 0 ? plural(e, 'error') : '', w > 0 ? plural(w, 'warning') : ''].filter(Boolean).join(', ');
}
const cancelled = (): CognotikError => new CognotikError('Request cancelled', { aborted: true });

/** Pulls the sketch out of a model reply: the longest fenced block, or the bare reply if it looks like code. */
export function extractCode(reply: string): string | null {
  const blocks = [...reply.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .map((m) => m[1] ?? '')
    .filter((b) => b.trim().length > 0);
  let code = blocks.length > 0 ? blocks.reduce((a, b) => (b.length > a.length ? b : a)) : reply;
  code = code.trim();
  if (!code) return null;
  if (blocks.length === 0 && !/(^|\n)\s*(\$|[A-Za-z_]\w*)\s*:|setcp[ms]\(|\b(s|note|n|sound)\(/.test(code)) {
    return null;
  }
  return `${code}\n`;
}

// ---- settings

interface Settings {
  baseUrl: string;
  model: string;
}

function loadSettings(): Settings {
  const fallback: Settings = { baseUrl: DEFAULT_URL, model: '' };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    return {
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : fallback.baseUrl,
      model: typeof p.model === 'string' ? p.model : '',
    };
  } catch {
    return fallback;
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable; settings just won't persist
  }
}

function loadApiKey(): string {
  try {
    return sessionStorage.getItem(API_KEY_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveApiKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(API_KEY_KEY, key);
    else sessionStorage.removeItem(API_KEY_KEY);
  } catch {
    // ignore
  }
}

// ---- UI

export function initAssistant(root: HTMLElement, host: AssistantHost): void {
  function q<T extends HTMLElement>(sel: string, type: new () => T): T {
    const e = root.querySelector(sel);
    if (!e) throw new Error(`missing ${sel}`);
    if (!(e instanceof type)) throw new Error(`${sel} is not a ${type.name}`);
    return e;
  }

  const urlInput = q('#ai-url', HTMLInputElement);
  const keyInput = q('#ai-key', HTMLInputElement);
  const connectBtn = q('#ai-connect', HTMLButtonElement);
  const modelSelect = q('#ai-model', HTMLSelectElement);
  const promptInput = q('#ai-prompt', HTMLTextAreaElement);
  const generateBtn = q('#ai-generate', HTMLButtonElement);
  const editBtn = q('#ai-edit', HTMLButtonElement);
  const fixBtn = q('#ai-fix', HTMLButtonElement);
  const undoBtn = q('#ai-undo', HTMLButtonElement);
  const cancelBtn = q('#ai-cancel', HTMLButtonElement);
  const varyBtn = q('#ai-vary', HTMLButtonElement);
  const recombineBtn = q('#ai-recombine', HTMLButtonElement);
  const countSelect = q('#ai-count', HTMLSelectElement);
  const partnerSelect = q('#ai-partner', HTMLSelectElement);
  const candidatesWrap = q('#ai-candidates-wrap', HTMLElement);
  const candidatesEl = q('#ai-candidates', HTMLUListElement);
  const statusEl = q('#ai-status', HTMLElement);
  const usageEl = q('#ai-usage', HTMLElement);

  const settings = loadSettings();
  urlInput.value = settings.baseUrl;
  keyInput.value = loadApiKey();

  let client: CognotikClient | null = null;
  let models: ChatModel[] = [];
  let busy: AbortController | null = null;
  const history: string[] = [];
  const usage = new UsageTracker();
  let candidates: Candidate[] = [];
  let activeCandidate = -1;

  function setStatus(msg: string, isError = false): void {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  }

  function updateButtons(): void {
    const ready = client !== null && modelSelect.value !== '' && busy === null;
    generateBtn.disabled = !ready;
    editBtn.disabled = !ready;
    fixBtn.disabled = !ready;
    varyBtn.disabled = !ready;
    recombineBtn.disabled = !ready;
    countSelect.disabled = busy !== null;
    partnerSelect.disabled = busy !== null;
    undoBtn.disabled = busy !== null || history.length === 0;
    connectBtn.disabled = busy !== null;
    cancelBtn.hidden = busy === null;
    modelSelect.disabled = busy !== null || models.length === 0;
    renderCandidates();
  }

  function persist(): void {
    settings.baseUrl = urlInput.value.trim();
    settings.model = modelSelect.value || settings.model;
    saveSettings(settings);
    saveApiKey(keyInput.value.trim());
  }

  function describeError(e: unknown): string {
    const server = urlInput.value.trim() || 'this site';
    if (e instanceof CognotikError) {
      if (e.aborted) return 'Cancelled.';
      if (e.auth) return `Not signed in. Sign in at ${server} in this browser, or enter an API key.`;
      if (e.retryable && /Network error/.test(e.message)) {
        return `${e.message}. Check that ${server} allows this origin (CORS) and that the page's CSP permits connecting to it.`;
      }
      return e.message;
    }
    return e instanceof Error ? e.message : String(e);
  }

  function modelLabel(m: ChatModel): string {
    const name = m.name ?? m.modelId ?? '?';
    const provider = providerName(m);
    return provider ? `${name} · ${provider}` : name;
  }

  function populateModels(): void {
    modelSelect.replaceChildren();
    const sorted = [...models].sort(
      (a, b) =>
        Number(!!a.deprecated) - Number(!!b.deprecated) ||
        providerName(a).localeCompare(providerName(b)) ||
        modelLabel(a).localeCompare(modelLabel(b)),
    );
    for (const m of sorted) {
      if (typeof m.modelId !== 'string') continue;
      const opt = document.createElement('option');
      opt.value = m.modelId;
      opt.textContent = m.deprecated ? `${modelLabel(m)} (deprecated)` : modelLabel(m);
      modelSelect.append(opt);
    }
    const saved = models.find((m) => m.modelId === settings.model);
    const chosen = saved ?? chooseDefaultModel(models);
    if (chosen?.modelId) modelSelect.value = chosen.modelId;
  }

  async function connect(): Promise<void> {
    persist();
    const apiKey = keyInput.value.trim();
    client = new CognotikClient({
      baseUrl: settings.baseUrl,
      ...(apiKey ? { apiKey } : {}),
      chatTimeoutMs: 180_000,
    });
    models = [];
    setStatus('Loading models…');
    updateButtons();
    try {
      const all = await client.listModels();
      const text = all.filter((m) => isTextModel(m) && typeof m.modelId === 'string');
      models = text.length > 0 ? text : all.filter((m) => typeof m.modelId === 'string');
      if (models.length === 0) throw new CognotikError('The server returned no usable models.');
      populateModels();
      persist();
      setStatus(`Connected · ${String(models.length)} models available`);
    } catch (e) {
      client = null;
      modelSelect.replaceChildren(new Option('Connect to load models', ''));
      setStatus(describeError(e), true);
    }
    updateButtons();
  }

  async function run(kind: Kind): Promise<void> {
    if (!client || busy) return;
    const model = modelSelect.value;
    if (!model) return;
    const prompt = promptInput.value.trim();
    if (kind !== 'fix' && !prompt) {
      setStatus('Describe what you want first.', true);
      promptInput.focus();
      return;
    }
    const source = host.getSource();
    const problems = host.problems();
    if (kind === 'fix' && problems.length === 0) {
      setStatus('No issues to fix.');
      return;
    }
    if (kind === 'edit' && !source.trim()) {
      setStatus('The editor is empty; use Generate instead.', true);
      return;
    }

    const conv = new Conversation({ system: SYSTEM_PROMPT });
    conv.addUser([textPart(userMessage(kind, prompt, source, problems))]);
    const ctrl = new AbortController();
    busy = ctrl;
    updateButtons();
    const label = kind === 'generate' ? 'Generating' : kind === 'edit' ? 'Editing' : 'Fixing';
    let pushed = false;

    try {
      let result: Problem[] = [];
      for (let attempt = 0; ; attempt++) {
        const response = await client.chat(buildRequest(conv, { model }), {
          signal: ctrl.signal,
          onStatus: (s) => {
            setStatus(`${label}: ${s}…`);
          },
        });
        usage.add(response.usage);
        usageEl.textContent = `${UsageTracker.format(response.usage)} · session: ${usage.summary()}`;
        const reply = extractText(response);
        const code = extractCode(reply);
        if (!code) throw new CognotikError('The model did not return a sketch.');
        if (ctrl.signal.aborted) throw new CognotikError('Request cancelled', { aborted: true });
        if (!pushed) {
          history.push(source);
          pushed = true;
        }
        result = await host.setSource(code, kind === 'generate' ? 'AI sketch' : undefined);
        const errors = result.filter((p) => p.severity === 'error');
        if (errors.length === 0 || attempt >= MAX_REPAIRS) break;
        conv.addAssistant(reply);
        conv.addUser([textPart(repairMessage(errors))]);
        setStatus(`Repairing ${String(errors.length)} error(s)…`);
      }
      const errors = result.filter((p) => p.severity === 'error').length;
      const warnings = result.length - errors;
      if (errors > 0) {
        setStatus(`Applied with ${String(errors)} error(s). Try "Fix issues" or undo.`, true);
      } else {
        setStatus(warnings > 0 ? `Applied with ${String(warnings)} warning(s).` : 'Applied. Press play to listen.');
        host.flash(kind === 'generate' ? 'New sketch ready' : 'Sketch updated');
      }
    } catch (e) {
      setStatus(describeError(e), !(e instanceof CognotikError && e.aborted));
    } finally {
      busy = null;
      updateButtons();
    }
  }
  // ---- variational and recombinant agents
  async function ask(
    c: CognotikClient,
    conv: Conversation,
    model: string,
    signal: AbortSignal,
    temperature?: number,
  ): Promise<string> {
    const response = await c.chat(buildRequest(conv, temperature === undefined ? { model } : { model, temperature }), {
      signal,
    });
    usage.add(response.usage);
    usageEl.textContent = `${UsageTracker.format(response.usage)} · session: ${usage.summary()}`;
    return extractText(response);
  }
  function fillPartners(): void {
    const keep = partnerSelect.value;
    const pool = host.pool();
    partnerSelect.replaceChildren(new Option('Random album sketch', ''), ...pool.map((s) => new Option(s.name, s.id)));
    partnerSelect.value = pool.some((s) => s.id === keep) ? keep : '';
  }
  function pickPartner(source: string): PoolSketch | null {
    const pool = host.pool().filter((s) => s.source.trim() && s.source !== source);
    const id = partnerSelect.value;
    if (id) return pool.find((s) => s.id === id) ?? null;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }
  function renderCandidates(): void {
    candidatesEl.replaceChildren(
      ...candidates.map((cand, i) => {
        const li = document.createElement('li');
        li.className = 'library-item';
        if (i === activeCandidate) li.setAttribute('aria-current', 'true');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'library-load';
        b.disabled = busy !== null;
        b.title = 'Load this candidate into the editor';
        const name = document.createElement('span');
        name.className = 'library-name';
        name.textContent = cand.label;
        const meta = document.createElement('span');
        meta.className = 'library-meta';
        const lines = cand.source.split('\n').filter((l) => l.trim()).length;
        meta.textContent = `${plural(lines, 'line')} · ${describeProblems(cand.problems)}`;
        b.append(name, meta);
        b.addEventListener('click', () => void audition(i));
        li.append(b);
        return li;
      }),
    );
    candidatesWrap.hidden = candidates.length === 0;
  }
  async function audition(i: number): Promise<void> {
    const cand = candidates[i];
    if (!cand || busy) return;
    activeCandidate = i;
    renderCandidates();
    cand.problems = await host.setSource(cand.source, cand.title);
    renderCandidates();
    setStatus(`Auditioning "${cand.label}" · ${describeProblems(cand.problems)}.`, countErrors(cand.problems) > 0);
  }
  /** Breeds a small population of candidates, tests each in the player, repairs once and keeps the fittest. */
  async function evolve(kind: Breed): Promise<void> {
    const c = client;
    if (!c || busy) return;
    const model = modelSelect.value;
    if (!model) return;
    const prompt = promptInput.value.trim();
    const source = host.getSource();
    if (!source.trim()) {
      setStatus(
        kind === 'vary'
          ? 'The editor is empty; generate a sketch to vary first.'
          : 'The editor is empty; load a sketch to recombine first.',
        true,
      );
      return;
    }
    const partner = kind === 'recombine' ? pickPartner(source) : null;
    if (kind === 'recombine' && !partner) {
      setStatus('There is no other sketch to recombine with yet.', true);
      return;
    }
    const count = Math.min(MAX_CANDIDATES, Math.max(1, Math.round(Number(countSelect.value)) || 1));
    const strategies = kind === 'vary' ? MUTATIONS : CROSSOVERS;
    const offset = Math.floor(Math.random() * strategies.length);
    const current: PoolSketch = { id: '', name: 'the current sketch', source };
    const briefs: Brief[] = [];
    for (let i = 0; i < count; i++) {
      const s = strategies[(offset + i) % strategies.length] ?? strategies[0];
      if (partner) {
        briefs.push({
          label: `Hybrid ${String(i + 1)} · ${s.name}`,
          title: `Hybrid × ${partner.name}`,
          message: recombineMessage(current, partner, s, prompt),
        });
      } else {
        briefs.push({
          label: `Variation ${String(i + 1)} · ${s.name}`,
          title: undefined,
          message: variationMessage(source, s, prompt, i + 1, count),
        });
      }
    }
    const ctrl = new AbortController();
    // Read through a function so TypeScript re-reads the flag after awaits instead of keeping a narrowed value.
    const aborted = (): boolean => ctrl.signal.aborted;
    busy = ctrl;
    candidates = [];
    activeCandidate = -1;
    updateButtons();
    const noun = kind === 'vary' ? 'variation' : 'hybrid';
    let replies = 0;
    let pushed = false;
    let settled = false;
    setStatus(`Breeding ${plural(count, noun)}…`);
    try {
      // All candidates are drafted in parallel; each has its own conversation for repairs.
      const drafts = await Promise.all(
        briefs.map(async (brief) => {
          const conv = new Conversation({ system: SYSTEM_PROMPT });
          conv.addUser([textPart(brief.message)]);
          let reply = '';
          let error = '';
          try {
            reply = await ask(c, conv, model, ctrl.signal, BREED_TEMPERATURE);
          } catch (e) {
            if (ctrl.signal.aborted) throw e;
            error = describeError(e);
          }
          replies++;
          if (!ctrl.signal.aborted) setStatus(`Breeding: ${String(replies)} of ${String(count)} replies in…`);
          return { brief, conv, reply, error };
        }),
      );
      // Testing runs one at a time, because the player checks one source at a time.
      const failures: string[] = [];
      for (const [i, d] of drafts.entries()) {
        if (aborted()) throw cancelled();
        let code = extractCode(d.reply);
        if (!code) {
          failures.push(`${d.brief.label}: ${d.error || 'no sketch in the reply'}.`);
          continue;
        }
        if (!pushed) {
          history.push(source);
          pushed = true;
        }
        setStatus(`Testing ${String(i + 1)} of ${String(drafts.length)}…`);
        let problems = await host.setSource(code);
        const errors = problems.filter((p) => p.severity === 'error');
        if (errors.length > 0) {
          setStatus(`Repairing ${d.brief.label}…`);
          d.conv.addAssistant(d.reply);
          d.conv.addUser([textPart(repairMessage(errors))]);
          try {
            const fixed = extractCode(await ask(c, d.conv, model, ctrl.signal));
            if (fixed) {
              const again = await host.setSource(fixed);
              if (score(again) < score(problems)) {
                code = fixed;
                problems = again;
              }
            }
          } catch (e) {
            if (ctrl.signal.aborted) throw e;
          }
        }
        candidates.push({ label: d.brief.label, source: code, title: d.brief.title, problems });
        renderCandidates();
      }
      if (candidates.length === 0) {
        throw new CognotikError(`No usable ${noun}s came back. ${failures.join(' ')}`.trim());
      }
      const best = candidates.reduce(
        (bi, cand, i, all) => (score(cand.problems) < score(all[bi]?.problems ?? []) ? i : bi),
        0,
      );
      const chosen = candidates[best];
      if (!chosen) throw new CognotikError(`No usable ${noun}s came back.`);
      activeCandidate = best;
      chosen.problems = await host.setSource(chosen.source, chosen.title);
      settled = true;
      const failed = failures.length > 0 ? ` ${plural(failures.length, 'draft')} failed.` : '';
      setStatus(
        `Bred ${plural(candidates.length, noun)}; loaded the fittest, "${chosen.label}" ` +
          `(${describeProblems(chosen.problems)}). Click another to audition.${failed}`,
        countErrors(chosen.problems) > 0,
      );
      host.flash(kind === 'vary' ? 'Variations ready' : 'Hybrids ready');
    } catch (e) {
      setStatus(describeError(e), !(e instanceof CognotikError && e.aborted));
    } finally {
      if (pushed && !settled) {
        // Cancelled or failed part-way: put the original sketch back.
        activeCandidate = -1;
        await host.setSource(source);
        if (candidates.length === 0) history.pop();
      }
      busy = null;
      updateButtons();
    }
  }

  async function undo(): Promise<void> {
    const prev = history.pop();
    if (prev === undefined) return;
    activeCandidate = -1;
    updateButtons();
    await host.setSource(prev);
    setStatus('Reverted the last AI change.');
  }

  connectBtn.addEventListener('click', () => void connect());
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void connect();
  });
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void connect();
  });
  modelSelect.addEventListener('change', () => {
    persist();
    updateButtons();
  });
  generateBtn.addEventListener('click', () => void run('generate'));
  editBtn.addEventListener('click', () => void run('edit'));
  fixBtn.addEventListener('click', () => void run('fix'));
  undoBtn.addEventListener('click', () => void undo());
  varyBtn.addEventListener('click', () => void evolve('vary'));
  recombineBtn.addEventListener('click', () => void evolve('recombine'));
  partnerSelect.addEventListener('focus', fillPartners);
  root.addEventListener('panelshow', fillPartners);
  cancelBtn.addEventListener('click', () => {
    busy?.abort();
  });
  promptInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void run(host.getSource().trim() ? 'edit' : 'generate');
    }
  });
  fillPartners();

  updateButtons();
  setStatus('Connect to a Cognotik server to start.');
}
