# Mayorly app: instructions for Claude

This is the application layer of Mayorly, a life OS: entries filed into ledgers, one desk timer, tomatoes that pay a coin each. Windows and macOS, Electron, React. The product rules come from `mayorly-design`; this repo turns them into code and puts a transparent HUD on top.

## Rules that are not negotiable

- **Every rule lives in `src/core`, and `src/core` stays pure.** No Electron, no DOM, no `Date.now()`, no `Math.random()`. Time, ids and randomness arrive through `Ctx`. If a rule needs the clock, pass it in.
- **State changes only through `reduce()`.** The main process is the only writer. Renderers dispatch actions and render snapshots. Do not add renderer-side state that matters after a restart.
- **The economy is the spec's.** One coin per tomato; a tomato grown on an entry is paid when that entry is cleared (the harvest), ledger time with no entry pays as it goes, a deleted entry forfeits its tomatoes. No bonus for long sittings, coins only from desk time; a completed leisure block costs one coin, rests are free, a block left early is free, nothing is earned on the couch. No streaks, no decay, no penalties, nothing that punishes a hold or a bad week. A ledger with `pays` off (paid work) is outside the economy: its tomatoes ripen and count, mint nothing and are never charged (`ledgerPays` in the reducer). Change `src/core/rules.ts` only after the design repo changes.
- **No AI-generated art.** The app icon is the founder's hand-drawn tomato at integer scale. UI icons come from Phosphor; do not hand-draw SVG icons. A ledger's glyph is a Phosphor name from the catalogue in `lib/glyphs.tsx`; the clerk may *choose* a name from that list (`pickGlyph`), never draw one.
- **No em dashes in user-visible copy.** HUD copy is short, plain, and neutral. The clerk speaks in machine-log voice only.

## Where things are

