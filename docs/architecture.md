# Architecture

**Status:** v0.1, Windows first. Last updated 2026-10-09.

This repo is the application layer of Mayorly: the rules of the product as running code, and the first client on top of them. The design repo says what Mayorly is; this repo is what it does. Anything that later draws pixels, talks to a phone, or plugs into Stardew sits on the same core and speaks the same contract.

## Three layers

```
 clients            HUD overlay (this repo)   pixel Mayor's Hall (later)   mods via local API (later)
                          |                           |                            |
 contract           ------------------------ Bridge: actions in, snapshots and events out -----------
                          |
 host               main process: Engine (one true state, 1 s heartbeat), Store (atomic JSON), hotkeys, tray
                          |
 domain             src/core: model, planner, reducer, selectors, clerk, rules. Pure functions, no I/O.
```

**The domain owns every rule.** `reduce(state, action, ctx)` is the only way state changes. It takes the clock, an id generator and a random source as arguments, so it is deterministic and every rule is unit tested by moving a fake clock (see `src/core/core.test.ts`). It returns the new state and a list of HUD events (tomato minted, block started, swap, cleared, sitting ended).

**The host owns time and storage.** The Electron main process holds the only live copy of state, ticks the reducer once a second, persists after every change, and broadcasts snapshots. Renderers never compute anything that matters; they render snapshots and send actions. If a window crashes, nothing is lost.

**Clients are interchangeable.** `src/shared/bridge.ts` is the whole contract: `getState`, `dispatch`, `onState`, `onEvents`, `onCommand`, plus two window hints. The Electron preload implements it over IPC. `src/renderer/src/bridge/web.ts` implements it by running the same engine inside a browser tab, which is how the HUD is developed and screenshotted without Electron. The local sync API promised in the product spec is a third implementation over HTTP on `127.0.0.1`, and the pixel game is another renderer on either.

## The domain

Nouns are the spec's, unchanged:

| noun | in code | notes |
|---|---|---|
| journal entry | `Entry` | `ledgerId: null` means it is in the mail tray |
| ledger | `Ledger` | hard cap 9, carries a written criterion and a callsign (`LGL`) |
| hand-written ledger | `handWritten: true` | every ledger made in the app; the clerk may file into it, never rename, merge or delete it |
| clerk | `Clerk` interface, `prefixClerk` | mute; deterministic stand-in for the classifier, files by `legal:` prefix or `#tag`, logs in machine voice |
| desk | `Desk` | the one timer |
| sitting | `Sitting` | from deploy to stand down; the unit the long-grind bonus is counted over |
| tomato | minted in the reducer | one per `tomatoMs` of accumulated focus in a sitting |
| token | `TokenTx` | 12 per tomato, 18 each once a sitting reaches 3, never from ticking a box |

New nouns this layer adds:

| noun | what it is |
|---|---|
| **flow** | open entries in order. Blitz runs it top to bottom. |
| **superset** | a rotation rule: slots (a ledger or a pinned entry, plus minutes), rounds, rest, round rest, fixed or shuffled order, and what to do when an entry is cleared mid-block |
| **mode** | how the planner picks the next block: `pomodoro`, `blitz`, `superset` |
| **block** | one stretch of focus or rest the desk is running now |
| **segment** | a closed interval of desk time against one entry and one ledger; the time-tracking record |

### The desk state machine

```
          deploy                     block ends (auto-start on)
  idle ----------> running <---------------------------------+
   ^                 |  ^  \                                  |
   |   stand down    |  |   \ block ends (auto-start off)     |
   +-----------------+  |    +--------> ready --- resume -----+
   |                hold| resume
   |                 v  |
   +-------------- paused
```

- **Timers are absolute.** A running block stores `runStartedAt` and `bankMs`; elapsed time is computed from the wall clock, never counted. Nothing drifts and a restart loses nothing.
- **Block ends are exact.** The heartbeat closes a block at its true end time, not at the tick that noticed, and can roll through several blocks in one tick.
- **Sleep is not desk time.** If the heartbeat sees a gap over two minutes the desk is paused at the last beat. On launch, a desk left running is paused at the last persisted beat.
- **Redeploying keeps the sitting.** Switching from a pomodoro to a superset mid-sitting keeps banked focus toward the three-tomato bonus.
- **Swaps keep the clock.** Swapping ledger or entry closes one segment and opens the next at the same instant; the block timer runs on. In blitz the timer belongs to the entry, so a swap re-arms it.

### The planner

`src/core/planner.ts`, pure. `initialPlan` and `firstBlock` start a plan; `advance(plan, finishedBlock)` returns the next block or `null` when the plan is done.

| mode | after focus | after rest | when the entry is cleared |
|---|---|---|---|
| pomodoro | rest, long rest every Nth | focus on the anchor, or the next open entry in its ledger | stay in the ledger, block continues |
| blitz | (focus ends only when you clear it) | | next entry in the flow starts, timed to its own estimate |
| superset | rest, or round rest after the last slot, or done | the next slot | next entry in the same ledger, or jump to the next slot |

A superset slot that targets a ledger with nothing open still runs, as ledger time. "Practice dance for 25 minutes" does not need a task to exist.

## The HUD

The overlay is one transparent, frameless, always-on-top window over a display's work area.

- **Field mode** is the resting state. The window ignores the mouse with move events forwarded, so the page can tell when the pointer is over a HUD control (`data-hit`) and only then catch clicks. The window is not focusable in field mode, so no keystroke ever lands in it by accident.
- **Plus, deck and capture** make the window focusable and interactive, then hand focus back on close.
- **Depth is CSS 3D.** One perspective on the stage; panels are rotated planes, and the Plus slab is a real box with four edge faces. Panels lean toward the pointer through Motion springs on motion values, never React state.
- **One accent** (signal amber) means live or about to be picked. One shape rule: square corners, two chamfered corners on panels. One theme, because the overlay is always on top of something else; legibility comes from scrims and text shadow.

## Persistence

`%APPDATA%\Mayorly\mayorly.json`, written to a temp file and renamed, debounced. An unreadable file is moved aside, never overwritten. The file carries a schema number and `migrate()` fills new fields without dropping anything.

The spec's target is SQLite with transactions. `src/main/store.ts` is the only module that knows the format, so swapping it touches nothing else. Segments are the one collection that grows without bound, roughly 1 MB a year of heavy use, which is the trigger to move.

## How the rest of Mayorly plugs in

- **mayorly-design** is upstream of this repo. Rule changes start there and land here in `src/core/rules.ts`.
- **mayorly-assets** becomes a client concern. The pixel Mayor's Hall is a renderer that reads the same snapshots: ledgers on the shelf (`prop2x4.bookshelf` bays), the desk prop switching to `desk.working` while the desk runs, tokens as `icon.coin`. Nothing in the core changes for it.
- **mayorly-workshop** is unaffected; it feeds the assets repo.
- **The local sync API** is a small HTTP server in the main process that maps routes onto `engine.state` and `engine.dispatch`. The Bridge shape is already what it needs.

## Not built yet, on purpose

- Leisure: entertainment tags, buying time with tokens, the couch countdown. The token ledger is ready for debits.
- The classifier proper: induction and assignment. `Clerk` is the seam.
- Multi-monitor HUD (one display at a time today, picked from the tray).
- Code signing and auto-update.
