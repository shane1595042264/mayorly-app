import { describe, expect, it } from 'vitest'
import {
  type Action, type HudEvent, type MayorlyState,
  balance, blockView, clock, dayStats, deriveCode, firstRunState, formatSuperset, objectives,
  parseSuperset, prefixClerk, reduce, tokensForSitting, tokensForTomato,
} from './index'

const MIN = 60_000
const T0 = new Date('2026-10-09T09:00:00').getTime()

function world(seed?: (s: MayorlyState) => void) {
  let n = 0
  const newId = () => `id${++n}`
  let now = T0
  let state = firstRunState(now, newId)
  seed?.(state)
  const events: HudEvent[] = []
  const w = {
    get s() { return state },
    get now() { return now },
    events,
    do(action: Action) {
      const r = reduce(state, action, { now, newId, random: () => 0.5 })
      state = r.state
      events.push(...r.events)
      return r
    },
    /** Move the clock forward, ticking every second like the main process heartbeat. */
    wait(ms: number) {
      const end = now + ms
      while (now < end) {
        now = Math.min(end, now + 1000)
        w.do({ type: 'desk/tick' })
      }
    },
    ledger(code: string) { return state.ledgers.find((l) => l.code === code)! },
    entry(title: string) { return state.entries.find((e) => e.title === title)! },
  }
  return w
}

describe('token economy', () => {
  it('pays one token per tomato, no bonus for long sittings', () => {
    expect([1, 2, 3, 4].map(tokensForTomato)).toEqual([1, 1, 1, 1])
    expect(tokensForSitting(1)).toBe(1)
    expect(tokensForSitting(3)).toBe(3)
    expect(tokensForSitting(5)).toBe(5)
  })
})

describe('clerk', () => {
  const s = firstRunState(T0, () => Math.random().toString())
  it('files by prefix, by tag, or leaves it in the tray', () => {
    expect(prefixClerk.file('legal: read the lease ~30', s.ledgers)).toMatchObject({
      title: 'read the lease', ledgerId: s.ledgers[0].id, estimateMin: 30,
    })
    expect(prefixClerk.file('drill footwork #dnc ~1h', s.ledgers)).toMatchObject({
      title: 'drill footwork', ledgerId: s.ledgers[1].id, estimateMin: 60,
    })
    const tray = prefixClerk.file('buy milk', s.ledgers)
    expect(tray.ledgerId).toBeNull()
    expect(tray.log).toMatch(/^tray 'buy milk'/)
  })
  it('does not treat an unknown prefix as a ledger', () => {
    expect(prefixClerk.file('note: call mom', s.ledgers)).toMatchObject({ title: 'note: call mom', ledgerId: null })
  })
  it('derives unique callsigns', () => {
    expect(deriveCode('Legal', [])).toBe('LGL')
    expect(deriveCode('Dance', [])).toBe('DNC')
    expect(deriveCode('Legal', ['LGL'])).toBe('LG2')
  })
})

describe('ledger shelf', () => {
  it('caps at nine and says so', () => {
    const w = world()
    for (let i = 0; i < 8; i++) w.do({ type: 'ledger/create', name: `Ledger ${i}`, criterion: '', glyph: 'book' })
    expect(w.s.ledgers).toHaveLength(9)
    expect(w.events.at(-1)).toMatchObject({ type: 'notice', text: 'Shelf is full: 9 ledgers' })
  })
  it('sends entries back to the tray when a ledger is removed', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: sign it' })
    w.do({ type: 'ledger/delete', id: w.ledger('LGL').id })
    expect(w.entry('sign it').ledgerId).toBeNull()
    expect(w.s.supersets[0].slots).toHaveLength(2)
  })
})

