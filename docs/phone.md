# Mayorly on the phone

A focus timer first: the desk, its clock and its task, with every ledger, entry, the couch and the
cadence one tap away, synced with the computers. iOS now; Android is the same code with one more
native folder (below).

## How it is built

| | |
|---|---|
| `src/phone/` | the app: React in a web view, the same `src/core` reducer as the desktop |
| `src/phone/engine.ts` | state in a file in the app's Library folder, a heartbeat while on screen, the replanner |
| `src/phone/account.ts` | sign-in by a code from a computer, and `src/shared/sync-client.ts`, the desktop's own sync loop |
| `src/phone/notify.ts` | local notifications for every block end, worked out by running the reducer forward |
| `src/phone/updater.ts` | the web layer over the air from GitHub releases, tried before it is kept |
| `src/phone/ui/` | four tabs (Desk, Ledgers, Couch, Settings) and the picker sheet |
| `capacitor.config.json` | Capacitor at the repo root; the native projects live in `mobile/ios` (and later `mobile/android`) |
| `vite.phone.config.ts` | builds `src/phone` into `mobile/www`, with `phone.json` (commit, shell, build time) beside it |
| `scripts/ship-ios.sh` | `npm run ship:ios`: build, sign, install on the phone, open |

Capacitor because everything the product is already exists in TypeScript and React: the reducer,
the merge, the planner, the glyph catalogue, the sync loop. A native rewrite would mean two copies
of every rule. Platform code is the thin part: files, notifications, haptics, the status bar.

**One rule differs from the desktop on purpose.** The desktop pauses a block it could not watch
(the machine slept, the app was closed), because time it could not see is not desk time. A phone is
locked in a pocket for most of every block and the person still means the timer to run, so the
phone never pauses on its own. When it comes back, the tick replays every block end at the moment
it fell (the reducer already chains them), and the notifications rang each one meanwhile.

**Sign-in.** Google refuses OAuth inside a web view, so the phone signs in through iOS's own sheet
(`ASWebAuthenticationSession`, in `mobile/ios/App/App/AuthSession.swift`, registered by
`MainViewController`): the code flow with PKCE against the "Mayorly iPhone" iOS client in the Cloud
project (bundle id `app.mayorly`, its id in `src/phone/google.ts`, and in `GOOGLE_CLIENT_IDS` on the
server beside the desktop's). Google's ID token goes to `/auth/google` as the desktop's does. While
the consent screen is in testing, only its test users can sign in. The fallback is a code from a
computer (Settings, Account, Link a phone): eight characters, ten minutes, once, only its hash on the
server, traded at `/auth/link/claim`. Either way the phone gets its own 30-day session.

**Native code of the app's own** is listed in `NATIVE_FILES` in `vite.phone.config.ts`, so a change
there changes the shell id and an older install waits for `ship:ios` instead of taking a bundle that
calls a plugin it does not have.

**The active device.** The phone is a device like any computer: anything done on it claims the desk,
and a desk running elsewhere shows here as "Running on MacBook" with that device's clock, until Take
over here.

**Design.** Taste skill, app screens, true-black flat (seed 1934367643) with the brand kept:
Mayorly's amber is the only data colour (the running block's track, the task's tomatoes), a ledger's
own colour is its dot, the primary control is a white pill. Barlow Condensed for the clock and titles,
the system face for reading. The clock is the biggest thing on the phone because the screen's one
question is what am I on and how much is left.

## The pipeline

1. **Install once:** `npm run ship:ios` with the phone unlocked on the same Wi-Fi (or a cable).
2. **Every push to main after that** builds the web layer in `dist.yml` (the `phone` job), zips it
   with a manifest (`mayorly-phone.json`: version, commit, shell, sha256, build time) and attaches
   both to the release. The app reads the manifest after launch and every half hour on screen,
   downloads a newer bundle, checks the sha256 and unpacks it where Capacitor serves live bundles
   (`Library/NoCloud/ionic_built_snapshots`). It switches the next time it launches or comes back
   after a minute away. A switch is a trial for one session: the bundle must boot and call
   `markBooted`, or the next launch comes up on the last good one and the bad commit is skipped.
3. **A native change** (a Capacitor package, `mobile/ios`) changes the shell id; bundles built for
   another shell wait, and Settings says the update needs an install. Run `ship:ios` again.

A release built before the phone's own build is never taken, so a `ship:ios` ahead of CI is not undone.

## One-time setup (the founder's hands)

- **Xcode, Settings, Accounts:** add your Apple ID. A free one works. Xcode then makes the Apple
  Development certificate `ship:ios` signs with.
- **On the iPhone:** Settings, Privacy & Security, Developer Mode, on (it restarts). Pair it with the
  Mac once by cable (Trust This Computer); after that Wi-Fi works.
- **First launch:** Settings, General, VPN & Device Management, trust your developer certificate.
- **Free Apple ID:** an install lasts seven days, then iOS will not open it until `ship:ios` runs
  again. The paid Developer Program ($99 a year) makes it a year, and adds TestFlight.

## Android later

The web layer, the engine, sync, the updater's logic and every screen are platform-free already.
Android needs: `npm i @capacitor/android` and `npx cap add android` (it lands in `mobile/android`
from `capacitor.config.json`), the notification channel and exact-alarm permission for block ends,
a `ship:android` that runs `gradlew installDebug` with `adb`, and in `updater.ts` the snapshot folder
Capacitor Android serves from. Nothing in `src/core` or `src/shared` changes.

## Checking it

```
npm run phone                      the app at localhost:5200 (?demo, ?fresh, &tab=, &pick)
IOS_SIM=1 npm run ship:ios         build and run in the booted simulator
npm run ship:ios                   on the phone
```
