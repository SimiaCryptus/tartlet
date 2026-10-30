# Oracle specifications

One file per topic, written by the oracle analyst in neutral prose (idea.md §4). Implementers
of `mini` and `core` read these files and nothing upstream.

First topics, in T2 order: structure rules (§8.6), patterned transform arguments, `off`,
`jux`, `ply`, `struct`, `mask`, polymeter, nested alternation (TS-14), scale octave (TS-11),
Euclid rotation (TS-19) and `iter` / `palindrome` (TS-39).

## Rules for the analyst

- The session that writes a specification for a module never implements that module.
- Run the reference runtime strictly as a black box. Never read, search for or paste its source
  code or tests.
- Write the observed behaviour as laws in your own words. Do not paste observed event lists,
  and never turn observations into fixtures; implementers write fixtures by hand from the laws.
- Log the session in `clean-room-log/` like any other.

## File format

Name the file `oracle/<topic>.md` and use these sections:

1. **Scope:** the construct, the matrix rows and the `TS-n` entries it settles.
2. **Laws:** numbered statements in terms of wholes, parts and values over rational time, for
   example "each argument event's part becomes a window in which …".
3. **Edge cases:** zero-width spans, cycle boundaries, patterned arguments, negative or zero
   factors, and what happens to fragments.
4. **Open points:** anything the observations could not decide.

When a specification lands, the implementer updates the code, the affected tests (citing the
oracle file in the fixture's `oracle` field) and the `TS-n` entry it resolves.
