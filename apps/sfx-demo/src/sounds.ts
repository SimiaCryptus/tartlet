// The demo's sound effects, each a short Tartlet sketch. setcps sets how long one cycle lasts.
export const SOUNDS: ReadonlyMap<string, string> = new Map([
  ['like', 'setcps(3)\n$: note("e5 b5").s("triangle").decay(.12).sustain(0).room(.2)'],
  ['save', 'setcps(4)\n$: s("click").gain(.7)'],
  ['success', 'setcps(1.5)\n$: n("0 2 4 7").scale("C5:major").s("sine").decay(.2).sustain(0).room(.3)'],
  ['error', 'setcps(4)\n$: note("c3 c3").s("square").lpf(900).decay(.08).sustain(0).gain(.4)'],
  ['delete', 'setcps(2)\n$: note("g3").s("sawtooth").penv(-12).pdecay(.3).lpf(1200).decay(.3).sustain(0)'],
  ['notify', 'setcps(1)\n$: note("a5").s("sine").fm(3).fmh(3.5).decay(.6).sustain(0).room(.4)'],
  ['on', 'setcps(6)\n$: note("c5 g5").s("sine").decay(.05).sustain(0)'],
  ['off', 'setcps(6)\n$: note("g5 c5").s("sine").decay(.05).sustain(0)'],
  ['key', 'setcps(16)\n$: s("tick").gain(.3)'],
  ['erase', 'setcps(16)\n$: s("tick").speed(.6).gain(.3)'],
  ['send', 'setcps(4)\n$: note("c5 e5 g5 c6").s("triangle").decay(.08).sustain(0).gain(.5)'],
  ['hover', 'setcps(4)\n$: s("drip").gain(.25)'],
]);

/** A pad note: the degree picks a pitch from a pentatonic scale, the pan places it left to right. */
export function padSound(degree: number, pan: number): string {
  const deg = Math.min(9, Math.max(0, Math.round(degree)));
  const p = Math.min(1, Math.max(0, pan)).toFixed(1);
  return `setcps(2)\n$: n(${String(deg)}).scale("C4:minor pentatonic").s("triangle").release(.3).pan(${p})`;
}