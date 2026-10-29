// Background playback for phones. Service workers cannot play sound, and mobile browsers pause
// pages that only use Web Audio once the screen locks. So the player's output bus is fed into a
// hidden <audio> element (via a MediaStream): the OS then treats the page as a media player,
// keeps it running and shows lock-screen controls through the Media Session API.
// If the element cannot start (autoplay rules), sound falls back to the speakers directly.
import { latestContext, onAudioContext, outputStream, setDirectOutput } from './audio-capture';

export interface BackgroundHost {
  isPlaying(): boolean;
  play(): Promise<void>;
  stop(): void;
  next(): void;
  previous(): void;
  title(): string;
  album(): string;
}

export interface BackgroundHandle {
  /** Call whenever the player starts or stops. */
  sync(): void;
  /** Call when the sketch title changes. */
  updateMetadata(): void;
}

const PREF_KEY = 'tartlet.background.v1';

function defaultEnabled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(pointer: coarse)').matches;
}

function loadPref(): boolean {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    // storage unavailable
  }
  return defaultEnabled();
}

function savePref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable
  }
}

export function initBackgroundAudio(toggle: HTMLInputElement, host: BackgroundHost): BackgroundHandle {
  const supported = typeof MediaStreamAudioDestinationNode !== 'undefined' && 'srcObject' in HTMLMediaElement.prototype;
  let enabled = supported && loadPref();
  toggle.checked = enabled;
  toggle.disabled = !supported;
  if (!supported) toggle.title = 'This browser cannot route generated audio for background playback.';

  const audio = document.createElement('audio');
  audio.setAttribute('playsinline', '');
  audio.preload = 'none';
  audio.hidden = true;
  document.body.append(audio);

  // Safari 16.4+: let Web Audio behave like media playback (ignores the silent switch).
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = 'playback';
    } catch {
      // not supported
    }
  }

  let bound: AudioContext | null = null;
  let ownPause = false;
  let blocked = false;
  let starting = false;

  function release(): void {
    if (bound) setDirectOutput(bound, true);
    if (!audio.paused) {
      ownPause = true;
      audio.pause();
    }
  }

  function engage(): void {
    const ctx = latestContext();
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    if (!enabled) {
      release();
      return;
    }
    if (bound !== ctx) {
      if (!audio.paused) {
        ownPause = true;
        audio.pause();
      }
      if (bound) setDirectOutput(bound, true);
      audio.srcObject = outputStream(ctx);
      bound = ctx;
    }
    if (!audio.paused) {
      setDirectOutput(ctx, false);
      return;
    }
    if (starting) return;
    starting = true;
    audio.play().then(
      () => {
        starting = false;
        blocked = false;
        // Only now cut the direct path, so there is never a gap.
        if (enabled && host.isPlaying() && bound === ctx) setDirectOutput(ctx, false);
        else release();
      },
      () => {
        starting = false;
        blocked = true;
        setDirectOutput(ctx, true);
      },
    );
  }

  audio.addEventListener('pause', () => {
    if (ownPause) {
      ownPause = false;
      return;
    }
    // Paused by the system (interruption, policy): keep the sound going directly and retry later.
    if (bound) setDirectOutput(bound, true);
    blocked = true;
  });

  const retry = (): void => {
    if (blocked && enabled && host.isPlaying()) engage();
  };
  document.addEventListener('pointerdown', retry, true);
  document.addEventListener('keydown', retry, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && host.isPlaying()) engage();
  });
  onAudioContext(() => {
    if (host.isPlaying()) engage();
  });

  toggle.addEventListener('change', () => {
    enabled = supported && toggle.checked;
    savePref(enabled);
    if (host.isPlaying()) engage();
    else release();
  });

  // ---- lock screen / notification controls
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  function action(name: MediaSessionAction, fn: () => void): void {
    try {
      ms?.setActionHandler(name, fn);
    } catch {
      // action not supported by this browser
    }
  }
  action('play', () => {
    void host.play();
  });
  action('pause', () => {
    host.stop();
  });
  action('stop', () => {
    host.stop();
  });
  action('nexttrack', () => {
    host.next();
  });
  action('previoustrack', () => {
    host.previous();
  });

  function updateMetadata(): void {
    if (!ms || typeof MediaMetadata === 'undefined') return;
    const art = (name: string, size: number): MediaImage => ({
      src: new URL(`icons/${name}`, document.baseURI).href,
      sizes: `${String(size)}x${String(size)}`,
      type: 'image/png',
    });
    ms.metadata = new MediaMetadata({
      title: host.title() || 'Sketch',
      artist: 'Tartlet',
      album: host.album(),
      artwork: [art('icon-192.png', 192), art('icon-512.png', 512)],
    });
  }

  function sync(): void {
    const playing = host.isPlaying();
    if (ms) ms.playbackState = playing ? 'playing' : 'paused';
    if (playing) {
      updateMetadata();
      engage();
    } else {
      release();
    }
  }

  updateMetadata();
  return { sync, updateMetadata };
}