describe('pomodoro', () => {
  it('runs focus then rest, mints a tomato, and keeps going', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'career: tailor resume' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', label: 'Career' })
    w.wait(25 * MIN)
    expect(w.s.desk.block).toMatchObject({ kind: 'rest', label: 'Rest' })
    expect(balance(w.s)).toBe(1)
    w.wait(5 * MIN)
    expect(w.s.desk.block?.kind).toBe('focus')
    expect(w.s.desk.block?.entryId).toBe(w.entry('tailor resume').id)
  })
  it('deploys on a ledger with no entries as ledger time', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: unrelated' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('DNC').id })
    expect(w.s.desk.block).toMatchObject({ ledgerId: w.ledger('DNC').id, entryId: null, label: 'Dance' })
    w.wait(30 * MIN)
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', ledgerId: w.ledger('DNC').id })
  })
  it('stays in the ledger when the entry is cleared', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: one' })
    w.do({ type: 'entry/capture', text: 'career: other' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.do({ type: 'entry/complete', id: w.entry('one').id })
    expect(w.s.desk.block).toMatchObject({ ledgerId: w.ledger('LGL').id, entryId: null })
  })
  it('takes a long rest every fourth focus', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(4 * 25 * MIN + 3 * 5 * MIN)
    expect(w.s.desk.block).toMatchObject({ kind: 'rest', label: 'Long rest', durationMs: 15 * MIN })
    expect(balance(w.s)).toBe(4)
  })
  it('pausing banks block time and pays nothing while paused', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(10 * MIN)
    w.do({ type: 'desk/pause' })
    w.wait(60 * MIN)
    expect(balance(w.s)).toBe(0)
    w.do({ type: 'desk/resume' })
    expect(blockView(w.s, w.now)!.remainingMs).toBe(15 * MIN)
    w.wait(15 * MIN)
    expect(balance(w.s)).toBe(1)
  })
})

describe('superset rotation', () => {
  it('rotates ledgers with rests between, then a round rest', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    const seen: string[] = []
    const label = () => `${w.s.desk.block!.kind}:${w.s.desk.block!.label}`
    seen.push(label())
    for (const ms of [25, 5, 25, 5, 25]) {
      w.wait(ms * MIN)
      seen.push(label())
    }
    expect(seen).toEqual([
      'focus:Legal', 'rest:Rest', 'focus:Dance', 'rest:Rest', 'focus:Career', 'rest:Round rest',
    ])
    expect(w.s.desk.plan?.round).toBe(2)
  })
  it('finishes after the last round and pays a token a tomato', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    // 3 rounds: 9 focus blocks, 6 rests, 2 round rests.
    w.wait(9 * 25 * MIN + 6 * 5 * MIN + 2 * 15 * MIN)
    expect(w.s.desk.status).toBe('idle')
    const end = w.events.find((e) => e.type === 'sitting-end')
    expect(end).toMatchObject({ reason: 'complete', tomatoes: 9, tokens: 9 })
  })
  it('pulls the next entry from the same ledger when one is cleared mid-block', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: one' })
    w.do({ type: 'entry/capture', text: 'legal: two' })
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    expect(w.s.desk.block?.entryId).toBe(w.entry('one').id)
    w.wait(3 * MIN)
    w.do({ type: 'entry/complete', id: w.entry('one').id })
    expect(w.s.desk.block?.entryId).toBe(w.entry('two').id)
    expect(blockView(w.s, w.now)!.remainingMs).toBe(22 * MIN)
  })
  it('shows objectives with the active slot', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    w.wait(31 * MIN)
    expect(objectives(w.s)!.slots.map((o) => `${o.letter}${o.code}:${o.state}`)).toEqual([
      'ALGL:done', 'BDNC:active', 'CCAR:queued',
    ])
  })
})

describe('blitz flow', () => {
  it('times each entry against its estimate and rolls to the next when cleared', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: first ~10' })
    w.do({ type: 'entry/capture', text: 'career: second' })
    w.do({ type: 'desk/deploy', mode: 'blitz' })
    expect(w.s.desk.block?.durationMs).toBe(10 * MIN)
    w.wait(12 * MIN)
    const v = blockView(w.s, w.now)!
    expect(v.entry?.title).toBe('first')
    expect(v.overtimeMs).toBe(2 * MIN)
    w.do({ type: 'entry/complete', id: w.entry('first').id })
    expect(w.s.desk.block).toMatchObject({ entryId: w.entry('second').id, durationMs: null })
    w.do({ type: 'entry/complete', id: w.entry('second').id })
    expect(w.s.desk.status).toBe('idle')
    expect(w.events.at(-1)).toMatchObject({ type: 'sitting-end', reason: 'flow-clear' })
  })
})

