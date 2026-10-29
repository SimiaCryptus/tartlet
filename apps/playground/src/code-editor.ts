/// <reference types="vite/client" />
// Monaco code editor for the playground, with Tartlet syntax colouring, completion, hover docs and
// diagnostics markers. It replaces the editor <textarea> in place: the textarea stays in the DOM
// (hidden) and its `value` property is routed to the Monaco model, so the rest of the playground keeps
// reading and writing `editor.value` and listening for its `input` event.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import {
  ROOTS,
  SCALE_NAMES,
  SOUNDS,
  SPACES,
  STARTERS,
  TOP_ONLY,
  VOWEL_NAMES,
  allSymbols,
  lookup,
  markdown,
  soundDoc,
  soundMarkdown,
  type DocKind,
  type SymbolDoc,
} from './tartlet-docs';

const LANG = 'tartlet';
const THEME = 'tartlet-dark';

export interface CodeEditorOptions {
  /** Ctrl/Cmd+Enter. */
  onRun(): void;
}

export interface CodeEditorHandle {
  setDiagnostics(ds: readonly object[]): void;
  focus(): void;
  dispose(): void;
}

(self as unknown as { MonacoEnvironment: { getWorker(): Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// ---- line scanning

type Scan =
  | { readonly kind: 'code' }
  | { readonly kind: 'comment' }
  | { readonly kind: 'string'; readonly fn: string; readonly start: number; readonly content: string };

/** Works out whether the end of `text` is in code, a line comment or a string (and which call it belongs to). */
function scanLine(text: string): Scan {
  let quote = '';
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '/' && text[i + 1] === '/') {
      return { kind: 'comment' };
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      start = i;
    }
  }
  if (!quote) return { kind: 'code' };
  const m = /([A-Za-z_$][\w$]*)\s*\(\s*$/.exec(text.slice(0, start));
  return { kind: 'string', fn: m?.[1] ?? '', start, content: text.slice(start + 1) };
}

interface UserSymbol {
  readonly name: string;
  readonly isFn: boolean;
  readonly line: number;
  readonly text: string;
}

function userSymbols(model: monaco.editor.ITextModel): UserSymbol[] {
  const out: UserSymbol[] = [];
  model.getLinesContent().forEach((l, i) => {
    const m = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(l);
    if (!m?.[1]) return;
    out.push({
      name: m[1],
      isFn: /^(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(m[2] ?? ''),
      line: i + 1,
      text: l.trim(),
    });
  });
  return out;
}

// ---- completion items

const START_SNIPPETS: Partial<Record<string, string>> = {
  s: 's("$0")',
  sound: 'sound("$0")',
  note: 'note("$0")',
  n: 'n("$0")',
  freq: 'freq("$0")',
  setcpm: 'setcpm(${1:120}/4)',
  setcps: 'setcps(${1:0.5})',
  run: 'run(${1:8})',
  irand: 'irand(${1:8})',
  silence: 'silence',
  const: 'const ${1:name} = $0',
  return: 'return ',
};

const STRING_VALUES: Partial<Record<string, readonly string[]>> = {
  space: SPACES,
  vowel: VOWEL_NAMES,
  timbre: ['soft', 'bright', 'glass', 'hollow', 'reed', 'organ'],
  earsplit: ['bands', 'harmonics'],
  voicetype: ['alto', 'tenor'],
};

type Mode = 'method' | 'value' | 'start';

function kindOf(kind: DocKind, mode: Mode): monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 'keyword':
      return K.Keyword;
    case 'signal':
      return K.Constant;
    case 'control':
      return K.Property;
    case 'transform':
    case 'tonal':
      return mode === 'method' ? K.Method : K.Function;
    default:
      return K.Function;
  }
}

function symbolItem(d: SymbolDoc, range: monaco.IRange, mode: Mode, sort: string): monaco.languages.CompletionItem {
  const insertText =
    mode === 'method'
      ? `${d.name}($0)`
      : mode === 'value'
        ? d.name
        : (START_SNIPPETS[d.name] ?? (d.kind === 'control' ? `${d.name}("$0")` : `${d.name}($0)`));
  return {
    label: d.name,
    kind: kindOf(d.kind, mode),
    detail: d.detail,
    documentation: { value: markdown(d) },
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    sortText: `${sort}${d.name}`,
  };
}

function userItem(u: UserSymbol, range: monaco.IRange, call: boolean): monaco.languages.CompletionItem {
  const K = monaco.languages.CompletionItemKind;
  return {
    label: u.name,
    kind: u.isFn ? K.Function : K.Variable,
    detail: u.isFn ? 'your function' : 'your binding',
    documentation: { value: `\`\`\`tartlet\n${u.text}\n\`\`\`` },
    insertText: call || u.isFn ? `${u.name}($0)` : u.name,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    sortText: `0${u.name}`,
  };
}

function valueItems(
  values: readonly string[],
  range: monaco.IRange,
  detail: string,
): monaco.languages.CompletionItem[] {
  return values.map((v) => ({
    label: v,
    kind: monaco.languages.CompletionItemKind.EnumMember,
    detail,
    insertText: v,
    range,
  }));
}

function stringItems(
  scan: Extract<Scan, { kind: 'string' }>,
  position: monaco.Position,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  const line = position.lineNumber;
  if (scan.fn === 's' || scan.fn === 'sound') {
    return SOUNDS.map((x) => ({
      label: x.name,
      kind: monaco.languages.CompletionItemKind.Value,
      detail: x.group,
      documentation: { value: soundMarkdown(x) },
      insertText: x.name,
      range,
    }));
  }
  if (scan.fn === 'scale') {
    const colon = scan.content.lastIndexOf(':');
    if (colon >= 0) {
      const r = new monaco.Range(line, scan.start + colon + 3, line, position.column);
      return valueItems(SCALE_NAMES, r, 'scale');
    }
    const r = new monaco.Range(line, scan.start + 2, line, position.column);
    return ROOTS.map((root, i) => ({
      label: `${root}:`,
      kind: monaco.languages.CompletionItemKind.EnumMember,
      detail: 'root note',
      insertText: `${root}:`,
      range: r,
      sortText: String(i).padStart(2, '0'),
      command: { id: 'editor.action.triggerSuggest', title: 'Suggest scales' },
    }));
  }
  const values = STRING_VALUES[scan.fn];
  return values ? valueItems(values, range, scan.fn) : [];
}

// ---- language registration

function miniNotation(quote: string): monaco.languages.IMonarchLanguageRule[] {
  return [
    [new RegExp(quote), 'string', '@pop'],
    [/~/, 'string.rest'],
    [/[<>[\]{}]/, 'string.bracket'],
    [/[*/!@?|%,.:_]/, 'string.op'],
    [/-?\d+(\.\d+)?/, 'string.number'],
    [new RegExp(`[^${quote}~<>\\[\\]{}*/!@?|%,.:_\\d-]+`), 'string'],
    [/./, 'string'],
  ];
}

let registered = false;
function register(): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: LANG, extensions: ['.tartlet'], aliases: ['Tartlet'] });
  monaco.languages.setLanguageConfiguration(LANG, {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '<', close: '>' },
    ],
  });

  const signals = allSymbols()
    .filter((s) => s.kind === 'signal')
    .flatMap((s) => [s.name, ...s.aliases]);
  monaco.languages.setMonarchTokensProvider(LANG, {
    keywords: ['const', 'return'],
    starters: [...STARTERS],
    signals,
    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.square' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],
    tokenizer: {
      root: [
        // Track labels: "$:" or "name:" at the start of a line
        [/^(\s*)(\$|[A-Za-z_]\w*)(\s*:)(?!:)/, ['white', 'type', 'type']],
        { include: '@whitespace' },
        [/(\.)([A-Za-z_$][\w$]*)/, ['delimiter', 'method']],
        [
          /[A-Za-z_$][\w$]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@starters': 'predefined',
              '@signals': 'constant',
              '@default': 'identifier',
            },
          },
        ],
        [/\d*\.\d+|\d+/, 'number'],
        [/"/, 'string', '@dstring'],
        [/'/, 'string', '@sstring'],
        [/`/, 'string', '@bstring'],
        [/=>|\.\.\./, 'operator'],
        [/[{}()[\]]/, '@brackets'],
        [/[=+\-*/%,;]/, 'operator'],
      ],
      whitespace: [
        [/\s+/, 'white'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      dstring: miniNotation('"'),
      sstring: miniNotation("'"),
      bstring: miniNotation('`'),
    },
  });

  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a7480', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c792ea', fontStyle: 'bold' },
      { token: 'type', foreground: 'ff6b85', fontStyle: 'bold' },
      { token: 'predefined', foreground: '7fdbca' },
      { token: 'constant', foreground: 'f78c6c' },
      { token: 'method', foreground: '82aaff' },
      { token: 'identifier', foreground: 'fbeee6' },
      { token: 'number', foreground: 'ffd479' },
      { token: 'operator', foreground: 'ff8fa3' },
      { token: 'delimiter', foreground: 'a8949f' },
      { token: 'string', foreground: 'ffb38a' },
      { token: 'string.rest', foreground: '8a7480' },
      { token: 'string.bracket', foreground: 'c7a4ff' },
      { token: 'string.op', foreground: 'ff7a95' },
      { token: 'string.number', foreground: 'ffd479' },
    ],
    colors: {
      'editor.background': '#1a1117',
      'editor.foreground': '#fbeee6',
      'editor.lineHighlightBackground': '#24161f',
      'editor.selectionBackground': '#ff4f6d55',
      'editorCursor.foreground': '#ffa45b',
      'editorLineNumber.foreground': '#6e5a66',
      'editorLineNumber.activeForeground': '#fbeee6',
      'editorWidget.background': '#24161f',
      'editorWidget.border': '#ff4f6d44',
      'editorSuggestWidget.selectedBackground': '#ff4f6d33',
    },
  });

  monaco.languages.registerCompletionItemProvider(LANG, {
    triggerCharacters: ['.', '"', "'", ':', ' '],
    provideCompletionItems(model, position, context) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const scan = scanLine(before);
      if (scan.kind === 'comment') return { suggestions: [] };
      if (scan.kind === 'string') return { suggestions: stringItems(scan, position, range) };

      const trig = context.triggerCharacter;
      if (trig && trig !== '.') return { suggestions: [] };
      if (/(^|[^\w$])\d+\.\d*$/.test(before)) return { suggestions: [] };
      const users = userSymbols(model);
      const suggestions: monaco.languages.CompletionItem[] = [];

      if (/(^\s*|[\w$)\]"'`]\s*)\.\s*[\w$]*$/.test(before)) {
        for (const u of users) if (u.isFn) suggestions.push(userItem(u, range, true));
        for (const d of allSymbols()) {
          if (d.kind === 'signal' || d.kind === 'keyword' || TOP_ONLY.has(d.name)) continue;
          suggestions.push(symbolItem(d, range, 'method', d.kind === 'transform' || d.kind === 'tonal' ? '1' : '2'));
        }
        return { suggestions };
      }
      if (trig === '.') return { suggestions: [] };

      for (const u of users) suggestions.push(userItem(u, range, false));
      for (const d of allSymbols()) {
        if (STARTERS.has(d.name)) suggestions.push(symbolItem(d, range, 'start', '0'));
        else if (d.kind === 'signal') suggestions.push(symbolItem(d, range, 'value', '2'));
        else if (d.kind === 'keyword') suggestions.push(symbolItem(d, range, 'start', '3'));
        else if (d.kind === 'combinator') suggestions.push(symbolItem(d, range, 'start', '4'));
        else if (d.kind === 'transform' || d.kind === 'tonal') suggestions.push(symbolItem(d, range, 'value', '8'));
        else if (d.kind === 'control') suggestions.push(symbolItem(d, range, 'start', '9'));
      }
      return { suggestions };
    },
  });

  monaco.languages.registerHoverProvider(LANG, {
    provideHover(model, position) {
      const w = model.getWordAtPosition(position);
      if (!w) return null;
      const before = model.getLineContent(position.lineNumber).slice(0, w.startColumn - 1);
      const range = new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn);
      const scan = scanLine(before);
      if (scan.kind === 'comment') return null;
      if (scan.kind === 'string') {
        if (scan.fn === 's' || scan.fn === 'sound') {
          const s = soundDoc(w.word);
          if (s) return { range, contents: [{ value: soundMarkdown(s) }] };
        }
        return null;
      }
      const user = userSymbols(model).find((u) => u.name === w.word);
      if (user) {
        return {
          range,
          contents: [{ value: `\`\`\`tartlet\n${user.text}\n\`\`\`\n\nDefined on line ${String(user.line)}.` }],
        };
      }
      const d = lookup(w.word);
      return d ? { range, contents: [{ value: markdown(d, w.word) }] } : null;
    },
  });
}

