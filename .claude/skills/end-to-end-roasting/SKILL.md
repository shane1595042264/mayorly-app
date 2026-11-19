---
name: end-to-end-roasting
description: End-to-end roasting. A hard review of Mayorly's phone app by actually using it, a tour that taps, types and waits through every place, with frames captured mid-animation, and three scores from 1 to 10 for Interactivity, Functionality and Aesthetic, each with evidence, plus the fixes that would raise them most. Use when asked to "roast the app", "end to end roasting", "e2e review", "score the app", "is the app good enough", or to run the review-and-fix loop until every score is 9 or more.
---

# End-to-end roasting

You are the reviewer, not the author. You did not build this app and you owe it nothing. Use it
the way its owner will, a person checking their timer a hundred times a day, and say plainly what
works, what does not, and what looks unfinished. A generous score is a failed review: the owner
asked for this because they want the truth before they live with the app.

Scores are whole numbers from 1 to 10, one each for **Interactivity**, **Functionality** and
**Aesthetic**. Every score is earned with evidence you saw: a frame file name, a log line, a state
read. Nothing is assumed from the code; if you could not see it, it does not count.

## The run

1. **The app.** The phone app's web layer serves at `http://localhost:5200` (`npm run phone`; start
   it in the background if nothing answers there). `?demo` loads sample data (three ledgers, a
   running superset, entries in the tray); `?fresh` is a first run. The same code runs on the
   iPhone inside Capacitor; what the browser cannot show (the Taptic Engine, notifications,
   dictation, Google sign-in) is judged from the log and the code paths, never imagined.

2. **The tour.** Play the default tour into this round's folder:

   ```
   ROAST_URL="http://localhost:5200/?demo" ROAST_OUT=.roast/round-N npx electron scripts/roast-tour.cjs
   ```

   Each step taps, types or presses a key the way a finger does, then saves frames at set offsets
   (`-t0`, `-t90`, `-t220` ms...), so motion is seen frame by frame. `log.json` records after each
   step the tab on screen, any open sheet, the desk's status and task, the clock, and how many
   sounds and haptics fired, and any error. Read `scripts/roast-tour.cjs` for the helpers
   (`__roast.tap`, `type`, `key`, `text`, `count`).

3. **Look at every frame.** Open every PNG with the Read tool, not a sample. Compare frames of one
   step to see whether something moved, how far, and whether it landed cleanly (no jump, no
   overlap, no clipped text, no flash of empty content).

4. **Go past the tour.** The tour is a floor. Write your own steps (a JSON array of
   `{ name, do, frames }`, played with `ROAST_TOUR=<file>`) for anything the app promises that the
   tour missed, and for edge cases: an empty first run (`?fresh`), a long title, a ledger with no
   entries, a second press of the same control, Escape on a sheet, search with nothing found.
   What the app promises is written in `docs/phone.md` and the top of `NOTES.md`; hold it to every
   promise. Probe at least six things the default tour does not.

5. **Score, with the rubric below.** Start each aspect at 5 and move it only on evidence. Say what
   kept it from the next point up.

6. **Report** in the format at the end. Rank the fixes by how much they would raise the lowest
   score, and make each one concrete enough to act on: the screen, the control, what it does now,
   what it should do, the file to look in.

## The rubric

**Interactivity: does everything answer when touched?**

| | |
|---|---|
| 10 | Every control answers within a frame or two: press motion, then a visible result; places and sheets move in and out; state changes (start, pause, clear, a tomato) are seen, heard and felt; gestures where a phone has them (swipe a sheet down); no dead taps anywhere. |
| 9 | All of the above with at most one or two quiet spots that do not matter (a static secondary label). |
| 7 | Main controls have press feedback and the big moments animate, but some places cut without transition, or some taps change state with no visible answer. |
| 5 | Works, but feels static: instant swaps, no motion, no sound. |
| 3 or less | Taps that do nothing, or answers that arrive late or in the wrong place. |

**Functionality: does it do what it says?**

| | |
|---|---|
| 10 | Every promise in `docs/phone.md` and `NOTES.md` that a browser can show works in the tour and in your probes; state is right after every step (the right task on the desk, the right tab after a start); no errors in the log; edge cases are handled with a clear message. |
| 9 | One minor glitch that does not lose work or mislead (a label a beat late). |
| 7 | A promised feature fails in one path, or a result is confusing (you start a task and are left on the wrong screen). |
| 5 | Several features fail or mislead. |
| 3 or less | The main loop (pick, start, see it running, clear) is broken. |

**Aesthetic: does it look good?**

Judged against the app's own design (true-black flat with Mayorly's amber as the only data colour;
see `docs/phone.md`) and the house rules in `.claude/skills/design-taste-frontend` for app screens:
hierarchy (the clock answers the screen's question first), spacing on one rhythm, alignment to one
set of edges, type at a few sizes, colour only on data, and motion that lands cleanly.

| | |
|---|---|
| 10 | Every screen and every mid-animation frame looks deliberate; a designer would change nothing. |
| 9 | Polished and consistent everywhere; at most one small spot a designer would nudge. |
| 7 | Good overall with visible rough spots: a cramped row, a misaligned edge, a frame where things overlap or jump. |
| 5 | Plain or inconsistent; looks unfinished in places. |
| 3 or less | Broken layout, clipped or overlapping text at rest. |

## The loop (for the session that fixes)

The owner's bar is **9 or more on all three**. A round is: review (a fresh reviewer, so the scores
are not anchored on the last ones), then fix the ranked issues, then the next round. Stop when all
three are 9 or more, or after 10 rounds, whichever is first. Keep `.roast/scores.md` with one line
per round (round, the three scores, the fixes made). A reviewer never sees the previous scores;
it judges the app as it is.

## Report format

```
ROUND <n>
Interactivity: <score>/10. <two to four sentences of evidence, citing frames and log lines>. Kept from <score+1> by: <what>.
Functionality: <score>/10. <evidence>. Kept from <score+1> by: <what>.
Aesthetic: <score>/10. <evidence>. Kept from <score+1> by: <what>.

Probes beyond the tour: <each probe, one line: what you tried, what happened>

Fixes, most valuable first:
1. <screen / control>: now <what happens>. Should <what>. Look in <file>.
2. ...

Working well: <short list, so a fix does not break it>
```
