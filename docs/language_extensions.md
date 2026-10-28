# Extensions: user-defined functions and a richer standard library

**Status: Part 1 is implemented (TS-48 to TS-52). Most of Part 2 is implemented natively as L3
registry entries (TS-53 to TS-60); the deferred items are listed in TS-60. Part 3 (derived
entries) is still a proposal.** The
implementation follows the recommendations below. It lowers calls by inline expansion, salts
ids with a call id built from name and structural `defHash`, and supports all four call forms,
including user methods. Each further item needs a `TS-n` entry in `spec-issues.md`, registry
entries, and tests as described in [testing.md](testing.md).

Today a document can name patterns (`const kick = s("bd*4")`) but not behaviour. Lambdas exist
only as arguments (`.every(4, x => x.fast(2))`), and the registry covers the core of the
algebra but few of the higher-level helpers people reach for. This page collects ideas for
both gaps:

1. letting a document **name its own functions**;
2. growing a **standard library**, and the few language features it needs.

## Constraints

Every proposal must respect the existing rules. If one cannot, it needs an ADR first.

- **The language stays closed.** A user function is lowered to IR like any other
  expression. Nothing runs as JavaScript, and there is still no `function`, `return` outside
  a lambda block, loop, `if` or `new` (`E-LX-*` stays as is).
- **No recursion, no unbounded expansion.** Every program must still lower in bounded time
  and bounded IR size. Termination must be structural, not checked by running anything.
- **The registry is the source of truth** for built-in names. User names may not shadow
  registry names, and library additions get original descriptions (compatibility aliases are
  allowed, as today).
- **Determinism is preserved.** The same document and seed sound the same. Appending a method
  at a call site must not change earlier draws, exactly as for built-ins.
- **Musical time stays rational.** New transforms are built from `compress`, `fast`, `late`,
  `bindWindow` and friends, and obey the laws in `laws.test.ts`.
- **Repair stays local.** A model must still be told which lines to rewrite. Functions make
  that harder, because a fault can live in a definition far from the track that is muted.
- **The core path stays pure** and its dependency graph unchanged. Ideally `core` does not
  learn about user functions at all.

## Part 1: naming new functions

### 1.1 Function bindings

The smallest step: allow a `const` binding whose value is a lambda.

```js
const wobble = (x) => x.fast(2).rev();
const chop = (x, n) => x.ply(n).gain(0.8);

$: s('bd sd').every(4, wobble);
$: s('hh*4').apply(chop, 2);
```

- A function binding is usable **anywhere a function value is accepted today**: `every`,
  `off`, `jux`, `sometimesBy`, and so on.
- Partial application works as for registry transforms: `chop(_, 3)` is not needed if
  function arguments follow the receiver, so `.every(4, chop(3))` reads as "chop by 3".
  This mirrors `fast(2)` used as a function value. Arity rules need a TS entry.
- Definition order is already enforced ("must be declared before use"). Because a binding
  cannot reference itself or anything declared later, **recursion is structurally
  impossible** in source. IR decoding already rejects cyclic binding references, which covers
  hostile IR.

### 1.2 Calling a user function

Three candidate surfaces, not mutually exclusive:

| Form                   | Example                  | Notes                                                                                               |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| As a function value    | `.every(4, wobble)`      | Needs no new syntax. Covered by 1.1.                                                                |
| Through `.apply(f, …)` | `s("bd").apply(chop, 2)` | One new registry entry. Also lets library code call a function-typed parameter.                     |
| As a user method       | `s("bd").chop(2)`        | Most natural to read. Needs shadowing rules and changes how `E-REG-UNKNOWN` / `W-REG-UNKNOWN` work. |
| As a user constructor  | `beat(3)`                | For functions that build a pattern rather than transform one (see 1.3).                             |

Recommendation: ship function values and `.apply` first, then user methods once the
shadowing and suggestion rules are settled.

User methods interact with the "unknown method that looks like a control" rule: a typo of a
user function name should suggest the user function, and user names must take part in
`suggest(name)` alongside registry names.

### 1.3 Pattern builders

Today `E-LX-LAMBDA` requires a lambda body to transform its parameter. That rule exists so
inline lambdas stay meaningful, but a named function is a different case:

```js
const beat = (k) => s('bd').euclid(k, 8);
const groove = (a, b) => stack(s(a), s(b).gain(0.6));

$: beat(3);
$: groove('bd*2', 'hh*8');
```

