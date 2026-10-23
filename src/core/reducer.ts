import { deriveCode, prefixClerk, type Clerk, type Filing } from './clerk'
import type {
  Block, Ctx, Entry, GlyphName, HudEvent, Id, Ledger, MayorlyState, Mode, Settings, Superset,
} from './model'
import { advance, blitzBlock, firstBlock, firstOpenInLedger, initialPlan, nextInFlow, openFlow, type DeployOpts } from './planner'
import { CLERK_LOG_CAP, LEDGER_CAP, LEISURE_TOKENS_PER_BLOCK, tokensForTomato } from './rules'
import { migrate } from './seed'

/** Settings that belong to the machine, not the account: a sync never overwrites them. */
export const DEVICE_SETTINGS = ['hotkeys', 'hudSide', 'hudScale', 'openAtLogin', 'sound'] as const

export type Action =
  /** `filing` is the AI clerk's answer, when there is one; the reducer checks it and otherwise files by prefix. */
  | { type: 'entry/capture'; text: string; filing?: Filing }
  | { type: 'entry/add'; title: string; ledgerId: Id | null; estimateMin: number | null }
  /** The clerk filed an existing entry (a tray sweep): ledger, an estimate if it had none, and its log line. */
  | { type: 'entry/file'; id: Id; ledgerId: Id | null; estimateMin: number | null; log: string; model?: string; confidence?: 'sure' | 'unsure' }
  /** You looked at an unsure filing and left it: the question mark goes, no rule is learned. */
  | { type: 'entry/confirm'; id: Id }
  | { type: 'rule/add'; text: string }
  | { type: 'rule/update'; id: Id; text: string }
  | { type: 'rule/delete'; id: Id }
  /** Your answer to the clerk's question: appended to the rule it learned, or a new rule when it only confirmed. */
  | { type: 'rule/explain'; entryId: Id; ruleId: Id | null; text: string }
  | { type: 'entry/update'; id: Id; patch: Partial<Pick<Entry, 'title' | 'ledgerId' | 'estimateMin'>> }
  | { type: 'entry/complete'; id: Id }
  | { type: 'entry/reopen'; id: Id }
  | { type: 'entry/delete'; id: Id }
  | { type: 'entry/move'; id: Id; toIndex: number }
  | { type: 'ledger/create'; name: string; code?: string; criterion: string; glyph: GlyphName }
  | { type: 'ledger/update'; id: Id; patch: Partial<Pick<Ledger, 'name' | 'code' | 'criterion' | 'glyph'>> }
  | { type: 'ledger/delete'; id: Id }
  | { type: 'superset/save'; superset: Superset }
  | { type: 'superset/delete'; id: Id }
  | { type: 'desk/deploy'; mode: Mode; supersetId?: Id | null; entryId?: Id | null; ledgerId?: Id | null; leisureId?: Id | null }
  | { type: 'leisure/add'; title: string }
  | { type: 'leisure/update'; id: Id; patch: { title?: string } }
  | { type: 'leisure/delete'; id: Id }
  /** The clerk says a tray entry is entertainment: it becomes a couch item and leaves the flow. */
  | { type: 'entry/toLeisure'; id: Id; log?: string }
  | { type: 'desk/pause'; at?: number }
  | { type: 'desk/resume' }
  | { type: 'desk/skip' }
  | { type: 'desk/standDown' }
  | { type: 'desk/swap'; entryId?: Id | null; ledgerId?: Id | null }
  | { type: 'desk/tick' }
  | { type: 'settings/update'; patch: Partial<Settings> }
  /** The account's state arrived from the sync server and replaces this copy. */
  | { type: 'sync/replace'; state: unknown }

export interface Result {
  state: MayorlyState
  events: HudEvent[]
}

