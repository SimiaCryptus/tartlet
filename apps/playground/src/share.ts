// Share dialog: link, QR code, native share sheet, email and source copy.
import { drawQr, encodeQr } from './qr';

export interface ShareHost {
  url(): string;
  title(): string;
  source(): string;
  fileStem(): string;
  flash(msg: string): void;
}

export function initShare(dialog: HTMLDialogElement, host: ShareHost): () => void {
  function q<T extends HTMLElement>(sel: string, type: new () => T): T {
    const e = dialog.querySelector(sel);
    if (!(e instanceof type)) throw new Error(`missing ${sel}`);
    return e;
  }
  const urlInput = q('#share-url', HTMLInputElement);
  const copyBtn = q('#share-copy', HTMLButtonElement);
  const nativeBtn = q('#share-native', HTMLButtonElement);
  const emailLink = q('#share-email', HTMLAnchorElement);
  const canvas = q('#share-qr', HTMLCanvasElement);
  const qrNote = q('#share-qr-note', HTMLElement);
  const qrDownload = q('#share-qr-download', HTMLButtonElement);
  const copySourceBtn = q('#share-copy-source', HTMLButtonElement);

  async function copy(text: string, ok: string, fallback?: HTMLInputElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      host.flash(ok);
    } catch {
      if (fallback) {
        fallback.focus();
        fallback.select();
        host.flash('Press Ctrl+C to copy');
      } else {
        host.flash('Copy failed');
      }
    }
  }

  function renderQr(url: string): void {
    try {
      const qr = encodeQr(url);
      const scale = Math.max(4, Math.ceil(512 / (qr.size + 8)));
      drawQr(canvas, qr, scale);
      canvas.hidden = false;
      qrDownload.disabled = false;
      qrNote.textContent =
        qr.version > 25
          ? 'Long sketch, dense code: hold the phone close or zoom in. The link always works.'
          : 'Point a phone camera at the code to open this sketch.';
    } catch {
      canvas.hidden = true;
      qrDownload.disabled = true;
      qrNote.textContent = 'This sketch is too long for a QR code. Share the link instead.';
    }
  }

  copyBtn.addEventListener('click', () => void copy(urlInput.value, 'Share link copied', urlInput));
  copySourceBtn.addEventListener('click', () => void copy(host.source(), 'Source copied'));
  nativeBtn.addEventListener('click', () => {
    navigator
      .share({ title: `Tartlet: ${host.title()}`, text: 'Listen to this Tartlet sketch', url: urlInput.value })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) host.flash('Sharing failed');
      });
  });
  qrDownload.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${host.fileStem()}-qr.png`;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    }, 'image/png');
  });
  urlInput.addEventListener('focus', () => {
    urlInput.select();
  });

  return () => {
    const url = host.url();
    const title = host.title();
    urlInput.value = url;
    emailLink.href =
      `mailto:?subject=${encodeURIComponent(`Tartlet sketch: ${title}`)}` +
      `&body=${encodeURIComponent(`Listen to this sketch:\n${url}`)}`;
    nativeBtn.hidden = !('share' in navigator);
    renderQr(url);
    dialog.showModal();
    copyBtn.focus();
  };
}