Proposal: for **named** functions, the body may be any pattern expression. Parameters may be
used wherever an argument is allowed. Inline lambdas keep the stricter rule.

### 1.4 Parameters

- **Kinds are inferred from use.** If a parameter flows into a constant-only position
  (`every(n, …)`, `euclid` method arguments, `sometimesBy(p, …)`), the parameter is
  constant-only, and passing a pattern at the call site is `E-ARG-TYPE` reported at the call
  site, with a related range pointing at the use in the definition.
- **Function-typed parameters** are allowed (`(x, f) => stack(x, x.apply(f))`). This is what
  lets the library in Part 3 be written in Tartlet itself.
- **Defaults**: `(x, n = 2) => x.ply(n)`. The default must be a constant expression.
- **Arity**: missing arguments without defaults are `E-ARG-MISSING`, extra arguments are
  `W-ARG-EXTRA`, matching built-ins.
- **Unused parameters** get `W-FN-UNUSED` (benign, hidden from the repair payload).
- No rest parameters, no destructuring, no objects as parameters (TS-23 still applies).

### 1.5 Lowering: inline expansion

The simplest design that keeps `core` untouched: **expand every call at check time.**

- The checker substitutes arguments for parameters and lowers the body at the call site,
  producing ordinary `PatternNode`s. Lambda parameters are already encoded as
  `RefNode { binding: "param:<name>" }` (TS-22), so the substitution machinery exists.
- The IR stays function-free. `encodeProgram` / `decodeProgram` need no new node kind, and
  `core` never sees a user function.
- **Expansion is bounded.** A function that calls another twice, nested ten deep, would grow
  as 2¹⁰. Add `maxExpandedNodes` to `LimitsConfig` (proposed default 10 000) and report
  `E-LIMIT-EXPAND` on the output that exceeds it.
- **Provenance** gains one level: an event's origin points at the mini-notation atom in the
  definition and records the call site range, so the editor can highlight both.

The alternative, a `FunctionNode` in the IR with applications resolved in `core`, keeps the
IR smaller and closer to the source but moves name resolution into `core` and complicates the
codec. It is noted here only for comparison.

### 1.6 Node ids and seeds

Inline expansion makes node ids a real design decision, and it needs a TS entry.

- **Proposed anchor:** a call is treated like a method call. Its id is
  `hash(receiverId, "user", name, defHash)`, and body nodes are hashed bottom-up from that
  anchor, exactly as if the body had been written inline at the call site.
- `defHash` is a structural hash of the definition body. Consequences:
  - appending `.gain(.8)` at the call site never changes draws (as today);
  - two calls of the same function on different receivers draw independently;
  - **editing the definition changes draws at every call site**, which is honest: the
    program changed;
  - moving the definition to another line, or reformatting it, changes nothing;
  - renaming the function changes draws. An alternative is to anchor on `defHash` alone, so
    renames are free but two identical functions with different names share draws.
- `.seed(x)` inside a body scopes as usual (TS-18, TS-28).

### 1.7 Diagnostics and repair

- **Errors inside a body** are reported once at the definition and mark the binding errored.
  Every output that calls it gets `E-NAME-ERRORED` and is muted. This is the existing binding
  policy.
- **Errors caused by a call** (wrong kind, missing argument, expansion limit) are reported at
  the call site, with a related range into the definition.
- **The repair payload** must say where to edit. For a definition error:

  ```
  tartlet: 1 issue to fix
    E-REG-UNKNOWN  function "chop", line 3:
        const chop = (x, n) => x.ply(n).wobble(2)
      Unknown function `wobble`. Tracks "$1", "hats" muted.
    Rewrite ONLY the definition on line 3; keep all other lines unchanged.
  ```

- `E-NAME-SHADOW`: a user function or binding uses a registry name.
- `E-LX-CALL`: calling something that is not a function (`kick(2)` where `kick` is a
  pattern).

### 1.8 Sharing functions between documents

`import` stays rejected. Possible later routes, all host-controlled:

- **Host preludes.** The host supplies Tartlet source that is checked under the same rules
  and prepended in a separate scope. Its diagnostics are reported against the prelude, never
  against the document.
- **Registry-backed libraries** (see Part 3): the most robust way to share is to make a
  function part of the standard library.

## Part 2: a richer standard library

Candidates grouped by purpose. Names in other ecosystems may become compatibility aliases;
descriptions stay original. Each item notes what it would be built from.