export function reduce(state: MayorlyState, action: Action, ctx: Ctx, clerk: Clerk = prefixClerk): Result {
  // The heartbeat runs every second; only pay for a copy when something is due.
  if (action.type === 'desk/tick' && !tickDue(state, ctx.now)) return { state, events: [] }

  if (action.type === 'sync/replace') {
    const incoming = migrate(action.state)
    if (!incoming) return { state, events: [] }
    incoming.settings = sanitiseSettings({ ...incoming.settings, ...Object.fromEntries(DEVICE_SETTINGS.map((k) => [k, state.settings[k]])) })
    // A desk left running on another machine is not running here: time this
    // machine could not see is not desk time. Pause it where that copy last was.
    if (incoming.desk.status === 'running') {
      return reduce(incoming, { type: 'desk/pause', at: Math.min(ctx.now, incoming.desk.runStartedAt ?? ctx.now) }, ctx, clerk)
    }
    return { state: incoming, events: [] }
  }

  const s = structuredClone(state)
  const ev: HudEvent[] = []
  const now = ctx.now

  switch (action.type) {
    case 'entry/capture': {
      const text = action.text.trim()
      if (!text) break
      const byClerk = !!(action.filing && validFiling(s, action.filing))
      const filing = byClerk ? action.filing! : clerk.file(text, s.ledgers)
      if (!filing.title) break
      if (byClerk && filing.leisure) {
        // Entertainment never enters the flow: it goes straight to the couch list.
        if (!s.leisure.some((x) => x.archivedAt === null && x.title.toLowerCase() === filing.title.toLowerCase())) {
          s.leisure.push({ id: ctx.newId(), title: filing.title, createdAt: now, archivedAt: null })
        }
        log(s, now, filing.log)
        break
      }
      const e = addEntry(s, ctx, filing.title, filing.ledgerId, filing.estimateMin)
      if (byClerk) e.clerkFiled = { ledgerId: filing.ledgerId, model: filing.model ?? 'clerk', confidence: filing.confidence ?? 'sure' }
      log(s, now, filing.log)
      break
    }
    case 'entry/add': {
      const title = action.title.trim()
      if (!title) break
      addEntry(s, ctx, title, validLedger(s, action.ledgerId), clampEstimate(action.estimateMin))
      break
    }
    case 'entry/file': {
      const e = s.entries.find((x) => x.id === action.id)
      if (!e || e.doneAt !== null) break
      if (action.ledgerId !== null && !s.ledgers.some((l) => l.id === action.ledgerId)) break
      if (action.ledgerId === e.ledgerId) break
      e.ledgerId = action.ledgerId
      e.clerkFiled = { ledgerId: action.ledgerId, model: action.model ?? 'clerk', confidence: action.confidence ?? 'sure' }
      if (e.estimateMin === null && action.estimateMin !== null) e.estimateMin = clampEstimate(action.estimateMin)
      if (typeof action.log === 'string' && action.log.trim()) log(s, now, action.log)
      break
    }
    case 'entry/confirm': {
      const e = s.entries.find((x) => x.id === action.id)
      if (!e?.clerkFiled) break
      e.clerkFiled.confidence = 'sure'
      ev.push({ type: 'clerk-wonders', at: now, entryId: e.id, ruleId: null, title: e.title, ledgerId: e.ledgerId, fromLedgerId: e.ledgerId, reason: 'confirmed' })
      break
    }
    case 'rule/explain': {
      const text = action.text.trim().slice(0, 400)
      if (!text) break
      const rule = action.ruleId ? s.houseRules.find((r) => r.id === action.ruleId) : undefined
      if (rule) {
        rule.text = `${rule.text} ${text}`.slice(0, 600)
      } else {
        const e = s.entries.find((x) => x.id === action.entryId)
        if (!e) break
        s.houseRules.push({ id: ctx.newId(), text: `"${e.title}" belongs in ${ledgerName(s, e.ledgerId)}: ${text}`.slice(0, 600), createdAt: now, learnedFrom: { title: e.title, fromLedgerId: e.ledgerId, toLedgerId: e.ledgerId } })
      }
      log(s, now, `clerk told: ${text.length > 60 ? text.slice(0, 59) + '…' : text}`)
      break
    }
    case 'rule/add': {
      const text = action.text.trim()
      if (!text) break
      s.houseRules.push({ id: ctx.newId(), text: text.slice(0, 300), createdAt: now })
      break
    }
    case 'rule/update': {
      const r = s.houseRules.find((x) => x.id === action.id)
      if (!r) break
      const text = action.text.trim()
      if (text) r.text = text.slice(0, 300)
      break
    }
    case 'rule/delete':
      s.houseRules = s.houseRules.filter((x) => x.id !== action.id)
      break
    case 'entry/update': {
      const e = s.entries.find((x) => x.id === action.id)
      if (!e) break
      const p = action.patch
      if (p.title !== undefined && p.title.trim()) e.title = p.title.trim()
      if (p.ledgerId !== undefined) {
        const to = validLedger(s, p.ledgerId)
        // Moving an entry the clerk filed is a correction: it becomes a house rule.
        if (e.clerkFiled && to !== e.clerkFiled.ledgerId) {
          const ruleId = learnRule(s, ctx, e.title, e.clerkFiled.ledgerId, to)
          log(s, now, `house rule learned: '${e.title.length > 40 ? e.title.slice(0, 39) + '…' : e.title}' -> ${ledgerCode(s, to)}, not ${ledgerCode(s, e.clerkFiled.ledgerId)}`)
          ev.push({ type: 'clerk-wonders', at: now, entryId: e.id, ruleId, title: e.title, ledgerId: to, fromLedgerId: e.clerkFiled.ledgerId, reason: 'moved' })
        }
        delete e.clerkFiled
        e.ledgerId = to
      }
      if (p.estimateMin !== undefined) e.estimateMin = clampEstimate(p.estimateMin)
      const b = s.desk.block
      if (b?.entryId === e.id) {
        b.ledgerId = e.ledgerId
        b.label = ledgerLabel(s, e.ledgerId)
      }
      break
    }
    case 'entry/complete':
      completeEntry(s, ctx, ev, action.id)
      break
    case 'entry/reopen': {
      const e = s.entries.find((x) => x.id === action.id)
      if (!e || e.doneAt === null) break
      e.doneAt = null
      e.order = maxOrder(s) + 1
      break
    }
    case 'entry/delete': {
      const e = s.entries.find((x) => x.id === action.id)
      if (!e) break
      if (s.desk.block?.entryId === e.id) {
        const next = s.desk.plan?.mode === 'superset' || s.desk.plan?.mode === 'pomodoro'
          ? firstOpenInLedger(s, e.ledgerId, e.id) ?? null
          : null
        swapTo(s, ctx, ev, next?.id ?? null, next?.ledgerId ?? s.desk.block.ledgerId)
      }
      s.entries = s.entries.filter((x) => x.id !== e.id)
      for (const ss of s.supersets) {
        ss.slots = ss.slots.filter((sl) => !(sl.target.kind === 'entry' && sl.target.entryId === e.id))
      }
      break
    }
    case 'entry/move': {
      const flow = openFlow(s)
      const from = flow.findIndex((e) => e.id === action.id)
      if (from < 0) break
      const [moved] = flow.splice(from, 1)
      flow.splice(Math.max(0, Math.min(flow.length, action.toIndex)), 0, moved)
      flow.forEach((e, i) => (e.order = i))
      break
    }
    case 'ledger/create': {
      const name = action.name.trim()
      if (!name) break
      if (s.ledgers.length >= LEDGER_CAP) {
        ev.push({ type: 'notice', at: now, text: `Shelf is full: ${LEDGER_CAP} ledgers` })
        break
      }
      const taken = s.ledgers.map((l) => l.code)
      const wanted = normaliseCode(action.code ?? '')
      const code = wanted && !taken.includes(wanted) ? wanted : deriveCode(name, taken)
      s.ledgers.push({
        id: ctx.newId(),
        name,
        code,
        criterion: action.criterion.trim(),
        glyph: action.glyph,
        handWritten: true,
        createdAt: now,
      })
      break
    }
    case 'ledger/update': {
      const l = s.ledgers.find((x) => x.id === action.id)
      if (!l) break
      const p = action.patch
      if (p.name !== undefined && p.name.trim()) l.name = p.name.trim()
      if (p.criterion !== undefined) l.criterion = p.criterion.trim()
      if (p.glyph !== undefined) l.glyph = p.glyph
      if (p.code !== undefined) {
        const c = normaliseCode(p.code)
        if (c && !s.ledgers.some((o) => o.id !== l.id && o.code === c)) l.code = c
      }
      if (s.desk.block?.ledgerId === l.id) s.desk.block.label = l.name
      break
    }
    case 'ledger/delete': {
      const id = action.id
      if (!s.ledgers.some((l) => l.id === id)) break
      s.ledgers = s.ledgers.filter((l) => l.id !== id)
      // Nothing is lost: entries go back to the tray.
      for (const e of s.entries) if (e.ledgerId === id) e.ledgerId = null
      for (const ss of s.supersets) {
        ss.slots = ss.slots.filter((sl) => !(sl.target.kind === 'ledger' && sl.target.ledgerId === id))
      }
      if (s.desk.block?.ledgerId === id) {
        s.desk.block.ledgerId = null
        s.desk.block.label = ledgerLabel(s, null)
      }
      break
    }
    case 'superset/save': {
      const ss = sanitiseSuperset(s, action.superset)
      const i = s.supersets.findIndex((x) => x.id === ss.id)
      if (i >= 0) s.supersets[i] = ss
      else s.supersets.push(ss)
      break
    }
    case 'superset/delete':
      if (s.desk.plan?.supersetId === action.id) endSitting(s, now, ev, 'stood')
      s.supersets = s.supersets.filter((x) => x.id !== action.id)
      break
    case 'desk/deploy':
      deploy(s, ctx, ev, { mode: action.mode, supersetId: action.supersetId, entryId: action.entryId, ledgerId: action.ledgerId, leisureId: action.leisureId })
      break
    case 'leisure/add': {
      const title = action.title.trim().slice(0, 120)
      if (!title) break
      s.leisure.push({ id: ctx.newId(), title, createdAt: now, archivedAt: null })
      break
    }
    case 'leisure/update': {
      const it = s.leisure.find((x) => x.id === action.id)
      if (!it) break
      if (action.patch.title?.trim()) it.title = action.patch.title.trim().slice(0, 120)
      if (s.desk.block?.leisureId === it.id) s.desk.block.label = it.title
      break
    }
    case 'leisure/delete': {
      const it = s.leisure.find((x) => x.id === action.id)
      if (!it) break
      if (s.desk.plan?.mode === 'couch' && s.desk.plan.leisureId === it.id) endSitting(s, now, ev, 'stood')
      it.archivedAt = now
      break
    }
    case 'entry/toLeisure': {
      const e = s.entries.find((x) => x.id === action.id)
      if (!e || e.doneAt !== null) break
      if (!s.leisure.some((x) => x.archivedAt === null && x.title.toLowerCase() === e.title.toLowerCase())) {
        s.leisure.push({ id: ctx.newId(), title: e.title, createdAt: now, archivedAt: null })
      }
      if (s.desk.block?.entryId === e.id) swapTo(s, ctx, ev, null, s.desk.block.ledgerId)
      s.entries = s.entries.filter((x) => x.id !== e.id)
      log(s, now, action.log?.trim() || `couch '${e.title.length > 40 ? e.title.slice(0, 39) + '…' : e.title}': entertainment, not a ledger`)
      break
    }
    case 'desk/pause': {
      const at = Math.min(action.at ?? now, now)
      if (s.desk.status !== 'running' || s.desk.runStartedAt === null) break
      const runFrom = s.desk.runStartedAt
      const t = Math.max(at, runFrom)
      closeSegment(s, t)
      mint(s, t, ev)
      s.desk.bankMs += t - runFrom
      s.desk.runStartedAt = null
      s.desk.status = 'paused'
      break
    }
    case 'desk/resume': {
      if (s.desk.status !== 'paused' && s.desk.status !== 'ready') break
      if (!s.desk.block) break
      s.desk.status = 'running'
      s.desk.runStartedAt = now
      openSegment(s, ctx, now)
      if (s.desk.bankMs === 0) ev.push({ type: 'block', at: now, block: s.desk.block, started: true })
      break
    }
    case 'desk/skip': {
      const { block, plan, status } = s.desk
      if (!block || !plan || status === 'idle') break
      if (status === 'running') closeSegment(s, now)
      mint(s, now, ev)
      const next = advance(s, plan, block, now, ctx.random)
      if (!next) endSitting(s, now, ev, plan.mode === 'blitz' ? 'flow-clear' : 'complete')
      else startBlock(s, ctx, ev, next, now, true)
      break
    }
    case 'desk/standDown':
      if (s.desk.status !== 'idle') endSitting(s, now, ev, 'stood')
      break
    case 'desk/swap': {
      const { block } = s.desk
      if (!block || block.kind !== 'focus') break
      let entryId = action.entryId ?? null
      let ledgerId = action.ledgerId ?? null
      if (entryId) {
        const e = s.entries.find((x) => x.id === entryId && x.doneAt === null)
        if (!e) break
        ledgerId = e.ledgerId
      } else if (ledgerId) {
        if (!s.ledgers.some((l) => l.id === ledgerId)) break
        entryId = firstOpenInLedger(s, ledgerId)?.id ?? null
      } else break
      swapTo(s, ctx, ev, entryId, ledgerId)
      break
    }
    case 'desk/tick':
      tick(s, ctx, ev)
      break
    case 'settings/update':
      s.settings = sanitiseSettings({ ...s.settings, ...action.patch })
      break
  }
  return { state: s, events: ev }
}

