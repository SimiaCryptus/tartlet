# ADR-003: Workers and worklets in opaque-origin iframes

**Status:** proposed (G0). Verify on three engines during T0 and T1 (risk R-3).

Worklet and worker modules are static module source shipped inside the bundle. They are
instantiated from `blob:` URLs created in the embedding context. They are never dynamically
generated from document content.

CSP needs `script-src 'self' blob:` and `worker-src 'self' blob:`.

T0 evaluates on the main thread. The worker host lands in T1. If an engine refuses `blob:`
workers in the sandbox, the fallback is main-thread evaluation inside the iframe with tighter
budgets.
