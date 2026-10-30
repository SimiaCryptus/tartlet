# Diagnostics

Every diagnostic has this shape (`@tartlet/ir`):

```ts
{
  id, severity: 'error' | 'warning' | 'info', message,
  range,            // blob-relative, 0-based line/col (UTF-16) plus UTF-8 byte (TS-8, TS-15)
  effect: 'none' | 'subtree-muted' | 'output-muted' | 'program-rejected',
  output?,          // label of the affected track
  definition?,      // name of the function definition it is inside, when not in a track (TS-50)
  fixes?,           // machine-applicable edits; `safe: true` may be auto-applied
  related?,         // extra ranges, e.g. into a function body (TS-50)
}
```

An error mutes the output it belongs to only when its effect is not `none`. Errors with effect
`none` (for example a bad `setcps` argument or an `E-RES-PATH` in a directive) are reported but
mute nothing directly.

## Recovery policy

- **Parse errors** drop the statement they occur in. Parsing resumes at the next line that
  starts at bracket depth 0 and is not a `.` continuation. The checker reports parse errors as
  errors with effect `subtree-muted`.
- **Errors while lowering an output** mark that output `muted-error`. Other outputs are not
  affected.
- **Errors inside a binding** mark the binding as errored. Every output that references it then
  gets `E-NAME-ERRORED` and is muted.
- **Errors inside a function body** are reported once at the definition, with `definition` set.
  Every call gets `E-NAME-ERRORED`. A problem caused by one call is moved to the call site,
  with a `related` range into the body (TS-50).
- **Runtime limits** mute only the offending output during a query (`E-LIMIT-DENSITY`). The
  result reaches the caller through `QueryResult.muted`.
- **The program is rejected** (`E-PROGRAM-EMPTY`) only when no output can play and at least one
  error exists.

## The repair payload

`repairPayload(result)` produces text like this:

```
tartlet: 1 issue to fix (1 cosmetic note not shown)
  E-REG-UNKNOWN  track "$1", line 2:
      s("bd").wobble(2)
    Unknown function `wobble`. Track muted.
  Rewrite ONLY the track on line 2; keep all other tracks unchanged.
```

- Info diagnostics, and warnings with effect `none`, are hidden unless `includeBenign: true` is
  passed.
- A diagnostic inside a function definition is labelled `function "name"`, and the closing line
  asks the model to rewrite the definition.
- Tracks muted only by `E-NAME-ERRORED` are summarised in one line, because fixing the
  definition fixes them.
- A suggestion is marked `safe` when it is exactly one edit away.

## Catalogue

### Syntax (from @tartlet/syntax)

- `E-SYN-UNEXPECTED`: unexpected token, or extra tokens after a statement.
- `E-SYN-UNTERMINATED`: unterminated string or block comment.
- `E-SYN-CHAR`: a character outside the language.
- `E-SYN-EXPR`: an expression that cannot be a pattern, such as a bare array or boolean.
- `E-LIMIT-DEPTH`: an expression or pattern nested more than 32 levels deep.
- `E-NOT-YET`: an object literal, or a supported name used in a position that is not supported
  yet.

### Closed-language rejections

- `E-LX-IMPORT`: `import` or `export`.
- `E-LX-KEYWORD`: `function`, `class`, `new`, `async`, `await`, `var`, `this`, `typeof` and
  similar keywords.
- `E-LX-CONTROL`: loops, `if`, `switch`, `try`, `return` outside a lambda block, or a ternary.
- `E-LX-MEMBER`: computed member access, or a member that is not called as a method.
- `E-LX-HOST`: a reference to a host API such as `window`, `fetch` or `globalThis`.
- `E-LX-PROTO`: `__proto__`, `constructor` or `prototype` used as a name.
- `E-LX-ASSIGN`: assignment outside a fresh binding.
- `E-LX-INTERP`: `${…}` inside a backtick string.
- `E-LX-LAMBDA`: a lambda whose body does not transform its parameter, an inline lambda with
  more than one parameter, or a block lambda that contains anything besides a single `return`.
- `E-LX-SPREAD`: a spread of anything other than an array literal.
- `E-LX-CALL`: a call on a parameter or a pattern binding. Use `x.apply(f)` instead (TS-51).

### Mini-notation

- `E-MINI-CHAR`: an unexpected character inside a pattern string.
- `E-MINI-UNEXPECTED`: an unexpected token.
- `E-MINI-UNCLOSED`: a bracket that is never closed. The diagnostic points at the opening
  bracket.
- `E-MINI-REPLICATE`: a `!` with no preceding step.
- `E-MINI-FACTOR`: `*`, `/` or `%` with no operand.
- `E-MINI-WEIGHT`: `@` without a positive number.
- `E-MINI-DEGRADE`: a `?` amount outside [0, 1].
- `E-MINI-EUCLID`: a malformed `(k,n,r)`.
- `E-MINI-INDEX`: `:` without a whole-number index.
- `E-LIMIT-MULTIPLIER`: a factor, replication count, step count or Euclidean `n` above 1024.

Mini-notation errors mute the whole output.

### Names, functions and the registry

- `E-NAME-UNDEF`: an unknown identifier. It is reported once per reference.
- `E-NAME-DUP`: a duplicate binding, function, output label, parameter or sample name.
- `E-NAME-ERRORED`: a reference to a binding or function that has errors.
- `E-NAME-SHADOW`: a binding or function uses a built-in name (TS-51).
- `W-FN-UNUSED`: a function parameter is never used.
- `E-REG-UNKNOWN`: an unknown function. The subtree is muted.
- `W-REG-UNKNOWN`: an unknown method whose likely meaning is a control. The control is dropped,
  the track plays, and a fix is usually offered.