// ---------------------------------------------------------------- desk

function deploy(s: MayorlyState, ctx: Ctx, ev: HudEvent[], opts: DeployOpts) {
  const now = ctx.now
  const plan = initialPlan(s, opts, ctx.random)
  if (!plan) {
    ev.push({ type: 'notice', at: now, text: opts.mode === 'blitz' ? 'Flow is empty' : opts.mode === 'couch' ? 'Pick something from the couch list' : 'Superset has no slots' })
    return
  }
  if (plan.mode === 'couch') {
    // Each leisure block costs one token, taken as it starts. Nothing is earned on the couch.
    if (balanceOf(s) < LEISURE_TOKENS_PER_BLOCK) {
      ev.push({ type: 'notice', at: now, text: 'No tokens: a tomato at the desk buys a block on the couch' })
      return
    }
    // The couch is its own sitting; a desk left running is stood down first.
    if (s.desk.status !== 'idle' || s.desk.sittingId) endSitting(s, now, ev, 'stood')
    const sittingId = ctx.newId()
    s.sittings.push({ id: sittingId, startedAt: now, endedAt: null, tomatoMs: s.settings.focusMin * 60_000, focusMs: 0, tomatoes: 0, tokens: 0 })
    s.desk.sittingId = sittingId
    s.desk.plan = plan
    const block = firstBlock(s, plan, now)
    if (!block) {
      endSitting(s, now, ev, 'complete')
      return
    }
    startBlock(s, ctx, ev, block, now, true)
    return
  }
  // A couch sitting ends when work starts.
  if (s.desk.plan?.mode === 'couch') endSitting(s, now, ev, 'stood')
  // Redeploying mid-sitting keeps the sitting, so a new plan never costs banked tomatoes.
  if (s.desk.status === 'running') closeSegment(s, now)
  if (!s.desk.sittingId) {
    const id = ctx.newId()
    s.sittings.push({
      id,
      startedAt: now,
      endedAt: null,
      tomatoMs: s.settings.focusMin * 60_000,
      focusMs: 0,
      tomatoes: 0,
      tokens: 0,
    })
    s.desk.sittingId = id
  }
  s.desk.plan = plan
  const block = firstBlock(s, plan, now)
  if (!block) {
    endSitting(s, now, ev, 'complete')
    return
  }
  startBlock(s, ctx, ev, block, now, true)
}