| | |
|---|---|
| `src/core/model.ts` | every type; nouns match the product spec |
| `src/core/reducer.ts` | all actions, the desk state machine, tomato minting |
| `src/core/planner.ts` | pomodoro, blitz, superset and couch sequencing |
| `src/core/superset-syntax.ts` | the one-line `/ss legal 25, dance 20 x3` grammar |
| `src/core/merge.ts` | two copies of one account's state become one without losing work |
| `src/core/core.test.ts` | rules tested against a fake clock |
| `src/main/engine.ts` | heartbeat, sleep detection, broadcast |
| `src/main/store.ts`, `log.ts`, `updates.ts` | the save and its backups, the log file and crash handling, GitHub-release updates |
| `docs/release.md`, `docs/privacy.md` | the release checklist (signing, notarization, App Store) and the privacy policy text |
| `src/main/overlay.ts` | the window: on Windows the click-through overlay, on macOS the pet-sized panel that follows the tomato |
| `src/renderer/src/hud/Pet.tsx` | the resting HUD: the tomato, its number, the hover caption |
| `src/renderer/src/lib/keys.ts` | keys matched by position, hotkeys shown as Option on a Mac |
| `src/renderer/src/lib/keymap.ts` | every in-app key by scope with its default; `settings.keymap` holds what the user changed; `deck/Keymap.tsx` is the screen |
| `src/renderer/src/lib/listkeys.ts` | j and k on a list, and what the other list keys do, per tab |
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
npm run ship:mac     build Mayorly.app, install it in /Applications, relaunch it
```

There is no staging: the founder runs the installed app, so a change is done when `ship:mac` has run and the new app is up. `npm run dev` is for iterating (hot reload, and with `MAYORLY_DEBUG=1` the `SIGUSR1`/`SIGUSR2` previews); the dev instance and the installed app share one single-instance lock, so only one runs at a time and the ship script quits whichever is up.

To screenshot the browser preview at full resolution:

```
SHOT_URL="http://localhost:5199/?demo" SHOT_OUT=shot.png SHOT_JS='...' npx electron scripts/shot.cjs
```

`?demo` and `?fresh` put `window.__mayorly = { dispatch, state }` on the page, so `SHOT_JS` (or the console) can drive the HUD: dispatch a harvest, open the deck with a synthetic keydown, and so on. Parameters go in the environment, which works the same on both platforms; Electron on Windows exits before running the script when a file path is passed as a positional argument. The capture window is offscreen with throttling off; a plain hidden window never runs `requestAnimationFrame`, so Motion animations would stay at their initial frame.

## Things that look like bugs and are not

- **The resting HUD is only the tomato and a number.** Hover gives one line of text and a hop, nothing more. Hold, skip, clear and stand down live in the Plus menu and the command line; there is no control strip.
- **The overlay window is never focusable in field mode.** That is how it avoids stealing keystrokes. Plus, deck and capture flip it on and hand focus back with `blur()`.
- **A held Alt+T fires the command repeatedly.** The renderer ignores repeats until the key is released; releasing after 400 ms closes the menu (hold to peek), unless an arm was steered meanwhile, which commits the open.
- **The Plus menu's keys are the keymap's `plus` scope**, matched by position with Option ignored (`actionFor(e, 'plus', settings, { ignoreShift: true, ignoreAlt: true })`), so they work while the swap key is still held. Digits 1 to 9 pick the item at that number in the arm you are on; every tile shows its number. `useFit` remeasures on resize, through a ResizeObserver and on timers after mount, because the menu mounts while the window is still pet-sized.
- **Alt+arrow and Alt+digit while the Plus menu is open are global shortcuts.** The swap key's modifiers plus Up, Down, Left, Right or 0 to 9 are registered as the menu opens and released as it closes, so Alt+T and Alt+Left (or Alt+1) in the same breath land before the window has the keyboard. They arrive as `arm-*` and `pick-*` commands; `plus/arms.ts` is the one path that points at an arm or a number, and a point made before the menu mounts waits as a hint. In the menu, 0 is always the couch: a tile at the end of the ledger arm that turns the entry arm into the couch list.
- **A swap does not reset the block clock** except in blitz, where the timer belongs to the entry. A swap you ask for (the Plus menu, Alt+Q) also resumes a desk on hold or waiting, so switching tasks is one act; a swap the desk makes on its own, such as the next entry after a clear, leaves a hold alone.
- **Superset slots with nothing open still run**, as ledger time.
- **Deploying anything parks the running session.** The desk holds one parked session in `desk.holster`, with its own sitting and the time already spent on its block. `desk/switch` (Alt+Q) swaps the two; a stand down brings the parked one back paused. Nothing is minted while parked.
- **Alt+Q is a two-place toggle, and a swap-back beats the parked session.** Every swap writes the entry it left into `desk.previous`; the switch swaps back to it inside the same sitting, like a primary and a secondary weapon, and only falls back to the holster when there is no such entry. A swap to a third entry drops the oldest, parked or not; a cleared entry on the other side gives way to its ledger. The parked session still returns on a stand down.
- **A desk found running at launch is paused at the last heartbeat.** Time the app could not see is not desk time.
- **`npm run web` with no query loads from localStorage**; `?demo` and `?fresh` never write to it.
- **The quick drawer (Alt+Shift+R) is its own window on a Mac.** `overlay.toggleDrawer` hangs a `DRAWER`-sized panel under the pet (over it when the pet sits low) that loads `?drawer` (`DrawerApp` in `hud/Drawer.tsx`); the pet's window never changes, so the tomato never moves. It is focusable, and closes on blur, on Esc from its page (`closeDrawer`), or on the hotkey again. On Windows and in the browser the overlay draws the same component beside the pet as the `drawer` mode. Notes and subtasks live on the entry (`entry/note`, `entry/subtask-*`), rules on the leisure item (`leisure/cue-*`), all through the reducer.
- **On a Mac the window is the pet, not the screen.** Field mode is a panel the size of the pet (`PET` in `overlay.ts`: the sign's column, the tomato, room for two lines of task), movable by dragging the tomato or with Option+G, and it takes clicks like any small window. The hover caption is its own click-through window just above the tomato, and it only says what the pet does not already show. Nothing is click-through on macOS; the `data-hit` path is Windows only. Plus, deck and capture grow the window to the work area and shrink it back. The position is saved in `hud.json` beside the state file.
- **On a Mac the field HUD polls the cursor for hover.** AppKit only sends mouse-moved events to the key window, and the pet never is one, so `overlay.ts` samples the pointer and feeds the page the same mousemove.
- **Two kinds of keys.** `settings.hotkeys` are global Electron accelerators, registered by the shell and kept per machine (`DEVICE_SETTINGS`). `settings.keymap` are in-app keys read by the renderer alone, named like `list.down`, and they sync. A key the user did not change is not in `keymap` at all; `keysFor` falls back to the default in `lib/keymap.ts`.
- **Text size is per area and per machine.** `settings.text` (`pet`, `deck`, `plus`, 0.8 to 1.6, in `DEVICE_SETTINGS`): the pet's task line reads `--text-pet`, the deck body zooms by `--text-deck`, the swap menu multiplies its fit by `text.plus`, and on a Mac `overlay.setTextSize` gives the pet window the height two bigger task lines need (`TASK_LINES`).
- **Hotkeys are stored as `Alt+T` on a Mac too.** Alt is Electron's cross-platform spelling for Option. The HUD labels them Option, the Settings field accepts Option, Cmd and Control and stores Alt.
- **Clicking the menu bar icon on a Mac opens the menu, not the Deck.** That is the macOS convention; Deck is in the menu.
- **The app has an application menu but no menu bar.** An accessory app shows none; the menu exists so Cmd+C, V, X, A and Z work in text fields and Cmd+Q quits. Cmd+W closes the open panel.
- **`backups/` fills up on its own.** One copy a day, one before a sync or an import replaces the state; `Store.load` falls back to them when the save cannot be read. A file dialog of our own sets `dialogOpen`, so the blur that would close the deck is ignored while it is up.
- **`mayorly://` is registered only in a packaged build**, and `open-url` can arrive before boot, so it is queued at module level.
- **Every build carries a stamp.** `build-info.ts` puts the version, the short commit (with a `+` when the tree was dirty), the build time and the top section of `NOTES.md` into every bundle as `__MAYORLY_BUILD__`. The first launch of a build on a machine opens the deck on the What changed card; `notes.json` beside the save remembers the build seen, a first run marks it seen without showing it, and Settings shows the build and brings the card back. Write the top section of `NOTES.md` in plain words before shipping.
- **The updater is silent.** Errors go to the log. A build installed by `ship:mac` has no `app-update.yml`, so it never checks; a signed download build without a Developer ID logs one error per check, which is expected until the certificate exists.
- **A deleted account's token still verifies.** `requireAuth` on the server looks the user row up on every request; the missing row is what answers 401.
- **Capture and start skips the clerk's wait.** `entry/capture` with `start` files by prefix and puts the entry on the desk in the same reduce (a focus block swaps to it and resumes, anything else deploys a pomodoro); `captureLine` then asks the clerk and, if it names another ledger, dispatches `entry/file`, which moves a block that is on that entry along with it.
- **The AI clerk never writes state itself.** It returns a `Filing`; `entry/capture` and `entry/file` in the reducer check it (real ledger, real title) and file by prefix otherwise. Keys live in `ai.bin`, sealed (`src/main/seal.ts`), never in state and never synced.
- **A correction is a house rule.** Entries the clerk filed carry `clerkFiled`; moving one writes a `HouseRule` in the reducer, in words, naming the ledger chosen and the ledger wanted. Rules are state, sync with the account, and go into every clerk prompt ahead of the criteria.
- **Interfaces close on a click outside and when the window loses focus.** The shell sends `close` on blur; the renderer closes on a pointer down outside the open panel.
- **Sync is last writer wins on the server, and never loses work on the client.** A server document enters this machine through `sync/replace` (taken whole, when nothing changed here since the last sync) or `sync/merge` (unioned with this machine's work otherwise; `src/core/merge.ts`); both keep this machine's own settings (`DEVICE_SETTINGS`) and pause a desk left running elsewhere, and the merge leaves a desk running here alone. `sync.json` beside the save holds the revision, the time and the hash of the last match. A document the reducer refuses blocks syncing until the app is updated. The server stores JSON, a revision and a per-user token version, nothing else.
- **Accounts need `MAIN_VITE_API_URL` and `MAIN_VITE_GOOGLE_CLIENT_ID` at build time** (see `.env.example`). Without them the Settings tab has no Account section and nothing talks to the network.
- **A Mac build is ad-hoc signed, not notarized.** There is no Developer ID. Gatekeeper refuses the first launch and offers Open Anyway in Privacy & Security. `npm run dist:mac` only works on macOS.
- **`ship:mac` signs with the local certificate "Mayorly Local"** when `scripts/local-cert.sh` has put one in the login keychain, so every build has one identity. A Developer ID (`CSC_NAME`) still wins.
- **On a Mac, secrets are sealed with a local key, not the keychain.** `seal.ts`: `session.bin` and `ai.bin` are AES-256-GCM under `seal.key` beside the save (0600). The keychain's Always Allow is tied to a partition list that, for an app without an Apple team identifier, holds a cdhash per build, so safeStorage asked for the login password after every ship, signed or not. A self-signed certificate cannot carry a team identifier. Windows and Linux keep safeStorage (DPAPI, the keyring), which never asks. A file the keychain sealed is opened once more and resealed.
