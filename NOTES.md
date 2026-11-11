# Mayorly notes

The top section is what the app shows once per build, the first time that build launches on a machine. Keep it short and in plain words: what changed for the person using it, not how.

## The Mac updates itself

- Every push to GitHub now reaches this Mac on its own, as on Windows. Mayorly checks every half hour, downloads the new version quietly, and asks Update now or Later, never during a running focus block.
- Later keeps it in the menu bar, and it goes in the next time Mayorly starts.

## A calendar you can read

- The week view is taller, so a half-hour block holds its name on one line. Blocks no longer overlap, and a very short one is a thin bar with its name when you point at it.
- The plan no longer breaks tasks into five-minute scraps as the day goes by. A task you have not started yet moves along with the clock in one piece.
- Every block on the calendar is now one pomodoro, as long as yours (30 minutes if that is what you set), with your rest after it. Estimates round up to whole pomodoros, and a task with no estimate gets one.

## One timer for tasks and the couch

- Switching from a task to something on the couch, or back, keeps the timer where it is. If a task was at 17:00, the couch item carries on at 17:00. Only the title, the colour and the tomato count change.
- A block that finishes on the couch costs one coin, as before. Leave the couch before the block ends and it costs nothing.
- This works in a pomodoro and in a superset. Blitz still starts the couch on its own timer, since there the timer is the task's estimate.

## Thousands of alarm sounds

- Settings, Alarms now has a search box. Suggestions show up as you type, from about 1,900 short sounds that come with the app. Play any result and press Work or Break to make it that alarm. It downloads on the spot.
- A word with few matches searches the whole online library by itself after a short pause, or press Enter.
- The sounds come from Freesound, under Creative Commons, and each alarm keeps its creator's name.

## This task's tomatoes beside the clock

- While a block runs, the small number next to the clock is how many tomatoes you have grown on that task, all time, to the tenth: 0.1 shows as 0.1. On the couch it counts that item's time in blocks.

## The couch waits for you too

- With "Start the next focus or couch block on its own" turned off, a couch block no longer starts by itself when a rest ends. It waits for you, like a focus block.

## Alt+Q works like Alt+Tab, and search starts with what you used last

- Tap Alt+Q to go back to your last task, same as before.
- Hold Alt after pressing Q to see your last 10 tasks. Press Q again to step down the list, or use the mouse, and let go of Alt to switch. Esc cancels.
- Alt+F now opens with your recently used tasks at the top.

## Resize the tomato

- Press Alt+G (Option+G on a Mac), then + or - to make the tomato bigger or smaller, or drag the small square on its corner.
- On Windows, dragging the tomato now carries it across monitors like a window.

## The couch works like your tasks

- Start a line with `couch:` or `leisure:` (or add `#couch`) and it goes to the couch list. Enter sits you down with it right away, for a coin, just like starting a task.
- Alt+F finds couch items too. Enter starts them.
- If the AI clerk reads a line you just started as entertainment, it now moves it to the couch instead of leaving it on your desk.
- Couch items can be renamed, and the quick drawer now has notes and a checklist for them.

## Updates that ask first

- When a new version is out, Mayorly downloads it quietly and asks whether to update. Say yes and it restarts into the new version; say later and it updates the next time you quit.
- It never asks in the middle of a running focus block.
- On a Mac this starts once the app is signed with an Apple Developer ID.

## Find a task and start it, and quieter syncing

- Alt+F (Option+F on a Mac) searches your open tasks. Type to narrow it down, use the arrows to choose, and press Enter to start.
- If nothing matches, Enter creates the task and starts it, just like capture. `legal: reply ~20` works there too.
- With Mayorly open on two computers, the one not running the timer no longer writes to the server every minute, and focus time no longer piles up. A session that was already inflated corrects itself.

## Auto picks a colour too

- Auto in the ledger editor now also gives the ledger a colour no other ledger wears, the one that stands farthest from theirs. Once all twelve are taken it picks the least used.
- Colours another ledger already wears are dimmed in the picker, like icons.