function startBlock(s: MayorlyState, ctx: Ctx, ev: HudEvent[], block: Block, at: number, force: boolean) {
  if (block.kind === 'leisure') {
    // A leisure block is bought as it starts. Out of tokens, the couch sitting ends.
    const sittingId = s.desk.sittingId
    if (!sittingId || balanceOf(s) < LEISURE_TOKENS_PER_BLOCK) {
      ev.push({ type: 'notice', at, text: 'Out of tokens: back to the desk' })
      endSitting(s, at, ev, 'complete')
      return
    }
    s.tokens.push({ id: `${sittingId}:leisure:${block.round}`, at, amount: -LEISURE_TOKENS_PER_BLOCK, reason: 'leisure', sittingId, leisureId: block.leisureId ?? undefined })
  }
  const auto = force || block.kind === 'leisure' || (block.kind === 'focus' ? s.settings.autoStartFocus : s.settings.autoStartRest)
  s.desk.block = block
  s.desk.bankMs = 0
  if (auto) {
    s.desk.status = 'running'
    s.desk.runStartedAt = at
    openSegment(s, ctx, at)
  } else {
    s.desk.status = 'ready'
    s.desk.runStartedAt = null
  }
  ev.push({ type: 'block', at, block, started: auto })
}

function swapTo(s: MayorlyState, ctx: Ctx, ev: HudEvent[], entryId: Id | null, ledgerId: Id | null) {
  const d = s.desk
  const block = d.block
  if (!block) return
  const now = ctx.now
  const running = d.status === 'running'
  if (running) closeSegment(s, now)
  block.entryId = entryId
  block.ledgerId = ledgerId
  block.label = ledgerLabel(s, ledgerId)
  if (d.plan?.mode === 'pomodoro') {
    d.plan.anchorEntryId = entryId
    d.plan.anchorLedgerId = ledgerId
  }
  if (d.plan?.mode === 'blitz' && entryId) {
    // In blitz the timer belongs to the entry, so a swap re-arms it.
    const e = s.entries.find((x) => x.id === entryId)!
    d.plan.anchorEntryId = entryId
    block.durationMs = blitzBlock(s, e, now).durationMs
    d.bankMs = 0
    if (running) d.runStartedAt = now
  }
  if (running) openSegment(s, ctx, now)
  ev.push({ type: 'swap', at: now, ledgerId, entryId })
}

