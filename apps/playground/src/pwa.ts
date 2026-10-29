/// <reference types="vite/client" />
// Installable app: registers the service worker (production builds only) and drives the Install button.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: string }>;
}

export interface PwaOptions {
  installButton: HTMLButtonElement;
  flash: (msg: string) => void;
}

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function initPwa({ installButton, flash }: PwaOptions): void {
  if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
      const hadController = navigator.serviceWorker.controller !== null;
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register(new URL('sw.js', document.baseURI).href, { scope: new URL('./', document.baseURI).href })
          .catch(() => {
            // offline support is optional
          });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) flash('Update installed; reload to use it');
      });
    } else {
      // A worker left over from a preview build would serve stale modules to the dev server.
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) void r.unregister();
      });
    }
  }

  let deferred: BeforeInstallPromptEvent | null = null;
  const ios = isIos();
  installButton.hidden = isStandalone() || !ios;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    installButton.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installButton.hidden = true;
    flash('Installed');
  });

  installButton.addEventListener('click', () => {
    const ev = deferred;
    if (ev) {
      void ev.prompt().then(async () => {
        const { outcome } = await ev.userChoice;
        deferred = null;
        if (outcome === 'accepted') installButton.hidden = true;
      });
      return;
    }
    if (ios) flash('In Safari, tap Share, then "Add to Home Screen"');
    else flash('Use your browser menu to install this app');
  });
}