## A finished rest stays finished

- When a rest ran out, the next sync could bring the rest back at 05:00. The computer running the timer now always keeps its own timer; the server only carries it to your other computers.

## One computer runs the timer

- The timer no longer jumps back to the start when Mayorly is also open on another computer.
- The computer you used last runs the timer. Your other computers hold it and say where it is running.
- Do anything in Mayorly on another computer and the timer moves there, carrying on from where it was. The first computer holds it within a minute.
- Time worked on either computer counts once, never twice and never lost.

## AI keys on all your computers

- Your AI clerk keys can now sync between your computers. Turn it on under Settings, AI clerk, with a sync passphrase, then type the same passphrase once on each other computer.
- Keys are encrypted with the passphrase before they leave your computer, so the sync server cannot read them. The passphrase itself is never saved or sent.
- Every different key you have on any computer is kept, and the same key on two computers counts once. A key you remove on one computer goes from the others.
- You can keep more than one key per provider. When one stops working, the clerk moves on to the next.

## Capture keys you can change, and the Mac's HUD on Windows

- Enter files a captured task and starts it immediately. Cmd+Enter on Mac, or Ctrl+Enter on Windows, files it without starting. Shift+Enter still files and keeps the box open.
- Change these shortcuts in Controls. The capture box shows the keys you chose.
- Windows has the Account section in Settings again: sign in with Google to bring your data over from the Mac.
- On Windows the resting HUD is now just the tomato and its number, as on a Mac. The rotation strip at the top of the screen and the messages in the middle and on the right are gone.
- Drag the tomato anywhere on the screen, onto your other monitor too. Alt+G, the arrows or hjkl move it, 1 to 4 put it in a corner. It stays where you leave it.
- The line above the tomato, the quick drawer and the coins all hang off the tomato wherever it sits: the line drops below it near the top of the screen, the drawer opens under it or over it.
- The quick drawer no longer dims the screen. A click anywhere else goes to that app and closes the drawer.
- With an auto-hidden taskbar the tomato starts clear of where the taskbar slides up.
- Side in Settings puts the tomato in that bottom corner.

## Gemini model requests

- Gemini keys can now finish their check with newer Flash-Lite models and file captured tasks.

## New Gemini keys

- The AI clerk now recognizes Gemini's new AQ. keys as well as older AIza keys. Add one in Settings.

## Back to the task from a rest

- Option+R skips the current rest and immediately resumes its task. Change it under Hotkeys in Settings.
- It also works on a held or waiting rest. Pressing it during work leaves the timer alone.

## One app on Windows and macOS

- The Windows build is the same app as the Mac one again, with everything since the first HUD: ledgers, the planner and calendar, the clerk, accounts and sync, alarms, the history and the trash.
- On Windows the file pickers for alarms, export and import now open in front of the HUD instead of behind it.
- The portable Windows exe stays portable: it no longer downloads the installer or claims mayorly:// links. The installed build keeps updating itself.
- Coins paid by the first Windows build for work on an entry count as that entry's harvest, so clearing the entry does not pay them twice. Your balance does not change.
- The quick drawer opens beside the tomato on whichever side you keep it. Key hints on Windows say Alt and the Windows key, not Option and Cmd.

## The history and the trash

- Every cleared entry keeps its record: its time, its tomatoes, its notes and checklist, and what they said each time it was cleared. Cleared today in Flow and inside a ledger now has a History button (or H) that opens all of it, searchable.
- Deleting an entry puts it in the trash, where it waits thirty days with its time and tomatoes. The trash is the second tab of the history. u restores a row, x deletes it, Enter opens it, t turns between cleared and the trash, / searches, Backspace goes back.
- The Record tab lists what was cleared last, with the same History button.

## Tomatoes stay visible after clearing

