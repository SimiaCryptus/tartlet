import type { PatternType, ValueKind } from "@tartlet/ir";

// Descriptions are original Tartlet prose (idea.md §4, rule 4).

export type Category = "control" | "combinator" | "transform" | "tonal" | "directive" | "constant";

export interface ParamSpec {
  readonly name: string;
  readonly type: ValueKind | "function" | "pattern-any";
  readonly patternable: boolean;
  readonly optional?: boolean;
  readonly range?: readonly [number, number];
}

export interface RegistryEntry {
  readonly id: string;
  readonly names: readonly string[];
  readonly compatAliases?: readonly string[];
  readonly form: "constructor" | "method" | "both" | "directive" | "function-value";
  readonly params: readonly ParamSpec[];
  readonly returns: PatternType | "same-as-receiver";
  readonly level: "L1" | "L2" | "L3";
  readonly deterministic: "pure" | "seeded";
  readonly since: string;
  readonly description: string;
  /** Tartlet extension used by the checker to choose a lowering. */
  readonly category: Category;
}

export interface Lookup {
  readonly entry: RegistryEntry;
  readonly via: "canonical" | "alias" | "compat";
  readonly typed: string;
}

const SINCE = "0.0.0";
const SINCE_T1 = "0.1.0";

function control(
  id: string,
  names: readonly string[],
  kind: ValueKind,
  description: string,
  extra: { compat?: readonly string[]; range?: readonly [number, number] } = Object.create(null) as object,
): RegistryEntry {
  return {
    id,
    names,
    ...(extra.compat ? { compatAliases: extra.compat } : undefined),
    form: "both",
    params: [{ name: "value", type: kind, patternable: true, ...(extra.range ? { range: extra.range } : undefined) }],
    returns: { kind: "pattern", of: "controls" },
    level: "L2",
    deterministic: "pure",
    since: SINCE,
    description,
    category: "control",
  };
}

function transform(id: string, names: readonly string[], params: readonly ParamSpec[], description: string, deterministic: "pure" | "seeded" = "pure"): RegistryEntry {
  return { id, names, form: "method", params, returns: "same-as-receiver", level: "L2", deterministic, since: SINCE_T1, description, category: "transform" };
}

const ANY: ParamSpec = { name: "pattern", type: "pattern-any", patternable: true };
const FACTOR: ParamSpec = { name: "factor", type: "number", patternable: true };
const SHIFT: ParamSpec = { name: "cycles", type: "number", patternable: true };

export const ENTRIES: readonly RegistryEntry[] = [
  control("s", ["s", "sound"], "sample", "Chooses the sound source: a kit name, a sample variant or a built-in oscillator."),
  control("note", ["note"], "note", "Sets pitch from note names or MIDI numbers."),
  control("n", ["n"], "number", "Sets a number used as a sample variant or as a scale degree."),
  control("freq", ["freq"], "number", "Sets pitch directly in hertz."),
  control("gain", ["gain"], "number", "Scales loudness. One is unity.", { range: [0, 1.5] }),
  control("velocity", ["velocity"], "number", "Scales loudness per note, between zero and one.", { range: [0, 1] }),
  control("pan", ["pan"], "number", "Stereo position: zero is left, one is right.", { range: [0, 1] }),
  control("speed", ["speed"], "number", "Playback rate for samples."),
  control("cutoff", ["cutoff", "lpf"], "number", "Low-pass filter frequency in hertz.", { range: [20, 20000] }),
  control("resonance", ["resonance", "lpq"], "number", "Emphasis at the low-pass cutoff.", { range: [0, 30] }),
  control("hcutoff", ["hcutoff", "hpf"], "number", "High-pass filter frequency in hertz.", { range: [20, 20000] }),
  control("attack", ["attack"], "number", "Seconds to rise to full level."),
  control("decay", ["decay"], "number", "Seconds to fall from peak to the sustain level."),
  control("sustain", ["sustain"], "number", "Held level as a fraction of peak."),
  control("release", ["release"], "number", "Seconds to fade out after the note ends."),
  control("room", ["room"], "number", "Amount of reverb send.", { compat: ["reverb"], range: [0, 1] }),
  control("size", ["size"], "number", "Reverb space size."),
  control("delay", ["delay"], "number", "Amount of echo send.", { range: [0, 1] }),
  control("delaytime", ["delaytime"], "number", "Echo spacing, in cycles or seconds depending on the host."),
  control("delayfeedback", ["delayfeedback"], "number", "How much each echo feeds the next.", { compat: ["feedback"], range: [0, 0.98] }),
  control("shape", ["shape"], "number", "Waveshaping distortion amount.", { range: [0, 1] }),
  control("crush", ["crush"], "number", "Bit-depth reduction.", { range: [1, 16] }),
  control("vowel", ["vowel"], "string", "Formant filter vowel."),
  control("orbit", ["orbit"], "number", "Effects bus number."),
  { id: "stack", names: ["stack"], form: "both", params: [{ ...ANY, name: "layers" }], returns: { kind: "pattern", of: "controls" },
    level: "L2", deterministic: "pure", since: SINCE, description: "Plays all layers at once.", category: "combinator" },
  { id: "slowcat", names: ["cat", "slowcat"], form: "constructor", params: [{ ...ANY, name: "items" }], returns: { kind: "pattern", of: "controls" },
    level: "L2", deterministic: "pure", since: SINCE, description: "Plays one item per cycle, in turn.", category: "combinator" },
  { id: "fastcat", names: ["seq", "fastcat"], form: "constructor", params: [{ ...ANY, name: "items" }], returns: { kind: "pattern", of: "controls" },
    level: "L2", deterministic: "pure", since: SINCE, description: "Squeezes all items into each cycle, in order.", category: "combinator" },
  transform("fast", ["fast"], [FACTOR], "Speeds the pattern up by a factor."),
  transform("slow", ["slow"], [FACTOR], "Stretches the pattern by a factor."),
  transform("rev", ["rev"], [], "Plays every cycle back to front."),
  transform("every", ["every", "firstOf"], [{ name: "n", type: "number", patternable: false }, { name: "f", type: "function", patternable: false }],
    "Applies a function on the first cycle of every group of n cycles."),
  transform("early", ["early"], [SHIFT], "Moves the pattern earlier by a number of cycles."),
  transform("late", ["late"], [SHIFT], "Moves the pattern later by a number of cycles."),
  transform("degradeBy", ["degradeBy"], [{ name: "amount", type: "number", patternable: true, range: [0, 1] }],
    "Removes a seeded random share of events. The share is between zero and one.", "seeded"),
  { id: "scale", names: ["scale"], form: "method", params: [{ name: "name", type: "string", patternable: false }], returns: "same-as-receiver",
    level: "L2", deterministic: "pure", since: SINCE, description: "Turns `n` degrees into notes of a named scale such as \"D:minor\".", category: "tonal" },
  { id: "silence", names: ["silence"], form: "constructor", params: [], returns: { kind: "pattern", of: "controls" },
    level: "L2", deterministic: "pure", since: SINCE, description: "A pattern with no events.", category: "constant" },
  { id: "setcps", names: ["setcps"], form: "directive", params: [{ name: "cps", type: "number", patternable: false }], returns: { kind: "error" },
    level: "L2", deterministic: "pure", since: SINCE, description: "Sets tempo in cycles per second.", category: "directive" },
  { id: "setcpm", names: ["setcpm"], form: "directive", params: [{ name: "cpm", type: "number", patternable: false }], returns: { kind: "error" },
    level: "L2", deterministic: "pure", since: SINCE, description: "Sets tempo in cycles per minute.", category: "directive" },
  { id: "samples", names: ["samples"], form: "directive", params: [{ name: "bank", type: "string", patternable: false }], returns: { kind: "error" },
    level: "L2", deterministic: "pure", since: SINCE, description: "Declares a sample bank. It is fetched only if the host allows it.", category: "directive" },
];

