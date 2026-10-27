// Proves the core path runs in Deno with no DOM (plan.md §4).
import { check, locator } from "@tartlet/check";
import { compile } from "@tartlet/core";
import { rat, span } from "@tartlet/time";

const src = 'setcpm(92/4)\n$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)\n$: note("<d2 f2>").s("sawtooth")';
const result = check(src, { documentId: "deno", blobIndex: "0" });
const program = compile(result.program, { locate: locator(src) });
const { events } = program.query(span(rat(0), rat(1)), { provenance: true });
if (events.length === 0) throw new Error("deno smoke: no events");
console.log(`deno smoke ok: ${String(events.length)} events in cycle 0`);