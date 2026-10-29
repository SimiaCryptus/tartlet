// Play queue: a list of sketches that plays through, switching every few seconds or minutes,
// in order, shuffled or at random, with repeat settings. The queue and its settings persist in
// localStorage. The countdown only runs while the player is actually playing.

export interface QueueEntry {
  readonly name: string;
  readonly source: string;
  readonly seed?: string;
}

export interface QueueHost {
  /** The sketch in the editor, or null when it is empty. */
  current(): QueueEntry | null;
  /** Sketches currently listed in the album browser. */
  shown(): QueueEntry[];
  /** Loads an entry into the editor and makes sure it plays. Called directly from clicks. */
  play(entry: QueueEntry): Promise<void>;
  stop(): void;
  isPlaying(): boolean;
  flash(msg: string): void;
}

export interface QueueHandle {
  add(entries: readonly QueueEntry[]): void;
  /** True while the queue is driving playback. */
  running(): boolean;
  /** Skips to the next entry; false when the queue is empty. */
  next(): boolean;
  /** Goes back to the previous entry; false when there is none. */
  previous(): boolean;
}

type Order = 'sequential' | 'shuffle' | 'random';
type Repeat = 'all' | 'one' | 'off';

interface QueueItem extends QueueEntry {
  readonly uid: string;
}

interface Settings {
  interval: number;
  /** Seconds per interval unit: 1 (seconds) or 60 (minutes). */
  unit: number;
  order: Order;
  repeat: Repeat;
  auto: boolean;
}

const STORAGE_KEY = 'tartlet.queue.v1';
const MIN_SECONDS = 5;
const MAX_ITEMS = 200;
const DEFAULTS: Settings = { interval: 30, unit: 1, order: 'sequential', repeat: 'all', auto: true };

function newUid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOrder(v: unknown): v is Order {
  return v === 'sequential' || v === 'shuffle' || v === 'random';
}

function isRepeat(v: unknown): v is Repeat {
  return v === 'all' || v === 'one' || v === 'off';
}

function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

const plural = (n: number, w: string): string => `${String(n)} ${w}${n === 1 ? '' : 's'}`;

function load(): { items: QueueItem[]; settings: Settings } {
  const fallback = { items: [], settings: { ...DEFAULTS } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null) return fallback;
    const r = data as Record<string, unknown>;
    const items: QueueItem[] = [];
    if (Array.isArray(r.items)) {
      for (const v of r.items as unknown[]) {
        if (typeof v !== 'object' || v === null) continue;
        const o = v as Record<string, unknown>;
        if (typeof o.source !== 'string' || !o.source.trim()) continue;
        const name = typeof o.name === 'string' && o.name.trim() ? o.name : 'Sketch';
        const seed = typeof o.seed === 'string' && o.seed ? o.seed : undefined;
        items.push({ uid: newUid(), name, source: o.source, ...(seed ? { seed } : {}) });
      }
    }
    const s = (typeof r.settings === 'object' && r.settings !== null ? r.settings : {}) as Record<string, unknown>;
    const settings: Settings = {
      interval:
        typeof s.interval === 'number' && Number.isFinite(s.interval) && s.interval > 0
          ? s.interval
          : DEFAULTS.interval,
      unit: s.unit === 60 ? 60 : 1,
      order: isOrder(s.order) ? s.order : DEFAULTS.order,
      repeat: isRepeat(s.repeat) ? s.repeat : DEFAULTS.repeat,
      auto: typeof s.auto === 'boolean' ? s.auto : DEFAULTS.auto,
    };
    return { items: items.slice(0, MAX_ITEMS), settings };
  } catch {
    return fallback;
  }
}

