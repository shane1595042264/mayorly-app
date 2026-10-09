# Mayorly app: instructions for Claude

This is the application layer of Mayorly, a life OS: entries filed into ledgers, one desk timer, tomatoes that pay tokens. Windows first, Electron, React. The product rules come from `mayorly-design`; this repo turns them into code and puts a transparent HUD on top.

## Rules that are not negotiable

- **Every rule lives in `src/core`, and `src/core` stays pure.** No Electron, no DOM, no `Date.now()`, no `Math.random()`. Time, ids and randomness arrive through `Ctx`. If a rule needs the clock, pass it in.
- **State changes only through `reduce()`.** The main process is the only writer. Renderers dispatch actions and render snapshots. Do not add renderer-side state that matters after a restart.
- **The economy is the spec's.** 12 tokens per tomato, 18 each once a sitting reaches 3, tokens only from desk time. No streaks, no decay, no penalties, nothing that punishes a hold or a bad week. Change `src/core/rules.ts` only after the design repo changes.
- **No AI-generated art.** The app icon is the founder's hand-drawn tomato at integer scale. UI icons come from Phosphor; do not hand-draw SVG icons.
- **No em dashes in user-visible copy.** HUD copy is short, plain, and neutral. The clerk speaks in machine-log voice only.

## Where things are

| | |
|---|---|
| `src/core/model.ts` | every type; nouns match the product spec |
| `src/core/reducer.ts` | all actions, the desk state machine, tomato minting |
| `src/core/planner.ts` | pomodoro, blitz and superset sequencing |
| `src/core/superset-syntax.ts` | the one-line `/ss legal 25, dance 20 x3` grammar |
| `src/core/core.test.ts` | rules tested against a fake clock |
| `src/main/engine.ts` | heartbeat, sleep detection, broadcast |
| `src/main/overlay.ts` | the transparent window, click-through, focus hand-off |
| `src/shared/bridge.ts` | the client contract |
| `src/renderer/src/bridge/web.ts` | the same engine in a browser tab, for `npm run web` |

## Checking your work

```
npm test             core rules
npm run typecheck    everything
npm run web          the HUD at localhost:5199 (?demo for sample data, ?fresh for first run)
```

To screenshot the browser preview at full resolution:

```
SHOT_URL="http://localhost:5199/?demo" SHOT_OUT=shot.png SHOT_JS='...' npx electron scripts/shot.cjs
```

Parameters go in the environment because Electron on Windows exits before running the script when a file path is passed as a positional argument. The capture window is offscreen with throttling off; a plain hidden window never runs `requestAnimationFrame`, so Motion animations would stay at their initial frame.

## Things that look like bugs and are not

- **The overlay window is never focusable in field mode.** That is how it avoids stealing keystrokes. Plus, deck and capture flip it on and hand focus back with `blur()`.
- **A held Alt+T fires the command repeatedly.** The renderer ignores repeats until the key is released; releasing after 400 ms closes the menu (hold to peek).
- **A swap does not reset the block clock** except in blitz, where the timer belongs to the entry.
- **Superset slots with nothing open still run**, as ledger time.
- **A desk found running at launch is paused at the last heartbeat.** Time the app could not see is not desk time.
- **`npm run web` with no query loads from localStorage**; `?demo` and `?fresh` never write to it.
