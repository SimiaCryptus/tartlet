# ADR-004: Embed postMessage protocol v1

**Status:** draft. To be agreed jointly with Markdown2 during T0.

The message shapes are defined in plan.md §5, and every message carries `{ v: 1, id }`.

- The embed never fetches. Resources come through `resource-request`.
- Both sides use the same hand-written validators.
- A host refuses an embed whose major protocol version it does not know.

Types land in `@tartlet/embed` in T2.
