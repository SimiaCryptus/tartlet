// Window manager for the playground. Panels can be hidden, collapsed, docked (left, center, right,
// bottom), floated, dragged, resized and reordered; the layout persists in localStorage. On narrow
// screens it switches to one full-width panel at a time with a bottom tab bar.
//
// Panels only move in the DOM when they change dock. Floating, hiding and the mobile layout are pure
// CSS, so custom elements inside (the player) are not disconnected by everyday layout changes.

export type Zone = 'left' | 'center' | 'right' | 'bottom';
type Side = 'left' | 'right' | 'bottom';

const ZONES: readonly Zone[] = ['left', 'center', 'right', 'bottom'];
const SIDES: readonly Side[] = ['left', 'right', 'bottom'];
const HIT_ORDER: readonly Zone[] = ['left', 'right', 'bottom', 'center'];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PanelState {
  zone: Zone;
  index: number;
  floating: boolean;
  hidden: boolean;
  collapsed: boolean;
  height: number | null;
  rect: Rect | null;
}

interface Panel {
  readonly id: string;
  readonly title: string;
  readonly el: HTMLElement;
  readonly head: HTMLElement;
  readonly grip: HTMLElement;
  readonly collapseBtn: HTMLButtonElement;
  readonly menuBtn: HTMLButtonElement;
  readonly tab: HTMLButtonElement;
  readonly defaults: PanelState;
  state: PanelState;
}

type MenuItem = { label: string; action: () => void; checked?: boolean; disabled?: boolean } | 'separator';

export interface PanelManager {
  /** Shows a panel (on phones: switches to its tab). */
  show(id: string): void;
  hide(id: string): void;
  toggle(id: string): void;
  isVisible(id: string): boolean;
  isMobile(): boolean;
  reset(): void;
}

export interface PanelOptions {
  /** Container holding [data-dock] areas and [data-split] splitters. */
  desk: HTMLElement;
  /** Top-bar button that opens the Windows menu. */
  windowsButton: HTMLButtonElement;
  /** Bottom tab bar used on phones. */
  tabbar: HTMLElement;
  /** Panel shown first on phones. */
  defaultActive?: string;
  mobileQuery?: string;
}

const STORAGE_KEY = 'tartlet.layout.v1';
const DEFAULT_SIZES: Record<Side, number> = { left: 300, right: 360, bottom: 260 };
const SPLITTER = 6;
const MIN_CENTER = 320;
const MIN_FLOAT_W = 260;
const MIN_FLOAT_H = 120;
const EDGE = 72;