- `I-REG-ALIAS`: a compatibility alias was used, for example `.reverb` read as `.room`.

### Arguments and capabilities

- `E-ARG-MISSING`: a required argument is absent.
- `E-ARG-TYPE`: the argument has the wrong kind, for example a pattern where a constant is
  required, a non-constant default, or an invalid sound name in `sample(...)`.
- `E-ARG-FUNCTION`: the argument is not a known transform or lambda.
- `E-ARG-DIVZERO`: constant division by zero.
- `E-ARG-SCALE`: an unknown scale name.
- `W-ARG-EXTRA`: extra arguments, which are ignored.
- `W-RANGE`: a constant outside the documented range, or a clamped tempo. The IR keeps the
  authored value.
- `E-CAP-PITCHED`: a pitch operation (`scale`, `transpose`, `octave`) on a receiver that plays
  only samples.
- `W-ARG-PHONEME`: a constant syllable outside the singing alphabet. It is sung as `ah`, and a
  fix is offered when one edit makes it valid (TS-45).
- `W-ARG-VOWEL`: an unknown constant `vowel` or `voicetype`. The default is used.
- `W-ARG-MODE`: an unknown constant value of an enum control: `earsplit`, `spectral`, `fir`,
  `firlen`, `body`, `cab`, `curve` or `envcurve` (the default, usually `none` or `lin`, is
  used), or `space` (the plain reverb is used).
- `W-ARG-UNSUPPORTED`: a control that cannot affect the track. It is reported only when every
  relevant value is known:
  - `iphase`, `irate` or `earsplit("harmonics")` on tracks with only noise and drums, and
    `dichotic` or `icorr` on tracks with only oscillators (TS-68);
  - `scomb`, `sgate` and `sshift` when no known `spectral` value selects their mode (TS-80);
  - `firwidth` without a band `fir` design, `bodysize` and `bodymix` without a `body`, and
    `spacepre` and `spacedamp` without a known `space` (TS-84);
  - `drive`, `bias` and `curvemix` without a curve (TS-89).

### Resources and tempo

- `I-RES-DECLARED`: a `samples()` bank was declared.
- `I-RES-FALLBACK`: a sound name is mapped to a kit sound.
- `W-RES-MISSING`: no sound is available for a name. The sound will be silent.
- `E-RES-PATH`: a `sample` or `samples` path breaks the path grammar (absolute path, scheme,
  `..`, wrong extension, non-ASCII). The declaration is ignored (TS-90).
- `I-RES-OVERRIDE`: a declared sample replaces a built-in kit sound in this document.
- `I-TEMPO-OVERRIDE`: a later tempo directive replaced an earlier one.

Resource diagnostics for sound names need a catalog (`CheckOptions.catalog`). Once any bank is
declared, names outside the kit are not judged, because bank contents are only known after
loading (TS-91).

### Advisories

These are benign info notes, hidden from the repair payload. Hosts use them and
`Program.advisories` to show warnings.

- `I-EXT-HEADPHONES`: an output uses controls that only work on headphones (TS-61).
- `I-EXT-PULSE`: an output pulses at a constant rate between 3 and 30 Hz. `binaural`,
  `isochronic` and `irate` count (TS-61, TS-67).
- `I-EXT-MONO`: a constant `iphase` of 150° or more, which nearly cancels in mono (TS-68).
- `I-DSP-LATENCY`: a track uses a constant FIR or per-voice spectral stage, which playback
  starts early to compensate its delay (TS-85).
- `I-DSP-ORBIT`: tracks on one orbit set different constant compressor settings; the latest
  onset wins (TS-87).

### Limits and program

- `E-LIMIT-SOURCE`: the source exceeds `maxSourceBytes`. The program is rejected.
- `E-LIMIT-EXPAND`: function calls in a statement expanded to more than `maxExpandedNodes`
  nodes. Only that output is muted (TS-52).
- `E-LIMIT-DENSITY`: at query time, the output exceeded its step or event budget. Only that
  output is muted.
- `E-PROGRAM-EMPTY`: nothing in the document can play.

### Host diagnostics

Hosts report these while loading samples. They depend on files, not on the document, so they
never change `check` results. `<tartlet-player>` appends them to its `diagnostics` (TS-91).

- `W-RES-MISSING`: a sample file or bank manifest could not be loaded, or the page does not
  load samples.
- `W-RES-FORMAT`: a file is not a supported WAV, or breaks the sample standard and is
  normalised.
- `W-RES-HASH`: a file does not match its manifest hash and is not played.
- `I-RES-LICENSE`: a bank entry records no licence.

The CLI importer also reports `I-RES-RATE` for files at rates other than 44.1 or 48 kHz.

## Adding a diagnostic

1. Choose an id with the prefix `E-`, `W-` or `I-` and a family segment, such as
   `E-ARG-WHATEVER`.
2. Emit it through `Lowerer.diag(...)`. Choose its `effect` carefully: an error with any effect
   other than `none` mutes the current output.
3. Add it to this catalogue, and to `spec-issues.md` if `idea.md` does not list it (see
   TS-24).
4. Add an X-kind test in `packages/check/test` or `packages/conformance/test`.