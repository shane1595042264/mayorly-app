# Mayorly app: instructions for Claude

This is the application layer of Mayorly, a life OS: entries filed into ledgers, one desk timer, tomatoes that pay a token each. Windows and macOS, Electron, React. The product rules come from `mayorly-design`; this repo turns them into code and puts a transparent HUD on top.

## Rules that are not negotiable

- **Every rule lives in `src/core`, and `src/core` stays pure.** No Electron, no DOM, no `Date.now()`, no `Math.random()`. Time, ids and randomness arrive through `Ctx`. If a rule needs the clock, pass it in.
- **State changes only through `reduce()`.** The main process is the only writer. Renderers dispatch actions and render snapshots. Do not add renderer-side state that matters after a restart.
- **The economy is the spec's.** One token per tomato, no bonus for long sittings, tokens only from desk time; a leisure block costs one token as it starts, rests are free, nothing is earned on the couch. No streaks, no decay, no penalties, nothing that punishes a hold or a bad week. Change `src/core/rules.ts` only after the design repo changes.
- **No AI-generated art.** The app icon is the founder's hand-drawn tomato at integer scale. UI icons come from Phosphor; do not hand-draw SVG icons.
- **No em dashes in user-visible copy.** HUD copy is short, plain, and neutral. The clerk speaks in machine-log voice only.

## Where things are

| | |
|---|---|
| `src/core/model.ts` | every type; nouns match the product spec |
| `src/core/reducer.ts` | all actions, the desk state machine, tomato minting |
| `src/core/planner.ts` | pomodoro, blitz, superset and couch sequencing |
| `src/core/superset-syntax.ts` | the one-line `/ss legal 25, dance 20 x3` grammar |
| `src/core/core.test.ts` | rules tested against a fake clock |
| `src/main/engine.ts` | heartbeat, sleep detection, broadcast |
| `src/main/overlay.ts` | the window: on Windows the click-through overlay, on macOS the pet-sized panel that follows the tomato |
| `src/renderer/src/hud/Pet.tsx` | the resting HUD: the tomato, its number, the hover caption |
| `src/renderer/src/lib/keys.ts` | keys matched by position, hotkeys shown as Option on a Mac |
| `src/main/auth.ts`, `session.ts`, `sync.ts` | Google sign-in through the system browser, the encrypted session, the sync loop |
| `server/` | mayorly-api: Google sign-in, one state document per account, last writer wins |
| `src/main/ai/` | the AI clerk: provider from the key's shape, cheapest model that answers, sealed keys, filing and the tray sweep |
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

Parameters go in the environment, which works the same on both platforms; Electron on Windows exits before running the script when a file path is passed as a positional argument. The capture window is offscreen with throttling off; a plain hidden window never runs `requestAnimationFrame`, so Motion animations would stay at their initial frame.

## Things that look like bugs and are not

- **The resting HUD is only the tomato and a number.** Hover gives one line of text and a hop, nothing more. Hold, skip, clear and stand down live in the Plus menu and the command line; there is no control strip.
- **The overlay window is never focusable in field mode.** That is how it avoids stealing keystrokes. Plus, deck and capture flip it on and hand focus back with `blur()`.
- **A held Alt+T fires the command repeatedly.** The renderer ignores repeats until the key is released; releasing after 400 ms closes the menu (hold to peek).
- **A swap does not reset the block clock** except in blitz, where the timer belongs to the entry.
- **Superset slots with nothing open still run**, as ledger time.
- **Deploying anything parks the running session.** The desk holds one parked session in `desk.holster`, with its own sitting and the time already spent on its block. `desk/switch` (Alt+Q) swaps the two; a stand down brings the parked one back paused. Nothing is minted while parked.
- **A desk found running at launch is paused at the last heartbeat.** Time the app could not see is not desk time.
- **`npm run web` with no query loads from localStorage**; `?demo` and `?fresh` never write to it.
- **On a Mac the window is the pet, not the screen.** Field mode is a 220 by 64 point panel around the tomato (a little taller while the caption shows), movable by dragging the tomato, and it takes clicks like any small window. Nothing is click-through on macOS; the `data-hit` path is Windows only. Plus, deck and capture grow the window to the work area and shrink it back. The position is saved in `hud.json` beside the state file.
- **On a Mac the field HUD polls the cursor for hover.** AppKit only sends mouse-moved events to the key window, and the pet never is one, so `overlay.ts` samples the pointer and feeds the page the same mousemove.
- **Hotkeys are stored as `Alt+T` on a Mac too.** Alt is Electron's cross-platform spelling for Option. The HUD labels them Option, the Settings field accepts Option, Cmd and Control and stores Alt.
- **Clicking the menu bar icon on a Mac opens the menu, not the Deck.** That is the macOS convention; Deck is in the menu.
- **The AI clerk never writes state itself.** It returns a `Filing`; `entry/capture` and `entry/file` in the reducer check it (real ledger, real title) and file by prefix otherwise. Keys live in `ai.bin`, sealed with the OS keychain, never in state and never synced.
- **A correction is a house rule.** Entries the clerk filed carry `clerkFiled`; moving one writes a `HouseRule` in the reducer, in words, naming the ledger chosen and the ledger wanted. Rules are state, sync with the account, and go into every clerk prompt ahead of the criteria.
- **Interfaces close on a click outside and when the window loses focus.** The shell sends `close` on blur; the renderer closes on a pointer down outside the open panel.
- **Sync is last writer wins and the server knows no rules.** `sync/replace` in the reducer is the only way a server document enters this machine; it keeps this machine's own settings (`DEVICE_SETTINGS`) and pauses a desk left running elsewhere. The server stores JSON and a revision, nothing else.
- **Accounts need `MAIN_VITE_API_URL` and `MAIN_VITE_GOOGLE_CLIENT_ID` at build time** (see `.env.example`). Without them the Settings tab has no Account section and nothing talks to the network.
- **A Mac build is ad-hoc signed, not notarized.** There is no Developer ID. Gatekeeper refuses the first launch and offers Open Anyway in Privacy & Security. `npm run dist:mac` only works on macOS.
