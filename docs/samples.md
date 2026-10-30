# Extensions: WAV samples, the sample collection and sample interpreters

**Status: implemented** (TS-90 to TS-94), except MIDI file import (§4.3) and content-addressed
uploads; see [Implementation notes](#implementation-notes). Every item that changes the language, the registry,
the IR or `Program` needs a `TS-n` entry in `spec-issues.md`, registry entries marked as extensions
extensions where relevant, and tests as described in [testing.md](testing.md). Tooling that
stays outside the core path (the CLI importer and the collection builder) needs tests but no TS
entry. The loading model below amends the "nothing is fetched" rule for host-side,
same-origin loads, so it needs an ADR before implementation.

This page turns the host-supplied bank idea in
[instruments.md](instruments.md#tier-6-samples-and-multisampling) into a concrete design:

1. [Referencing WAV files](#part-1-referencing-wav-files) from a document with relative paths.
2. [The sample standard](#part-2-the-sample-standard): what every WAV is assumed to be
   (normalised, tone-standard).
3. [The CLI importer and the collection](#part-3-the-cli-importer-and-the-collection): a
   Node.js tool that validates WAVs and aggregates them into a server-side collection.
4. [Interpreters](#part-4-impulse-and-note-interpreters): two general interpreters, one for
   impulses and one for notes, that map MIDI-style events onto sample playback.

## Constraints

Every proposal follows the [instrument constraints](instruments.md#constraints): the core path
stays pure, controls are data, randomness is decided in core, musical time is rational, the
safety chain cannot be bypassed and nothing is fetched from document content by the core or
the embed. Samples add these:

- **The core path never touches files.** `check` validates the _syntax_ of a sample path and
  records it in `program.resources`. It never reads, stats or fetches anything. Resolution and
  loading are host jobs: the CLI reads from disk, and the playground and element load from a
  same-origin collection through a host resolver.
- **References are relative, and confined to a root.** A path is relative to its root: the
  document's directory in the CLI, or the configured collection base in a browser. Absolute
  paths, URL schemes, backslashes and any `..` that escapes the root are rejected at check
  time. A host can never be steered to load something outside the root it chose.
- **`import` stays rejected.** Samples are declared with directives, not ES imports
  (`E-LX-IMPORT` is unchanged).
- **Same origin only.** Browser loads go to `'self'`, so the CSP in
  [embedding.md](embedding.md#content-security-policy) (`connect-src 'self'`) does not change.
  Cross-origin banks stay a host concern, through the planned `resource-request` message
  (ADR-004).
- **WAV is the only format.** PCM 16-bit, PCM 24-bit and IEEE float 32-bit, mono or stereo.
  The parser is hand-written and closed (ADR-001 style), and treats every file as untrusted
  input.
- **Sound depends on bytes, and bytes are pinned.** A manifest records a content hash for every
  file. The same document, seed and collection give the same sound. A changed file is reported,
  never silently accepted.
- **The safety chain applies.** Sample voices connect to the bus before the compressor and the
  limiter. Gain and playback rate are clamped at the adapter, as for every voice.
- **Licences travel with samples.** Every collection entry carries a `license` field. Voice
  recordings also need the `consent` field from [vocals.md](vocals.md#tier-v5-recorded-voices).

## Part 1: referencing WAV files

### 1.1 Directives

```js
// proposed syntax — not accepted today
sample('kick', './drums/kick.wav'); // one file, bound to a sound name
sample('snare', './drums/snare.wav');
samples('./keys/'); // a bank: a directory with a manifest.json
samples('./strings.json'); // a bank: an explicit manifest file

$: s('kick ~ snare ~');
$: note('c3 e3 g3').s('rhodes'); // 'rhodes' named by ./keys/manifest.json
```

- `sample(name, path)` binds one WAV file to a sound name. `name` follows the rules for sound
  names: letters, digits, `_` and `-`, starting with a letter.
- `samples(path)` declares a bank. A path ending in `/` means `<path>manifest.json`. Any other
  path must end in `.json`.
- Both are directives. Like `setcps`, their arguments must be constant strings.
- Mini-notation atoms cannot contain `/`, so a path can never appear inside a pattern string.
  Documents refer to samples by the names the directives bind.
- A name bound twice is `E-NAME-DUP`, as for bindings and output labels. A sample name that
  shadows a built-in kit sound (`bd`, `sine`, …) wins inside that document and gets
  `I-RES-OVERRIDE`.
- `name:i` keeps selecting a variant by index. With a bank, `rhodes:2` picks the bank's third
  take for `rhodes`. With a single-file `sample`, every index plays the same file.

### 1.2 Path rules

The checker validates each path with a pure, closed grammar:

```
path      := ("./")? segment ("/" segment)* "/"?
segment   := [A-Za-z0-9_.-]+     // not "." or ".."
```

- Allowed: `./drums/kick.wav`, `drums/kick.wav`, `keys/`.
- Rejected with `E-RES-PATH`: `/abs/kick.wav`, `https://…`, `file:…`, `C:\…`,
  `../other/kick.wav`, `drums//kick.wav`, empty segments, non-ASCII characters, and paths
  longer than 256 bytes.
- `sample` paths must end in `.wav`. Matching is case-insensitive, and anything else is
  `E-RES-PATH`.
- A path error mutes nothing directly, because a directive is not an output. Every output that
  plays the bound name gets `W-RES-MISSING` and is silent for that sound, as today.

The IR records each declaration as a `ResourceDecl` with `kind: 'wav' | 'bank'`, `name?`,
`path`, and its source range. `decodeProgram` re-validates paths with the same grammar, so
hostile IR cannot smuggle in an absolute path.

### 1.3 Resolution by host

| Host               | Root                                                                    | Loader                                          |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------- |
| CLI (Node)         | The document file's directory, capped by `--samples-root` when given.   | `fs.readFile`, then the WAV parser.             |
| Playground         | The collection base, by default `/samples/` on the same origin.         | `fetch` on `'self'`, then `decodeAudioData`.    |
| `<tartlet-player>` | The `sample-base` attribute. When it is absent, samples are not loaded. | The same as the playground, or a host callback. |

- The element gains a `sample-base` attribute and an optional `resolveSample(path)` property. A
  host that sets the property hands back an `ArrayBuffer` of WAV bytes, or `null`. The element
  never resolves outside that callback, or outside `sample-base` when there is no callback.
- Loading starts after `check`, in parallel. Playback does not wait for samples. An event whose
  sample is not decoded yet is skipped and counted, and the status region says
  "Loading 3 samples…".
- Inline documents in the playground have no file directory, so their paths resolve against
  the collection base. A document that works in the playground also works in the CLI when run
  from the collection directory.

## Part 2: the sample standard

Every WAV in a collection is assumed to follow this standard. The importer (Part 3) enforces it,
so the engine and interpreters can rely on it without measuring anything at play time.

- **Normalised.** Peak level is −1 dBFS (a linear peak of 0.891). The engine applies no
  loudness guessing: `gain` 1 means "as normalised". Files are also trimmed, with leading
  silence below −60 dBFS removed so that onsets land on the beat.
- **Tone-standard.** Pitched samples are tuned to A4 = 440 Hz and recorded at a declared root
  note. The default root is C4, MIDI 60. A sample whose root differs records it in the manifest
  (`root: 57`). Unpitched samples (drums, foley, impulses) have no root.
- **Format.** 44.1 or 48 kHz. Other rates are accepted and resampled by the engine, with
  `I-RES-RATE` from the importer. Mono or stereo. Multichannel files beyond two channels are
  rejected.
- **Length caps.** At most 30 s for impulse samples and 120 s for note samples, and at most
  64 MiB per file. Longer material belongs to a bed or loop zone (Part 4.2).
- **No DC offset.** The importer removes any DC offset.

The standard is a promise about the files, not something the core checks. A document that
references a file outside a collection, for example a raw `./my.wav` in the CLI, still plays.
The CLI measures the file once and reports any deviation with `W-RES-FORMAT`, and the engine
normalises it on load in that case only.

## Part 3: the CLI importer and the collection

### 3.1 Commands

```sh
npx tsx packages/cli/src/main.ts samples import <dir> --into <collection> [--license <spdx>] [--root <note>]
npx tsx packages/cli/src/main.ts samples verify <collection>
npx tsx packages/cli/src/main.ts samples list <collection> [--json]
```

- **`import`** walks `<dir>` for `*.wav`, parses each file with the strict WAV parser, applies
  the standard (normalise, trim, remove DC), and writes the result into
  `<collection>/<bank>/<name>.wav`. It also creates or updates `<collection>/<bank>/manifest.json`.
  Without `--license`, every entry is written with `license: "UNKNOWN"`, and `verify` fails
  until a human fills it in.
- **`verify`** re-hashes every file, checks it against its manifest, and checks every manifest
  against the schema. It exits with 1 on any mismatch. `pnpm check` runs it when a collection is
  present in the repository.
- **`list`** prints every name, bank, kind and root, and is useful for the system prompt.

The importer is a tooling package, `@tartlet/samples`. It holds the WAV parser and encoder, the
manifest schema and validator, and the normalisation helpers, all pure and runnable in Node. It
may import `ir` and `time`. No core package imports it, and the CLI and playground do. The
dependency graph gains a leaf, never a new edge between existing packages.

### 3.2 The manifest

```json
{
  "v": 1,
  "bank": "keys",
  "entries": [
    {
      "name": "rhodes",
      "kind": "note",
      "takes": [
        {
          "file": "rhodes_c3.wav",
          "sha256": "…",
          "root": 48,
          "lo": 36,
          "hi": 54,
          "vlo": 0,
          "vhi": 1
        },
        {
          "file": "rhodes_c4.wav",
          "sha256": "…",
          "root": 60,
          "lo": 55,
          "hi": 72,
          "vlo": 0,
          "vhi": 1
        }
      ],
      "loop": null,
      "license": "CC0-1.0"
    },
    {
      "name": "kick",
      "kind": "impulse",
      "takes": [{ "file": "kick.wav", "sha256": "…" }],
      "license": "CC0-1.0"
    }
  ]
}
```

- The manifest is untrusted input, validated with the same rules as IR ingestion:
  - no `__proto__`, `constructor` or `prototype` keys;
  - nesting capped;
  - every `file` must pass the path grammar of Part 1.2 and stay inside the bank directory;
  - numbers must be in range.
- `kind` is `impulse` or `note`, and selects the interpreter (Part 4).
- `lo`, `hi`, `vlo` and `vhi` define a zone: a note range and a velocity range. Takes in the same
  zone form a round-robin group.
- `loop` is `null` or `{ start, end }` in sample frames, for sustained note samples.
- The importer can group files into zones from file names (`name_c3.wav`, `name_c3_v2.wav`),
  with a summary of what it guessed. Any guess is printed, never applied silently.

### 3.3 The server-side collection

For now there is one shared collection, aggregated from imports and served as static files:

- The repository layout is `collection/<bank>/manifest.json`, the WAV files, and
  `collection/index.json` listing the banks. Large binaries live in Git LFS or in the deploy
  bucket only. The decision belongs to the ADR.
- `deploy.sh` uploads the collection under `/samples/` next to the playground. WAV files are
  content-addressed in the bucket (`<sha256>.wav` with an alias map in each manifest), so they
  can use the same long-lived immutable caching as hashed assets. Manifests are `no-cache`.
- The playground reads `/samples/index.json` and offers the bank names in autocomplete and in
  the system prompt.
- Nothing is uploaded from the browser. Adding samples is a CLI and review step.

## Part 4: impulse and note interpreters

An interpreter turns one event's controls into one sample playback: which file, at what rate,
for how long, and at what level. There are two general interpreters, chosen by the entry's
`kind`. Both are pure functions in `@tartlet/samples`, from `(controls, entry, cps)` to a
playback plan, and are unit-tested in Node. The audio adapter in `@tartlet/webaudio` only
executes plans.

Both read MIDI-style values: `note` is `{ kind: 'midi', value }`, `velocity` is 0–1, and
`n` is an index. This is the same model as the proposed MIDI export in
[claudes_ideas.md](claudes_ideas.md#21-midi-export), so a file exported from Tartlet and
imported again (Part 4.3) plays through the same interpreters.

### 4.1 The impulse interpreter

For one-shots: drums, hits, foley and stabs.

- **Trigger.** It plays from the start of the file at the event's onset. Fragments that are not
  onsets never trigger.
- **Length.** By default, the whole file plays, regardless of the event's whole. `legato` (or
  `clip`) cuts the sample at `legato × whole` with a short release, and `release` sets that
  fade.
- **Pitch.** `speed` sets the playback rate, clamped to 0.125–8. A negative `speed` is not
  supported in the first version and gives `W-RANGE`. `note` is ignored, except when
  `note` selects a drum (below).
- **Selection.** The take index is `n` modulo the number of takes. With `vary` (instruments
  Tier 3), the take is chosen by a seeded draw keyed by node id, cycle and `whole.begin`, drawn
  in core and passed down as a control.
- **MIDI drum map.** When an event has a `note` but no `s`, and a bank declares
  `gm: true`, the interpreter maps General MIDI percussion numbers onto names: 36 → `kick`,
  38 → `snare`, 42 → `hat`, and so on. The map is static data with an original layout, and the
  bank's manifest may override it per entry (`gm: 36`).
- **Choke.** `mono` acts as a choke group, as for the kit (TS-42). For example, an open hat is
  silenced by a closed hat on the same line.

### 4.2 The note interpreter

For pitched instruments.

- **Zone choice.** It picks the takes whose `[lo, hi]` contains the note and whose
  `[vlo, vhi]` contains the velocity. When none match, it uses the zone with the nearest root.
  Ties go to the lower root. A round-robin group cycles by a seeded draw, never by playback
  order, so seeking stays deterministic.
- **Rate.** It plays at `2^((note − root) / 12) × speed`, computed in doubles at the adapter
  boundary, with the transposition capped at ±24 semitones from the root. Beyond the cap the
  voice is still played at the capped rate, with `W-RANGE` when the note is constant.
- **Length.** It plays for the event's whole, scaled by `legato`, then releases with
  `release`. Samples with a `loop` sustain by looping between `loop.start` and `loop.end`
  until release. Samples without a loop simply end, even when the whole is longer.
- **Envelope and effects.** The usual `attack`, `decay`, `sustain` and `release` apply, as do
  the per-voice chain (filters, `shape`, `body`, …) and `glide` on a `mono` line. `glide`
  ramps the playback rate.
- **Capability.** A bank entry of kind `note` is **pitched**, so `.scale` and `.transpose`
  work on it. An `impulse` entry is not, and they give `E-CAP-PITCHED` (TS-35) once the
  checker knows the bank through a catalog.
- **Cost.** One sample voice costs 1 unit of the polyphony budget (TS-42). A looping voice
  costs 1 as well.

### 4.3 MIDI file import (later)

`samples midi <file.mid> --out <file.tt>` converts a Standard MIDI File into a Tartlet document
for the same interpreters:

- Each track becomes an output. Channel 10 becomes `s(...)` with the drum map. Other channels
  become `note(...)`.
- Ticks are converted to rational cycles with the same `--beats-per-cycle` convention as MIDI
  export. Positions that do not land on a short grid are reported, never silently snapped.
- The result is ordinary Tartlet source, checked before it is written. It is a starting point
  to edit, not a lossless format.

## Diagnostics (proposed)

- `E-RES-PATH`: a sample or bank path breaks the path grammar (absolute path, scheme, `..`, wrong
  extension, non-ASCII). The declaration is ignored.
- `I-RES-OVERRIDE`: a declared sample name replaces a built-in kit sound in this document.
- `W-RES-MISSING` (existing): with a catalog that knows the collection, a name that resolves to
  no file. The sound is silent.
- `I-RES-FALLBACK` (existing): a missing sample name falls back to a kit sound.
- `W-RES-FORMAT`: reported by hosts that load the file, not by the checker. The file breaks the
  sample standard: not normalised, wrong rate, too long, or an unsupported encoding.
- `W-RES-HASH`: reported by hosts. A file's content hash does not match its manifest. The file is
  not played.
- `I-RES-LICENSE`: a known bank has an entry with `license: "UNKNOWN"`.
- `E-CAP-PITCHED` (existing): extended to cover `.scale` and `.transpose` on impulse entries.

Host-side diagnostics are reported through the element's `diagnostics` event and the CLI
output. They never change `check` results, because they depend on files rather than on the
document. Each would follow [Adding a diagnostic](diagnostics.md#adding-a-diagnostic).

## Testing

- **Path grammar.** P- and X-style tests in `packages/check/test` cover:
  - every accepted and rejected form from Part 1.2;
  - an `E-RES-PATH` range that points at the string literal;
  - `decodeProgram` rejecting hostile paths (extending Z-10).
- **WAV parser.** Byte-level tests on hand-written, tiny RIFF files:
  - 16-bit, 24-bit and float data;
  - odd chunk sizes and unknown chunks that must be skipped;
  - truncated data, oversized declared lengths and wrong `fmt ` fields, which must be rejected
    without throwing anything other than a typed error;
  - a round-trip property: encode a hand-written sample array, then parse it back.
- **Normalisation.** Peak after import is −1 dBFS within a tolerance. Trimmed leading silence
  is below −60 dBFS. The output has no DC. Importing a file twice gives identical bytes and
  hashes.
- **Manifest.** Schema tests, forbidden keys, out-of-range zones, and files that escape the bank
  directory.
- **Interpreters.** Pure Node tests with hand-written expectations:
  - for the note interpreter, A4 on a C4 root plays at rate `2^(9/12)`;
  - the zone choice picks the nearest root and breaks ties low;
  - round-robin take choice is stable for a seed and differs across seeds (D rows);
  - for the impulse interpreter, the drum map turns note 38 into `snare`;
  - `legato` cuts at the expected time.
- **Audio.** Render with `OfflineAudioContext` in the Playwright suite against a small test
  collection of generated WAVs (sines at known roots, clicks), and assert properties, never
  stored waveforms:
  - the measured fundamental is within a few cents of the requested note;
  - onsets land within a millisecond of the scheduled time;
  - looping notes sustain for the whole;
  - the peak never exceeds the limiter ceiling;
  - no sample is NaN;
  - identical seeds render bit-identical buffers on one engine.
- **CSP.** The e2e test loads samples under the production CSP, so any cross-origin load fails
  the test.
- **Expectations by reasoning.** Test WAVs are generated from static code, not recorded or
  captured, and expectations come from the interpreter rules above, as
  [testing.md](testing.md#rules-for-expectations) requires.

## Suggested order

1. The ADR for host-side, same-origin loading, and a TS entry for the `sample` and `samples`
   directives and the path grammar.
2. `@tartlet/samples`: the WAV parser and encoder, manifest validation and normalisation, with
   Node tests.
3. The checker side: directives, `E-RES-PATH`, `ResourceDecl` kinds and the codec update.
4. The CLI `samples import`, `verify` and `list` commands, and the first shared collection.
5. The impulse interpreter in the adapter, then the CLI-hosted resolver for headless analysis.
6. The playground and element resolvers (`sample-base`, `resolveSample`), and deploying the
   collection under `/samples/`.
7. The note interpreter, with zones, loops and `glide`.
8. MIDI file import, sharing its time conversion with MIDI export.

## Open questions

- Should `sample(name, path)` exist at all, or should every file go through a bank manifest so
  that licences are never missing?
- Is C4 the right default root for tone-standard samples, or should a root be mandatory for
  every `note` entry?
- Should normalisation be peak-based (−1 dBFS) or loudness-based (LUFS)? Peak is simple and
  safe. Loudness makes banks sound more even.
- Should the collection live in the repository (Git LFS), or only in the deploy bucket with a
  manifest index in the repository?
- How should a document reference a sample from a bank it did not declare? Should the shared
  collection be implicitly available, or must every document declare its banks?
- Should hosts be allowed to block playback until all samples are loaded, so that the first
  cycle is complete?
- Should reversed playback (negative `speed`) be supported, given that it needs the whole file
  decoded before the onset?

## Implementation notes

- `samples("…")` with a `:` keeps the old meaning: a remote bank that is declared and never
  fetched (TS-90). Paths are stored in `ResourceDecl.spec`.
- Single-file samples are impulses. Hashes are checked with Web Crypto in hosts and with Node in
  the CLI.
- The playground serves the repo-root `collection/` directory as `/samples/` and sets
  `sample-base="samples/"` on its player.
- Not implemented: MIDI file import, content-addressed uploads, running `samples verify` from
  `pnpm check`, and `W-RANGE` for negative `speed`.
