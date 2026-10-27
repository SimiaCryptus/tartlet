import type { TimeSpan } from "@tartlet/time";
import { check, locator } from "@tartlet/check";
import { compile, type CompiledProgram } from "@tartlet/core";
import type { CheckRequest, Checked, QueryReply } from "./protocol";

/** Check, compile and query. It is shared by the worker host and the inline evaluator. */
export class EvalCore {
  #compiled: CompiledProgram | undefined;

  check(req: CheckRequest): Checked {
    const r = check(req.source, { documentId: req.documentId, blobIndex: req.blobIndex, ...(req.seed !== undefined ? { seed: req.seed } : undefined) });
    this.#compiled = compile(r.program, { locate: locator(req.source), documentId: req.documentId, blobIndex: req.blobIndex });
    return { program: r.program, diagnostics: r.diagnostics };
  }

  query(span: TimeSpan, provenance: boolean): QueryReply {
    if (!this.#compiled) return { events: [], muted: [] };
    const q = this.#compiled.query(span, { provenance });
    return { events: q.events, muted: [...q.muted] };
  }
}