// ---- mounting

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function mountCodeEditor(textarea: HTMLTextAreaElement, opts: CodeEditorOptions): CodeEditorHandle {
  register();
  const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  // Bound once to the textarea, so the native accessors can be called directly.
  const nativeGet = native?.get?.bind(textarea);
  const nativeSet = native?.set?.bind(textarea);
  if (!nativeGet || !nativeSet) throw new Error('Cannot attach the code editor');
  const initial = String(nativeGet());

  const host = document.createElement('div');
  host.className = 'monaco-host';
  textarea.after(host);
  // Suggestions and hovers render here, outside the panel, so its overflow and blur cannot clip them.
  const overflow = document.createElement('div');
  overflow.className = 'monaco-editor monaco-overflow';
  document.body.append(overflow);

  const model = monaco.editor.createModel(initial, LANG);
  model.setEOL(monaco.editor.EndOfLineSequence.LF);
  const ed = monaco.editor.create(host, {
    model,
    theme: THEME,
    ariaLabel: 'Source',
    automaticLayout: true,
    fixedOverflowWidgets: true,
    overflowWidgetsDomNode: overflow,
    fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 14,
    lineHeight: 24,
    tabSize: 2,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    padding: { top: 14, bottom: 14 },
    renderLineHighlight: 'line',
    wordBasedSuggestions: 'off',
    quickSuggestions: { other: true, comments: false, strings: true },
    suggest: { showWords: false, preview: true },
    hover: { delay: 300 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });

  let external = false;
  ed.onDidChangeModelContent(() => {
    if (external) return;
    nativeSet(model.getValue());
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  Object.defineProperty(textarea, 'value', {
    configurable: true,
    get: () => model.getValue(),
    set: (v: unknown) => {
      const next = String(v);
      nativeSet(next);
      if (next === model.getValue()) return;
      external = true;
      try {
        // An edit rather than setValue, so Ctrl+Z can step back through loads and AI changes.
        ed.pushUndoStop();
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null);
        ed.pushUndoStop();
        ed.setPosition({ lineNumber: 1, column: 1 });
        ed.setScrollTop(0);
      } finally {
        external = false;
      }
    },
  });
  textarea.hidden = true;
  textarea.tabIndex = -1;

  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    opts.onRun();
  });

  return {
    setDiagnostics(ds) {
      const S = monaco.MarkerSeverity;
      const lines = model.getLineCount();
      const markers: monaco.editor.IMarkerData[] = [];
      for (const d of ds) {
        const r = d as Record<string, unknown>;
        const line = num(r.line);
        if (line === undefined) continue;
        const startLine = Math.min(Math.max(1, Math.round(line)), lines);
        const startCol = Math.max(1, num(r.column) ?? num(r.col) ?? 1);
        const endLine = Math.min(Math.max(startLine, num(r.endLine) ?? startLine), lines);
        let endCol = num(r.endColumn);
        if (endCol === undefined) {
          const w =
            num(r.column) !== undefined ? model.getWordAtPosition({ lineNumber: startLine, column: startCol }) : null;
          endCol = w ? w.endColumn : model.getLineMaxColumn(endLine);
        }
        markers.push({
          severity: r.severity === 'error' ? S.Error : r.severity === 'warning' ? S.Warning : S.Info,
          message: typeof r.message === 'string' ? r.message : 'Problem',
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: Math.max(endCol, startCol + 1),
          source: 'tartlet',
        });
      }
      monaco.editor.setModelMarkers(model, 'tartlet', markers);
    },
    focus() {
      ed.focus();
    },
    dispose() {
      const value = model.getValue();
      Reflect.deleteProperty(textarea, 'value');
      textarea.value = value;
      textarea.hidden = false;
      textarea.tabIndex = 0;
      ed.dispose();
      model.dispose();
      host.remove();
      overflow.remove();
    },
  };
}
