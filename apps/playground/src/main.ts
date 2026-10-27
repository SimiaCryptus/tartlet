import { defineTartletPlayer, type TartletPlayerElement } from "@tartlet/element";

// The idea.md §13.1 example.
const EXAMPLE = `setcpm(92/4)

$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
`;

defineTartletPlayer();
const player = document.getElementById("player") as TartletPlayerElement;
const editor = document.getElementById("editor") as HTMLTextAreaElement;
editor.value = EXAMPLE;
player.source = EXAMPLE;

let timer: ReturnType<typeof setTimeout> | undefined;
editor.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => { player.source = editor.value; }, 300);
});