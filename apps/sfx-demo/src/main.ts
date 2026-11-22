import './style.css';
import { midiToNoteName } from '@tartlet/samples';
import { SOUNDS, padSound } from './sounds';
import { TartletSfx, type Sound } from './sfx';

function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`missing #${id}`);
  return e;
}

const sfx = new TartletSfx();
const status = el('audio-status', HTMLElement);
const mute = el('mute', HTMLInputElement);
const lastName = el('last-name', HTMLElement);
const lastCode = el('last-code', HTMLElement);
const pad = el('pad', HTMLElement);
const toggle = el('toggle', HTMLInputElement);
const typing = el('typing', HTMLInputElement);
const custom = el('custom', HTMLTextAreaElement);
const customPlay = el('custom-play', HTMLButtonElement);
const customDiags = el('custom-diags', HTMLUListElement);
const clipForm = el('clip-form', HTMLFormElement);
const clipName = el('clip-name', HTMLInputElement);
const clipUrl = el('clip-url', HTMLInputElement);
const clipReadout = el('clip-readout', HTMLElement);
const clipPlayChord = el('clip-play-chord', HTMLButtonElement);
const clipPlayScale = el('clip-play-scale', HTMLButtonElement);
const clipPlayArp = el('clip-play-arp', HTMLButtonElement);
let activeClipName = '';

function updateStatus(): void {
  status.textContent = sfx.ready ? 'Sound is on.' : 'Click, tap or press a key to turn sound on.';
  status.classList.toggle('is-on', sfx.ready);
}

function show(name: string, sound: Sound): void {
  lastName.textContent = name;
  lastCode.textContent = sound.source.trim();
}

/** Plays a source; `quiet` sounds (typing, hover) do not replace the "last sound" panel. */
function play(name: string, source: string, quiet = false): void {
  sfx.play(source).then(
    (sound) => {
      if (!quiet) show(name, sound);
      updateStatus();
    },
    (e: unknown) => {
      console.warn(e);
    },
  );
}

function playNamed(name: string, quiet = false): void {
  const source = SOUNDS.get(name);
  if (source !== undefined) play(name, source, quiet);
}

// Start the engine on the first gesture anywhere, so hover sounds can play afterwards.
function unlock(): void {
  void sfx.start().then(updateStatus);
}
document.addEventListener('pointerdown', unlock, { once: true });
document.addEventListener('keydown', unlock, { once: true });

// Any element with data-sfx="name" plays that sound when clicked.
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-sfx]') : null;
  const name = target?.dataset.sfx;
  if (name) playNamed(name);
});

// Any element with data-sfx-hover="name" plays that sound when the mouse enters it.
document.addEventListener('pointerover', (e) => {
  if (!sfx.ready || e.pointerType !== 'mouse') return;
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-sfx-hover]') : null;
  if (!target) return;
  if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
  const name = target.dataset.sfxHover;
  if (name) playNamed(name, true);
});

// The pad: height picks the note, left to right sets the pan.
pad.addEventListener('pointerdown', (e) => {
  const r = pad.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  play('pad', padSound((1 - y / r.height) * 9, x / r.width));
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.left = `${String(Math.round(x))}px`;
  ripple.style.top = `${String(Math.round(y))}px`;
  ripple.addEventListener('animationend', () => {
    ripple.remove();
  });
  pad.append(ripple);
});

toggle.addEventListener('change', () => {
  playNamed(toggle.checked ? 'on' : 'off');
});

typing.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (typing.value.trim()) {
      playNamed('send');
      typing.value = '';
    } else {
      playNamed('error');
    }
  } else if (e.key === 'Backspace') {
    playNamed('erase', true);
  } else if (e.key.length === 1) {
    playNamed('key', true);
  }
});

mute.addEventListener('change', () => {
  sfx.muted = mute.checked;
  if (mute.checked) sfx.stopAll();
});

