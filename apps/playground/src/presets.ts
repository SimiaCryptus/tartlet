// Built-in sketches for the playground. Original compositions, written for Tartlet.

export type PresetGroup = 'Grooves' | 'Mini-notation' | 'Transforms' | 'Sound and signals' | 'Language';

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly group: PresetGroup;
  readonly blurb: string;
  readonly tags: readonly string[];
  readonly source: string;
}

export const PRESETS: readonly [Preset, ...Preset[]] = [
  // ---- Grooves
  {
    id: 'groove',
    name: 'Groove',
    group: 'Grooves',
    blurb: 'The design document example: drums, saw bass and a slow pad.',
    tags: ['92 bpm', 'D minor'],
    source: `setcpm(92/4)

$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
`,
  },
  {
    id: 'four-on-the-floor',
    name: 'Four on the floor',
    group: 'Grooves',
    blurb: 'Steady kick, off-beat hats and a pulsing bass.',
    tags: ['house', '124 bpm'],
    source: `setcpm(124/4)

$: s("bd*4, [~ hh]*4, ~ cp ~ cp").gain(.9)
$: note("<c2 c2 eb2 g1>*2").s("sawtooth").lpf(500).release(.1)
$: n("0 ~ 4 ~ 7 ~ 4 ~").scale("C:minor").add(12).s("square").gain(.3).release(.05)
`,
  },
  {
    id: 'ambient-drift',
    name: 'Ambient drift',
    group: 'Grooves',
    blurb: 'Slow sine tones and soft chords in a wide room.',
    tags: ['ambient', '60 bpm'],
    source: `setcpm(60/4)

$: n("<0 4 2 [6 5]>").scale("A:minor pentatonic").s("sine").room(.7).attack(.4).release(2).slow(2)
$: n("<[0,2,4] [3,5,7]>").scale("A:minor").s("triangle").gain(.35).attack(1).release(3).slow(4)
$: s("~ ~ ~ rim").gain(.4).room(.5)
`,
  },
  {
    id: 'broken-beat',
    name: 'Broken beat',
    group: 'Grooves',
    blurb: 'Euclidean kicks, scattered hats and a filter that breathes.',
    tags: ['dnb', '170 bpm'],
    source: `setcpm(170/4)

$: s("bd(3,8), ~ sd ~ sd, hh*16?0.3").gain(.9)
$: note("c2 [~ c2] eb2 [g1 bb1]").s("sawtooth").lpf(sine.range(300, 1600).slow(4)).release(.15)
`,
  },
  {
    id: 'chip-arps',
    name: 'Chip arps',
    group: 'Grooves',
    blurb: 'Square-wave arpeggios over a shifting chord root.',
    tags: ['chiptune', '140 bpm'],
    source: `setcpm(140/4)

$: n("0 [2 4] 7 [4 2]").add("<0 5 3 4>").scale("C:major").s("square").gain(.3).release(.05)
$: n("<0 5 3 4>").scale("C:major").add(-14).s("triangle").release(.3)
$: s("bd [~ bd] sd ~, hh*8").every(4, x => x.fast(2))
`,
  },
  {
    id: 'dub-echoes',
    name: 'Dub echoes',
    group: 'Grooves',
    blurb: 'Off-beat chords with an octave echo layered on top.',
    tags: ['dub', '72 bpm'],
    source: `setcpm(72/4)

$: s("bd ~ ~ ~, ~ ~ sd ~, hh*4?").room(.3)
$: note("~ [c3,eb3,g3] ~ [c3,eb3,g3]").s("triangle").off(1/8, x => x.add(12).gain(.4)).delay(.5)
$: note("<c2 c2 ab1 bb1>").s("sine").release(.8)
`,
  },
  {
    id: 'mirror',
    name: 'Mirror',
    group: 'Grooves',
    blurb: 'A melody on the left, its reflection on the right.',
    tags: ['stereo', 'dorian'],
    source: `setcpm(100/4)

$: n("0 2 4 <7 9>").scale("D:dorian").s("triangle").jux(rev).release(.2)
$: s("bd*2 sd, hh(5,8)").gain(.8)
`,
  },
  {
    id: 'layers',
    name: 'Layers',
    group: 'Grooves',
    blurb: 'Named parts with const, plus a seeded melodic surprise.',
    tags: ['bindings', 'seeded'],
    source: `setcpm(110/4)

const drums = s("bd [~ bd] sd ~, hh*8")
const bass = note("<a1 a1 f1 g1>").s("sawtooth").lpf(700).release(.2)

$: drums
$: bass
$: n("0 2 4 2").scale("A:minor").s("sine").sometimesBy(.3, x => x.add(7)).gain(.5)
`,
  },

  // ---- Mini-notation
  {
    id: 'mini-tour',
    name: 'Mini-notation tour',
    group: 'Mini-notation',
    blurb: 'Sequences, rests, groups, alternation and layered chords.',
    tags: ['basics', '[ ] < > ,'],
    source: `setcpm(100/4)

// a sequence splits the cycle; ~ rests; [ ] squeezes a group into one step
$: s("bd ~ [sd sd] ~")
// < > takes one item per cycle, and nested alternations advance in turn
$: s("hh*4, <~ oh> ~ <rim <cp cp*2>> ~").gain(.6)
// commas inside brackets layer notes into a chord
$: note("[c3,e3,g3]").transpose("<0 -3 5 7>").s("triangle").gain(.4).release(.4)
`,
  },
  {
    id: 'stretch-repeat',
    name: 'Stretch and repeat',
    group: 'Mini-notation',
    blurb: 'Replicate with !, elongate with @, and speed steps up or down.',
    tags: ['! @ * /'],
    source: `setcpm(96/4)

// ! repeats a step, @ gives a step more weight
$: s("bd!3 sd, hh@3 oh")
// * and / change speed inside a step, and the factor itself can be a pattern
$: note("c2*<2 4> [eb2 g2]/2").s("sawtooth").lpf(800).release(.1)
$: n("0@2 2 4@3 7").scale("C:minor").add(12).s("square").gain(.25).release(.05)
`,
  },
  {
    id: 'euclidean',
    name: 'Euclidean rhythms',
    group: 'Mini-notation',
    blurb: 'k hits spread over n steps, with rotation and patterned counts.',
    tags: ['(k,n,r)', '118 bpm'],
    source: `setcpm(118/4)

$: s("bd(3,8), sd(2,8,4), hh(7,16)")
// every argument may be a pattern
$: s("rim(<3 5>,8,<0 2>)").gain(.6)
$: note("c2(5,8)").s("sawtooth").lpf(600).release(.1)
// the method form keeps a melody only on the hits
$: n("0 2 4 7").scale("E:minor pentatonic").s("triangle").euclid(5,8).gain(.4)
`,
  },
  {
    id: 'polymeter',
    name: 'Polymeter',
    group: 'Mini-notation',
    blurb: 'Layers of different lengths that share one step size.',
    tags: ['{ }', '%n'],
    source: `setcpm(110/4)

// three against four: both layers keep the same step length
$: s("{bd sd hh, cp ~ hh rim}")
// %n sets how many steps fit in a cycle, so five notes wrap across cycles
$: note("{c3 eb3 g3 bb3 d4}%8").s("square").gain(.25).release(.05)
$: note("{c2 g1 bb1}%2").s("sawtooth").lpf(500).release(.2)
`,
  },
  {
    id: 'chance',
    name: 'Chance and choice',
    group: 'Mini-notation',
    blurb: 'Seeded random drops and per-cycle choices. Change the seed for a new take.',
    tags: ['? |', 'seeded'],
    source: `setcpm(124/4)

// ? drops steps at random, ?0.4 sets the odds
$: s("bd*4, hh*16?0.4")
// | picks one option every cycle
$: s("[~ sd] | [~ cp] | [~ sd sd]")
$: note("c3 eb3 g3 bb3").s("triangle").degradeBy(.3).sometimesBy(.4, x => x.add(12)).release(.1)
// .seed pins the draws below it to a named take
$: s("rim*8?").seed("take-2").gain(.5)
`,
  },
  {
    id: 'groups-variants',
    name: 'Dot groups and variants',
    group: 'Mini-notation',
    blurb: 'A lone dot splits the cycle into equal groups; name:index picks a variant.',
    tags: ['.', ':n'],
    source: `setcpm(90/4)

// a lone . splits the cycle into equal groups
$: s("bd bd . sd . hh hh hh")
// name:index picks a sample variant
$: s("cp:1 ~ rim:2 ~").gain(.6)
$: note("c3 e3 . g3 . c4 b3 g3 e3").s("triangle").gain(.4).release(.1)
`,
  },

  // ---- Transforms
  {
    id: 'time-shapers',
    name: 'Time shapers',
    group: 'Transforms',
    blurb: 'One riff, reshaped with slow, rev, palindrome, late and early.',
    tags: ['fast slow rev', 'mixolydian'],
    source: `setcpm(100/4)

const riff = n("0 2 4 5 7 5 4 2").scale("G:mixolydian")

$: riff.s("square").gain(.25).release(.05).every(4, rev)
$: riff.slow(2).add(-7).s("sawtooth").lpf(700).release(.2)
$: riff.palindrome().late(1/8).add(7).s("triangle").gain(.3).release(.1)
$: s("bd*2 [sd bd] ~ sd").fast("<1 2>")
$: s("~ cp").early(1/8).gain(.5)
`,
  },
  {
    id: 'rotations',
    name: 'Rotations',
    group: 'Transforms',
    blurb: 'iter and iterBack start each cycle one step further along.',
    tags: ['iter', 'dorian'],
    source: `setcpm(112/4)

$: n("0 1 2 3 4 5 6 7").scale("D:dorian").s("triangle").iter(4).gain(.35).release(.08)
$: n("0 2 4 6").scale("D:dorian").add(-7).s("sawtooth").iterBack(4).lpf(900).release(.15)
$: s("bd sd [~ bd] sd, hh*8").every(3, iter(4))
`,
  },
  {
    id: 'echoes-doubles',
    name: 'Echoes and doubles',
    group: 'Transforms',
    blurb: 'Shifted copies with off, stereo copies with jux, repeats with ply.',
    tags: ['off jux ply'],
    source: `setcpm(96/4)

$: note("c3 [eb3 g3] bb3 <g3 f3>").s("triangle").off(1/16, x => x.add(7).gain(.5)).release(.1)
$: s("bd ~ sd ~").ply("<1 2>")
$: s("hh*4").jux(x => x.fast(2).gain(.5))
$: note("<c2 bb1>").s("sawtooth").lpf(500).every(2, x => stack(x, x.late(1/2).add(12)))
`,
  },
  {
    id: 'structure-masks',
    name: 'Structure and masks',
    group: 'Transforms',
    blurb: 'Borrow a rhythm with struct, cut holes with mask, thin out with degrade.',
    tags: ['struct mask', '120 bpm'],
    source: `setcpm(120/4)

$: note("<c3 eb3 f3 g3>").s("sawtooth").struct("x ~ x x ~ x x ~").lpf(900).release(.08)
$: s("hh*16").mask("<1 [1 0] 1 [0 1]>").gain(.5)
$: s("bd").struct("x(3,8)")
$: s("cp*8").degrade().sometimes(x => x.speed(2)).gain(.5)
`,
  },
  {
    id: 'library',
    name: 'Library tour',
    group: 'Transforms',
    blurb: 'Layered copies, echoes, swing, seeded choices, moving chunks, counting and smooth noise.',
    tags: ['echo swing', 'chunk run'],
    source: `setcpm(112/4)
// superimpose layers a transformed copy; echo adds fading repeats
$: n("0 2 4 7").scale("C:minor").s("triangle").superimpose(x => x.add(12).gain(.4)).echo(3, 1/8, .5).release(.1)
// swing delays every second eighth note; often and rarely make seeded choices
$: s("hh*8").swing(4).often(x => x.gain(.6))
$: s("bd sd [~ bd] sd").rarely(x => x.ply(2))
// chunk hurries a moving quarter of each cycle
$: s("rim*4").chunk(4, x => x.hurry(2)).gain(.5)
// run counts up; segment turns smooth noise into steps
$: n(run(8)).scale("C:minor pentatonic").s("square").palindrome().gain(.25).release(.05)
$: note("c2*8").s("sawtooth").lpf(perlin.range(300, 2000).segment(8)).release(.1)
`,
  },

  // ---- Sound and signals
  {
    id: 'signals',
    name: 'Signals',
    group: 'Sound and signals',
    blurb: 'Continuous shapes driving gain, pan, filters and pitch.',
    tags: ['sine saw tri', 'rand'],
    source: `setcpm(100/4)

// signals glide between 0 and 1; range maps them onto any interval
$: s("hh*16").gain(saw.range(.2, .8)).pan(sine.slow(2))
$: note("c2*8").s("sawtooth").lpf(tri.range(300, 3000).slow(4)).resonance(6).release(.1)
$: n("0*8").add(square.range(0, 7)).scale("C:minor").s("square").gain(.25).release(.05)
$: s("rim*8").gain(rand.range(.2, .7)).pan(cosine)
`,
  },
  {
    id: 'sound-design',
    name: 'Sound design',
    group: 'Sound and signals',
    blurb: 'Envelopes, filters, distortion, echo and reverb on built-in synths.',
    tags: ['ADSR', 'effects'],
    source: `setcpm(90/4)

$: note("<c3 g2>").s("sawtooth").lpf(isaw.range(600, 3000).slow(2)).lpq(8).attack(.02).decay(.2).sustain(.4).release(.6).shape(.3)
$: freq("110 165 220 165").s("square").hpf(300).gain(.3).velocity(.8).release(.1)
$: s("bd sd:1 [~ bd] sd").crush(6).speed(1.5)
$: note("~ g4 ~ eb4").s("sine").vowel("<a o>").delay(.4).delaytime(.25).delayfeedback(.5).room(.6).size(.8).orbit(1)
`,
  },
  {
    id: 'borrowed-names',
    name: 'Borrowed names',
    group: 'Sound and signals',
    blurb: 'Names from other tools still play, with a note saying how they were read.',
    tags: ['aliases', 'fallback'],
    source: `setcpm(100/4)

// .reverb and .feedback are read as .room and .delayfeedback
$: s("bd ~ sd ~, hh*8").reverb(.3)
$: note("c3 eb3 g3 c4").sound("triangle").delay(.5).feedback(.4).release(.1)
// piano is not in the kit, so it falls back to the nearest built-in sound
$: n("0 4 7 4").s("piano").scale("C:major").gain(.5)
`,
  },
  {
    id: 'binaural',
    name: 'Binaural',
    group: 'Sound and signals',
    blurb: 'Headphones on: a slow binaural drone, circling hats and placed bells.',
    tags: ['headphones', 'HRTF'],
    source: `setcpm(60/4)
// binaural sets a beat in hertz: each ear hears the note detuned by half of it
$: note("<a2 a2 f2 g2>").s("sine").binaural(6).attack(1).release(2).gain(.6).slow(2)
// azimuth moves a sound around your head, in degrees: 0 ahead, 90 right, -90 left
$: s("hh*8").azimuth(saw.range(-180, 180).slow(4)).gain(.5)
// elevation and distance place it above and further away
$: n("0 2 4 7").scale("A:minor pentatonic").s("triangle").azimuth("<-60 60>").elevation(20).distance(2).release(.2).gain(.4)
`,
  },
  {
    id: 'synth-lab',
    name: 'Synth lab',
    group: 'Sound and signals',
    blurb: 'Noise, envelopes, FM, unison, glide and named waveforms, all built from scratch.',
    tags: ['FM', 'unison', 'glide'],
    source: `setcpm(100/4)
// noise and a pitch envelope make hats and a kick from nothing
$: s("white*8").hpf(6000).decay(.05).sustain(0).gain(.3)
$: note("c2 ~ c2 ~").s("sine").penv(24).pdecay(.08).release(.1)
// FM bells in a medium room
$: note("<c4 g4 eb4 bb4>*2").s("sine").fm(3).fmh(3.5).decay(.4).sustain(0).room(.5).size(.6).gain(.4)
// a detuned lead: filter envelope, a mono line with glide, and echoes
$: note("c3 eb3 g3 <bb3 f3>").s("sawtooth").unison(3).detune(12).lpf(400).lpenv(3).lpdecay(.15).lpq(6).mono(1).glide(.05).delay(.3).delaytime(.18).delayfeedback(.4).gain(.5)
// pulse width, vibrato and tremolo on a square bass
$: note("<c2 ab1>").s("square").pw(sine.range(.1, .5).slow(4)).vib(5).vibdepth(.2).trem(4).tremdepth(.3).gain(.4)
// a named waveform through crush, shape and a vowel filter
$: n("0 2 4 7").scale("C:minor").s("triangle").timbre("organ").crush(8).shape(.2).vowel("o").gain(.3)
`,
  },
  {
    id: 'voices',
    name: 'Voices',
    group: 'Sound and signals',
    blurb: 'A singing line with syllables, a small choir, a hum with an overtone, and a talking bass.',
    tags: ['syllables', 'choir'],
    source: `setcpm(84/4)
// voice sings syllables: consonants lead into the beat and _ holds the vowel
$: note("c4 d4 e4 [g4 e4]").s("voice").syl("la la li [lu _]").voicetype("alto").mono(1).vglide(.08).room(.4)
// a choir of scattered voices on slow chords
$: note("<[c3,e3,g3] [a2,c3,e3]>").s("choir").syl("<ah oo>").attack(.3).release(1.5).gain(.5).slow(2)
// a hum drone with an overtone whistle, and a whispered pulse
$: note("c2").s("hum").overtone(8).gain(.4)
$: s("whisper*4").syl("<sha ha>").gain(.3)
// talk puts a vowel track on a saw bass
$: note("c2*8").s("sawtooth").syl("wa wa wo wi").talk(1).gain(.4)
`,
  },

  // ---- Language
  {
    id: 'bindings',
    name: 'Bindings and arithmetic',
    group: 'Language',
    blurb: 'const values, exact constant arithmetic and constant spreads.',
    tags: ['const', 'setcps'],
    source: `setcps(.45)

const lag = 1/16
const bars = 2 * 2
const kick = s("bd [~ bd] ~ bd")
const snare = s("~ sd").late(lag)

$: stack(...[kick, snare])
$: s("hh*8").gain(.5).late(lag / 2)
$: n("0 2 4 6").scale("F:lydian").s("triangle").slow(bars).release(.3)
`,
  },
  {
    id: 'named-tracks',
    name: 'Named tracks',
    group: 'Language',
    blurb: 'Named outputs, labels, and the cat, seq and silence combinators.',
    tags: ['name:', 'cat seq'],
    source: `setcpm(104/4)

drums: s("bd*2, ~ sd, hh*4")
bass: note(cat("c2 c2", "eb2 eb2", "f2 g2")).s("sawtooth").lpf(600).release(.15)
lead: seq(note("g3"), note("bb3 c4"), note("~ d4")).s("square").gain(.25).release(.05)
$: s(cat("rim*2", silence, "cp")).gain(.5).label("fills")
`,
  },
  {
    id: 'function-args',
    name: 'Function arguments',
    group: 'Language',
    blurb: 'A transform name, a partial application, an arrow and a block body.',
    tags: ['every', 'lambdas'],
    source: `setcpm(108/4)

$: s("bd sd [~ bd] sd").every(4, rev)
$: s("hh*8").every(3, fast(2)).gain(.5)
$: note("c3 e3 g3 b3").s("triangle").every(2, x => x.add(5)).release(.1)
$: note("c2 ~ g1 ~").s("sawtooth").every(4, x => { return x.ply(2).lpf(400); }).release(.2)
`,
  },
];
