# Tartlet sound effects demo

A compact page showing how Tartlet can add sound effects to any web page: button presses,
mouse clicks, hover, typing and form controls.

```sh
pnpm --filter sfx-demo dev
```

- `src/sfx.ts` is the reusable part. `TartletSfx.play(source)` checks and compiles a Tartlet
  source once (cached), turns the onsets of its first cycle into timed notes, and plays them
  through `@tartlet/webaudio`, so the master limiter always applies. Nothing is evaluated as
  JavaScript.
- `src/sounds.ts` holds the effects. Each is a short sketch; `setcps` sets how long one cycle
  (the whole effect) lasts.
- `src/main.ts` wires them to events. Any element with `data-sfx="name"` plays that sound on
  click, and `data-sfx-hover="name"` plays one on mouse hover.

Browsers only allow audio after a user gesture, so the engine starts on the first click, tap or
key press anywhere on the page.