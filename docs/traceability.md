# Traceability

Requirement ID → test. CI will fail when a MUST has no test (from T1).

| Requirement                         | Test                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| R-8.1-exact-time                    | packages/time/test/rational.test.ts                                                                                   |
| R-8.3-span-split                    | packages/core/test/laws.test.ts                                                                                       |
| R-8.3-containment                   | packages/core/test/laws.test.ts                                                                                       |
| R-8.4-determinism                   | packages/conformance/test/expr-t1.test.ts (D rows), packages/random/test/random.test.ts                               |
| R-7.2-mini (T0 rows)                | packages/core/test/mini-rows.test.ts, packages/conformance/fixtures                                                   |
| R-7.2-mini (T1 rows M-13–M-20)      | packages/core/test/mini-t1.test.ts, packages/mini/test/parse.test.ts                                                  |
| R-7.2-mini (T2 rows M-21–M-28)      | packages/core/test/mini-t2.test.ts, packages/core/test/laws.test.ts                                                   |
| R-7.3-expr (T0 rows)                | packages/conformance/test/expr.test.ts                                                                                |
| R-7.3-expr (T1 rows)                | packages/conformance/test/expr-t1.test.ts                                                                             |
| R-7.3-expr (T2 rows)                | packages/conformance/test/expr-t2.test.ts                                                                             |
| R-7.3-expr (X-03, X-22, X-27, X-31) | packages/conformance/test/expr-l2.test.ts, packages/core/test/laws.test.ts                                            |
| R-11.1-capabilities (Q-03)          | packages/conformance/test/expr-t2.test.ts                                                                             |
| R-11.2-resources (Q-05, Q-08)       | packages/conformance/test/expr-t2.test.ts, packages/resources/test/resources.test.ts                                  |
| R-7.3-rejection (Z-01–Z-08)         | packages/check/test/reject.test.ts, packages/syntax/test/parse.test.ts                                                |
| R-9.7-ingestion (Z-10)              | packages/ir/test/codec.test.ts                                                                                        |
| R-10.3-repair-payload               | packages/check/test/reject.test.ts                                                                                    |
| R-10.4-limits (Z-08, Z-09)          | packages/check/test/reject.test.ts, packages/conformance/test/expr-t1.test.ts                                         |
| R-11.3-worker                       | packages/worker/test/inline.test.ts                                                                                   |
| R-11.4-sanity (Q-09)                | packages/cli/test/corpus.test.ts                                                                                      |
| R-6.2-no-proto                      | packages/registry/test/registry.test.ts, packages/check/test/reject.test.ts                                           |
| R-7.4-ext-binaural (TS-40)          | packages/conformance/test/binaural.test.ts                                                                            |
| R-7.4-ext-synthesis (TS-41, TS-42)  | packages/conformance/test/synthesis.test.ts, packages/webaudio/test/dsp.test.ts                                       |
| R-7.4-ext-vocals (TS-43–TS-47)      | packages/conformance/test/vocals.test.ts, packages/registry/test/registry.test.ts, packages/webaudio/test/dsp.test.ts |