describe('swap', () => {
  it('switches the entry without resetting the block clock', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(7 * MIN)
    w.do({ type: 'desk/swap', ledgerId: w.ledger('DNC').id })
    const v = blockView(w.s, w.now)!
    expect(v.block.label).toBe('Dance')
    expect(v.remainingMs).toBe(18 * MIN)
    const today = dayStats(w.s, new Date(T0).setHours(0, 0, 0, 0), w.now + 3 * MIN)
    const byCode = Object.fromEntries(today.byLedger.map((b) => [w.s.ledgers.find((l) => l.id === b.ledgerId)?.code, b.focusMs]))
    expect(byCode).toEqual({ LGL: 7 * MIN, DNC: 3 * MIN })
  })
  it('redeploying mid-sitting keeps banked focus toward the bonus', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(40 * MIN)
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    expect(w.s.sittings).toHaveLength(1)
    expect(w.s.sittings[0].tomatoes).toBe(1)
  })
})

describe('superset syntax', () => {
  it('parses slots and options', () => {
    let k = 0
    const s = firstRunState(T0, () => `L${++k}`)
    let n = 0
    const r = parseSuperset('legal 25, dance 20 > career x2 rest 3 rr 10 shuffle', s.ledgers, () => `p${++n}`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.superset).toMatchObject({ rounds: 2, restMin: 3, roundRestMin: 10, order: 'shuffle', name: 'LGL / DNC / CAR' })
    expect(r.superset.slots.map((sl) => sl.minutes)).toEqual([25, 20, 25])
    expect(formatSuperset(r.superset, s.ledgers, [])).toBe('lgl 25, dnc 20, car 25 x2 rest 3 rr 10 shuffle')
  })
  it('names the ledger it could not find', () => {
    let k = 0
    const s = firstRunState(T0, () => `L${++k}`)
    expect(parseSuperset('legal 25, cooking 20', s.ledgers, () => 'y')).toEqual({ ok: false, error: 'No ledger called "cooking"' })
  })
})

describe('format', () => {
  it('formats clocks', () => {
    expect(clock(25 * MIN)).toBe('25:00')
    expect(clock(1)).toBe('00:01')
    expect(clock(62 * MIN)).toBe('1:02:00')
  })
})

describe('sync', () => {
  it('a synced state replaces entries and ledgers but keeps this machine\'s own settings', () => {
    const w = world()
    w.do({ type: 'settings/update', patch: { hotkeys: { ...w.s.settings.hotkeys, plus: 'Ctrl+Alt+T' }, hudScale: 1.3, focusMin: 30 } })
    const other = structuredClone(w.s)
    other.entries = [{ ...other.entries[0] ?? { id: 'x', title: 'from the other machine', ledgerId: null, estimateMin: null, createdAt: T0, doneAt: null, order: 0 }, title: 'from the other machine' } as never]
    other.settings = { ...other.settings, hotkeys: { ...other.settings.hotkeys, plus: 'Alt+T' }, hudScale: 0.8, focusMin: 50 }
    w.do({ type: 'sync/replace', state: other })
    expect(w.s.entries.map((e) => e.title)).toEqual(['from the other machine'])
    expect(w.s.settings.hotkeys.plus).toBe('Ctrl+Alt+T')
    expect(w.s.settings.hudScale).toBe(1.3)
    expect(w.s.settings.focusMin).toBe(50)
  })

  it('a desk running on the other machine arrives paused', () => {
    const w = world()
    const other = structuredClone(w.s)
    const r = reduce(other, { type: 'desk/deploy', mode: 'pomodoro', ledgerId: other.ledgers[0].id }, { now: T0, newId: () => 'o1', random: () => 0.5 })
    expect(r.state.desk.status).toBe('running')
    w.do({ type: 'sync/replace', state: r.state })
    expect(w.s.desk.status).toBe('paused')
  })

  it('garbage from the server is ignored', () => {
    const w = world()
    const before = w.s
    w.do({ type: 'sync/replace', state: { nope: true } })
    expect(w.s).toBe(before)
  })
})

describe('the AI clerk', () => {
  it('a filing that names a real ledger is used as given', () => {
    const w = world()
    const dnc = w.ledger('DNC')
    w.do({ type: 'entry/capture', text: 'practice the footwork combo for 20', filing: { title: 'practice the footwork combo', ledgerId: dnc.id, estimateMin: 20, log: "filed 'practice the footwork combo' -> DNC (clerk, test)" } })
    const e = w.entry('practice the footwork combo')
    expect(e.ledgerId).toBe(dnc.id)
    expect(e.estimateMin).toBe(20)
    expect(w.s.clerkLog.at(-1)?.text).toContain('clerk, test')
  })

  it('a filing that names a ledger that does not exist falls back to the prefix clerk', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: reply to the landlord', filing: { title: 'reply to the landlord', ledgerId: 'nope', estimateMin: null, log: 'bad' } })
    expect(w.entry('reply to the landlord').ledgerId).toBe(w.ledger('LGL').id)
  })
})

