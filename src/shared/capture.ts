import { prefixClerk, type Action, type Entry, type MayorlyState } from '@core/index'
import type { ClerkNotice } from './bridge'
import type { AiClerk } from './ai/service'

// Capturing a line, on any platform: the clerk files it first when there is a working key, then
// the reducer takes it with that filing; without a key it is filed by its prefix. Captured and
// started, it lands at once and the clerk moves it afterwards. What the clerk is doing is said
// through `say`, which the desktop shows on the pet and the phone in its capture sheet.

/** What capture needs from the engine that owns the state. */
export interface CaptureEngine {
  readonly state: MayorlyState
  /** A person did this here (claims the desk). */
  act(action: Action): unknown
  /** The app does this on its own. */
  dispatch(action: Action): unknown
}

export function makeCapture(engine: CaptureEngine, clerk: AiClerk, say: (n: ClerkNotice) => void) {
  const short = (t: string) => (t.length > 36 ? `${t.slice(0, 35)}…` : t)
  // Everything still in the tray goes to the clerk in one call; what fits a ledger moves.
  let sweeping = false
  const sweepTray = async () => {
    if (sweeping) return
    if (!clerk.enabled()) {
      say({ phase: 'done', text: 'No working AI key: add one in Settings for the clerk to sort the tray' })
      return
    }
    const tray = engine.state.entries.filter((e) => e.ledgerId === null && e.doneAt === null)
    if (tray.length === 0) {
      say({ phase: 'done', text: 'The tray is empty' })
      return
    }
    sweeping = true
    try {
      say({ phase: 'working', text: `Clerk is sorting the tray, ${tray.length} ${tray.length === 1 ? 'entry' : 'entries'}` })
      const filed = await clerk.fileMany(tray.map((e) => ({ id: e.id, title: e.title })), engine.state.ledgers, engine.state.houseRules.map((r) => r.text))
      for (const [id, f] of filed) {
        if (f.leisure) engine.dispatch({ type: 'entry/toLeisure', id, log: f.log })
        else engine.dispatch({ type: 'entry/file', id, ledgerId: f.ledgerId, estimateMin: f.estimateMin, log: f.log, model: f.model, confidence: f.confidence })
      }
      const unsure = [...filed.values()].filter((f) => f.confidence === 'unsure').length
      say({ phase: 'done', text: filed.size === 0 ? 'The clerk could not read the tray this time' : `Clerk filed ${filed.size} of ${tray.length} from the tray${unsure ? `, ${unsure} with a question mark` : ''}` })
    } finally {
      sweeping = false
    }
  }
  // A captured line goes to the clerk first, when there is one, then to the reducer with its
  // filing. The capture window, a mayorly:// link and anything else that captures come through here.
  // Captured and started (Cmd+Enter): the line lands by prefix and goes on the desk at once; the
  // clerk reads it afterwards and, if it names another ledger, the entry and the desk move there.
  const fileLater = async (e: Entry, text: string) => {
    say({ phase: 'working', text: `Clerk is filing '${short(e.title)}'` })
    let filing: Awaited<ReturnType<typeof clerk.fileEntry>> = null
    try {
      filing = await clerk.fileEntry(text, engine.state.ledgers, engine.state.houseRules.map((r) => r.text))
    } catch (err) {
      console.warn('[clerk] could not file:', err instanceof Error ? err.message : String(err))
      say({ phase: 'done', text: `The clerk could not reach its model. '${short(e.title)}' stays where it is.` })
      return
    }
    if (filing?.leisure) {
      engine.dispatch({ type: 'entry/toLeisure', id: e.id, log: filing.log, start: true })
      say({ phase: 'done', text: `'${short(e.title)}' is entertainment: on the couch` })
      return
    }
    if (filing && filing.ledgerId && filing.ledgerId !== e.ledgerId) {
      engine.dispatch({ type: 'entry/file', id: e.id, ledgerId: filing.ledgerId, estimateMin: filing.estimateMin, log: filing.log, model: filing.model, confidence: filing.confidence })
    }
    const now = engine.state.entries.find((x) => x.id === e.id)
    const ledger = engine.state.ledgers.find((l) => l.id === now?.ledgerId)
    say({ phase: 'done', text: ledger ? `'${short(e.title)}' went to ${ledger.name}${filing?.confidence === 'unsure' ? ', best guess' : ''}` : `'${short(e.title)}' stays in the tray` })
  }
  const captureLine = async (text: string, start = false) => {
    const action: Action = { type: 'entry/capture', text, start }
    // Named for the couch in so many words: there is nothing for the clerk to read.
    if (!clerk.enabled() || prefixClerk.file(text, engine.state.ledgers).leisure) return engine.act(action)
    if (start) {
      const before = new Set(engine.state.entries.map((x) => x.id))
      const r = engine.act(action)
      const added = engine.state.entries.find((x) => !before.has(x.id))
      if (added) void fileLater(added, text)
      return r
    }
    say({ phase: 'working', text: `Clerk is filing '${short(text.trim())}'` })
    let filing: Awaited<ReturnType<typeof clerk.fileEntry>> = null
    try {
      filing = await clerk.fileEntry(text, engine.state.ledgers, engine.state.houseRules.map((r) => r.text))
    } catch (err) {
      // The provider is down or the key is bad: the line still lands, in the tray.
      console.warn('[clerk] could not file:', err instanceof Error ? err.message : String(err))
      say({ phase: 'done', text: `The clerk could not reach its model. '${short(text.trim())}' is in the tray.` })
      return engine.act(action)
    }
    const r = engine.act(filing ? { ...action, filing } : action)
    const ledger = filing?.ledgerId ? engine.state.ledgers.find((l) => l.id === filing.ledgerId) : null
    const title = short(filing?.title ?? text.trim())
    say({ phase: 'done', text: filing?.leisure ? `'${title}' is entertainment: on the couch list` : ledger ? `'${title}' went to ${ledger.name}${filing?.confidence === 'unsure' ? ', best guess' : ''}` : `'${title}' stays in the tray` })
    void sweepTray()
    return r
  }
  return { captureLine, sweepTray }
}