function completeEntry(s: MayorlyState, ctx: Ctx, ev: HudEvent[], id: Id) {
  const now = ctx.now
  const e = s.entries.find((x) => x.id === id)
  if (!e || e.doneAt !== null) return
  e.doneAt = now
  ev.push({ type: 'cleared', at: now, entryId: e.id, title: e.title })

  const d = s.desk
  if (!d.block || d.block.entryId !== id || !d.plan) return
  const mode = d.plan.mode

  if (mode === 'blitz') {
    if (d.status === 'running') closeSegment(s, now)
    mint(s, now, ev)
    const next = advance(s, d.plan, d.block, now, ctx.random)
    if (!next) endSitting(s, now, ev, 'flow-clear')
    else startBlock(s, ctx, ev, next, now, false)
    return
  }
  if (mode === 'superset') {
    const ss = s.supersets.find((x) => x.id === d.plan!.supersetId)
    if (ss?.onClear === 'next-slot') {
      if (d.status === 'running') closeSegment(s, now)
      mint(s, now, ev)
      const next = advance(s, d.plan, d.block, now, ctx.random)
      if (!next) endSitting(s, now, ev, 'complete')
      else startBlock(s, ctx, ev, next, now, false)
      return
    }
    const next = firstOpenInLedger(s, d.block.ledgerId)
    swapTo(s, ctx, ev, next?.id ?? null, d.block.ledgerId)
    return
  }
  // Pomodoro stays in the ledger you were working; only a ledger-less plan follows the flow.
  const stay = d.plan.anchorLedgerId
  const next = stay ? firstOpenInLedger(s, stay) : nextInFlow(s, id)
  swapTo(s, ctx, ev, next?.id ?? null, next?.ledgerId ?? stay ?? null)
}