describe('the tray sweep', () => {
  it('entry/file moves a tray entry into a ledger and logs it', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'apply for 10 jobs' })
    const e = w.entry('apply for 10 jobs')
    expect(e.ledgerId).toBeNull()
    w.do({ type: 'entry/file', id: e.id, ledgerId: w.ledger('CAR').id, estimateMin: 90, log: "filed 'apply for 10 jobs' -> CAR (clerk, test)" })
    expect(w.entry('apply for 10 jobs').ledgerId).toBe(w.ledger('CAR').id)
    expect(w.entry('apply for 10 jobs').estimateMin).toBe(90)
    expect(w.s.clerkLog.at(-1)?.text).toContain('-> CAR')
  })

  it('entry/file ignores unknown ledgers and cleared entries', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'book a haircut' })
    const e = w.entry('book a haircut')
    w.do({ type: 'entry/file', id: e.id, ledgerId: 'nope', estimateMin: null, log: 'x' })
    expect(w.entry('book a haircut').ledgerId).toBeNull()
  })
})

describe('house rules', () => {
  it('moving an entry the clerk filed teaches a rule naming both ledgers', () => {
    const w = world()
    const car = w.ledger('CAR'), dnc = w.ledger('DNC')
    w.do({ type: 'entry/capture', text: 'battle prep drills', filing: { title: 'battle prep drills', ledgerId: car.id, estimateMin: null, log: 'x', model: 'test' } })
    const e = w.entry('battle prep drills')
    expect(e.clerkFiled?.ledgerId).toBe(car.id)
    w.do({ type: 'entry/update', id: e.id, patch: { ledgerId: dnc.id } })
    expect(w.s.houseRules).toHaveLength(1)
    expect(w.s.houseRules[0].text).toBe('Entries like "battle prep drills" go to Dance, not Career.')
    expect(w.entry('battle prep drills').clerkFiled).toBeUndefined()
    // Moving it again is the user's own business, not a correction of the clerk.
    w.do({ type: 'entry/update', id: e.id, patch: { ledgerId: car.id } })
    expect(w.s.houseRules).toHaveLength(1)
  })

  it('an entry filed by prefix teaches nothing when moved', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'career: tailor resume' })
    w.do({ type: 'entry/update', id: w.entry('tailor resume').id, patch: { ledgerId: w.ledger('LGL').id } })
    expect(w.s.houseRules).toHaveLength(0)
  })

  it('rules can be written, edited and removed by hand', () => {
    const w = world()
    w.do({ type: 'rule/add', text: 'Anything about visas is Legal.' })
    const id = w.s.houseRules[0].id
    w.do({ type: 'rule/update', id, text: 'Anything about visas or forms is Legal.' })
    expect(w.s.houseRules[0].text).toContain('forms')
    w.do({ type: 'rule/delete', id })
    expect(w.s.houseRules).toHaveLength(0)
  })
})

describe('an unsure clerk', () => {
  it('keeps its guess and its doubt until the user moves or confirms the entry', () => {
    const w = world()
    const car = w.ledger('CAR')
    w.do({ type: 'entry/capture', text: 'oct 26 on page', filing: { title: 'oct 26 on page', ledgerId: car.id, estimateMin: null, log: 'x', model: 'test', confidence: 'unsure' } })
    const e = w.entry('oct 26 on page')
    expect(e.ledgerId).toBe(car.id)
    expect(e.clerkFiled?.confidence).toBe('unsure')
    w.do({ type: 'entry/confirm', id: e.id })
    expect(w.entry('oct 26 on page').clerkFiled?.confidence).toBe('sure')
    expect(w.s.houseRules).toHaveLength(0)
  })
})