export function initQueue(root: HTMLElement, host: QueueHost): QueueHandle {
  function q<T extends HTMLElement>(sel: string, type: new () => T): T {
    const e = root.querySelector(sel);
    if (!(e instanceof type)) throw new Error(`missing ${sel}`);
    return e;
  }

  const nowEl = q('#q-now', HTMLElement);
  const countdownEl = q('#q-countdown', HTMLElement);
  const progress = q('#q-progress', HTMLProgressElement);
  const prevBtn = q('#q-prev', HTMLButtonElement);
  const playBtn = q('#q-play', HTMLButtonElement);
  const nextBtn = q('#q-next', HTMLButtonElement);
  const intervalInput = q('#q-interval', HTMLInputElement);
  const unitSel = q('#q-unit', HTMLSelectElement);
  const orderSel = q('#q-order', HTMLSelectElement);
  const repeatSel = q('#q-repeat', HTMLSelectElement);
  const autoInput = q('#q-auto', HTMLInputElement);
  const list = q('#q-list', HTMLUListElement);
  const emptyEl = q('#q-empty', HTMLElement);
  const addCurrentBtn = q('#q-add-current', HTMLButtonElement);
  const addShownBtn = q('#q-add-shown', HTMLButtonElement);
  const clearBtn = q('#q-clear', HTMLButtonElement);

  const loaded = load();
  let items: QueueItem[] = loaded.items;
  const settings: Settings = loaded.settings;

  let running = false;
  let currentUid: string | null = null;
  let sequence: string[] = [];
  let history: string[] = [];
  let passCount = 0;
  let elapsed = 0;
  let switching = false;
  let lastTick = performance.now();

  intervalInput.value = String(settings.interval);
  unitSel.value = String(settings.unit);
  orderSel.value = settings.order;
  repeatSel.value = settings.repeat;
  autoInput.checked = settings.auto;

  const byUid = (uid: string | null): QueueItem | undefined =>
    uid === null ? undefined : items.find((i) => i.uid === uid);
  const intervalMs = (): number => Math.max(MIN_SECONDS, settings.interval * settings.unit) * 1000;

  function persist(): void {
    const data = {
      items: items.map((i) => ({ name: i.name, source: i.source, ...(i.seed ? { seed: i.seed } : {}) })),
      settings,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // storage unavailable; the queue just won't persist
    }
  }

  // ---- ordering

  function buildSequence(avoidFirst: string | null): string[] {
    const uids = items.map((i) => i.uid);
    if (settings.order !== 'shuffle') return uids;
    const s = shuffled(uids);
    if (s.length > 1 && s[0] === avoidFirst) s.push(s.shift() as string);
    return s;
  }

  /** Keeps the sequence in step with added, removed and reordered items. */
  function syncSequence(): void {
    if (settings.order !== 'shuffle') {
      sequence = items.map((i) => i.uid);
      return;
    }
    const live = new Set(items.map((i) => i.uid));
    sequence = sequence.filter((u) => live.has(u));
    const missing = items.map((i) => i.uid).filter((u) => !sequence.includes(u));
    sequence.push(...shuffled(missing));
  }

  function pickNext(manual: boolean): string | null {
    if (items.length === 0) return null;
    const cur = byUid(currentUid) ? currentUid : null;
    if (!manual && cur && settings.repeat === 'one') return cur;
    if (settings.order === 'random') {
      if (!manual && settings.repeat === 'off' && passCount >= items.length) return null;
      const pool = items.filter((i) => i.uid !== cur);
      const pick = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : items[0];
      return pick?.uid ?? null;
    }
    syncSequence();
    const pos = cur ? sequence.indexOf(cur) : -1;
    const next = sequence[pos + 1];
    if (next !== undefined) return next;
    if (!manual && settings.repeat === 'off') return null;
    sequence = buildSequence(cur);
    passCount = 0;
    return sequence[0] ?? null;
  }

  function pickPrev(): string | null {
    while (history.length > 0) {
      const u = history.pop() ?? null;
      if (u !== null && u !== currentUid && byUid(u)) return u;
    }
    if (items.length === 0) return null;
    syncSequence();
    const pos = currentUid ? Math.max(0, sequence.indexOf(currentUid)) : 0;
    return sequence[(pos - 1 + sequence.length) % sequence.length] ?? null;
  }

  // ---- playback

  async function go(uid: string, record = true): Promise<void> {
    const item = byUid(uid);
    if (!item) return;
    if (record && currentUid && currentUid !== uid) {
      history.push(currentUid);
      if (history.length > 100) history.shift();
    }
    currentUid = uid;
    elapsed = 0;
    passCount++;
    running = true;
    switching = true;
    render();
    try {
      await host.play(item);
    } catch {
      host.flash(`Could not play "${item.name}"`);
    } finally {
      switching = false;
      lastTick = performance.now();
      updateStatus();
    }
  }

  function finish(): void {
    running = false;
    host.stop();
    render();
    host.flash('Queue finished');
  }

  function advance(manual: boolean): void {
    const uid = pickNext(manual);
    if (uid === null) {
      if (manual) host.flash('The queue is empty');
      else finish();
      return;
    }
    void go(uid);
  }

  function toggle(): void {
    if (running && host.isPlaying()) {
      running = false;
      host.stop();
      render();
      return;
    }
    if (items.length === 0) {
      host.flash('Add sketches to the queue first');
      return;
    }
    const resume = byUid(currentUid) ? currentUid : null;
    if (resume) {
      void go(resume, false);
      return;
    }
    sequence = buildSequence(null);
    history = [];
    passCount = 0;
    const first = settings.order === 'random' ? pickNext(true) : (sequence[0] ?? null);
    if (first !== null) void go(first);
  }

  // ---- editing the queue

  function add(entries: readonly QueueEntry[]): void {
    let added = 0;
    let skipped = 0;
    for (const e of entries) {
      if (!e.source.trim()) continue;
      const seed = e.seed?.trim() ?? '';
      if (items.some((i) => i.source === e.source && (i.seed ?? '') === seed)) {
        skipped++;
        continue;
      }
      if (items.length >= MAX_ITEMS) {
        host.flash(`The queue is limited to ${String(MAX_ITEMS)} sketches`);
        break;
      }
      items.push({ uid: newUid(), name: e.name.trim() || 'Sketch', source: e.source, ...(seed ? { seed } : {}) });
      added++;
    }
    persist();
    render();
    if (added > 0)
      host.flash(`Queued ${plural(added, 'sketch')}${skipped ? ` (${String(skipped)} already queued)` : ''}`);
    else if (skipped > 0) host.flash('Already in the queue');
  }

  function move(index: number, dir: -1 | 1): void {
    const other = index + dir;
    const a = items[index];
    const b = items[other];
    if (!a || !b) return;
    items[index] = b;
    items[other] = a;
    persist();
    render();
  }

  function remove(uid: string): void {
    items = items.filter((i) => i.uid !== uid);
    history = history.filter((u) => u !== uid);
    if (items.length === 0) {
      running = false;
      currentUid = null;
    }
    persist();
    render();
  }

  function clear(): void {
    if (items.length === 0) return;
    if (!confirm(`Remove all ${plural(items.length, 'sketch')} from the queue?`)) return;
    items = [];
    sequence = [];
    history = [];
    currentUid = null;
    running = false;
    persist();
    render();
  }

  // ---- rendering

  function button(cls: string, text: string, label?: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    b.textContent = text;
    if (label) {
      b.setAttribute('aria-label', label);
      b.title = label;
    }
    return b;
  }

  function span(cls: string, text: string): HTMLSpanElement {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function row(it: QueueItem, i: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'library-item';
    if (it.uid === currentUid) li.setAttribute('aria-current', 'true');

    const load = button('library-load', '');
    load.title = 'Play from here';
    const lines = it.source.split('\n').filter((l) => l.trim()).length;
    const meta = [plural(lines, 'line')];
    if (it.seed) meta.push(`seed ${it.seed}`);
    if (it.uid === currentUid) meta.unshift(running ? 'now playing' : 'last played');
    load.append(span('library-name', `${String(i + 1)}. ${it.name}`), span('library-meta', meta.join(' · ')));
    load.addEventListener('click', () => void go(it.uid));

    const up = button('', '↑', `Move ${it.name} up`);
    up.disabled = i === 0;
    up.addEventListener('click', () => {
      move(i, -1);
    });
    const down = button('', '↓', `Move ${it.name} down`);
    down.disabled = i === items.length - 1;
    down.addEventListener('click', () => {
      move(i, 1);
    });
    const del = button('library-delete', '×', `Remove ${it.name} from the queue`);
    del.addEventListener('click', () => {
      remove(it.uid);
    });

    li.append(load, up, down, del);
    return li;
  }

  function updateStatus(): void {
    const item = byUid(currentUid);
    nowEl.textContent = item
      ? item.name
      : items.length > 0
        ? `${plural(items.length, 'sketch')} queued`
        : 'The queue is empty';
    const playing = running && host.isPlaying();
    const label = playing ? 'Stop queue' : running ? 'Resume queue' : 'Play queue';
    if (playBtn.textContent !== label) playBtn.textContent = label;
    const total = intervalMs();
    let text = '';
    let value = 0;
    if (running && switching) text = 'loading…';
    else if (running && !settings.auto) text = 'manual switching';
    else if (running) {
      value = Math.min(1, elapsed / total);
      text = !playing
        ? 'paused'
        : settings.repeat === 'one'
          ? `repeats in ${clock(total - elapsed)}`
          : `next in ${clock(total - elapsed)}`;
    }
    if (countdownEl.textContent !== text) countdownEl.textContent = text;
    progress.value = value;
    const empty = items.length === 0;
    prevBtn.disabled = empty;
    nextBtn.disabled = empty;
    playBtn.disabled = empty && !running;
    clearBtn.disabled = empty;
  }

  function render(): void {
    list.replaceChildren(...items.map(row));
    emptyEl.hidden = items.length > 0;
    updateStatus();
  }

  // ---- events

  function readSettings(): void {
    const n = Number(intervalInput.value);
    settings.interval = Number.isFinite(n) && n > 0 ? n : DEFAULTS.interval;
    settings.unit = unitSel.value === '60' ? 60 : 1;
    const order = orderSel.value;
    const orderChanged = isOrder(order) && order !== settings.order;
    if (isOrder(order)) settings.order = order;
    if (isRepeat(repeatSel.value)) settings.repeat = repeatSel.value;
    settings.auto = autoInput.checked;
    if (orderChanged && settings.order === 'shuffle') {
      const rest = shuffled(items.map((i) => i.uid).filter((u) => u !== currentUid));
      sequence = byUid(currentUid) && currentUid ? [currentUid, ...rest] : rest;
    }
    if (orderChanged) passCount = 0;
    persist();
    updateStatus();
  }

  for (const input of [intervalInput, unitSel, orderSel, repeatSel, autoInput]) {
    input.addEventListener('change', readSettings);
  }
  playBtn.addEventListener('click', toggle);
  nextBtn.addEventListener('click', () => {
    advance(true);
  });
  prevBtn.addEventListener('click', () => {
    const uid = pickPrev();
    if (uid !== null) void go(uid, false);
  });
  addCurrentBtn.addEventListener('click', () => {
    const cur = host.current();
    if (!cur) {
      host.flash('The editor is empty');
      return;
    }
    add([cur]);
  });
  addShownBtn.addEventListener('click', () => {
    const shown = host.shown();
    if (shown.length === 0) {
      host.flash('No sketches are listed in the Albums window');
      return;
    }
    add(shown);
  });
  clearBtn.addEventListener('click', clear);

  setInterval(() => {
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    if (running && !switching && settings.auto && host.isPlaying()) {
      elapsed += dt;
      if (elapsed >= intervalMs()) {
        advance(false);
        return;
      }
    }
    updateStatus();
  }, 250);

  render();

  return {
    add,
    running: () => running,
    next() {
      if (items.length === 0) return false;
      advance(true);
      return true;
    },
    previous() {
      const uid = pickPrev();
      if (uid === null) return false;
      void go(uid, false);
      return true;
    },
  };
}
