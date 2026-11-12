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

/** When a line the clerk could not reach a model for is tried again: soon, then less often. */
export const RETRY_AFTER_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000]

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
      let filed: Awaited<ReturnType<typeof clerk.fileMany>>
      try {
        filed = await clerk.fileMany(tray.map((e) => ({ id: e.id, title: e.title })), engine.state.ledgers, engine.state.houseRules.map((r) => r.text))
      } catch (err) {
        console.warn('[clerk] could not sort the tray:', err instanceof Error ? err.message : String(err))
        say({ phase: 'done', text: 'The clerk could not reach its model. The tray stays as it is.' })
        return
      }
      apply(filed)
      const unsure = [...filed.values()].filter((f) => f.confidence === 'unsure').length
      say({ phase: 'done', text: filed.size === 0 ? 'The clerk could not read the tray this time' : `Clerk filed ${filed.size} of ${tray.length} from the tray${unsure ? `, ${unsure} with a question mark` : ''}` })
    } finally {
      sweeping = false
    }
  }
  const apply = (filed: Awaited<ReturnType<typeof clerk.fileMany>>) => {
    for (const [id, f] of filed) {
      missed.delete(id)
      if (f.leisure) engine.dispatch({ type: 'entry/toLeisure', id, log: f.log })
      else engine.dispatch({ type: 'entry/file', id, ledgerId: f.ledgerId, estimateMin: f.estimateMin, log: f.log, model: f.model, confidence: f.confidence })
    }
  }

  // Lines that landed in the tray because the clerk could not reach any model (a provider busy or
  // down) get another try later, while they are still in the tray: a person who files one by hand
  // meanwhile has answered it. Only these; an entry put in the tray on purpose is left alone.
  const missed = new Set<string>()
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryStep = 0
  const scheduleRetry = () => {
    if (retryTimer || retryStep >= RETRY_AFTER_MS.length) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void retryMissed()
    }, RETRY_AFTER_MS[retryStep++])
  }
  const retryMissed = async () => {
    const waiting = engine.state.entries.filter((e) => missed.has(e.id) && e.ledgerId === null && e.doneAt === null)
    for (const id of [...missed]) if (!waiting.some((e) => e.id === id)) missed.delete(id)
    if (waiting.length === 0 || !clerk.enabled()) return
    if (sweeping) return scheduleRetry()
    sweeping = true
    try {
      const filed = await clerk.fileMany(waiting.map((e) => ({ id: e.id, title: e.title })), engine.state.ledgers, engine.state.houseRules.map((r) => r.text))
      apply(filed)
      for (const e of waiting) {
        const ledger = engine.state.ledgers.find((l) => l.id === engine.state.entries.find((x) => x.id === e.id)?.ledgerId)
        if (ledger) say({ phase: 'done', text: `'${short(e.title)}' went to ${ledger.name}` })
      }
      // The model answered; whatever it left in the tray is its answer, not a missed call.
      missed.clear()
      retryStep = 0
    } catch (err) {
      console.warn('[clerk] still cannot file the tray:', err instanceof Error ? err.message : String(err))
      scheduleRetry()
    } finally {
      sweeping = false
    }
  }
  const missedCall = (id: string | undefined) => {
    if (!id) return
    missed.add(id)
    retryStep = 0
    scheduleRetry()
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
      // The provider is down or busy: the line still lands, in the tray, and the clerk tries it again later.
      console.warn('[clerk] could not file:', err instanceof Error ? err.message : String(err))
      say({ phase: 'done', text: `The clerk could not reach its model. '${short(text.trim())}' is in the tray for now; it will try again.` })
      const before = new Set(engine.state.entries.map((x) => x.id))
      const r = engine.act(action)
      const added = engine.state.entries.find((x) => !before.has(x.id) && x.ledgerId === null)
      missedCall(added?.id)
      return r
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
