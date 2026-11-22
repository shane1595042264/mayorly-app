import { useState } from 'react'
import { CaretDown, CaretRight, Eye, EyeSlash, Plus, X } from '@phosphor-icons/react'
import { isWatched, watchedCues } from '../../../shared/streamdeath'
import { current, dispatch } from '../store'

// Context switch rules: cues in your words for when to leave something and do something
// else ("rookie dies in game", "stuck 20 minutes: read the hint"). No logic behind them;
// the drawer shows them while you are on it and the quick switch does the leaving. The
// same on a task and a couch item (`entry/cue-*`). One kind is watched: a rule that the streamer
// dies, on a stream, carries an eye, and Mayorly does the switch when a League or GTA streamer goes down
// (shared/streamdeath.ts). The band's eye button turns watching on or off for the task whatever its
// words say (`entry/watch`).

/** The caret that opens a row's rules; Space does the same on the selected row. */
export function CueToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button className="icon-btn" aria-expanded={open} aria-label={open ? 'Hide context switch rules' : 'Show context switch rules'} title="Context switch rules" onClick={onToggle}>
      {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
    </button>
  )
}

/** "2 cues" beside a title, nothing when there are none. */
export function CueCount({ cues }: { cues: string[] | undefined }) {
  const n = cues?.length ?? 0
  return n > 0 ? <span className="row-cue-count mono num dim">{n} {n === 1 ? 'cue' : 'cues'}</span> : null
}

/**
 * The rules of one task or couch item, opened under its row. On the couch list it is a band
 * attached under the row; on a task's row (`inRow`) it is the row's own second line, since the
 * flow's rows are dragged as one piece.
 */
export function Cues({ id, title, cues, live, example, inRow }: { id: string; title: string; cues: string[]; live: boolean; example: string; inRow?: boolean }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    if (!draft.trim()) return
    dispatch({ type: 'entry/cue-add', id, text: draft })
    setDraft('')
  }
  const Box = inRow ? 'div' : 'li'
  const st = current()
  const watch = (st?.entries.find((e) => e.id === id) ?? st?.leisure.find((l) => l.id === id))?.watch
  // Watched only while the rule is on in Settings (Auto switch); the eye says so.
  const ruleOn = st?.settings.autoSwitch.streamDeath !== false
  const watching = isWatched({ title, cues, watch })
  const watched = ruleOn && watching ? watchedCues({ title, cues, watch }) : []
  return (
    <Box className={`cues-band ${inRow ? 'in-row' : ''} ${live ? 'live' : ''}`}>
      <div className="cues-head">
        <span className="cues-title">
          <span className="field-label caps">Context switch rules</span>
          <button
            type="button"
            className={`cue-watch ${watching && ruleOn ? 'on' : ''}`}
            aria-pressed={watching}
            title={
              !ruleOn
                ? 'Watching streams is off in Settings, Auto switch'
                : watching
                  ? 'Mayorly watches a League or GTA stream while this runs, and switches when the streamer dies. Click to stop.'
                  : 'Watch a League or GTA stream while this runs: when the streamer dies, Mayorly switches for you.'
            }
            onClick={() => dispatch({ type: 'entry/watch', id, watch: !watching })}
          >
            {watching ? <Eye size={13} weight="bold" /> : <EyeSlash size={13} />}
            {watching ? 'Watching the stream' : 'Watch the stream'}
          </button>
        </span>
        <span className="field-help">When to leave {title} for something else. A cue, not a rule.</span>
      </div>
      {cues.length > 0 && (
        <ul className="cues-list">
          {cues.map((c, i) => (
            <li key={i} className={`cue ${watched.includes(c) ? 'watched' : ''}`}>
              {watched.includes(c) && (
                <span className="cue-eye" role="img" aria-label="Watched" title="Mayorly watches the stream for this: when a League or GTA streamer dies, it switches for you">
                  <Eye size={12} weight="bold" />
                </span>
              )}
              <span>{c}</span>
              <button className="cue-x" aria-label={`Remove cue: ${c}`} title="Remove" onClick={() => dispatch({ type: 'entry/cue-delete', id, index: i })}><X size={11} weight="bold" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="cues-add">
        <input value={draft} placeholder={cues.length ? 'Another cue' : example} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="New cue" />
        <button className="btn" onClick={add} disabled={!draft.trim()}><Plus size={14} /> Add cue</button>
      </div>
    </Box>
  )
}
