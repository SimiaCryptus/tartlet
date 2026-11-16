---
specifies: ../apps/playground/albums/*.json
---

# Writing longer compositions

A single loop is easy to write in Tartlet. A piece that runs for several minutes needs more: an
intro, verses and choruses, a bridge, a change of key, a slower ending and a real stop. This guide
covers the features for that:

- a shared timeline (`song`)
- per-section placement (`.sections`, `.exceptSections`)
- section-aware values (`bysec`, section and song envelopes, pattern scales)
- fills and variations (`.atStart`, `.atEnd`, `.variant`)
- repeats and endings in layouts
- a tempo map (`tempomap`)
- duration reporting

All of them are checker-level sugar. They lower to the existing `form`, `silence` and constant
nodes, so time stays exact and rational, and the
[language constraints](language_extensions.md#constraints) still apply. There are no loops, no
recursion and no JavaScript.

## A complete example

```js
setcpm(100/4)
song("intro@4 verse@16 chorus@16 verse'@16 chorus@16 bridge@8 chorus'@16 outro@8", "once")
tempomap("0:25 92:25 100:15")

const key   = "D:minor"
const riff  = note("<d2 d2 f2 c2>").s("sawtooth")
const hook  = n("0 2 4 2 5 4 2 1").scale(key).s("triangle")
const verse = n("<0 ~ 2 4>").scale(key).s("sine")

drums: s("bd*2 sd, hh*8").gain(bysec("verse:.6 *:.9"))
         .exceptSections("intro outro").atEnd(1, x => x.ply(2))
bass:  riff.lpf(env("300 2400", "section")).exceptSections("intro")
pad:   note("<[d3,f3,a3] [c3,e3,g3]>").s("triangle").room(.5)
         .gain(env("0 1@3 .3", "song")).sections("intro bridge outro")
lead:  hook.sections("chorus").variant(x => x.add(12))
         .scale(bysec("chorus':F:major *:D:minor"))
melody: verse.sections("verse")
```

This is about four minutes of music from seven short bindings:

- One line names the whole structure.
- Each track says where it plays instead of counting cycles.
- The tempo map adds a ritardando over the last eight cycles.
- The piece stops at the end on its own.

The rest of this guide explains each piece.

## Declaring the structure: `song`

`song` declares the sections of the piece once, for every track:

```js
song("intro@4 verse@16 chorus@16 verse'@16 chorus@16 bridge@8 chorus'@16 outro@8", "once")
```

- **Section names** are lowercase words (`[a-z][a-z0-9_]*`).
- **Primes** are optional (`verse'`, `chorus''`).
- **Length** is optional and given in cycles after `@`. The default is 1.
- **Section limit:** a song can have at most 256 sections, the same limit as `form`.
- **Second argument:** `"loop"` (the default) or `"once"`. With `"once"`, the host stops at the
  end and every track falls silent, so no track needs its own `exit`.
- **Duplicates:** only one `song` is allowed per document. A second one gives `E-NAME-DUP`.
- **No song:** without a `song`, everything behaves as before.

The checker reports the total length with `I-SONG-LENGTH`, in cycles and in seconds. The seconds
account for any [tempo map](#changing-tempo-tempomap).

## Placing tracks in sections

`.sections(names)` keeps a track only in the named sections. `.exceptSections(names)` keeps it
everywhere else.

```js
const riff = note("<d2 d2 f2 c2>").s("sawtooth")

drums: s("bd*2 sd, hh*8").exceptSections("intro outro")
bass:  riff.lpf(300).exceptSections("intro")
lead:  hook.sections("chorus")
pad:   chords.sections("intro outro bridge")
```

Each occurrence of a section restarts the track at local time zero, as in `form`. Write a part
once, relative to its section, and it lines up wherever the section appears. If a section changes
length in the `song` line, no track needs editing.

Primes match by base name:

- `sections("verse")` includes `verse'`.
- `sections("verse'")` includes only the primed one.

If you name a section that does not exist, you get `E-ARG-MISSING` at the name. A section that no
track plays in gives the benign warning `W-SONG-UNUSED`.

## Values that change by section

### `bysec(map)`

`bysec` gives a value that is constant within each section. The map is a constant string of
`name:value` pairs. It can end with a `*:value` default.

```js
drums: s("bd sd").gain(bysec("intro:.4 verse:.6 *:.9"))
lead:  hook.add(bysec("chorus:0 chorus':2 *:0"))
```

Without a `*` entry, an unlisted section gives no value. A control stays unset there, and `add`
leaves the value unchanged.

### Envelopes over a section or the whole song

`env` accepts `"section"` or `"song"` in place of a cycle count:

- With `"section"`, the envelope stretches over each section and restarts every time.
- With `"song"`, it stretches once over the whole piece.

In both cases the envelope does not repeat within its span.

```js
bass: riff.lpf(env("300 2400", "section"))  // opens through every section
pad:  chords.gain(env("0 1@3 .3", "song"))   // one arc over the whole piece
```

### Changing key: `.scale(pattern)`

`.scale` accepts a pattern of `Root:name` strings as well as a constant. The scale is read at
each event's onset, which is how you modulate:

```js
hook.scale("<D:minor F:major>")
hook.scale(bysec("verse:D:minor bridge:F:major"))
```

A string that is not a scale gives `E-ARG-SCALE`.

## Fills, pickups and variations

### `.atStart(k, f)` and `.atEnd(k, f)`

These apply `f` only during the first or last `k` cycles of every section, where `k` is a
constant. Use them for fills, pickups, risers and cadences:

```js
drums: kit.atEnd(1, x => x.ply(2).gain(1.1))
```

They need a `song`. Outside one, they give `W-ARG-UNSUPPORTED` and do nothing.

### `.variant(f1, f2, …)`

`.variant` turns primes into real variations:

- In a section with `k` primes, it applies `f_k`.
- If `k` is larger than the number of functions, it applies the last function.
- Unprimed sections are left unchanged.

It works inside a `song` or a `form`.

```js
lead: tune.sections("verse").variant(x => x.add(12), x => x.canon(2, 1/2, 7))
```

Without `.variant`, a prime only reseeds random draws. On a deterministic part, a prime alone
changes nothing.

## Repeats and endings

Both `song` and `form` layouts support repeat groups and numbered endings:

```js
song("intro@4 (theme@8 1.half@2 2.full@2)*2 coda@4")
//   plays: intro theme half theme full coda
```

- `( … )*n` repeats the group `n` times, where `n` is from 2 to 16. Groups can be nested up to
  the usual depth limit.
- `1.name`, `2.name` and so on are endings that play only on that pass. Write the digit directly
  before the section name.
- A repeat is exact. To get new random draws on a pass, write a prime on the section (`theme'`).
- Expanded repeats count toward the 256-section limit. Going over it gives `E-ARG-GRAMMAR` at the
  offending text.

## Changing tempo: `tempomap`

```js
setcpm(100/4)
tempomap("0:25 92:25 100:15")   // steady, then a ritardando over the last 8 cycles
```

- **Points:** `cycle:cpm` pairs, in order. The tempo changes linearly between two points.
- **Steps:** repeat a cycle number to jump. `"0:25 32:25 32:30"` jumps to 30 cpm at cycle 32.
- **Base tempo:** `setcpm` still sets it, and `tempomap` overrides it from its first point
  (`I-TEMPO-OVERRIDE`).
- **Range:** values are clamped to [0.001, 100] cps, with a `W-RANGE` warning.
- **Errors:** out-of-order cycles, non-numbers and incomplete pairs give `E-ARG-GRAMMAR`.
- **Scope:** the map is global. All tracks share one clock, and per-track tempo is not supported.

Patterns are still written in cycles. The host converts cycles to seconds through the map.
`I-SONG-LENGTH` uses the map to compute the duration in seconds.

## Checking how long a piece is

`tartlet check` and `sanity` print the length in cycles and seconds:

```
piece: 100 cycles, 3 min 52 s
```

The length comes from `I-SONG-LENGTH`. Without a song, it comes from the longest `periods` entry.

A host can set a minimum duration. The checker then reports `W-SONG-SHORT` when the piece is
shorter than the target. This check is off by default. Its warning is benign for the repair
payload unless the host asks for it. When composing with a model, set a target such as 90 s in
the host or the prompt.

## Smaller conveniences

- **`arrange(c1, p1, c2, p2, …)`** plays `c1` cycles of `p1`, then `c2` cycles of `p2`, and so
  on, then repeats. It is a letter-free `form` for a single track, it is not limited to 26 parts,
  and it is handy for through-composed material.
- **More than 26 `form` parts.** Layouts accept `A`…`Z`, then `AA`, `AB`, …
- **`.once()` on any pattern.** The pattern plays once from cycle zero, then stays silent.

## Coming from loops

If you wrote longer pieces before these features existed, here is what replaces what:

| Instead of… | Write… |
| --- | --- |
| a separate `form` layout in every track | one `song` line plus `.sections(…)` per track |
| `enter(32)`, `exit(48)`, `during(16, 24, f)` | `.sections("chorus")`, `.atEnd(1, f)` |
| a 64-entry `<…>` or parts `A`–`Z` | `arrange(…)` or `form` with `AA`, `AB`, … |
| writing a repeated section out twice | `( … )*2` with `1.`/`2.` endings |
| a prime that changed nothing | `.variant(f)` |
| one `setcpm` for the whole piece | `tempomap(…)` |
| repeating a part to change key | `.scale(bysec(…))` |
| an `exit` on every track to end the piece | `song(…, "once")` |

## How it works

- **Sections.** `x.sections("chorus")` lowers to a `form` with two parts, `x` and `silence`. A
  generated layout maps each song section to one of them and keeps the section lengths and
  primes. The body of `x` is lowered once and shared. The cost grows with the number of sections,
  not with sections × body size.
- **Numbered parts.** Generated layouts can need many parts, so the IR layout grammar includes
  numbered parts (`#12`). You cannot write these yourself.
- **Other features.** `bysec` lowers to a `form` over constant parts. Section envelopes create one
  `env` per distinct section length. `.variant` adds one part per distinct prime count.
- **Limits.** Everything stays within `maxExpandedNodes` (10 000) and the 256-section limit.
- **Determinism.**
  - Draws are keyed by section-local time.
  - Appending a method at a call site does not change earlier draws.
  - A primed section is a differently seeded variant.
  - Adding a section elsewhere in the song leaves draws unchanged when their section-local time
    is the same.

## Diagnostics

| Id | Meaning |
| --- | --- |
| `I-SONG-LENGTH` | Total length in cycles and seconds. |
| `W-SONG-UNUSED` | A song section that no track plays in (benign). |
| `W-SONG-SHORT` | The piece is shorter than the host's target (off by default). |
| `E-ARG-MISSING` | Unknown section name. |
| `E-ARG-GRAMMAR` | Bad layout, repeat, ending or tempo map. |
| `E-ARG-SCALE` | A `scale` pattern value is not a scale. |
| `E-NAME-DUP` | A second `song` or `tempomap`. |
| `W-ARG-UNSUPPORTED` | `atStart`/`atEnd` used without a `song`. |
| `W-RANGE` | Tempo value clamped. |
| `I-TEMPO-OVERRIDE` | `tempomap` overrides `setcpm`. |

Each diagnostic names the `song` line or the track line to rewrite, so repairs stay local.