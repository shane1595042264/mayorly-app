# Decision log

Newest first. Each entry records what was decided, why, and what would reverse it. Product-level decisions live in [mayorly-design/docs/04-decisions.md](https://github.com/shane1595042264/mayorly-design/blob/main/docs/04-decisions.md); these are the ones this layer made.

## 2026-10-09

### Electron, not Tauri, for the Windows app layer
The design log chose Tauri v2 for a macOS-first pixel game. This layer is a Windows overlay first, and the overlay needs one thing Tauri does not offer: **ignoring the mouse while still receiving move events** (`setIgnoreMouseEvents(true, { forward: true })`). That is what lets a click-through HUD notice the pointer over its own buttons. Tauri's `set_ignore_cursor_events` is all or nothing, which would force a hotkey just to press Hold. Electron also ships transparent, topmost, non-activating windows on Windows without native code, and the founder asked for it by name. **Cost:** a ~110 MB installer and a Chromium per app. **Reverses if:** Tauri gains forwarded cursor events, or the pixel game ships on Tauri and running two runtimes becomes the bigger cost.

### Windows first for this layer
The founder's request for the app layer is "mainly a Windows application". Nothing in `src/core` or `src/renderer` is Windows specific; only `src/main/overlay.ts` (window flags) and the installer are. macOS needs a different overlay level and the Accessibility-free hotkey rule from the design spec. **Reverses if:** the founder moves to daily use on a Mac.

### The domain core is pure and owns every rule
`src/core` has no I/O and takes time, ids and randomness as arguments. **Why:** this is the layer every future client shares, so its rules must be testable without a window and identical everywhere. The browser preview runs the exact same reducer. **Reverses if:** never; this is the point of the repo.

### The main process owns the one true state
Renderers send actions and receive snapshots; they never hold authoritative state. **Why:** the spec designs for a local sync API from v1 so that nothing assumes a single client. With the host as the only writer, the HUD, a future pixel window, and an HTTP client are peers. **Cost:** a full snapshot per change over IPC, which is fine at this size.

### Supersets are a planner mode, not a scheduler
A superset is a rule the planner reads (slots, rounds, rests, order, what to do on clear), and the desk asks "what next" only when a block ends or you act. **Why:** it keeps the one-timer rule intact, makes swaps and holds behave the same in every mode, and means a superset can be redeployed mid-sitting without a calendar to reconcile. **Rejected:** a time-of-day scheduler (blocks pinned to clock times), because a missed start would cascade, which is guilt by another name.

### Tomatoes are minted from accumulated focus, not from completed blocks
The spec says each completed interval is one tomato. With supersets the blocks have different lengths (25, 20, 25), so "interval" means the tomato length (the focus setting) worth of focus time inside a sitting, however it was split across blocks and swaps. **Why:** a 20-minute dance slot and a 5-minute remainder should still add up, and splitting a block with a swap must never cost a tomato. Partial time is tracked, not paid. **Reverses if:** the founder wants tomatoes tied to whole blocks; it is one function.

### Blocks may target a ledger with no entry
"Dance 25" runs as Dance time even when no Dance entry exists. **Why:** practice, study and job hunting are often a ledger, not a task, and the founder's own examples were ledgers. Time is still tracked against the ledger.

### Redeploying keeps the sitting; sleep pauses it
A new plan mid-sitting keeps banked focus toward the three-tomato bonus. A heartbeat gap over two minutes pauses the desk at the last beat, and so does launching with a desk left running. **Why:** switching plans is the whole point of supersets and must not be punished; sleeping is not desk time and must not be paid. Both follow the spec's anti-cheat and anti-guilt rules.

### Hold to peek, tap to toggle
Alt+T held longer than 400 ms closes the Plus menu on release, like the attachment menu it is modelled on. A quick tap leaves it open for keyboard use. Auto-repeat from a held global hotkey is ignored until the key is released.

### JSON file now, SQLite later
One atomic JSON file in AppData. **Why:** zero native modules means no Electron rebuild step and no build tools on the founder's machine. The store is one module behind an interface. **Reverses when:** segments pass a few MB, or the classifier needs transactional batch moves, as the design log predicts.

### One theme, one accent, square corners
The HUD always sits on top of another app, so a light theme would be a second set of scrims for no gain. Amber is the only accent and always means live or about to be picked. Ledgers are told apart by callsign and glyph, not colour, which also keeps colour free for the leisure state the spec reserves.

### The app icon is the founder's tomato, scaled by whole pixels
`build/icon.ico` and the tray icon are `icon.tomato@1x.png` from mayorly-assets, nearest-neighbour at 2x and 16x, the same integer zoom the game camera uses. No pixel is invented, which keeps the hand-drawn rule. **Reverses when:** the founder draws a dedicated app icon.

### No licence chosen
The sibling repos carry no licence, so neither does this one. Open source first is the stated intent; which licence is the founder's call.
