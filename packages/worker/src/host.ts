import { EvalCore } from './core';
import { isRequest, type Response } from './protocol';

export interface WorkerPort {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

/** Runs inside a dedicated worker. Unknown messages are ignored. */
export function startWorkerHost(port: WorkerPort): void {
  const core = new EvalCore();
  port.addEventListener('message', (e) => {
    const req = e.data;
    if (!isRequest(req)) return;
    let res: Response;
    try {
      if (req.type === 'check') {
        res = { id: req.id, type: 'checked', ...core.check(req) };
      } else if (req.type === 'query') {
        res = { id: req.id, type: 'events', ...core.query({ begin: req.begin, end: req.end }, req.provenance) };
      } else {
        core.setParams(req.params);
        res = { id: req.id, type: 'ok' };
      }
    } catch (err) {
      res = { id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    port.postMessage(res);
  });
}
