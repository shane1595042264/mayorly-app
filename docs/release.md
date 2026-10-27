# Releasing Mayorly

There is no staging. The founder runs the installed app, so a change is done when `npm run ship:mac` has run and the new app is up. Everything below is about putting the same build in other people's hands.

## Versions

`npm version patch` (or `minor`) bumps `package.json`, commits and tags `vX.Y.Z`. Pushing the tag runs `.github/workflows/dist.yml`, which builds Windows and macOS, attaches the installers to the GitHub release, and attaches `latest.yml` and `latest-mac.yml`, which installed apps read to find updates. The build number (`CFBundleVersion`) is the workflow run number, so every build is higher than the last, which the App Store insists on.

## What the app does for a release already

- One log a user can send: `logs/mayorly.log` in the data folder (Open data folder in the menu bar). Uncaught errors are written there, and a renderer that dies is reloaded.
- Backups: `backups/` beside the save, one copy a day (14 kept) and one before a sync or an import replaces the state (6 kept). A save that cannot be read falls back to the newest backup that can.
- Export and import in Settings, account deletion in Settings (Apple guideline 5.1.1(v)), and the server removes the account's document the moment it is asked.
- Updates: the direct-download build checks GitHub releases after launch and every six hours, downloads quietly, and offers Restart to update in the menu bar. Only a Developer ID signed build can be updated on a Mac.
- `mayorly://capture?text=...`, `mayorly://deck`, `plus`, `capture`, `pause`, `clear`, `switch` for Shortcuts, Raycast and browsers.

## Direct download (first)

Needs an Apple Developer Program membership (99 USD a year) and, from it, a **Developer ID Application** certificate.

1. Export the certificate and key as a `.p12`. In the repository secrets set `CSC_LINK` (the file, base64), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com) and `APPLE_TEAM_ID`. With these present the workflow signs with the hardened runtime (`build/entitlements.mac.plist`) and notarizes; without them it ad-hoc signs, which Gatekeeper refuses on first launch until Open Anyway.
2. Locally, a certificate in the keychain is found on its own: `CSC_NAME="Developer ID Application: Name (TEAMID)" npm run ship:mac` signs the installed copy too.
3. Windows: SmartScreen warns about unsigned installers until the publisher has reputation or a certificate. Azure Trusted Signing is the cheap route; set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` the same way, or sign with the `signtool` step electron-builder documents.

## Mac App Store (after)

What is in place: the `mas` target (`npm run dist:mas`), the sandbox entitlements (`build/entitlements.mas.plist`, replace `TEAMID`), the helper entitlements, `LSUIElement`, `ITSAppUsesNonExemptEncryption`, account deletion, export, no tracking. Nothing in the app needs an API the sandbox refuses: global hotkeys go through Carbon, the keychain seals the AI keys inside the container, the loopback sign-in server is covered by the network server entitlement, and the data folder is the container's.

What only the founder can do:

1. App Store Connect: create the app with bundle id `app.mayorly`, a **Mac App Distribution** certificate, a **Mac Installer Distribution** certificate, and a Mac App Store provisioning profile saved as `build/embedded.provisionprofile`.
2. Build with `npm run dist:mas` on a Mac with those certificates, upload the `.pkg` with Transporter, and submit.
3. **Sign in with Apple (guideline 4.8).** An app that offers Google sign-in must offer Sign in with Apple too. Either add it to mayorly-api (verify Apple identity tokens against Apple's key set the way `server/src/auth.ts` verifies Google's, and open `appleid.apple.com/auth/authorize` through the same loopback flow) or build the store version without the Account section (`MAIN_VITE_API_URL` unset hides it) until that lands. The direct-download build is not bound by 4.8.
4. A privacy policy URL. `docs/privacy.md` is the text; host it (GitHub Pages is enough) and paste the URL into App Store Connect.
5. Privacy labels, from `docs/privacy.md`: with an account, "Email Address" and "Name" linked to the user for app functionality, and "Other User Content" (the entries) linked to the user; nothing used for tracking. With the clerk, entry titles go to the AI provider the user chose, under that provider's policy.
6. Screenshots, the listing, and the hand-drawn art. Reviewers open the app with no account and no AI key, so the empty flow has to carry the first minute, which it does.

## The server

mayorly-api deploys from `server/` with the Railway CLI (`RAILWAY_API_TOKEN` in `.env.local`, the folder linked to the `mayorly` project): `railway up --detach`, then `curl https://mayorly-api-production.up.railway.app/health`. Production needs `JWT_SECRET` (32 characters or more), `GOOGLE_CLIENT_IDS` and `DATABASE_URL`; the schema brings itself up to date on boot. A client on an older build cannot overwrite a newer document (the server refuses a lower schema), and Sign out everywhere bumps the account's token version.

## Checks before a tag

```
npm test
npm run typecheck
npm run build
npm run ship:mac      and use it for a day
```
