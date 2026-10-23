# Decision log

Newest first. Each entry records what was decided, why, and what would reverse it. Product-level decisions live in [mayorly-design/docs/04-decisions.md](https://github.com/shane1595042264/mayorly-design/blob/main/docs/04-decisions.md); these are the ones this layer made.

## 2026-10-22

### The clerk is the user's own model, chosen by the key alone
The spec calls the clerk a swappable classifier. It is the user's own API key, the shanejli.com way: the provider is read from the key's shape, its models are listed, the cheapest text model that answers one token becomes the default, and every call is recorded with its cost. The key is sealed with the OS keychain beside the state file and never synced. The reducer trusts a filing only if it names a real ledger and a real title; otherwise the prefix clerk files as before, so a dead key or a slow network costs nothing but the AI. **Rejected:** running the clerk through mayorly-api with the server's own keys, which would make every capture a billable server call and put the key where the user cannot see it.

### Corrections are house rules, written in words
When the user moves an entry the clerk filed, that is the only signal the clerk was wrong, so the reducer turns it into a rule: entries like this go to that ledger, not the one chosen. Rules are plain sentences, part of the state, shown and editable in Settings, and go into every prompt ahead of the criteria. **Rejected:** fine-tuning or embeddings; a dozen sentences do the job and the user can read and correct them.

### Accounts are Google sign-in and a sync server, the shanejli.com way
The founder asked for sign-in like shanejli.com and for all data to reach a server. shanejli.com's backend verifies a Google ID token and issues its own JWT, so mayorly-api does the same (`server/`), as its own small Railway service with its own Postgres rather than a module in shaneBackend: Mayorly's data stays Mayorly's, and the website is untouched. The desktop app cannot use the website's web client (Google forbids its consent screen in embedded views and a web client cannot do the loopback exchange), so it uses a Google "Desktop app" client and the loopback flow through the system browser. **Cost:** a second service to run, and a Google Cloud client to create.

### Sync is one document, last writer wins
The state is one JSON (about a megabyte a year), the app is single-user, and the first need is "the same on my Mac and my Windows machine". So the server keeps the whole document with a revision, a push carries the revision it was based on, and a conflict returns the winner, which replaces the loser through the reducer. **Rejected:** per-record merging, which needs an operation log and conflict rules for every noun before there is a second user. **Kept out of the merge:** hotkeys, HUD side and scale, open at login and sound, which belong to the machine. **Reverses when:** two machines are used at once for real; then segments and tokens, which only ever append, become the first per-record sync.

## 2026-10-19

### macOS is a second target in the same repo, on the same code
The founder works on a Mac now, which is the condition the Windows-first entry below named. Nothing in `src/core` changed. The renderer changed how keys are matched and, by the founder's call, what the resting HUD is (the pet, below). The shell differences fit in `src/main/overlay.ts` (a non-activating panel, every Space, the pet-sized window, a cursor poll for hover), `src/main/index.ts` (accessory policy, a login item guard) and `src/main/tray.ts` (a 1x and 2x image, menu on click), plus a `mac` block in `electron-builder.yml`. **Why one repo:** Electron builds both from one tree, and a second repo would fork the domain core, the one thing this layer exists to keep single. **Rejected:** a separate `mayorly-mac` repo. **Reverses if:** the shells drift until `src/main` is mostly conditionals; then they split into `src/main/win32` and `src/main/darwin` behind one interface, still here.

### The overlay is a panel on macOS
A normal window can take keyboard focus only once Mayorly is the active app, which takes the menu bar from whatever you were doing, and `blur()` would not hand focus back. Electron's `type: 'panel'` is the non-activating panel that Spotlight-style tools use: plus, deck and capture take typing while your app stays active, and closing them leaves it active. Field mode is unchanged. **Cost:** the type cannot change after construction, so it is a constructor option.

### The resting HUD is a pet: the tomato and one number
The founder found the field card big and distracting over other apps, and wanted the Codex-pet shape instead: a small mascot that stays out of the way. At rest the HUD is the hand-drawn tomato with a sign (the countdown, or today's tomatoes), a one-line caption and a hop on hover, and nothing else; hold, skip, clear and stand down moved to the Plus menu and the command line, which already had them. The sign is the click target for the swap menu. **Rejected:** unfolding the old card on hover, which on a Mac meant a window big enough to hold it sitting invisibly around the tomato and catching clicks. **Reverses if:** a glance needs more than the clock and the entry; then the caption grows, not the window. The tomato with arms the founder described is his to draw in mayorly-assets; the sprite is one file to swap.

### On macOS the window is the pet, and nothing is click-through
A click-through overlay over the whole work area did not pass clicks reliably on the founder's Mac, even though the window server reported the window as transparent to clicks in every variant tested (normal and panel, with and without Spaces and Mission Control flags, before and after the focus cycle), and the cause was not found. Rather than keep chasing it, field mode on macOS is a 220 by 64 point window hung off the tomato, on the side of the screen it is nearer, taking clicks like any small floating window. The tomato is a native drag region, so the window server moves the window itself; when the move settles the shell re-hangs the window around the tomato and saves the position in `hud.json`. Plus, deck and capture grow the window to the work area, which is what the Windows overlay is all the time. **Cost:** on a Mac the superset objectives strip, the event feed and the centre callout do not show in field mode; the caption carries the hotkey warning instead of the toast. **Reverses if:** click-through is understood and wanted back; the Windows path is unchanged and ready.

### The pet window is exactly the pet; the caption is its own click-through window
Any invisible part of the pet window catches clicks, and the founder could not star an email whose star sat in the room kept for the hover caption. Resizing on hover is out (one frame of old content at the new position makes the tomato jump), so the pet window is the fixed-width sign, the gap and the tomato at the HUD scale and nothing else, and the caption is a second small window beside it that is display only and ignores the mouse entirely. **Cost:** a second renderer process while the caption window exists. **Reverses if:** Electron can resize a transparent window without the stale frame.

### Field-mode hover polls the cursor on macOS
AppKit delivers mouse-moved events only to the key window, and the pet never is one. So on macOS the shell samples the cursor every 40 ms while the pet is visible in field mode and feeds the page the same mousemove, with a mouse leave when the pointer leaves the window. **Cost:** a 25 Hz timer in the main process while the HUD is up, paused during a drag.

### Ad-hoc signed, not notarized
There is no Apple Developer ID. electron-builder skips signing when it finds no certificate, and a download carrying only Electron's linker signature is refused as damaged, with no way through but the command line. `identity: "-"` signs the bundle ad hoc, so Gatekeeper offers Open Anyway in Privacy & Security instead. Hardened runtime stays off until there is a certificate to notarize with. **Reverses when:** the founder buys the certificate; then `identity`, `hardenedRuntime: true` and the notarize variables change, nothing in `src`.

### Hotkeys stay Alt+T on a Mac, shown as Option+T
Alt is Electron's cross-platform spelling for Option, and Option-letter combos register through Carbon with no Accessibility prompt, which the design spec requires. The stored strings are the same on both platforms; the HUD labels them Option on a Mac, and the Settings field accepts Cmd, Option and Control and stores Alt. Keys are matched by position, because Option changes what a key types. **Cost:** while Mayorly runs, Option+N and the other defaults no longer type their characters. macOS 15.0 and 15.1 refused Option-only hot keys outright; the HUD says so instead of blaming another app.

### Icons are written by the repo, not by ImageMagick
`scripts/make-icon.mjs` scales the 16 px tomato by whole numbers and writes the PNG, ICO and ICNS containers itself, so `npm run icon` needs nothing installed and gives the same bytes on both platforms. The ICNS carries Apple's ARGB form for the 16 and 32 point slots, the only form Finder reads there, so every size is the tomato pixel for pixel. The Windows ICO holds PNG entries, which Windows has read since Vista. **Reverses when:** the founder draws a dedicated app icon.

### The menu bar icon opens the menu on a Mac
On macOS a click on a status item with a menu opens the menu, and Electron fires the click event as well, so the Windows behaviour (click opens the Deck) would open the Deck under the menu. The Mac follows its own convention: click for the menu, Deck is in it. The icon stays the colour tomato; a template image would mean redrawing it in black.

## 2026-10-09

### Electron, not Tauri, for the Windows app layer
The design log chose Tauri v2 for a macOS-first pixel game. This layer is a Windows overlay first, and the overlay needs one thing Tauri does not offer: **ignoring the mouse while still receiving move events** (`setIgnoreMouseEvents(true, { forward: true })`). That is what lets a click-through HUD notice the pointer over its own buttons. Tauri's `set_ignore_cursor_events` is all or nothing, which would force a hotkey just to press Hold. Electron also ships transparent, topmost, non-activating windows on Windows without native code, and the founder asked for it by name. **Cost:** a ~110 MB installer on Windows, a ~130 MB disk image per Mac architecture, and a Chromium per app. **Reverses if:** Tauri gains forwarded cursor events, or the pixel game ships on Tauri and running two runtimes becomes the bigger cost.

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