function playCustom(): void {
  sfx.play(custom.value).then(
    (sound) => {
      show('your sound', sound);
      updateStatus();
      const items = sound.diagnostics.map((d) => {
        const li = document.createElement('li');
        li.className = d.severity;
        li.textContent = `line ${String(d.range.start.line + 1)}: ${d.id} ${d.message}`;
        return li;
      });
      if (items.length === 0) {
        const li = document.createElement('li');
        li.textContent = sound.hits.length > 0 ? 'No issues.' : 'No issues, but nothing plays in the first cycle.';
        items.push(li);
      }
      customDiags.replaceChildren(...items);
    },
    (e: unknown) => {
      console.warn(e);
    },
  );
}
customPlay.addEventListener('click', playCustom);
custom.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    playCustom();
  }
});

// ---- URL clip import & runtime calibration demo
async function importAndCalibrate(name: string, url: string): Promise<void> {
  const cleanName = name.trim();
  const cleanUrl = url.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(cleanName)) {
    clipReadout.textContent = 'Name must start with a letter and use letters, digits, "_" or "-".';
    return;
  }
  if (!cleanUrl) {
    clipReadout.textContent = 'Enter a clip URL.';
    return;
  }
  clipReadout.textContent = `Importing & calibrating "${cleanName}"…`;
  try {
    const entry = await sfx.importClip(cleanName, cleanUrl);
    updateStatus();
    if (!entry) {
      clipReadout.textContent = 'Audio is unavailable here.';
      return;
    }
    activeClipName = entry.name;
    clipPlayChord.disabled = false;
    clipPlayScale.disabled = false;
    clipPlayArp.disabled = false;
    const c = entry.calibration;
    if (c && c.detectedHz !== null && c.root !== null) {
      const sign = c.retuneCents >= 0 ? '+' : '';
      clipReadout.textContent = `Calibrated "${entry.name}": resampled ${String(c.sourceSampleRate)} Hz → ${String(c.sampleRate)} Hz, detected ${c.detectedHz.toFixed(1)} Hz → retuned to ${midiToNoteName(c.root)} (${sign}${c.retuneCents.toFixed(1)}¢).`;
    } else if (c) {
      clipReadout.textContent = `Calibrated "${entry.name}": resampled ${String(c.sourceSampleRate)} Hz → ${String(c.sampleRate)} Hz (unpitched ${c.kind}).`;
    } else {
      clipReadout.textContent = `Loaded "${entry.name}".`;
    }
  } catch (e) {
    clipReadout.textContent = e instanceof Error ? e.message : 'Failed to import clip.';
  }
}

clipForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void importAndCalibrate(clipName.value, clipUrl.value);
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-demo-clip]')) {
  btn.addEventListener('click', () => {
    const name = btn.dataset.demoClip ?? 'chime';
    const url = btn.dataset.demoUrl ?? './clips/detuned-chime.wav';
    clipName.value = name;
    clipUrl.value = url;
    void importAndCalibrate(name, url);
  });
}

clipPlayChord.addEventListener('click', () => {
  if (!activeClipName) return;
  play(`${activeClipName} (chord)`, `setcps(1)\n$: note("[c4,e4,g4,c5]").s("${activeClipName}").gain(.7).room(.3)`);
});
clipPlayScale.addEventListener('click', () => {
  if (!activeClipName) return;
  play(
    `${activeClipName} (scale)`,
    `setcps(0.75)\n$: n("0 1 2 3 4 5 6 7").scale("C4:major").s("${activeClipName}").gain(.8).room(.25)`,
  );
});
clipPlayArp.addEventListener('click', () => {
  if (!activeClipName) return;
  play(
    `${activeClipName} (arpeggio)`,
    `setcps(1.2)\n$: note("c4 e4 g4 b4 c5 g4 e4 c4").s("${activeClipName}").gain(.8).room(.35)`,
  );
});

updateStatus();