- Cleared entries in Flow and on the Shelf show their tomatoes beside their recorded focus time.
- The count includes partial tomatoes and stays visible after the harvest. A task with no work shows zero.

## Tomatoes follow the task's time

- A task's tomatoes now come from its own recorded work intervals. Switching tasks keeps each task's partial progress, including across sittings and restarts.
- Clearing a task includes the final seconds of work before paying its whole tomatoes. Reopening it never pays the same tomato twice.
- Existing task counts are corrected from saved time records. Past coin payments stay unchanged.

## Your work and break sounds

- Settings has separate work and break alarms: Classic, Bell, Chime, Pulse, Gentle or Silent, with a Preview button for each.
- Upload your own audio for either alarm. Mayorly keeps a local copy so it still plays after a restart or after you move the original file.
- Sound cues controls automatic playback. Preview works while cues are off. Custom alarms play up to 15 seconds.

## Rests stay out of the quick switch

- Option+Q brings back the last task, never its rest timer. Leaving a rest for another task keeps the task behind that rest available to switch back to.
- A completed block stays completed. Returning from its rest starts a fresh task block, with no extra tomato or coin charge for the rest.
- Older saves with a parked rest follow the same rule.

## Pick first, start when the menu closes

- Option+T previews your task, ledger, mode or couch choice. Only the final choice takes effect when the menu closes.
- Browsing leaves a held timer on hold and keeps the last real task in Option+Q. Opening and closing without a choice changes nothing.

## The quick switch keeps one clock per task

- Selecting the task already on the desk keeps its clock and the previous task. Selecting a parked task resumes its saved clock.
- Option+Q skips an older saved copy of the same task, so it cannot jump between two timers for one task.

## The plan fills itself

- Every open entry is on the calendar now, from this moment on: one without an estimate is placed at a default length (30 minutes, in Settings) and shows a tilde until it has one. The pet shows the next planned entry. Entries without estimates stay on the plan until cleared.
- Settings under Calendar has the range the clerk plans: this day, a day ahead, the week ahead, two weeks. What does not fit waits past it, in a quiet list above the calendar.
- And the mode. Get it done: earliest due first, up next ahead of all, then the flow's order. Rotate: one entry from each ledger in turn, then the rest. Rotation can delay deadlines; Get it done puts them first.
- The ask box is for corrections. The clerk has already made the plan; tell it what to change.
- The quick drawer (Option+Shift+R) now shows what is on the desk right now. It used to keep the entry from the first time it opened.

## The calendar

- A Calendar tab, second in the deck: the week, with every entry that has an estimate placed into your work hours, earliest due first, in the order of the flow. What does not fit is said at the top, not hidden.
- Your own events never move. Select a block with j and k, Enter starts it, p pins it where it is. [ and ] turn the week, t comes back.
- Settings has the hours per day, the break, the smallest chunk and the horizon. The hours are kept in your zone and sync.
- Select a block and the side panel has its knobs: estimate, due, not before, up next, splitting, off the calendar. New event (or n) adds an event of your own; a selected event can be edited.
- The clerk listens: the ask box at the bottom of the Calendar tab, or /cal in the capture line. "move leetcode to tomorrow 9am", "give the resume two hours", "block Friday afternoon for dance". It answers with a proposal, every change in words, and nothing happens until you press Apply. It cannot touch your own events; that is not a rule it follows but a thing it cannot say.
- Google comes in as busy time: in Settings, under Calendar, paste a calendar's secret address in iCal format. Its events show on the grid, hatched, and the planner routes around them; all-day and free ones are drawn, not busy. Read every fifteen minutes. The address never leaves this machine.
- Your plan goes out too: with an account, Settings under Calendar makes a secret address Google can subscribe to (Other calendars, From URL). The planned blocks and the events made here appear in Google; a moved block updates in place. Google reads a subscribed calendar on its own clock, often hours apart. New address and Stop sharing are there when you need them.
- Drag a block to another time and it is pinned there; drag an event to move it, or its bottom edge to resize it. A click selects. The banner about what does not fit has an Ask the clerk button. The Record tab says how much the plan still holds for today.