function endSitting(s: MayorlyState, at: number, ev: HudEvent[], reason: 'stood' | 'complete' | 'flow-clear') {
  const d = s.desk
  if (d.status === 'running') closeSegment(s, at)
  mint(s, at, ev)
  const sitting = s.sittings.find((x) => x.id === d.sittingId)
  if (sitting) {
    sitting.endedAt = at
    ev.push({ type: 'sitting-end', at, reason, focusMs: sitting.focusMs, tomatoes: sitting.tomatoes, tokens: sitting.tokens })
  }
  s.desk = { status: 'idle', sittingId: null, plan: null, block: null, runStartedAt: null, bankMs: 0 }
}

function tickDue(s: MayorlyState, now: number): boolean {
  const d = s.desk
  if (d.status !== 'running' || !d.block || d.runStartedAt === null) return false
  const end = blockEndsAt(s)
  if (end !== null && now >= end) return true
  const sitting = s.sittings.find((x) => x.id === d.sittingId)
  if (!sitting) return false
  return Math.floor(liveFocus(s, now) / sitting.tomatoMs) > sitting.tomatoes
}

/** Absolute end of the running block, or null when it counts up or never auto-ends. */
export function blockEndsAt(s: MayorlyState): number | null {
  const d = s.desk
  if (!d.block || d.runStartedAt === null || d.block.durationMs === null) return null
  // A blitz entry is finished by you, not by the clock; past its estimate it runs into overtime.
  if (d.plan?.mode === 'blitz' && d.block.kind === 'focus') return null
  return d.runStartedAt + (d.block.durationMs - d.bankMs)
}

