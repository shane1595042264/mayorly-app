import { motion } from 'motion/react'
import { onDeskId, type FoundTask, type MayorlyState } from '@core/index'
import { hotkeyLabel } from '../lib/keys'

// Alt+Tab for tasks. The shell's key opens it and steps it; letting go of the modifier takes
// the one highlighted. App owns the keys and the choice, since a quick tap can be over before
// this has mounted. The appear is held back a beat so a tap never flashes it.

interface Props {
  s: MayorlyState
  rows: FoundTask[]
  at: number
  point: (i: number) => void
  pick: (i: number) => void
}

export function Switcher({ s, rows, at, point, pick }: Props) {
  const here = onDeskId(s)
  const hotkey = hotkeyLabel(s.settings.hotkeys.switch).split('+')
  const key = hotkey.pop() ?? 'Q'
  return (
    <motion.div
      className="switcher"
      role="listbox"
      aria-label="Recent tasks"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.12, duration: 0.1 }}
    >
      <ul className="find-list">
        {rows.map((row, i) => {
          const id = row.kind === 'entry' ? row.entry.id : row.item.id
          const code = row.kind === 'leisure' ? 'COUCH' : (s.ledgers.find((l) => l.id === row.entry.ledgerId)?.code ?? 'TRAY')
          return (
            <li key={id} role="option" aria-selected={i === at} className={`find-row ${i === at ? 'is-on' : ''}`} onPointerMove={() => point(i)} onClick={() => pick(i)}>
              <span className="find-code">{code}</span>
              <span className="find-title">{row.kind === 'entry' ? row.entry.title : row.item.title}</span>
              <span className="find-meta">{id === here ? 'On the desk' : ''}</span>
            </li>
          )
        })}
      </ul>
      <footer className="hint-row">
        <span><i className="key">{key}</i> Next</span>
        <span>Let go of <i className="key">{hotkey.join('+') || 'the key'}</i> to switch</span>
        <span><i className="key">Esc</i> Cancel</span>
      </footer>
    </motion.div>
  )
}