describe('explaining to the clerk', () => {
  it('a move raises the question and the answer lands in the learned rule', () => {
    const w = world()
    const car = w.ledger('CAR'), dnc = w.ledger('DNC')
    w.do({ type: 'entry/capture', text: 'on page sprint review', filing: { title: 'on page sprint review', ledgerId: dnc.id, estimateMin: null, log: 'x', model: 'test' } })
    const e = w.entry('on page sprint review')
    const r = w.do({ type: 'entry/update', id: e.id, patch: { ledgerId: car.id } })
    const q = r.events.find((x) => x.type === 'clerk-wonders')
    expect(q && q.type === 'clerk-wonders' && q.reason).toBe('moved')
    w.do({ type: 'rule/explain', entryId: e.id, ruleId: q && q.type === 'clerk-wonders' ? q.ruleId : null, text: 'On Page is the company I work for.' })
    expect(w.s.houseRules[0].text).toBe('Entries like "on page sprint review" go to Career, not Dance. On Page is the company I work for.')
  })

  it('a confirmation with an answer writes a new rule', () => {
    const w = world()
    const lgl = w.ledger('LGL')
    w.do({ type: 'entry/capture', text: 'oct 26 on page', filing: { title: 'oct 26 on page', ledgerId: lgl.id, estimateMin: null, log: 'x', model: 'test', confidence: 'unsure' } })
    const e = w.entry('oct 26 on page')
    const r = w.do({ type: 'entry/confirm', id: e.id })
    expect(r.events.some((x) => x.type === 'clerk-wonders' && x.reason === 'confirmed')).toBe(true)
    w.do({ type: 'rule/explain', entryId: e.id, ruleId: null, text: 'the contract deadline' })
    expect(w.s.houseRules[0].text).toBe('"oct 26 on page" belongs in Legal: the contract deadline')
  })
})

describe('the couch', () => {
  function rich() {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('CAR').id })
    w.wait(3 * 25 * MIN + 10 * MIN + 5000)
    w.do({ type: 'desk/standDown' })
    return w
  }

  it('one token buys one leisure block of the focus length, rests are free, nothing is earned', () => {
    const w = rich()
    const before = balance(w.s)
    expect(before).toBe(3)
    w.do({ type: 'leisure/add', title: 'civilization 6' })
    const civ = w.s.leisure[0]
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId: civ.id })
    expect(w.s.desk.block?.kind).toBe('leisure')
    expect(w.s.desk.block?.durationMs).toBe(25 * MIN)
    expect(balance(w.s)).toBe(before - 1)
    w.wait(25 * MIN + 1000)
    expect(w.s.desk.block?.kind).toBe('rest')
    expect(balance(w.s)).toBe(before - 1)
    w.wait(5 * MIN + 1000)
    expect(w.s.desk.block?.kind).toBe('leisure')
    expect(balance(w.s)).toBe(before - 2)
    const tomatoes = w.s.tokens.filter((t) => t.reason === 'tomato').length
    w.do({ type: 'desk/standDown' })
    expect(w.s.tokens.filter((t) => t.reason === 'tomato').length).toBe(tomatoes)
    expect(balance(w.s)).toBe(before - 2)
    expect(w.s.desk.status).toBe('idle')
  })

  it('the couch ends on its own when the tokens run out', () => {
    const w = rich()
    w.do({ type: 'leisure/add', title: 'young sheldon' })
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId: w.s.leisure[0].id })
    w.wait(3 * 25 * MIN + 2 * 5 * MIN + 15 * MIN + 5000)
    expect(balance(w.s)).toBe(0)
    expect(w.s.desk.status).toBe('idle')
  })

  it('cannot be started with no tokens', () => {
    const w = world()
    w.do({ type: 'leisure/add', title: 'slay the spire 2' })
    const r = w.do({ type: 'desk/deploy', mode: 'couch', leisureId: w.s.leisure[0].id })
    expect(w.s.desk.status).toBe('idle')
    expect(r.events.some((e) => e.type === 'notice' && e.text.startsWith('No tokens'))).toBe(true)
  })

  it('the clerk sends entertainment to the couch list, not the flow', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'play civilization 6', filing: { title: 'play civilization 6', ledgerId: null, estimateMin: null, log: 'x', model: 'test', leisure: true } })
    expect(w.s.entries.map((e) => e.title)).not.toContain('play civilization 6')
    expect(w.s.leisure.map((x) => x.title)).toContain('play civilization 6')
    w.do({ type: 'entry/capture', text: 'stream watch 2026' })
    const e = w.entry('stream watch 2026')
    w.do({ type: 'entry/toLeisure', id: e.id })
    expect(w.s.entries.some((x) => x.id === e.id)).toBe(false)
    expect(w.s.leisure.map((x) => x.title)).toContain('stream watch 2026')
  })
})
