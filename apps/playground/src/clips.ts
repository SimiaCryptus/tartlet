// Clips panel: import audio clips from URLs (WAV, etc.), inspect runtime resampling & retuning
// calibration, audition calibrated notes, and insert `importClip(...)` into the editor.
import type { TartletPlayerElement } from '@tartlet/element';
import { midiToNoteName, type SampleEntry } from '@tartlet/samples';
import { AudioEngine } from '@tartlet/webaudio';

export interface DemoClip {
  readonly name: string;
  readonly label: string;
  readonly url: string;
}

export const DEMO_CLIPS: readonly DemoClip[] = [
  { name: 'kalimba', label: 'Detuned kalimba (22 kHz, +25¢)', url: './clips/detuned-kalimba.wav' },
  { name: 'brass', label: 'Flat brass (32 kHz, −31¢)', url: './clips/flat-brass.wav' },
  { name: 'rottweiler', label: 'Rottweiler bark (CC BY-SA)', url: './clips/open/rottweiler.wav' },
  { name: 'siamese', label: 'Siamese meow (CC0)', url: './clips/open/siamese.wav' },
  { name: 'cowbell', label: 'Cowbell (Public domain)', url: './clips/open/cowbell.wav' },
  { name: 'horn', label: 'Matatu brass horn (CC0)', url: './clips/open/matatu-horn.wav' },
];

export interface ClipsOptions {
  readonly player: TartletPlayerElement;
  readonly onInsert: (directive: string) => void;
  readonly flash: (msg: string) => void;
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}

function formatCalibration(entry: SampleEntry): string {
  const c = entry.calibration;
  if (!c) return `${entry.kind} · ${String(entry.takes.length)} take${entry.takes.length === 1 ? '' : 's'}`;
  const rate = `${String(c.sourceSampleRate)} → ${String(c.sampleRate)} Hz`;
  if (c.detectedHz !== null && c.root !== null) {
    const sign = c.retuneCents >= 0 ? '+' : '';
    return `${rate} · ${c.detectedHz.toFixed(1)} Hz → ${midiToNoteName(c.root)} (${sign}${c.retuneCents.toFixed(1)}¢)`;
  }
  return `${rate} · unpitched (${c.kind})`;
}

export function initClips(opts: ClipsOptions): void {
  const form = el('clips-form') as HTMLFormElement;
  const nameInput = el('clip-name') as HTMLInputElement;
  const urlInput = el('clip-url') as HTMLInputElement;
  const rootSelect = el('clip-root') as HTMLSelectElement;
  const status = el('clip-status');
  const demosEl = el('clip-demos');
  const listEl = el('clip-list');
  const emptyEl = el('clip-empty');

  let auditionEngine: AudioEngine | undefined;
  async function audition(entry: SampleEntry): Promise<void> {
    try {
      auditionEngine ??= await AudioEngine.create();
      if (auditionEngine.ctx.state === 'suspended') await auditionEngine.ctx.resume();
      auditionEngine.setLibrary(opts.player.library);
      const t0 = auditionEngine.ctx.currentTime + 0.02;
      if (entry.kind === 'note') {
        // Play a calibrated C-major triad arpeggio so the tuning is immediately audible.
        const notes = [60, 64, 67, 72];
        notes.forEach((midi, i) => {
          auditionEngine?.play({ s: entry.name, note: { kind: 'midi', value: midi }, gain: 0.75 }, t0 + i * 0.16, 0.32);
        });
      } else {
        auditionEngine.play({ s: entry.name, gain: 0.85 }, t0, 0.3);
      }
    } catch (e) {
      console.warn(e);
      opts.flash('Audio is unavailable here');
    }
  }

  function renderList(): void {
    const lib = opts.player.library;
    const entries = lib
      .names()
      .map((n) => lib.get(n))
      .filter((e): e is SampleEntry => e !== undefined);
    emptyEl.hidden = entries.length > 0;
    listEl.replaceChildren(
      ...entries.map((entry) => {
        const li = document.createElement('li');
        li.className = 'clip-item';

        const info = document.createElement('div');
        info.className = 'clip-info';
        const title = document.createElement('div');
        title.className = 'clip-head';
        const code = document.createElement('code');
        code.textContent = entry.name;
        const badge = document.createElement('span');
        badge.className = 'brand-tag';
        badge.textContent = entry.kind;
        title.append(code, badge);

        const meta = document.createElement('span');
        meta.className = 'clip-meta';
        meta.textContent = formatCalibration(entry);
        info.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'clip-actions';
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.textContent = entry.kind === 'note' ? 'Arp' : 'Hit';
        playBtn.title = entry.kind === 'note' ? 'Audition calibrated C-major arpeggio' : 'Audition hit';
        playBtn.addEventListener('click', () => {
          void audition(entry);
        });
        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.textContent = 'Insert';
        insertBtn.title = 'Insert importClip(...) directive into the editor';
        insertBtn.addEventListener('click', () => {
          const url = entry.takes[0]?.file ?? '';
          if (!url) return;
          const root = entry.calibration?.root;
          const line =
            root !== null && root !== undefined
              ? `importClip("${entry.name}", "${url}", "${midiToNoteName(root).toLowerCase()}")`
              : `importClip("${entry.name}", "${url}")`;
          opts.onInsert(line);
        });
        actions.append(playBtn, insertBtn);

        li.append(info, actions);
        return li;
      }),
    );
  }

  async function doImport(name: string, url: string, rootVal: string): Promise<void> {
    const cleanName = name.trim();
    const cleanUrl = url.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(cleanName)) {
      status.textContent = 'Name must start with a letter and use letters, digits, "_" or "-".';
      return;
    }
    if (!cleanUrl) {
      status.textContent = 'Enter a WAV or audio clip URL.';
      return;
    }
    status.textContent = `Importing and calibrating "${cleanName}"…`;
    try {
      const targetRoot = rootVal ? Number(rootVal) : undefined;
      const entry = await opts.player.importClip(cleanName, cleanUrl, {
        ...(targetRoot !== undefined && Number.isFinite(targetRoot) ? { targetRoot } : undefined),
      });
      status.textContent = `Ready: ${cleanName} (${formatCalibration(entry)})`;
      renderList();
      opts.flash(`Calibrated "${cleanName}"`);
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'Could not import clip.';
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void doImport(nameInput.value, urlInput.value, rootSelect.value);
  });

  demosEl.replaceChildren(
    ...DEMO_CLIPS.map((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = d.label;
      btn.addEventListener('click', () => {
        nameInput.value = d.name;
        urlInput.value = d.url;
        rootSelect.value = '';
        void doImport(d.name, d.url, '');
      });
      return btn;
    }),
  );

  opts.player.addEventListener('clipschange', () => {
    renderList();
  });
  renderList();
}
