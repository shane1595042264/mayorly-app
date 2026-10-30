# Decision log

Newest first. Each entry records what was decided, why, and what would reverse it. Product-level decisions live in [mayorly-design/docs/04-decisions.md](https://github.com/shane1595042264/mayorly-design/blob/main/docs/04-decisions.md); these are the ones this layer made.

## 2026-10-22

### Tokens are harvested: paid when the entry is cleared
The founder wanted tokens to feel grown, not ticked: a tomato ripened on an entry is banked on it (`entry.tomatoes`) and pays out as a `harvest` transaction when the entry is cleared, which Alt+C does from anywhere. Ledger time with no entry pays as it goes, because there is nothing to harvest. A deleted entry forfeits its tomatoes. Leisure mirrors it: a block of play is charged when it completes, not when it starts, and a block left early costs nothing. **Rejected:** paying on sitting end, which rewards sitting rather than finishing. **Reverses if:** entries that never close pile up unpaid tomatoes; then a cap or an expiry, not a change of principle.

### The quick switch: one parked session, clocks never reset
The founder wanted the FPS weapon swap: Q to the previous session, Q back, timers untouched. The desk gets a holster for exactly one parked session, kept with its own sitting and the time already banked on its block. Deploying anything parks what was running; the switch swaps the two; standing down brings the parked one back paused; the parked one mints nothing. With the bonus gone there is no reason left to fold a redeploy into the old sitting, so every deploy is a sitting of its own. **Rejected:** a stack of parked sessions, which is a task list by another name. Leisure items carry context switch rules, cues in the user's words with no logic behind them, shown while on the couch.

### One token per tomato, no bonus; one token per leisure block
The founder dropped the 12-per-tomato rate and the long-sitting bonus: the bonus rewarded one kind of day over another, and the point is to keep the economy stupidly simple. A tomato is a token. The couch pairs with it: it runs on the same focus and rest cadence as a pomodoro, and each leisure block costs one token as it starts, rests free, no refunds, so a tomato of work is a block of play. The product spec in mayorly-design changed in the same commit. **Reverses if:** the balance stops meaning anything because it is too easy to earn; then prices move, not the rate.

### Leisure is its own list and its own sitting, outside the ledgers
The founder wanted entertainment as a category of its own rather than a tag on entries, so `leisure` is a separate list in the state, a `couch` plan on the pomodoro cadence, and a sitting of its own: it refuses to start without a token, stands down any desk work first, mints nothing, and ends on its own when the tokens run out. The clerk may answer LEISURE for a line, which goes to the couch list instead of the flow. **Rejected:** entertainment as a tag on entries in ledgers, which would put bought time next to earned time in the same bays. **Cost:** a fourth mode in the planner and a third segment kind.

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

### The currency is called coins
Tokens became coins in every piece of user-visible copy on 2026-10-26: the Deck header, the couch tab, the record, the harvest line. **Why:** the founder: "sounds like AI tokens". The app now also holds AI provider keys whose usage is counted in tokens, so the word meant two things in one Settings tab. The code keeps `tokens` and `TokenTx`: a rename there is churn in the sync document for no user gain. The coin on screen is `icon.coin@1x.png` from mayorly-assets at whole-pixel scale.

### The harvest is seen: cashing in
On a harvest, coins fly from the tomato to a counter in the top right of the screen that counts up to the new balance, a coin ding per landing and a short run-up as it banks, then everything fades. On macOS the pet window is too small for that, so a display-only effects window the size of the work area (`?effects`, the same bundle) appears for the animation, ignores the mouse and hides when the page says it is done; Windows draws it inside the overlay. **Why:** clearing a task with Option+C is the moment the economy pays, and a number changing in a deck nobody has open is no reward. The sound is synthesized like the rest of the HUD, no samples.

### The tomato moves by keyboard
Alt+G (Option+G) puts the pet into a move: arrows or hjkl nudge it 16 points, Shift makes that 96, 1 to 4 put it in a corner of the work area, Enter or Escape, a blur, or any key it does not know ends it, and a dashed box around the tomato says it is picked up while the caption lists the keys. On macOS the pet window becomes focusable for the duration and hands focus back after; the anchor is clamped and saved like a drag. On Windows the HUD has two places, so left and right flip `hudSide` and nothing else moves. **Why:** the founder wants the whole app usable without a mouse, and the one thing only the trackpad could do was put the tomato somewhere. Option+G is free in the apps that matter (terminals, browsers, editors use it for nothing) and sits next to the other Option keys.

### No mouse needed: list keys and a Keymap screen
The deck works from the keyboard end to end: j and k pick a row, the row keys act on it (Enter, c, x, r, [ and ], J and K, n, b, s), h j k l walk the shelf, digits jump tabs, ? opens the Keymap. The Keymap screen follows Minecraft's controls: sections of rows, a bevelled keycap per key, press a row's Enter then the new key, Backspace for the default, / to search. Sections and rows rank by how often this machine has used them, counted in localStorage, so the keys you reach for are at the top. In-app keys are plain names (`j`, `G`, `Shift+Enter`, `ArrowDown`) in `settings.keymap` and sync; the global hotkeys stay Electron accelerators per machine and are shown under Anywhere. **Why:** the founder wants the whole app usable without a mouse, vim style, and a list of bindings nobody can find is not accessibility. Defaults avoid q and e (tabs) and anything with a modifier; `r` edits a ledger on the shelf but renames an entry inside one, so inside a ledger the ledger itself is edited from the shelf. **Reverses when:** a scope's keys need to differ per tab; then the scope becomes the tab.

### The caption sits above the tomato and says only what the pet does not
The hover caption on a Mac was hung beside the pet window, which is wider than the pet, so the text landed a hand's width from the tomato. It now sits just above the tomato, starting at its outer edge, and below it only when the screen's top is in the way. It no longer repeats the task: the task is on the pet, up to two lines. Hover shows a line only when there is something the pet does not show, how to deploy when idle and how to get back to a parked session; the clerk's notices and the move hint use the same window. **Why:** the founder: the tooltip was far from the tomato and said what the pet already said.

### The harvest starts where the entry was cleared
With a panel open the overlay window is the whole work area on both platforms, so the coins play inside it and start at the control that cleared the entry, noted just before the dispatch because the row is gone by the time the event comes back; the shell's effects window plays only while the pet is alone on screen. **Why:** clearing from the Flow tab showed nothing on a Mac, since the effects window sat behind the deck, and coins should come from the thing you cleared.


### What a release needs, before anyone but the founder runs it
The app now carries what a user in the wild needs and a reviewer looks for: a log file with uncaught errors written down and dead renderers reloaded; daily backups and one before a sync or an import replaces the state, with a read that falls back to them; export and import; account deletion that removes the server document; a sign-in rate limit and no open CORS on the API; an application menu so Cmd+C, V, A and Q work in a menu bar app; notifications while the HUD is hidden; the `mayorly://` scheme; a cursor poll that slows to four a second when the pointer is far; an auto-updater reading GitHub releases; hardened-runtime and App Sandbox entitlements, a `mas` target, a CI that runs the rules on every push, and a release workflow that signs and notarizes when the secrets exist. **Why:** the founder asked whether the app was ready for the App Store and to build whatever was missing short of the art and Apple's paperwork. **Reverses when:** never; these are the floor.

### Direct download first, the App Store after Sign in with Apple
A Mac build goes out signed with a Developer ID and notarized, with updates from GitHub releases. The Mac App Store build waits on one thing the code cannot give itself: an app that offers Google sign-in must offer Sign in with Apple (guideline 4.8), which needs the developer account to exist before the server can verify Apple's tokens. Until then a store build ships with the Account section hidden, which the build does on its own when no API URL is configured. **Why:** everything else the store asks for is in place, and gating the first public build on paperwork helps nobody.

### Updates are quiet, and a Mac without a certificate has none
The updater checks after launch and every six hours, downloads on its own, and asks for a restart from the menu bar; its errors go to the log, never the HUD. Squirrel.Mac refuses an unsigned app, so until the certificate exists Mac users update by downloading again. **Why:** an update prompt is the one piece of nagging a desk timer could do, and a menu item is enough.

### Sync never discards work: a mark beside the save, and a merge
Last writer wins stays the server's rule, but the client no longer takes a document on faith. `sync.json` beside the save remembers the revision this machine last matched, when, and a hash of the state as it was then. A newer server document is taken whole only when this machine changed nothing since; otherwise the reducer merges the two (`sync/merge`): sittings, segments and coins are unioned, entries and the rest take the server's version where both have one and keep this machine's where it made them since the last sync, and the desk stays with the machine running it. The merge is pushed back, a failed push retries with a growing wait, the quit flush waits for a pull in flight, and a document this build cannot read blocks syncing with a message instead of being overwritten by the next edit. Sessions renew themselves ten days before they run out, and Sign out everywhere bumps a version on the server that every older token fails. **Why:** the audit showed four ways a second machine, a crash or a flaky connection lost work, and a product cannot ship on any of them. **Reverses when:** entities carry edit timestamps or the document becomes a CRDT; then the same-id rule stops favouring the server.

### A new install starts empty
The founder's three ledgers and daily rotation are the sample (`sampleState`), used by the demo and the tests; `firstRunState` is an empty shelf and an open tray, and the first launch opens the deck on the Shelf, whose empty bay says to write a ledger. **Why:** a stranger should not inherit someone else's ledgers, and ledgers are the user's to write.

### A ledger can be paid work: tomatoes count, coins do not
A ledger has a switch, on by default, for whether desk time in it mints coins. Off, a tomato still ripens, still counts in the day and on the entry, and the record of it is kept with no coin on it; the harvest of an entry cleared from such a ledger pays nothing, and nothing is ever charged. Each ledger also wears a colour (amber by default) that the pet's sign, the shelf bay, the live row and the swap menu show. **Why:** the founder is paid in money for professional hours, and a coin for those would be a second wage for the same work. The economy's rule stays one coin per tomato; a paid ledger is simply outside the economy, the way the couch is outside the ledgers. Decided 2026-10-30.

### Nothing is written in the clear, and the HUD cannot go blank
When the OS keychain is not available the session and the AI keys live for the run and are not saved, which keeps the promise in Settings true. A render error shows a small card with a Reload button and is written to the log over IPC; a renderer that dies is reloaded, three times in five minutes at most. The one reachable render crash (a live superset losing a slot) is gone: saving a running superset re-plans it. A locked screen or a sleeping machine pauses the desk at once, which is the existing rule applied sooner. `mayorly://` can open things and capture, but cannot clear an entry or switch the desk, since any web page can open a link.
