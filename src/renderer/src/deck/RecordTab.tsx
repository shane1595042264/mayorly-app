import { useState } from 'react'
import { balance, dayStats, lastDays, span, startOfDay, type MayorlyState } from '@core/index'
import { useNow } from '../store'

// What the desk recorded. One measure (focus time), so one colour: neutral ink,
// with today picked out in the accent. Numbers wear text colours, never the bar's.

export function RecordTab({ s }: { s: MayorlyState }) {
  const now = useNow(5000)
  const today = dayStats(s, startOfDay(now), now)
  const week = lastDays(s, now, 7)
  const weekMax = Math.max(1, ...week.map((d) => d.focusMs))
  const ledgerMax = Math.max(1, ...today.byLedger.map((b) => b.focusMs))
  const [hover, setHover] = useState<number | null>(null)
  const weekTotal = week.reduce((n, d) => n + d.focusMs, 0)

  return (
    <div className="record">
      <section className="tiles" aria-label="Today">
        <Tile big={span(today.focusMs)} label="Focus today" />
        <Tile big={String(today.tomatoes)} label={today.tomatoes === 1 ? 'Tomato' : 'Tomatoes'} />
        <Tile big={`+${today.tokens}`} label="Tokens earned" />
        <Tile big={String(today.cleared)} label="Entries cleared" />
        <Tile big={balance(s).toLocaleString()} label="Balance" />
      </section>

      <section className="rec-ledgers">
        <h3 className="side-title caps">By ledger, today</h3>
        {today.byLedger.length === 0 ? (
          <p className="dim small">No desk time yet today.</p>
        ) : (
          <ol className="barlist">
            {today.byLedger.map((b) => {
              const l = s.ledgers.find((x) => x.id === b.ledgerId)
              return (
                <li key={b.ledgerId ?? 'free'} title={`${l?.name ?? 'Free focus'}  ${span(b.focusMs)}`}>
                  <span className="mono">{l?.code ?? 'FREE'}</span>
                  <span className="barlist-track">
                    <i style={{ width: `${(b.focusMs / ledgerMax) * 100}%` }} />
                  </span>
                  <span className="mono num">{span(b.focusMs)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section className="rec-week">
        <h3 className="side-title caps">Last 7 days</h3>
        <div className="cols" onMouseLeave={() => setHover(null)}>
          {week.map((d, i) => {
            const isToday = i === week.length - 1
            const label = new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' })
            return (
              <div key={d.day} className="col" onMouseEnter={() => setHover(i)}>
                <span className="col-plot">
                  {hover === i && (
                    <span className="tip mono num">
                      {new Date(d.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}  {span(d.focusMs)}
                    </span>
                  )}
                  <i className={isToday ? 'today' : ''} style={{ height: `${(d.focusMs / weekMax) * 92}%` }} />
                </span>
                <span className={`col-label caps ${isToday ? '' : 'dim'}`}>{label}</span>
              </div>
            )
          })}
        </div>
        <p className="mono num dim small">{span(weekTotal)} this week</p>
        <table className="sr-only">
          <caption>Focus time, last 7 days</caption>
          <tbody>
            {week.map((d) => (
              <tr key={d.day}>
                <th scope="row">{new Date(d.day).toDateString()}</th>
                <td>{span(d.focusMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rec-log">
        <h3 className="side-title caps">Clerk log</h3>
        <ol className="log mono">
          {s.clerkLog.slice(-14).reverse().map((line, i) => (
            <li key={`${line.at}-${i}`}>
              <span className="dim">{new Date(line.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function Tile({ big, label }: { big: string; label: string }) {
  return (
    <div className="tile">
      <span className="tile-big num">{big}</span>
      <span className="tile-label caps">{label}</span>
    </div>
  )
}