const px = (n: number): string => `${String(Math.round(n))}px`;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function isZone(v: unknown): v is Zone {
  return typeof v === 'string' && (ZONES as readonly string[]).includes(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function readRect(v: unknown): Rect | null {
  const r = obj(v);
  const x = num(r.x);
  const y = num(r.y);
  const w = num(r.w);
  const h = num(r.h);
  return x !== null && y !== null && w !== null && h !== null ? { x, y, w, h } : null;
}

function readState(v: unknown, def: PanelState): PanelState {
  if (typeof v !== 'object' || v === null) return { ...def };
  const r = v as Record<string, unknown>;
  const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
  return {
    zone: isZone(r.zone) ? r.zone : def.zone,
    index: num(r.index) ?? def.index,
    floating: bool(r.floating, def.floating),
    hidden: bool(r.hidden, def.hidden),
    collapsed: bool(r.collapsed, def.collapsed),
    height: num(r.height),
    rect: readRect(r.rect),
  };
}

function iconButton(label: string, text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'panel-btn';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.textContent = text;
  return b;
}

function isControl(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest('button, input, select, textarea, a') !== null;
}

/** True if moving this element would disconnect a custom element (which may reset its state). */
function fragile(el: Element): boolean {
  for (const n of el.querySelectorAll('*')) if (n.tagName.includes('-')) return true;
  return false;
}

export function initPanels(opts: PanelOptions): PanelManager {
  const { desk, windowsButton, tabbar } = opts;
  const mq = window.matchMedia(opts.mobileQuery ?? '(max-width: 760px)');
  let mobile = mq.matches;

  const docks = {} as Record<Zone, HTMLElement>;
  for (const z of ZONES) {
    const d = desk.querySelector<HTMLElement>(`[data-dock="${z}"]`);
    if (!d) throw new Error(`missing dock ${z}`);
    docks[z] = d;
  }
  const splitters = {} as Record<Side, HTMLElement>;
  for (const s of SIDES) {
    const e = desk.querySelector<HTMLElement>(`[data-split="${s}"]`);
    if (!e) throw new Error(`missing splitter ${s}`);
    splitters[s] = e;
  }

  let zTop = 60;
  const panels: Panel[] = [];
  for (const z of ZONES) {
    docks[z].querySelectorAll<HTMLElement>(':scope > .panel[data-panel]').forEach((el, index) => {
      panels.push(buildPanel(el, z, index));
    });
  }
  const find = (id: string): Panel | undefined => panels.find((p) => p.id === id);
  const defaultActive = find(opts.defaultActive ?? '')?.id ?? panels[0]?.id ?? '';

  // ---- state

  const sizes: Record<Side, number> = { ...DEFAULT_SIZES };
  let shown: Record<Side, number> = { left: 0, right: 0, bottom: 0 };
  let active = defaultActive;

  const saved = loadSaved();
  if (saved) {
    for (const p of panels) p.state = readState(saved.panels[p.id], p.defaults);
    for (const s of SIDES) sizes[s] = num(saved.sizes[s]) ?? DEFAULT_SIZES[s];
    if (typeof saved.active === 'string' && find(saved.active)) active = saved.active;
    placeAll();
  }

  function loadSaved(): {
    panels: Record<string, unknown>;
    sizes: Record<string, unknown>;
    active: unknown;
  } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const r = obj(JSON.parse(raw) as unknown);
      return { panels: obj(r.panels), sizes: obj(r.sizes), active: r.active };
    } catch {
      return null;
    }
  }

  function save(): void {
    for (const p of panels) {
      const parent = p.el.parentElement;
      p.state.index = parent ? Array.prototype.indexOf.call(parent.children, p.el) : 0;
    }
    const data = { panels: Object.fromEntries(panels.map((p) => [p.id, p.state])), sizes, active };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // storage unavailable; the layout just won't persist
    }
  }

  /** Puts every panel into its dock, in saved order, moving only those that are out of place. */
  function placeAll(): void {
    for (const z of ZONES) {
      const d = docks[z];
      panels
        .filter((p) => p.state.zone === z)
        .sort((a, b) => a.state.index - b.state.index)
        .forEach((p, i) => {
          const at = d.children[i] ?? null;
          if (at !== p.el) d.insertBefore(p.el, at);
        });
    }
  }

  /** Docked, visible panels of a zone in DOM order. */
  function inDock(z: Zone): Panel[] {
    const out: Panel[] = [];
    for (const c of docks[z].children) {
      const p = panels.find((x) => x.el === c);
      if (p && !p.state.floating && !p.state.hidden) out.push(p);
    }
    return out;
  }

  // ---- building

  function buildPanel(el: HTMLElement, zone: Zone, index: number): Panel {
    const id = el.dataset.panel ?? `panel-${String(index)}`;
    const title = el.dataset.title ?? id;
    if (!el.id) el.id = `panel-${id}`;
    let body = el.querySelector<HTMLElement>(':scope > .panel-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'panel-body';
      body.append(...el.childNodes);
      el.append(body);
    }
    if (!body.id) body.id = `${el.id}-body`;

    const head = document.createElement('header');
    head.className = 'panel-head';
    const icon = document.createElement('span');
    icon.className = 'panel-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = el.dataset.icon ?? '•';
    const h = document.createElement('h2');
    h.className = 'panel-title';
    h.id = `${el.id}-title`;
    h.textContent = title;
    const tools = document.createElement('div');
    tools.className = 'panel-tools';
    const collapseBtn = iconButton(`Collapse ${title}`, '▾');
    collapseBtn.setAttribute('aria-controls', body.id);
    const menuBtn = iconButton(`${title} window options`, '⋮');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    const closeBtn = iconButton(`Hide ${title}`, '×');
    tools.append(collapseBtn, menuBtn, closeBtn);
    head.append(icon, h, tools);

    const grip = document.createElement('div');
    grip.className = 'panel-grip';
    grip.setAttribute('aria-hidden', 'true');
    el.prepend(head);
    el.append(grip);
    el.setAttribute('role', 'region');
    el.setAttribute('aria-labelledby', h.id);

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', el.id);
    const tabIcon = document.createElement('span');
    tabIcon.className = 'tab-icon';
    tabIcon.setAttribute('aria-hidden', 'true');
    tabIcon.textContent = el.dataset.icon ?? '•';
    const tabLabel = document.createElement('span');
    tabLabel.className = 'tab-label';
    tabLabel.textContent = el.dataset.short ?? title;
    tab.append(tabIcon, tabLabel);
    tabbar.append(tab);

    const defaults: PanelState = {
      zone,
      index,
      floating: false,
      hidden: el.hasAttribute('data-hidden'),
      collapsed: el.hasAttribute('data-collapsed'),
      height: null,
      rect: null,
    };
    const p: Panel = { id, title, el, head, grip, collapseBtn, menuBtn, tab, defaults, state: { ...defaults } };

    collapseBtn.addEventListener('click', () => {
      toggleCollapse(p);
    });
    menuBtn.addEventListener('click', () => {
      if (menuOwner === menuBtn) closeMenu();
      else openMenu(menuBtn, panelMenu(p));
    });
    closeBtn.addEventListener('click', () => {
      hidePanel(p);
    });
    tab.addEventListener('click', () => {
      showPanel(p);
    });
    head.addEventListener('dblclick', (e) => {
      if (mobile || isControl(e.target)) return;
      toggleCollapse(p);
    });
    head.addEventListener('pointerdown', (e) => {
      startDrag(p, e);
    });
    grip.addEventListener('pointerdown', (e) => {
      startResize(p, e);
    });
    grip.addEventListener('dblclick', () => {
      resetSize(p);
    });
    el.addEventListener(
      'pointerdown',
      () => {
        raise(p);
      },
      true,
    );
    return p;
  }

  // ---- rendering

  function defaultRect(p: Panel): Rect {
    const r = p.el.getBoundingClientRect();
    const w = clamp(r.width || 420, 340, 520);
    const h = clamp(r.height || 360, 200, window.innerHeight * 0.6);
    const x = r.width ? r.left + 24 : (window.innerWidth - w) / 2;
    const y = r.height ? r.top + 24 : (window.innerHeight - h) / 3;
    return { x, y, w, h };
  }

  function clampRect(r: Rect): Rect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = clamp(r.w, MIN_FLOAT_W, vw - 16);
    const h = clamp(r.h, MIN_FLOAT_H, vh - 16);
    return { w, h, x: clamp(r.x, 120 - w, vw - 120), y: clamp(r.y, 0, vh - 40) };
  }

  function applyPanel(p: Panel): void {
    const { el, state: s } = p;
    const isActive = mobile && active === p.id;
    const floating = !mobile && s.floating && !s.hidden;
    el.classList.toggle('is-hidden', !mobile && s.hidden);
    el.classList.toggle('is-collapsed', !mobile && s.collapsed);
    el.classList.toggle('is-floating', floating);
    el.classList.toggle('is-active', isActive);
    const st = el.style;
    if (floating) {
      const r = clampRect(s.rect ?? defaultRect(p));
      s.rect = r;
      st.left = px(r.x);
      st.top = px(r.y);
      st.width = px(r.w);
      st.height = s.collapsed ? '' : px(r.h);
      if (!st.zIndex) st.zIndex = String(++zTop);
      el.classList.remove('has-size');
    } else {
      st.left = '';
      st.top = '';
      st.width = '';
      st.zIndex = '';
      const sized = !mobile && s.height !== null && !s.collapsed && s.zone !== 'bottom';
      st.height = sized && s.height !== null ? px(s.height) : '';
      el.classList.toggle('has-size', sized);
    }
    const verb = s.collapsed ? 'Expand' : 'Collapse';
    p.collapseBtn.textContent = s.collapsed ? '▸' : '▾';
    p.collapseBtn.setAttribute('aria-label', `${verb} ${p.title}`);
    p.collapseBtn.title = `${verb} ${p.title}`;
    p.collapseBtn.setAttribute('aria-expanded', String(!s.collapsed));
    p.tab.setAttribute('aria-selected', String(isActive));
  }

  function layout(): void {
    document.body.classList.toggle('is-mobile', mobile);
    desk.classList.toggle('is-mobile', mobile);
    if (!find(active)) active = defaultActive;
    for (const p of panels) applyPanel(p);

    const count = {} as Record<Zone, number>;
    for (const z of ZONES) {
      count[z] = inDock(z).length;
      docks[z].classList.toggle('is-empty', count[z] === 0);
    }
    for (const s of SIDES) splitters[s].hidden = mobile || count[s] === 0;

    if (mobile) {
      desk.style.gridTemplateColumns = '';
      desk.style.gridTemplateRows = '';
      return;
    }
    const W = desk.clientWidth;
    const H = desk.clientHeight;
    let l = count.left ? clamp(sizes.left, 160, W * 0.45) : 0;
    let r = count.right ? clamp(sizes.right, 200, W * 0.5) : 0;
    const avail = W - MIN_CENTER - (l ? SPLITTER : 0) - (r ? SPLITTER : 0);
    if (l + r > avail && l + r > 0) {
      const k = Math.max(avail, 0) / (l + r);
      l *= k;
      r *= k;
    }
    const b = count.bottom ? clamp(sizes.bottom, 100, H * 0.7) : 0;
    shown = { left: l, right: r, bottom: b };
    desk.style.gridTemplateColumns = `${px(l)} ${px(l ? SPLITTER : 0)} minmax(0, 1fr) ${px(r ? SPLITTER : 0)} ${px(r)}`;
    desk.style.gridTemplateRows = `minmax(0, 1fr) ${px(b ? SPLITTER : 0)} ${px(b)}`;
  }

  function commit(): void {
    layout();
    save();
  }

  function notify(p: Panel): void {
    p.el.dispatchEvent(new CustomEvent('panelshow'));
  }

  function visible(p: Panel): boolean {
    return mobile ? active === p.id : !p.state.hidden && !p.state.collapsed;
  }

  // ---- actions

  function raise(p: Panel): void {
    if (!mobile && p.state.floating) p.el.style.zIndex = String(++zTop);
  }

  function showPanel(p: Panel): void {
    const was = visible(p);
    if (mobile) {
      active = p.id;
      commit();
      window.scrollTo({ top: 0 });
      p.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else {
      p.state.hidden = false;
      p.state.collapsed = false;
      raise(p);
      commit();
      p.el.scrollIntoView({ block: 'nearest' });
    }
    if (!was) notify(p);
  }

  function hidePanel(p: Panel): void {
    if (mobile) return;
    const hadFocus = p.el.contains(document.activeElement);
    p.state.hidden = true;
    commit();
    if (hadFocus) windowsButton.focus();
  }

  function toggleCollapse(p: Panel): void {
    if (mobile) return;
    p.state.collapsed = !p.state.collapsed;
    commit();
    if (!p.state.collapsed) notify(p);
  }

  /** Docks a panel. With `before` undefined it stays put if already in that dock, else goes last. */
  function dock(p: Panel, z: Zone, before?: Element | null): void {
    const d = docks[z];
    if (before !== undefined) {
      const inPlace = p.el.parentElement === d && p.el.nextElementSibling === before;
      if (before !== p.el && !inPlace) d.insertBefore(p.el, before);
    } else if (p.el.parentElement !== d) {
      d.append(p.el);
    }
    p.state.zone = z;
    p.state.floating = false;
    p.state.hidden = false;
    commit();
  }

  function floatPanel(p: Panel): void {
    if (!p.state.floating) p.state.rect = defaultRect(p);
    p.state.floating = true;
    p.state.hidden = false;
    p.el.style.zIndex = '';
    commit();
  }

  function movePanel(p: Panel, dir: -1 | 1): void {
    const list = inDock(p.state.zone);
    const i = list.indexOf(p);
    const other = list[i + dir];
    if (i < 0 || !other) return;
    const d = docks[p.state.zone];
    // Swapping neighbours can move either one; prefer not to disconnect the player.
    const moveOther = fragile(p.el) && !fragile(other.el);
    if (dir < 0) {
      if (moveOther) d.insertBefore(other.el, p.el.nextElementSibling);
      else d.insertBefore(p.el, other.el);
    } else if (moveOther) {
      d.insertBefore(other.el, p.el);
    } else {
      d.insertBefore(p.el, other.el.nextElementSibling);
    }
    commit();
    p.menuBtn.focus();
  }

  function resetSize(p: Panel): void {
    p.state.height = null;
    if (p.state.rect) p.state.rect = { ...p.state.rect, w: 420, h: 360 };
    commit();
  }

  function reset(): void {
    for (const p of panels) {
      p.state = { ...p.defaults };
      p.el.style.zIndex = '';
    }
    Object.assign(sizes, DEFAULT_SIZES);
    active = defaultActive;
    placeAll();
    commit();
    for (const p of panels) if (visible(p)) notify(p);
  }

  // ---- drag to move and dock

  const hints = document.createElement('div');
  hints.className = 'drop-hints';
  hints.hidden = true;
  hints.setAttribute('aria-hidden', 'true');
  const hintEls = {} as Record<Zone, HTMLElement>;
  for (const z of ZONES) {
    const h = document.createElement('div');
    h.className = 'drop-hint';
    h.dataset.zone = z;
    h.textContent = `Dock ${z}`;
    hintEls[z] = h;
    hints.append(h);
  }
  document.body.append(hints);
  let dropTarget: Zone | null = null;

  function zoneRects(): Record<Zone, DOMRect> {
    const d = desk.getBoundingClientRect();
    const cx = d.left + d.width / 2;
    const cy = d.top + d.height / 2;
    return {
      left: new DOMRect(d.left, d.top, EDGE, d.height),
      right: new DOMRect(d.right - EDGE, d.top, EDGE, d.height),
      bottom: new DOMRect(d.left + EDGE, d.bottom - EDGE, Math.max(0, d.width - 2 * EDGE), EDGE),
      center: new DOMRect(cx - 90, cy - 55, 180, 110),
    };
  }

  function hitTest(x: number, y: number): Zone | null {
    const rects = zoneRects();
    for (const z of HIT_ORDER) {
      const r = rects[z];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
    }
    return null;
  }

  function setTarget(z: Zone | null): void {
    dropTarget = z;
    for (const zz of ZONES) hintEls[zz].classList.toggle('is-target', zz === z);
  }

  function showHints(on: boolean): void {
    hints.hidden = !on;
    if (!on) {
      setTarget(null);
      return;
    }
    const rects = zoneRects();
    for (const z of ZONES) {
      const r = rects[z];
      const st = hintEls[z].style;
      st.left = px(r.left);
      st.top = px(r.top);
      st.width = px(r.width);
      st.height = px(r.height);
    }
  }

  function insertionPoint(p: Panel, z: Zone, ev: PointerEvent): Element | null {
    const horizontal = z === 'bottom';
    const pos = horizontal ? ev.clientX : ev.clientY;
    for (const o of inDock(z)) {
      if (o === p) continue;
      const r = o.el.getBoundingClientRect();
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      if (pos < mid) return o.el;
    }
    return null;
  }

  function startDrag(p: Panel, e: PointerEvent): void {
    if (mobile || e.button !== 0 || isControl(e.target)) return;
    const head = p.head;
    const start = p.el.getBoundingClientRect();
    const offX = e.clientX - start.left;
    const offY = e.clientY - start.top;
    let dragging = false;
    head.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
        dragging = true;
        closeMenu();
        if (!p.state.floating) {
          p.state.rect = {
            x: start.left,
            y: start.top,
            w: start.width,
            h: Math.min(start.height, window.innerHeight * 0.6),
          };
          p.state.floating = true;
          p.el.style.zIndex = '';
          layout();
        }
        document.body.classList.add('is-dragging');
        showHints(true);
      }
      const r = p.state.rect ?? defaultRect(p);
      p.state.rect = { ...r, x: ev.clientX - offX, y: ev.clientY - offY };
      applyPanel(p);
      setTarget(hitTest(ev.clientX, ev.clientY));
    };
    const end = (ev: PointerEvent): void => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', end);
      head.removeEventListener('pointercancel', end);
      if (!dragging) return;
      document.body.classList.remove('is-dragging');
      const target = ev.type === 'pointerup' ? dropTarget : null;
      showHints(false);
      if (target) dock(p, target, insertionPoint(p, target, ev));
      else commit();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  // ---- resize

  function startResize(p: Panel, e: PointerEvent): void {
    if (mobile || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = p.grip;
    grip.setPointerCapture(e.pointerId);
    const start = p.el.getBoundingClientRect();
    document.body.classList.add('is-resizing');
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - e.clientX;
      const dy = ev.clientY - e.clientY;
      if (p.state.floating) {
        const r = p.state.rect ?? defaultRect(p);
        p.state.rect = { ...r, w: start.width + dx, h: start.height + dy };
      } else {
        p.state.height = Math.max(MIN_FLOAT_H, start.height + dy);
      }
      applyPanel(p);
    };
    const end = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      document.body.classList.remove('is-resizing');
      save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  for (const s of SIDES) {
    const sp = splitters[s];
    sp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      const base = shown[s];
      sp.classList.add('is-active');
      document.body.classList.add('is-resizing');
      const move = (ev: PointerEvent): void => {
        const d =
          s === 'left' ? ev.clientX - e.clientX : s === 'right' ? e.clientX - ev.clientX : e.clientY - ev.clientY;
        sizes[s] = Math.max(0, base + d);
        layout();
      };
      const end = (): void => {
        sp.removeEventListener('pointermove', move);
        sp.removeEventListener('pointerup', end);
        sp.removeEventListener('pointercancel', end);
        sp.classList.remove('is-active');
        document.body.classList.remove('is-resizing');
        sizes[s] = shown[s];
        save();
      };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', end);
      sp.addEventListener('pointercancel', end);
    });
    sp.addEventListener('keydown', (e) => {
      const grow = s === 'left' ? 'ArrowRight' : s === 'right' ? 'ArrowLeft' : 'ArrowUp';
      const shrink = s === 'left' ? 'ArrowLeft' : s === 'right' ? 'ArrowRight' : 'ArrowDown';
      const step = e.shiftKey ? 64 : 16;
      if (e.key === grow) sizes[s] = shown[s] + step;
      else if (e.key === shrink) sizes[s] = shown[s] - step;
      else return;
      e.preventDefault();
      commit();
    });
    sp.addEventListener('dblclick', () => {
      sizes[s] = DEFAULT_SIZES[s];
      commit();
    });
  }

  // ---- menus

  const menu = document.createElement('div');
  menu.className = 'panel-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  let menuOwner: HTMLElement | null = null;

  function openMenu(anchor: HTMLElement, items: readonly MenuItem[]): void {
    closeMenu();
    menu.replaceChildren(
      ...items.map((it) => {
        if (it === 'separator') {
          const hr = document.createElement('hr');
          hr.setAttribute('role', 'separator');
          return hr;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = it.label;
        b.setAttribute('role', it.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
        if (it.checked !== undefined) b.setAttribute('aria-checked', String(it.checked));
        b.disabled = !!it.disabled;
        b.addEventListener('click', () => {
          closeMenu(true);
          it.action();
        });
        return b;
      }),
    );
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = px(clamp(r.right - mw, 8, window.innerWidth - mw - 8));
    const below = r.bottom + 4;
    menu.style.top = px(below + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh - 4) : below);
    menuOwner = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  function closeMenu(restoreFocus = false): void {
    if (menu.hidden) return;
    menu.hidden = true;
    const owner = menuOwner;
    menuOwner = null;
    owner?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && owner?.isConnected) owner.focus();
  }

  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n === 0) return;
      const next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      items[next]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  });
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target;
      if (menu.hidden || !(t instanceof Node)) return;
      if (!menu.contains(t) && !menuOwner?.contains(t)) closeMenu();
    },
    true,
  );

  function panelMenu(p: Panel): MenuItem[] {
    const s = p.state;
    const list = inDock(s.zone);
    const i = list.indexOf(p);
    const items: MenuItem[] = ZONES.map((z) => ({
      label: `Dock ${z}`,
      checked: !s.floating && s.zone === z,
      action: () => {
        dock(p, z);
      },
    }));
    items.push(
      {
        label: 'Float',
        checked: s.floating,
        action: () => {
          floatPanel(p);
        },
      },
      'separator',
      {
        label: 'Move up',
        disabled: s.floating || i <= 0,
        action: () => {
          movePanel(p, -1);
        },
      },
      {
        label: 'Move down',
        disabled: s.floating || i < 0 || i >= list.length - 1,
        action: () => {
          movePanel(p, 1);
        },
      },
      {
        label: 'Reset size',
        action: () => {
          resetSize(p);
        },
      },
      {
        label: s.collapsed ? 'Expand' : 'Collapse',
        action: () => {
          toggleCollapse(p);
        },
      },
      {
        label: 'Hide',
        action: () => {
          hidePanel(p);
        },
      },
    );
    return items;
  }

  function windowsMenu(): MenuItem[] {
    const items: MenuItem[] = panels.map((p) => ({
      label: p.title,
      checked: mobile ? active === p.id : !p.state.hidden,
      action: () => {
        if (mobile || p.state.hidden) showPanel(p);
        else hidePanel(p);
      },
    }));
    items.push('separator', { label: 'Reset layout', action: reset });
    return items;
  }

  windowsButton.addEventListener('click', () => {
    if (menuOwner === windowsButton) closeMenu();
    else openMenu(windowsButton, windowsMenu());
  });

  // ---- responsiveness

  mq.addEventListener('change', () => {
    mobile = mq.matches;
    closeMenu();
    layout();
    const p = find(active);
    if (mobile && p) notify(p);
  });
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(layout);
  });

  layout();
  requestAnimationFrame(layout);

  return {
    show(id) {
      const p = find(id);
      if (p) showPanel(p);
    },
    hide(id) {
      const p = find(id);
      if (p) hidePanel(p);
    },
    toggle(id) {
      const p = find(id);
      if (!p) return;
      if (visible(p)) hidePanel(p);
      else showPanel(p);
    },
    isVisible(id) {
      const p = find(id);
      return p ? visible(p) : false;
    },
    isMobile: () => mobile,
    reset,
  };
}