export class Registry {
  readonly #byName = new Map<string, Lookup>();
  readonly #byId = new Map<string, RegistryEntry>();

  constructor(entries: readonly RegistryEntry[]) {
    for (const entry of entries) {
      this.#byId.set(entry.id, entry);
      entry.names.forEach((typed, i) => this.#byName.set(typed, { entry, via: i === 0 ? "canonical" : "alias", typed }));
      for (const typed of entry.compatAliases ?? []) this.#byName.set(typed, { entry, via: "compat", typed });
    }
  }

  /** Map-backed, so `__proto__` and `constructor` never resolve (idea.md §6.2). */
  lookup(name: string): Lookup | undefined {
    return this.#byName.get(name);
  }

  get(id: string): RegistryEntry | undefined {
    return this.#byId.get(id);
  }

  entries(): IterableIterator<RegistryEntry> {
    return this.#byId.values();
  }

  /** The closest known name within edit distance 2, if it is unique. */
  suggest(name: string): { name: string; distance: number } | undefined {
    let best: { name: string; distance: number } | undefined;
    let tie = false;
    for (const known of this.#byName.keys()) {
      const d = editDistance(name, known);
      if (d > 2) continue;
      if (!best || d < best.distance) {
        best = { name: known, distance: d };
        tie = false;
      } else if (d === best.distance) {
        tie = true;
      }
    }
    return tie ? undefined : best;
  }
}

export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

export const defaultRegistry: Registry = new Registry(ENTRIES);

/**
 * Draft v1 of the published system-prompt snippet (idea.md §10.3), generated from the
 * registry so the prompt and the runtime cannot drift apart.
 */
export function systemPrompt(reg: Registry = defaultRegistry): string {
  const names = (c: Category): string => [...reg.entries()].filter((e) => e.category === c).map((e) => e.names[0] ?? e.id).join(", ");
  return [
    "Write music as Tartlet source (Strudel-compatible). Rules:",
    "- One track per line: `$: <pattern>`. Optionally start with `setcpm(n)`.",
    '- Start a track with s("…"), note("…") or n("…").scale("D:minor"), then chain methods.',
    "- Mini-notation inside strings: `a b` sequence, `~` rest, `[a b]` group, `<a b>` one per cycle, `a, b` layers, `*n` `/n` `!n` `@n` `?` `(k,n)`.",
    `- Controls: ${names("control")}.`,
    `- Transforms: ${names("transform")}. Combinators: ${names("combinator")}.`,
    "- A function argument is a transform name like `rev`, or `x => x.fast(2)`.",
    "- Drums: bd, sd, hh. Synths: sine, square, triangle, sawtooth.",
    "- Use `const` for reuse. No imports, loops, if, async, window or fetch.",
  ].join("\n");
}