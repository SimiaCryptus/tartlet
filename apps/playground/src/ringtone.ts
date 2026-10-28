// Ringtone export: records the sketch, shapes it (trim, level, fade) and offers WAV / M4R files.
import { canRecordCompressed, recordOutput, waitForOutput, type Recording } from './audio-capture';

export interface RingtoneHost {
  /** Applies the editor and (re)starts playback from the top. Called directly from a click. */
  prepare(): Promise<void>;
  stop(): void;
  fileStem(): string;
  hasErrors(): boolean;
  flash(msg: string): void;
}

const LEAD_IN = 1.5; // extra seconds recorded so start-up latency can be trimmed away
const SILENCE = 1e-4;

/** Trims leading silence, cuts to length, normalises to about -1 dBFS and fades in and out. */
export function shapeRingtone(rec: Recording, seconds: number): Float32Array[] {
  const sr = rec.sampleRate;
  const [l = new Float32Array(0), r = l] = rec.channels;
  const limit = Math.min(l.length, Math.round(sr * LEAD_IN));
  let start = 0;
  while (start < limit && Math.abs(l[start] ?? 0) < SILENCE && Math.abs(r[start] ?? 0) < SILENCE) start++;
  const len = Math.max(0, Math.min(l.length - start, Math.round(seconds * sr)));
  const out = [l.slice(start, start + len), r.slice(start, start + len)];

  let peak = 0;
  for (const ch of out) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  if (peak < SILENCE * 10) {
    throw new Error('Nothing was heard. Check that the sketch makes sound and is not muted, then try again.');
  }
  const gain = Math.min(0.9 / peak, 4);
  const fadeIn = Math.min(len, Math.round(sr * 0.005));
  const fadeOut = Math.min(len, Math.round(sr * 0.4));
  for (const ch of out) {
    for (let i = 0; i < len; i++) {
      let g = gain;
      if (i < fadeIn) g *= i / fadeIn;
      const fromEnd = len - 1 - i;
      if (fromEnd < fadeOut) g *= fromEnd / fadeOut;
      ch[i] = (ch[i] ?? 0) * g;
    }
  }
  return out;
}

/** 16-bit PCM WAV, which every phone and computer can play. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  const nCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataLen = frames * nCh * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * 2, true);
  v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      const s = Math.max(-1, Math.min(1, ch[i] ?? 0));
      v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function initRingtone(dialog: HTMLDialogElement, host: RingtoneHost): () => void {
  function q<T extends HTMLElement>(sel: string, type: new () => T): T {
    const e = dialog.querySelector(sel);
    if (!(e instanceof type)) throw new Error(`missing ${sel}`);
    return e;
  }
  const lengthSel = q('#rt-length', HTMLSelectElement);
  const recordBtn = q('#rt-record', HTMLButtonElement);
  const cancelBtn = q('#rt-cancel', HTMLButtonElement);
  const progress = q('#rt-progress', HTMLProgressElement);
  const statusEl = q('#rt-status', HTMLElement);
  const preview = q('#rt-preview', HTMLAudioElement);
  const wavBtn = q('#rt-download-wav', HTMLButtonElement);
  const m4rBtn = q('#rt-download-m4r', HTMLButtonElement);
  const shareBtn = q('#rt-share', HTMLButtonElement);

  let busy: AbortController | null = null;
  let wav: Blob | null = null;
  let m4r: Blob | null = null;
  let previewUrl: string | null = null;

  const stem = (): string => `${host.fileStem()}-ringtone`;
  const setStatus = (msg: string, isError = false): void => {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  };

  function wavFile(): File | null {
    return wav ? new File([wav], `${stem()}.wav`, { type: 'audio/wav' }) : null;
  }

  function canShareFile(file: File): boolean {
    return 'canShare' in navigator && navigator.canShare({ files: [file] });
  }

  function updateUi(): void {
    const recording = busy !== null;
    recordBtn.disabled = recording;
    lengthSel.disabled = recording;
    cancelBtn.hidden = !recording;
    progress.hidden = !recording;
    wavBtn.disabled = recording || !wav;
    m4rBtn.hidden = !m4r;
    m4rBtn.disabled = recording;
    const file = wavFile();
    shareBtn.hidden = !file || !canShareFile(file);
    shareBtn.disabled = recording;
    preview.hidden = !previewUrl;
  }

  async function record(): Promise<void> {
    if (busy) return;
    const ctrl = new AbortController();
    busy = ctrl;
    progress.value = 0;
    updateUi();
    const seconds = Number(lengthSel.value) || 20;
    try {
      // prepare() starts playback, so it must run before any await to keep the click's user activation.
      const started = host.prepare();
      setStatus(host.hasErrors() ? 'The sketch has errors; recording whatever plays…' : 'Starting playback…');
      await started;
      await waitForOutput(3000, ctrl.signal);
      setStatus(`Recording ${String(seconds)} seconds in real time…`);
      const rec = await recordOutput(seconds + LEAD_IN, {
        signal: ctrl.signal,
        onProgress: (f) => {
          progress.value = f;
        },
      });
      const shaped = shapeRingtone(rec, seconds);
      wav = encodeWav(shaped, rec.sampleRate);
      m4r = rec.compressed;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(wav);
      preview.src = previewUrl;
      setStatus(`Ready: ${String(seconds)} s, ${(wav.size / 1_000_000).toFixed(1)} MB WAV${m4r ? ' + M4R' : ''}.`);
      host.flash('Ringtone ready');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setStatus('Cancelled.');
      else setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      host.stop();
      busy = null;
      updateUi();
    }
  }

  recordBtn.addEventListener('click', () => void record());
  cancelBtn.addEventListener('click', () => {
    busy?.abort();
  });
  wavBtn.addEventListener('click', () => {
    if (wav) downloadBlob(wav, `${stem()}.wav`);
  });
  m4rBtn.addEventListener('click', () => {
    if (m4r) downloadBlob(m4r, `${stem()}.m4r`);
  });
  shareBtn.addEventListener('click', () => {
    const file = wavFile();
    if (!file) return;
    navigator.share({ files: [file], title: 'Tartlet ringtone' }).catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === 'AbortError')) host.flash('Sharing failed');
    });
  });
  dialog.addEventListener('close', () => {
    busy?.abort();
    preview.pause();
  });

  return () => {
    if (!canRecordCompressed()) m4rBtn.title = 'This browser cannot encode AAC; use the WAV file';
    if (!busy) setStatus('Plays the sketch and records it. Keep this tab open while recording.');
    updateUi();
    dialog.showModal();
  };
}
