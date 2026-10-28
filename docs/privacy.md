# Mayorly privacy policy

Mayorly is a desk timer and journal that lives on your computer. This page says what it keeps, where, and who can see it. It is written to be read, not to be scrolled past.

## On your computer

Everything you put into Mayorly stays in one file on your computer: your ledgers, entries, desk time, coins, settings and the clerk's log. Beside it are daily backups and a log file for problems. You can export all of it as JSON from Settings, import it back, and delete it by removing the app's data folder (Open data folder in the menu bar).

Mayorly has no analytics, no advertising, no tracking and no crash reporting. The log stays on your computer unless you send it to us.

## If you sign in

Signing in is optional. It exists so the same ledgers follow you between computers. When you sign in with Google, Mayorly's server (mayorly-api, hosted on Railway) stores:

- your Google account id, email address, name and picture, to know which document is yours;
- your Mayorly document: the same ledgers, entries, desk time and settings that are in the file on your computer, except settings that belong to one machine (hotkeys, HUD placement, open at login).

The server keeps the latest copy and a revision number, nothing else. It does not read the document, index it, or share it. Traffic is over HTTPS.

**Deleting your account** is in Settings. It removes your account and your document from the server at once. The copy on your computer stays yours.

## If you add an AI key

The clerk is optional and brings its own key: you paste a key from Anthropic, OpenAI, Google or another provider. The key is sealed on your computer (with the operating system's store on Windows and Linux, with a key kept beside Mayorly's data on a Mac) and never leaves it except to that provider. When the clerk files an entry, the entry's text, the names and criteria of your ledgers, and your house rules are sent to the provider you chose, under that provider's terms. Nothing is sent to us.

## Children

Mayorly is not directed to children under 13 and does not knowingly collect information from them.

## Changes

If this policy changes, the change is recorded in the Mayorly repository with the date, and the app's release notes say so.

## Contact

Open an issue in the Mayorly repository on GitHub.

*Last updated 2026-10-27.*
