import { describe, expect, it } from "vitest";
import { rat } from "@tartlet/time";
import { InlineEvaluator, startWorkerHost, type Response } from "../src";

const SRC = '$: s("bd*2")\n$: note("c")';

describe("evaluators", () => {
  it("inline evaluator checks and queries", async () => {
    const ev = new InlineEvaluator();
    const c = await ev.check({ source: SRC, documentId: "d", blobIndex: "0" });
    expect(c.program.outputs).toHaveLength(2);
    const q = await ev.query({ begin: rat(0), end: rat(1) }, false);
    expect(q.events).toHaveLength(3);
  });
  it("worker host answers over a port and ignores junk", () => {
    const sent: Response[] = [];
    let listener: ((e: { data: unknown }) => void) | undefined;
    startWorkerHost({ postMessage: (m) => sent.push(m as Response), addEventListener: (_t, l) => { listener = l; } });
    listener?.({ data: { junk: true } });
    listener?.({ data: { id: 1, type: "check", source: SRC, documentId: "d", blobIndex: "0" } });
    listener?.({ data: { id: 2, type: "query", begin: rat(0), end: rat(1), provenance: false } });
    expect(sent.map((r) => r.type)).toEqual(["checked", "events"]);
  });
});