function tick(s: MayorlyState, ctx: Ctx, ev: HudEvent[]) {
  const now = ctx.now
  for (let guard = 0; guard < 64; guard++) {
    const d = s.desk
    if (d.status !== 'running' || !d.block || !d.plan) return
    const end = blockEndsAt(s)
    if (end === null || now < end) {
      mint(s, now, ev)
      return
    }
    closeSegment(s, end)
    mint(s, end, ev)
    const next = advance(s, d.plan, d.block, end, ctx.random)
    if (!next) {
      endSitting(s, end, ev, 'complete')
      return
    }
    startBlock(s, { ...ctx, now: end }, ev, next, end, false)
  }
}

const balanceOf = (s: MayorlyState) => s.tokens.reduce((n, t) => n + t.amount, 0)

function liveFocus(s: MayorlyState, now: number): number {
  const sitting = s.sittings.find((x) => x.id === s.desk.sittingId)
  if (!sitting) return 0
  const open = s.segments.find((x) => x.end === null && x.sittingId === sitting.id)
  return sitting.focusMs + (open && open.kind === 'focus' ? Math.max(0, now - open.start) : 0)
}

function mint(s: MayorlyState, at: number, ev: HudEvent[]) {
  const sitting = s.sittings.find((x) => x.id === s.desk.sittingId)
  if (!sitting) return
  const due = Math.floor(liveFocus(s, at) / sitting.tomatoMs)
  while (sitting.tomatoes < due) {
    sitting.tomatoes++
    const amount = tokensForTomato(sitting.tomatoes)
    sitting.tokens += amount
    s.tokens.push({ id: `${sitting.id}:${sitting.tomatoes}`, at, amount, reason: 'tomato', sittingId: sitting.id })
    ev.push({ type: 'tomato', at, n: sitting.tomatoes, tokens: amount })
  }
}

function openSegment(s: MayorlyState, ctx: Ctx, at: number) {
  const { block, sittingId } = s.desk
  if (!block || !sittingId) return
  s.segments.push({
    id: ctx.newId(),
    sittingId,
    kind: block.kind,
    ledgerId: block.ledgerId,
    entryId: block.entryId,
    ...(block.kind === 'leisure' ? { leisureId: block.leisureId ?? null } : {}),
    start: at,
    end: null,
  })
}

function closeSegment(s: MayorlyState, at: number) {
  const seg = s.segments.find((x) => x.end === null)
  if (!seg) return
  seg.end = Math.max(seg.start, at)
  if (seg.kind === 'focus') {
    const sitting = s.sittings.find((x) => x.id === seg.sittingId)
    if (sitting) sitting.focusMs += seg.end - seg.start
  }
}

// ---------------------------------------------------------------- helpers

function addEntry(s: MayorlyState, ctx: Ctx, title: string, ledgerId: Id | null, estimateMin: number | null): Entry {
  const e: Entry = {
    id: ctx.newId(),
    title,
    ledgerId,
    estimateMin,
    order: maxOrder(s) + 1,
    createdAt: ctx.now,
    doneAt: null,
  }
  s.entries.push(e)
  return e
}

