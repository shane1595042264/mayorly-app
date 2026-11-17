import { LEDGER_CAP, prefixClerk, type Action, type Entry, type Filing, type MayorlyState } from '@core/index'
import type { ClerkNotice } from './bridge'
import type { AiClerk, TrayFiling } from './ai/service'
import { DEFAULT_THRESHOLD } from './ai/tuning'
import { GLYPH_NAMES } from './glyph-names'
import { distinctTheme } from './themes'

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

/** A ledger the clerk started is left a day to collect entries before it may be folded away. */
export const FOLD_AFTER_MS = 24 * 3_600_000

// The clerk may also start a ledger for a line no ledger fits, and fold a ledger it started into
// another that covers the same ground (settings.clerk). Both wait for it to be sure enough: the
// user's level, else the one tuned by trial for its model (ai/tuning.ts). A ledger a person wrote
// or edited is never folded, renamed or removed; the reducer refuses it too.

export function makeCapture(engine: CaptureEngine, clerk: AiClerk, say: (n: ClerkNotice) => void) {
  const short = (t: string) => (t.length > 36 ? `${t.slice(0, 35)}…` : t)
  const rules = () => engine.state.houseRules.map((r) => r.text)
  const own = () => engine.state.settings?.clerk ?? { createLedgers: false, consolidate: false, minConfidence: null }
  /** How sure the clerk must be to start or fold a ledger. */
  const bar = () => own().minConfidence ?? clerk.tuned()?.threshold ?? DEFAULT_THRESHOLD
  const opts = () => {
    const cal = engine.state.settings?.calendar
    return { newLedgers: own().createLedgers && engine.state.ledgers.length < LEDGER_CAP, sessions: cal ? { min: cal.sessionMin, max: cal.sessionMax } : undefined }
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`

  /**
   * The ledger a proposal lands in: one of that name if there is one (an earlier line in the same
   * sweep may have started it), else a new one when the clerk is sure enough and the shelf has room.
   * Null leaves the line in the closest ledger the clerk named.
   */
  const adopt = async (p: NonNullable<Filing['newLedger']>, model: string): Promise<string | null> => {
    const same = () => engine.state.ledgers.find((l) => l.name.toLowerCase() === p.name.toLowerCase())
    const found = same()
    if (found) return found.id
    if (!opts().newLedgers || p.confidence < bar()) return null
    const worn = engine.state.ledgers.map((l) => l.glyph)
    const picked = await clerk.pickGlyph(p.name, p.criterion, GLYPH_NAMES, worn).catch(() => null)
    const glyph = picked && GLYPH_NAMES.includes(picked) ? picked : 'folder'
    // Another line may have started it while the glyph was being picked.
    const raced = same()
    if (raced) return raced.id
    if (engine.state.ledgers.length >= LEDGER_CAP) return null
    const before = new Set(engine.state.ledgers.map((l) => l.id))
    engine.dispatch({ type: 'ledger/create', name: p.name, criterion: p.criterion, glyph, theme: distinctTheme(engine.state.ledgers.map((l) => l.theme)), byClerk: true, log: `(clerk, ${model}, ${pct(p.confidence)} sure)` })
    const made = engine.state.ledgers.find((l) => !before.has(l.id))
    if (made) say({ phase: 'done', text: `Clerk started a ledger: ${made.name}` })
    return made?.id ?? null
  }
  /** A filing that proposed a ledger, pointed at the ledger it now has, or left as it was. */
  const settle = async <F extends { ledgerId: string | null; newLedger?: Filing['newLedger']; model?: string; log: string; confidence?: 'sure' | 'unsure' }>(f: F, title: string): Promise<F> => {
    if (!f.newLedger) return f
    const model = f.model ?? 'model'
    const id = await adopt(f.newLedger, model)
    const ledger = id ? engine.state.ledgers.find((l) => l.id === id) : null
    if (!ledger) return f
    const quoted = `'${title.length > 40 ? title.slice(0, 39) + '…' : title}'`
    return { ...f, ledgerId: ledger.id, confidence: 'sure', log: `filed ${quoted} -> ${ledger.code} (clerk, ${model}, in the ledger it started)` }
  }
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
        filed = await clerk.fileMany(tray.map((e) => ({ id: e.id, title: e.title })), engine.state.ledgers, rules(), opts())
      } catch (err) {
        console.warn('[clerk] could not sort the tray:', err instanceof Error ? err.message : String(err))
        say({ phase: 'done', text: 'The clerk could not reach its model. The tray stays as it is.' })
        return
      }
      await apply(filed)
      const unsure = [...filed.values()].filter((f) => f.confidence === 'unsure').length
      say({ phase: 'done', text: filed.size === 0 ? 'The clerk could not read the tray this time' : `Clerk filed ${filed.size} of ${tray.length} from the tray${unsure ? `, ${unsure} with a question mark` : ''}` })
    } finally {
      sweeping = false
    }
  }
  const apply = async (filed: Map<string, TrayFiling>) => {
    for (const [id, raw] of filed) {
      missed.delete(id)
      const title = engine.state.entries.find((e) => e.id === id)?.title ?? ''
      const f = await settle(raw, title)
      // The line may have been filed by hand or cleared while a ledger was being started.
      const now = engine.state.entries.find((e) => e.id === id)
      if (!now || now.ledgerId !== null || now.doneAt !== null) continue
      if (f.leisure) engine.dispatch({ type: 'entry/toLeisure', id, log: f.log })
      else engine.dispatch({ type: 'entry/file', id, ledgerId: f.ledgerId, estimateMin: f.estimateMin, log: f.log, model: f.model, confidence: f.confidence, sessionMin: f.sessionMin })
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
      const filed = await clerk.fileMany(waiting.map((e) => ({ id: e.id, title: e.title })), engine.state.ledgers, rules(), opts())
      await apply(filed)
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
      filing = await clerk.fileEntry(text, engine.state.ledgers, rules(), opts())
      if (filing) filing = await settle(filing, filing.title)
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
      engine.dispatch({ type: 'entry/file', id: e.id, ledgerId: filing.ledgerId, estimateMin: filing.estimateMin, log: filing.log, model: filing.model, confidence: filing.confidence, sessionMin: filing.sessionMin })
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
      filing = await clerk.fileEntry(text, engine.state.ledgers, rules(), opts())
      if (filing) filing = await settle(filing, filing.title)
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

  // Tidying the shelf: ledgers the clerk started that cover the same ground as another are folded
  // into it, entries and all. Run by the shell a while after launch and every few hours.
  let folding = false
  const consolidate = async () => {
    if (folding || !own().consolidate || !clerk.enabled()) return
    const at = Date.now()
    const movable = new Set(engine.state.ledgers.filter((l) => !l.handWritten && at - l.createdAt >= FOLD_AFTER_MS).map((l) => l.id))
    if (movable.size === 0) return
    folding = true
    try {
      const samples = new Map<string, string[]>()
      for (const e of [...engine.state.entries].reverse()) {
        if (!e.ledgerId || e.doneAt !== null) continue
        const list = samples.get(e.ledgerId) ?? []
        if (list.length < 5) samples.set(e.ledgerId, [...list, e.title.slice(0, 60)])
      }
      const folds = await clerk.consolidate(engine.state.ledgers, movable, samples)
      const level = bar()
      const gone = new Set<string>()
      for (const f of folds.sort((a, b) => b.confidence - a.confidence)) {
        if (f.confidence < level || gone.has(f.from) || gone.has(f.into)) continue
        const from = engine.state.ledgers.find((l) => l.id === f.from)
        const into = engine.state.ledgers.find((l) => l.id === f.into)
        if (!from || !into || from.handWritten) continue
        engine.dispatch({ type: 'ledger/merge', from: from.id, into: into.id, log: `folded ${from.name} into ${into.name} (clerk, ${pct(f.confidence)} sure${f.reason ? `: ${f.reason}` : ''})` })
        gone.add(from.id)
        say({ phase: 'done', text: `Clerk folded ${from.name} into ${into.name}` })
      }
    } catch (err) {
      console.warn('[clerk] could not tidy the shelf:', err instanceof Error ? err.message : String(err))
    } finally {
      folding = false
    }
  }
  return { captureLine, sweepTray, consolidate }
}
