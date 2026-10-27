import type { Rational, TimeSpan } from "@tartlet/time";
import type { Diagnostic, Program } from "@tartlet/ir";
import type { ControlMap, Event } from "@tartlet/core";

export interface CheckRequest {
  readonly source: string;
  readonly documentId: string;
  readonly blobIndex: string;
  readonly seed?: string;
}

export interface Checked {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
}

export interface QueryReply {
  readonly events: readonly Event<ControlMap>[];
  readonly muted: readonly (readonly [string, Diagnostic])[];
}

export type RequestBody =
  | ({ readonly type: "check" } & CheckRequest)
  | { readonly type: "query"; readonly begin: Rational; readonly end: Rational; readonly provenance: boolean };
export type Request = RequestBody & { readonly id: number };

export type Response =
  | ({ readonly id: number; readonly type: "checked" } & Checked)
  | ({ readonly id: number; readonly type: "events" } & QueryReply)
  | { readonly id: number; readonly type: "error"; readonly message: string };

/** The host-neutral evaluation surface. The element uses it in a worker or inline. */
export interface Evaluator {
  check(req: CheckRequest): Promise<Checked>;
  query(span: TimeSpan, provenance: boolean): Promise<QueryReply>;
  dispose(): void;
}

/** Hand-written validator for messages arriving in the worker. */
export function isRequest(v: unknown): v is Request {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { id?: unknown; type?: unknown; source?: unknown };
  if (typeof r.id !== "number") return false;
  return (r.type === "check" && typeof r.source === "string") || r.type === "query";
}