## More icons, more colours, and a pick by the clerk

- A ledger can wear any of 174 icons, searchable by name, and one of twelve colours. Icons another ledger already wears are dimmed.
- Auto picks the icon for a ledger from its name and criterion: the clerk chooses from the same set when a key is set, your own words choose otherwise. Nothing is drawn; the icons stay one family.

## Paid work, and ledger colours

- A ledger can be set to pay no coins, for work you are paid for in money: tomatoes still ripen and count, nothing is minted and nothing is charged. Edit the ledger on the shelf and untick Pays coins.
- Each ledger can wear a colour. The pet's sign, the shelf bay, the live row and the swap menu show it.
- The day's tomato count now counts every tomato in a harvest, not one per entry.

## The quick drawer, and a hold on the couch

- Option+Shift+R drops a small drawer from the pet for what is on the desk: notes and a checklist under an entry, the switch-when rules under a leisure item. Click a line to edit it, Enter adds one, Esc closes. On a Mac the pet's window grows just enough for it; the deck stays closed.
- The couch on hold now looks held, like the desk: the colour is the state.

## The couch in the swap menu

- The ledger arm ends with the couch, on 0, from any arm. Pick it and the entry arm lists your couch list; an item there sits you down. Ledgers keep 1 to 9.
- Digits work in the same breath as Option+T, like the arrows: Option+T, 1 is the first ledger before the menu has even drawn.

## Ledger rows line up

- Inside a ledger, each row sat one column to the left: the ledger box was squeezed to a caret and the title cut short. They line up now, and a title too long for its room wraps to a second line instead of being cut.

## Capture and start

- In the capture box, Cmd+Enter files the line and puts it on the desk at once: a running focus block swaps to it with the clock where it is, a hold comes off, and from idle a pomodoro starts on it. The clerk reads the line afterwards and moves it, desk and all, if it belongs elsewhere.

## Text size, and numbered tabs

- Settings, under HUD: a text size per area, for the pet's task line, the deck and the swap menu, 80 to 160 percent. The pet's window grows with its task line.
- Every deck tab shows its number, since the digit jumps to it.

## The task line on the pet is readable

- The task above the clock sits on its own dark plate in bold, full ink, in every state, so it reads over any app behind the pet.

## No more keychain prompts

- On a Mac the sign-in and the AI key are sealed with a key kept beside Mayorly's data instead of the keychain, so no build will ask for your login password again. This launch opens the old files one last time, which may ask once.

## Numbers in the Plus menu

- Every item in the Plus menu carries a number; the digit picks it in the arm you are on. Option+T, Left, 2 is the second entry, no cycling.
- The menu's keys (arms, previous and next, apply, deck, close) are in the Keymap under Swap menu, so they can be rebound.
- The rig no longer sticks at pet size in the middle of the screen when the window grows a beat late.

## The Plus menu shows where you are

- The tile under the cursor fills solid amber with dark text, the arm under the keys tints faintly, and the line from the slab to that arm lights up. What the desk is on stays white.
- Option+T with an arrow in the same breath opens the menu on that arm: Option+Left for entries, Up for ledgers, Right for modes, Down for orders. Steering an arm while holding the key keeps the menu open when you let go.

## Switching, counting, and a quieter clerk

- Option+Q swaps between the last two entries you worked on, like a primary and a secondary weapon. A third entry drops the oldest.
- Swapping or switching while the desk is on hold resumes it on the new task, the clock where it was.
- Entry rows count their tomatoes, with the sprite as the unit: 2 while they sit, 2.2 while the next ripens.
- When a tomato ripens, the entry's count shows above the pet for three seconds.
- The clerk's question mark only appears when it is nearly guessing, not on every loose fit.
- The clerk's answer box is readable again.
- This note, once per build, with the build time. Settings shows the build you are running.
