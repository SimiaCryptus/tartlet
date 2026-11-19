import type { TimeSpan } from '@tartlet/time';
import { check, locator } from '@tartlet/check';
import { compile, type CompiledProgram } from '@tartlet/core';
import { toParamEntries, type CheckRequest, type Checked, type ParamInput, type QueryReply } from './protocol';

/** Check, compile and query. It is shared by the worker host and the inline evaluator. */
export class EvalCore {
  #compiled: CompiledProgram | undefined;
  #params: ReadonlyMap<string, unknown> = new Map();

  check(req: CheckRequest): Checked {
    const r = check(req.source, {
      documentId: req.documentId,
      blobIndex: req.blobIndex,
      ...(req.seed !== undefined ? { seed: req.seed } : undefined),
    });
    this.#compiled = compile(r.program, {
      locate: locator(req.source),
      documentId: req.documentId,
      blobIndex: req.blobIndex,
    });
    return { program: r.program, diagnostics: r.diagnostics };
  }

  /** Replaces the live parameter values used by later queries. They survive re-checks. */
  setParams(params: ParamInput): void {
    this.#params = new Map(toParamEntries(params));
  }

  query(span: TimeSpan, provenance: boolean): QueryReply {
    if (!this.#compiled) return { events: [], muted: [] };
    // `compile` reads `controls`; `params` is the same map under the host-facing name.
    const options = { provenance, controls: this.#params, params: this.#params };
    const q = this.#compiled.query(span, options);
    return { events: q.events, muted: [...q.muted] };
  }
}
