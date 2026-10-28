// Optional AI assistant: generates and edits sketches through a Cognotik API proxy.
// Loaded lazily by main.ts the first time the assistant panel is opened.

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
import { PRESETS, type Preset } from './presets';

export interface Problem {
  readonly severity: string;
  readonly text: string;
}

export interface AssistantHost {
  getSource(): string;
  /** Replaces the editor contents, applies them and resolves with the resulting problems. */
  setSource(source: string, title?: string): Promise<Problem[]>;
  /** Current errors and warnings reported by the player. */
  problems(): Problem[];
  flash(msg: string): void;
}

type Kind = 'generate' | 'edit' | 'fix';

const MAX_REPAIRS = 1;
const SETTINGS_KEY = 'tartlet.assistant.v1';
const API_KEY_KEY = 'tartlet.assistant.apiKey';

// ---- prompts

const EXAMPLES = ['groove', 'layers', 'function-args']
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter((p): p is Preset => p !== undefined);

const FENCE = '```';

const SYSTEM_PROMPT = `You write music sketches for Tartlet, a deterministic runtime for a safe subset of Strudel-style code. Tartlet never evaluates JavaScript: it parses a small fixed language and rejects anything outside it.

Language:
- Tempo: setcpm(bpm/4) or setcps(x) on the first line.
- Tracks: each "$: <pattern>" line plays a track; "name: <pattern>" plays a named track.
- Bindings: const name = <expression>, then reuse the name.
- Pattern sources: s("..."), sound("..."), note("..."), n("...").scale("Root:mode"), freq("..."), stack(a, b), cat(a, b), seq(a, b), silence.
- Mini-notation inside strings: spaces split the cycle, ~ rest, [a b] group, <a b> one per cycle, "a, b" layers, a*2 and a/2 speed, a!3 repeat, a@2 weight, a? or a?0.3 random drop, a(3,8) or a(3,8,2) Euclidean, {a b c}%4 polymeter, a | b random choice, a lone . splits groups, name:index picks a variant.
- Drum sounds: bd sd hh oh cp rim lt mt ht cr rd. Synth sounds: sine sawtooth square triangle.
- Noise sounds: white pink brown.
- Methods: fast slow rev palindrome early late iter iterBack ply off jux every sometimes sometimesBy degrade degradeBy struct mask euclid add transpose gain velocity pan lpf hpf lpq resonance attack decay sustain release shape crush speed vowel delay delaytime delayfeedback room size orbit seed label.
- Synthesis: lpenv lpattack lpdecay lpsustain lprelease (filter envelope, octaves), penv pdecay (pitch envelope, semitones), vib vibdepth, trem tremdepth, fm fmh, pw (square only), unison detune, timbre("organ|hollow|bright|soft|reed|glass"), mono(n) with glide(seconds).
- Signals: sine cosine saw isaw tri square rand, with .range(lo, hi) and .slow(n).
- Function arguments: a transform name (rev), a partial application (fast(2)), an arrow (x => x.add(7)) or a block (x => { return x.ply(2); }).
- Constant arithmetic (1/8, 2 * 2) and spreads of constant arrays are allowed. No loops, conditionals, imports, other JavaScript or global objects.

Rules for your reply:
- Reply with the complete sketch in a single ${FENCE}tartlet code block, followed by at most one short sentence.
- Keep it musical and concise: usually 2 to 6 tracks, with gain below 1 for dense layers.
- When editing, keep everything the user did not ask to change.
- Short // comments are fine.

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
  return `Tartlet rejected that sketch:\n${listProblems(problems)}\n\nReturn the corrected complete sketch.`;
}

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

  function setStatus(msg: string, isError = false): void {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  }

  function updateButtons(): void {
    const ready = client !== null && modelSelect.value !== '' && busy === null;
    generateBtn.disabled = !ready;
    editBtn.disabled = !ready;
    fixBtn.disabled = !ready;
    undoBtn.disabled = busy !== null || history.length === 0;
    connectBtn.disabled = busy !== null;
    cancelBtn.hidden = busy === null;
    modelSelect.disabled = busy !== null || models.length === 0;
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

  async function undo(): Promise<void> {
    const prev = history.pop();
    if (prev === undefined) return;
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
  cancelBtn.addEventListener('click', () => {
    busy?.abort();
  });
  promptInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void run(host.getSource().trim() ? 'edit' : 'generate');
    }
  });

  updateButtons();
  setStatus('Connect to a Cognotik server to start.');
}