### 2.1 Time and structure

- `.palindrome()`: alternate forwards and reversed cycles (`every` + `rev`).
- `.iter(n)` / `.iterBack(n)`: start each cycle one `1/n` later (`late` with a cycle-indexed
  amount).
- `.chunk(n, f)`: apply `f` to a moving quarter (or `1/n`) of each cycle (`within` + cycle
  index).
- `.within(b, e, f)`: apply `f` only to the part of each cycle in `[b, e)`.
- `.zoom(b, e)`, `.compress(b, e)`, `.fastGap(f)`: expose existing algebra directly.
- `.linger(f)`: repeat the first fraction `f` of each cycle.
- `.segment(n)`: sample a signal into `n` discrete steps per cycle; the missing link between
  signals and `struct`.
- `.hurry(f)`: `fast` plus `speed` multiplied by the same factor.
- `.swingBy(amount, n)` / `.swing(n)`: delay every second subdivision (also in
  [instruments.md](instruments.md#tier-3-performance-and-articulation)).
- `.brak()`: squash every other cycle into a syncopated half.
- `.press()` / `.pressBy(r)`: shift each event later within its own whole.
- `.lastOf(n, f)`: like `every`, but on the last cycle of each group.
- `.superimpose(f)` and `.layer(f, g, …)`: stack transformed copies.
- `.echo(times, time, feedback)`: delayed copies with falling gain.
- `run(n)`: the pattern `0 1 … n-1`, handy with `.scale`.
- `arrange(...)`: a song-form helper that plays sections for a number of cycles each (needs
  lists, see 2.6).

### 2.2 Randomness

All seeded with counter-based draws, all with D rows.

- Probability shorthands: `.often(f)` (0.75), `.rarely(f)` (0.25), `.almostNever(f)`,
  `.almostAlways(f)`, `.always(f)`, `.never(f)`.
- `.someCyclesBy(p, f)` / `.someCycles(f)`: decide once per cycle rather than per event.
- `.shuffle(n)` / `.scramble(n)`: reorder `1/n` slices, without or with replacement.
- `irand(n)`: a seeded integer signal in `[0, n)`.
- `perlin`: a smooth seeded signal, interpolating between per-cycle draws.
- `choose(...)` / `wchoose(...)`: a seeded choice among constants, sampled at onsets.
- `.degradeBy` already exists; add `.undegradeBy(p)` for the complementary events, which
  makes "split a pattern in two" expressible.

### 2.3 Arithmetic and values

- `.sub`, `.mul`, `.div`, `.mod`, `.round`, `.floor`, `.ceil` alongside `.add`.
- Structure variants. Other ecosystems spell these as `add.squeeze`, which is a member
  access and therefore `E-LX-MEMBER` here. Proposed spellings: a structure argument
  (`.add(x, "squeeze")`) or separate names (`.addOut`, `.addMix`). Needs a TS entry; the
  default stays `appLeft` (structure from the receiver).
- `.set(control, value)` / `.keep(...)`: overwrite or preserve controls from another
  pattern.
- `.toBipolar()` / `.fromBipolar()`: map between `[0, 1]` and `[-1, 1]` for signals.

### 2.4 Tonal

- `chord("Cm7")` and `.voicing()`: shared with the instruments proposal.
- `.arp("up" | "down" | "updown" | "converge" …)`: play stacked notes in order.
- `.octave(n)`, `.scaleTranspose(n)`: move within a scale by degrees rather than semitones.
- `.rootNotes(octave)`: reduce chords to their roots, for bass lines.
- More scales and modes in `SCALES` (whole tone, Hirajoshi, Phrygian dominant, …), all as
  static data.

### 2.5 Control helpers

- `.legato(x)`, `.clip(x)`, `.nudge(s)`: see
  [instruments.md](instruments.md#tier-3-performance-and-articulation).
- `.velocity` already exists; add `.accent(pattern)` as a shorthand for boosting velocity on
  truthy steps.

### 2.6 Language features the library needs

Some useful helpers cannot be expressed in today's closed language. Each is a small,
deliberate widening:

- **List-typed parameters.** Arrays are allowed today only as a spread operand. Allow an
  array literal as the argument of a parameter the registry declares as a list, for example
  `arrange([4, verse], [8, chorus])` or `pick(["bd", "sd"], "<0 1>")`. Elsewhere arrays stay
  `E-SYN-EXPR`.
- **Object literals for control sets** (TS-23). `.set({ gain: 0.5, pan: 0.2 })` would build
  `Object.create(null)` maps, reject `__proto__`, `constructor` and `prototype` keys
  (`E-LX-PROTO`), and allow only known control names as keys.
- **Operators on patterns.** `n("0 2") + 7` could lower to `.add(7)`. Tempting for models,
  but it blurs the line between constant folding and pattern arithmetic. Proposed: leave out
  until there is corpus evidence that models write it often.
- **Doc comments.** A `/** … */` comment directly above a function binding becomes its
  description, shown in editor hovers and in the repair payload.

## Part 3: how the library is built

Two ways to add a library entry:

1. **Native.** A registry entry plus a core combinator. Fastest at query time, laws proven
   once in `core`, but each entry costs code in the core budget.
2. **Derived.** A registry entry whose body is Tartlet source, lowered with the same inline
   expansion as user functions:

   ```js
   superimpose = (x, f) => stack(x, x.apply(f));
   often = (x, f) => x.sometimesBy(0.75, f);
   palindrome = (x) => x.every(2, rev).late(1); // illustrative only
   ```

   - Derived bodies are checked at registry build time; a broken body fails the build, never
     a document.
   - Their node ids use the entry id instead of `defHash`, so a library body is **frozen per
     version**: changing it would change everyone's draws. A behavioural change needs a new
     entry id and a `since` bump, with the old one kept as a compatibility alias or removed
     in a major release.
   - `systemPrompt()` lists derived entries like native ones; users never see the
     difference.

Recommendation: derived by default, native only when a construct needs new algebra
(`segment`, `shuffle`, `zoom`) or when profiling shows the expansion is too costly.

## Testing

- **Expansion transparency.** For deterministic bodies, calling a user function must give the
  same events as writing the body inline. A fast-check property generates small definitions
  and compares both forms through `canon(events)`.
- **D rows.** Stable for a seed, different across seeds, unchanged when a method is appended
  at the call site, unchanged when the definition moves to another line, changed when the
  body changes (per the rule chosen in 1.6).
- **X and R rows.** Shadowing, arity, kind errors at the call site, errors in the body,
  `E-LIMIT-EXPAND` on an exponential definition, `E-LX-CALL`, and the repair payload naming
  the definition line.
- **Codec.** Decoded IR never contains user functions; hostile IR with cyclic references is
  still rejected (Z-10).
- **Laws.** New time transforms join `SOURCES` in `laws.test.ts`.
- **Library expectations** are hand-written from musical reasoning, never captured from
  Tartlet or another implementation, per [testing.md](testing.md#rules-for-expectations).

## Diagnostics (proposed)

- `E-NAME-SHADOW`: a user name collides with a registry name.
- `E-LX-CALL`: a call on something that is not a function.
- `E-LIMIT-EXPAND`: function expansion exceeded `maxExpandedNodes`; that output is muted.
- `W-FN-UNUSED`: a parameter is never used (benign).
- Existing ids reused at call sites: `E-ARG-MISSING`, `W-ARG-EXTRA`, `E-ARG-TYPE`,
  `E-NAME-ERRORED`.

Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Suggested order

1. Function bindings usable as function values, and `.apply(f, …)`.
2. Inline expansion with `maxExpandedNodes`, provenance through call sites, and repair
   payloads that name definition lines.
3. Probability shorthands, `superimpose`, `layer`, `echo`, `run`, `segment` (mostly derived).
4. Named pattern builders and parameter defaults.
5. `within`, `chunk`, `iter`, `palindrome`, `shuffle`, `scramble`, `perlin`, `irand`.
6. Tonal helpers (`chord`, `voicing`, `arp`), shared with the instruments work.
7. User methods, once shadowing and suggestion rules are agreed.
8. List-typed parameters, `arrange`, `pick`; object literals for `.set` (TS-23).

## Open questions

- Should user methods exist at all, or is `.apply(f)` clear enough and safer for models?
- Should renaming a function change its draws (anchor on name and body) or not (anchor on
  body only)?
- What is the right `maxExpandedNodes`, and should it scale with `maxEvalSteps`?
- How should the editor show provenance that crosses a call site?
- Should host preludes be allowed, and if so how are their diagnostics shown to a model that
  cannot edit them?
- Which library entries are worth native implementations, and which can stay derived
  forever?
- Do list-typed parameters and object literals stay narrow exceptions, or do they open the
  door to general data values in the language?