const ledgerCode = (s: MayorlyState, id: Id | null) => s.ledgers.find((l) => l.id === id)?.code ?? 'the tray'
const ledgerName = (s: MayorlyState, id: Id | null) => s.ledgers.find((l) => l.id === id)?.name ?? 'the tray'

/** One correction, one rule, in plain words the clerk can read back. The same correction twice does not make two. */
function learnRule(s: MayorlyState, ctx: Ctx, title: string, from: Id | null, to: Id | null): Id {
  const dup = s.houseRules.find((r) => r.learnedFrom && r.learnedFrom.title.toLowerCase() === title.toLowerCase() && r.learnedFrom.toLedgerId === to)
  if (dup) return dup.id
  const id = ctx.newId()
  const text = `Entries like "${title}" go to ${ledgerName(s, to)}, not ${ledgerName(s, from)}.`
  s.houseRules.push({ id, text, createdAt: ctx.now, learnedFrom: { title, fromLedgerId: from, toLedgerId: to } })
  return id
}

function maxOrder(s: MayorlyState): number {
  return s.entries.reduce((m, e) => Math.max(m, e.order), -1)
}

function log(s: MayorlyState, at: number, text: string) {
  s.clerkLog.push({ at, text })
  if (s.clerkLog.length > CLERK_LOG_CAP) s.clerkLog.splice(0, s.clerkLog.length - CLERK_LOG_CAP)
}

function ledgerLabel(s: MayorlyState, id: Id | null): string {
  return s.ledgers.find((l) => l.id === id)?.name ?? 'Free focus'
}

function validLedger(s: MayorlyState, id: Id | null | undefined): Id | null {
  return id && s.ledgers.some((l) => l.id === id) ? id : null
}

function clampEstimate(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return null
  return Math.min(24 * 60, Math.round(n))
}

function normaliseCode(c: string): string {
  return c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}

const clampInt = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt
}

export function sanitiseSuperset(s: MayorlyState, ss: Superset): Superset {
  const slots = ss.slots.filter((sl) =>
    sl.target.kind === 'ledger'
      ? s.ledgers.some((l) => l.id === (sl.target as { ledgerId: Id }).ledgerId)
      : s.entries.some((e) => e.id === (sl.target as { entryId: Id }).entryId),
  )
  return {
    id: ss.id,
    name: ss.name.trim() || 'Superset',
    slots: slots.slice(0, 12).map((sl) => ({ ...sl, minutes: clampInt(sl.minutes, 1, 240, 25) })),
    rounds: clampInt(ss.rounds, 0, 24, 3),
    restMin: clampInt(ss.restMin, 0, 120, 5),
    roundRestMin: clampInt(ss.roundRestMin, 0, 180, 15),
    order: ss.order === 'shuffle' ? 'shuffle' : 'fixed',
    onClear: ss.onClear === 'next-slot' ? 'next-slot' : 'next-in-ledger',
  }
}

/** A filing from outside the core is trusted only if it names a real ledger and a real title. */
function validFiling(s: MayorlyState, f: Filing): boolean {
  if (!f || typeof f.title !== 'string' || !f.title.trim() || typeof f.log !== 'string') return false
  if (f.ledgerId !== null && !s.ledgers.some((l) => l.id === f.ledgerId)) return false
  if (f.estimateMin !== null && (!Number.isFinite(f.estimateMin) || f.estimateMin <= 0 || f.estimateMin > 24 * 60)) return false
  return true
}

export function sanitiseSettings(x: Settings): Settings {
  return {
    ...x,
    focusMin: clampInt(x.focusMin, 1, 180, 25),
    shortRestMin: clampInt(x.shortRestMin, 0, 60, 5),
    longRestMin: clampInt(x.longRestMin, 0, 120, 15),
    longRestEvery: clampInt(x.longRestEvery, 1, 12, 4),
    hudScale: Math.min(1.6, Math.max(0.7, Number(x.hudScale) || 1)),
    hudSide: x.hudSide === 'left' ? 'left' : 'right',
  }
}
