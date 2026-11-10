# Mayorly privacy policy

Mayorly is a desk timer and journal that lives on your computer. This page says what it keeps, where, and who can see it. It is written to be read, not to be scrolled past.

## On your computer

Everything you put into Mayorly stays in one file on your computer: your ledgers, entries, desk time, coins, settings and the clerk's log. Beside it are daily backups and a log file for problems. You can export all of it as JSON from Settings, import it back, and delete it by removing the app's data folder (Open data folder in the tray, or the menu bar on a Mac).

Mayorly has no analytics, no advertising, no tracking and no crash reporting. The log stays on your computer unless you send it to us.

## If you sign in

Signing in is optional. It exists so the same ledgers follow you between computers. When you sign in with Google, Mayorly's server (mayorly-api, hosted on Railway) stores:

- your Google account id, email address, name and picture, to know which document is yours;
- your Mayorly document: the same ledgers, entries, desk time and settings that are in the file on your computer, except settings that belong to one machine (hotkeys, HUD placement, open at login).

The server keeps the latest copy and a revision number, nothing else. It does not read the document, index it, or share it. Traffic is over HTTPS.

**Deleting your account** is in Settings. It removes your account and your document from the server at once. The copy on your computer stays yours.

## If you add an AI key

The calendar can read an outside calendar of yours, such as a Google calendar, through its secret iCal address. That address is kept sealed on the machine that added it and is used only to fetch the calendar from Google. The events read from it go into your account's document so the plan on another machine sees them; with "Keep titles" off, only the word Busy and the times are kept.

Your plan can be read by Google Calendar, or any calendar app, through a feed address the server makes for your account on request. The address carries a secret token in place of a sign-in, so anyone who has it can read the plan's blocks and the events made in Mayorly, with their titles and notes, until you make a new address or stop sharing in Settings. The server keeps the token beside your account and nothing else about who reads the feed; a read is not logged. Outside events read in from Google are never sent back out.

The clerk is optional and brings its own key: you paste a key from Anthropic, OpenAI, Google or another provider. The key is sealed on your computer (with the operating system's store on Windows and Linux, with a key kept beside Mayorly's data on a Mac) and leaves it only to call that provider, unless you sync keys. When the clerk files an entry, the entry's text, the names and criteria of your ledgers, and your house rules are sent to the provider you chose, under that provider's terms. Nothing of that is sent to us.

**Syncing keys** between your computers is optional and needs a sync passphrase you choose. Your computer turns the passphrase into an encryption key (scrypt), encrypts each AI key with it (AES-256-GCM), and only then sends it to the server. The passphrase never leaves your computer and is not stored, not even there; the encryption key made from it is sealed beside your AI keys. The server keeps the encrypted keys, a random salt, and a known phrase encrypted the same way so a wrong passphrase can be told apart. It cannot read your keys or tell which providers they are for: each one is filed under a code made from the key and your passphrase. It does see how many keys you sync and when they were added or removed. If you forget the passphrase, Reset in Settings deletes the server's copy; the keys on each computer stay where they are.

## Children

Mayorly is not directed to children under 13 and does not knowingly collect information from them.

## Changes

If this policy changes, the change is recorded in the Mayorly repository with the date, and the app's release notes say so.

## Contact

Open an issue in the Mayorly repository on GitHub.

*Last updated 2026-10-27.*

**Finding alarm sounds.** The sound search in Settings sends the words you type to Openverse (api.openverse.org), and the sound you play or choose is downloaded from Freesound (cdn.freesound.org). Nothing else about you goes with them, and nothing is sent until you press Search. A sound you choose is kept beside your other alarms on this computer.
