// The message loop of the acoustic render worker (docs/acoustic_rendering.md). Requests are
// validated by hand; replies transfer the rendered samples.
import { SPACE_MAX_SECONDS, isAcousticParams, safeRender } from './acoustics';

export interface RenderPort {
  postMessage(message: unknown, options?: { transfer?: Transferable[] }): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

export function startRenderHost(port: RenderPort): void {
  port.addEventListener('message', (e) => {
    const r = e.data as {
      id?: unknown;
      params?: unknown;
      sampleRate?: unknown;
      seconds?: unknown;
      seed?: unknown;
    } | null;
    if (
      typeof r !== 'object' ||
      r === null ||
      typeof r.id !== 'number' ||
      typeof r.sampleRate !== 'number' ||
      typeof r.seconds !== 'number' ||
      typeof r.seed !== 'number' ||
      !isAcousticParams(r.params)
    )
      return;
    const out = safeRender(r.params, r.sampleRate, Math.min(r.seconds, SPACE_MAX_SECONDS), r.seed);
    port.postMessage({ id: r.id, ok: out.ok, data: out.data }, { transfer: [out.data.buffer] });
  });
}
