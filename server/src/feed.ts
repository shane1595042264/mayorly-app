import ical, { ICalCalendarMethod, ICalEventStatus } from 'ical-generator'

// The plan as a calendar Google can subscribe to. The server knows no rules of the product;
// it reads the account's document as data: the planner's blocks and the events made in
// Mayorly, by the user or the clerk. Outside events came from Google and are not sent back.
// Every UID is stable (a block keeps its id across a move) and SEQUENCE is the reducer's, so a
// subscriber updates the entry in place instead of growing a duplicate.

interface Block { id: string; entryId: string; chunk: number; of: number; late: boolean; seq: number; start: number; end: number }
interface Event { id: string; title: string; origin: string; start: number; end: number; seq: number; note?: string }
interface Entry { id: string; title: string; ledgerId: string | null }
interface Ledger { id: string; title: string }
interface Doc { entries?: Entry[]; ledgers?: Ledger[]; calendar?: { blocks?: Block[]; events?: Event[] } }

/** Events that ended longer ago than this are left out; a feed is the plan, not the record. */
const KEEP_PAST_MS = 30 * 86_400_000
/** How often a subscriber is asked to read again (Google follows its own clock anyway). */
const TTL_SECONDS = 15 * 60

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '')

export function buildFeed(doc: unknown, now: Date): string {
  const d = (doc && typeof doc === 'object' ? doc : {}) as Doc
  const entries = new Map<string, Entry>()
  for (const e of Array.isArray(d.entries) ? d.entries : []) if (e && typeof e.id === 'string') entries.set(e.id, e)
  const ledgers = new Map<string, Ledger>()
  for (const l of Array.isArray(d.ledgers) ? d.ledgers : []) if (l && typeof l.id === 'string') ledgers.set(l.id, l)
  const floor = now.getTime() - KEEP_PAST_MS

  const cal = ical({
    name: 'Mayorly',
    prodId: { company: 'Mayorly', product: 'Mayorly', language: 'EN' },
    method: ICalCalendarMethod.PUBLISH,
    ttl: TTL_SECONDS,
  })

  for (const b of Array.isArray(d.calendar?.blocks) ? d.calendar.blocks : []) {
    if (!b || typeof b.id !== 'string' || !num(b.start) || !num(b.end) || b.end <= b.start || b.end < floor) continue
    const entry = entries.get(b.entryId)
    const title = str(entry?.title) || 'Planned work'
    const ledger = entry?.ledgerId ? ledgers.get(entry.ledgerId) : undefined
    const part = num(b.of) && b.of > 1 ? ` (${b.chunk} of ${b.of})` : ''
    const lines = ['Planned by Mayorly.']
    if (ledger) lines.push(`Ledger: ${str(ledger.title, 120)}`)
    if (b.late) lines.push('Ends after the due.')
    cal.createEvent({
      id: `${b.id}@mayorly`,
      start: new Date(b.start),
      end: new Date(b.end),
      summary: `${title}${part}`,
      description: lines.join('\n'),
      sequence: num(b.seq) ? b.seq : 0,
      status: ICalEventStatus.TENTATIVE,
      stamp: now,
    })
  }

  for (const ev of Array.isArray(d.calendar?.events) ? d.calendar.events : []) {
    if (!ev || typeof ev.id !== 'string' || !num(ev.start) || !num(ev.end) || ev.end <= ev.start || ev.end < floor) continue
    const by = ev.origin === 'clerk' ? 'Made by the Mayorly clerk.' : 'Made in Mayorly.'
    const note = str(ev.note, 2000)
    cal.createEvent({
      id: `${ev.id}@mayorly`,
      start: new Date(ev.start),
      end: new Date(ev.end),
      summary: str(ev.title, 200) || 'Event',
      description: note ? `${note}\n\n${by}` : by,
      sequence: num(ev.seq) ? ev.seq : 0,
      status: ICalEventStatus.CONFIRMED,
      stamp: now,
    })
  }

  return cal.toString()
}
