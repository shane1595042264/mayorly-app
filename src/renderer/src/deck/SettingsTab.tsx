import { useEffect, useState } from 'react'
import { ArrowsClockwise, GoogleLogo, Keyboard, Plus, Trash } from '@phosphor-icons/react'
import { TEXT_MAX, TEXT_MIN, type MayorlyState, type Settings } from '@core/index'
import type { AiProvider, AppInfo } from '../../../shared/bridge'
import { builtOn } from '../../../shared/build'
import { bridge } from '../bridge'
import { hotkeyLabel, IS_MAC } from '../lib/keys'
import { GLOBAL_ACTIONS } from '../lib/keymap'
import { dispatch, useAccount, useAi, useNow, useSyncStatus } from '../store'

const EXAMPLE = IS_MAC ? 'Option+T' : 'Alt+T'
/** Electron's accelerator grammar, every modifier spelling it accepts, one key. */
const ACCELERATOR = /^((Ctrl|Control|Alt|Option|AltGr|Shift|Super|Meta|Cmd|Command|CmdOrCtrl|CommandOrControl)\+)+([A-Z0-9]|F\d{1,2}|Space|Tab|`)$/i
/** Stored accelerators keep Electron's cross-platform spelling: Option is Alt. */
const normalise = (v: string) => v.trim().replace(/\bOption\b/gi, 'Alt')


export function SettingsTab({ s, kind, openKeymap, openNotes }: { s: MayorlyState; kind: 'electron' | 'web'; openKeymap: () => void; openNotes: () => void }) {
  const st = s.settings
  const set = (patch: Partial<Settings>) => dispatch({ type: 'settings/update', patch })

  return (
    <div className="settings">
      <section>
        <h3 className="side-title caps">Desk</h3>
        <div className="rules">
          <Num label="Focus" help="minutes, and the tomato length" value={st.focusMin} min={1} max={180} onChange={(focusMin) => set({ focusMin })} />
          <Num label="Rest" help="minutes" value={st.shortRestMin} min={0} max={60} onChange={(shortRestMin) => set({ shortRestMin })} />
          <Num label="Long rest" help="minutes" value={st.longRestMin} min={0} max={120} onChange={(longRestMin) => set({ longRestMin })} />
          <Num label="Long rest every" help="focus blocks" value={st.longRestEvery} min={1} max={12} onChange={(longRestEvery) => set({ longRestEvery })} />
        </div>
        <div className="checks">
          <Check label="Start the next focus block on its own" value={st.autoStartFocus} onChange={(autoStartFocus) => set({ autoStartFocus })} />
          <Check label="Start rests on their own" value={st.autoStartRest} onChange={(autoStartRest) => set({ autoStartRest })} />
          <Check label="Sound cues" value={st.sound} onChange={(sound) => set({ sound })} />
          {kind === 'electron' && <Check label="Open at login" value={st.openAtLogin} onChange={(openAtLogin) => set({ openAtLogin })} />}
          {kind === 'electron' && IS_MAC && <Check label="Timer beside the menu bar tomato" value={st.trayTimer} onChange={(trayTimer) => set({ trayTimer })} />}
        </div>
      </section>

      <section>
        <h3 className="side-title caps">HUD</h3>
        <div className="rules">
          <div className="field">
            <span className="field-label caps">Side</span>
            <div className="seg" role="radiogroup" aria-label="HUD side">
              {(['left', 'right'] as const).map((v) => (
                <button key={v} role="radio" aria-checked={st.hudSide === v} className={st.hudSide === v ? 'on' : ''} onClick={() => set({ hudSide: v })}>
                  {v === 'left' ? 'Left' : 'Right'}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label caps">Scale</span>
            <input type="range" min={0.7} max={1.6} step={0.05} value={st.hudScale} onChange={(e) => set({ hudScale: Number(e.target.value) })} />
            <span className="field-help mono num">{Math.round(st.hudScale * 100)}%</span>
          </label>
        </div>
        <h4 className="field-label caps" style={{ marginTop: 18 }}>Text size</h4>
        <p className="field-help">Per area, on this machine. The pet grows with its task line.</p>
        <div className="rules">
          <TextSize label="Pet" value={st.text.pet} onChange={(pet) => set({ text: { ...st.text, pet } })} />
          <TextSize label="Deck" value={st.text.deck} onChange={(deck) => set({ text: { ...st.text, deck } })} />
          <TextSize label="Swap menu" value={st.text.plus} onChange={(plus) => set({ text: { ...st.text, plus } })} />
        </div>
      </section>

      <CalendarSection s={s} />

      {kind === 'electron' && <AccountSection />}
      {kind === 'electron' && <AiSection />}
      <DataSection kind={kind} openNotes={openNotes} />
      <HouseRulesSection s={s} />

      <section>
        <div className="section-head">
          <h3 className="side-title caps">Hotkeys</h3>
          <button type="button" className="btn" onClick={openKeymap} title="Every key in the app, and the ones you changed (? in the deck)">
            <Keyboard size={14} /> Keymap
          </button>
        </div>
        <p className="field-help">
          Global, they work from any app. Use a modifier combo such as {EXAMPLE} or Ctrl+Shift+Space.
          {IS_MAC && ' Option combos replace the characters they would type while Mayorly runs.'}
        </p>
        <div className="hotkeys">
          {GLOBAL_ACTIONS.map(([action, label]) => (
            <HotkeyField key={action} label={label} value={st.hotkeys[action]} onCommit={(v) => set({ hotkeys: { ...st.hotkeys, [action]: v } })} />
          ))}
        </div>
      </section>
    </div>
  )
}

function AccountSection() {
  const account = useAccount()
  const sync = useSyncStatus()
  const now = useNow(10_000)
  const [available, setAvailable] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => void bridge.accountsAvailable().then(setAvailable), [])
  const remove = async () => {
    if (!confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    setError(null)
    try {
      await bridge.deleteAccount()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error: /, '') : String(e))
    }
  }

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await bridge.signIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  let line = ''
  if (sync.phase === 'syncing') line = 'Syncing'
  else if (sync.phase === 'error') line = sync.message ?? 'Sync failed'
  else if (sync.phase === 'idle' && sync.at) {
    const m = Math.round((now - sync.at) / 60_000)
    line = m < 1 ? 'Synced just now' : `Synced ${m} min ago`
  }

  return (
    <section>
      <h3 className="side-title caps">Account</h3>
      {!available ? (
        <p className="field-help">This build has no sync server configured.</p>
      ) : account ? (
        <div className="account">
          <div className="account-who">
            <span>{account.name ?? account.email}</span>
            {account.name && <span className="field-help">{account.email}</span>}
          </div>
          <span className={`field-help ${sync.phase === 'error' ? 'field-error' : ''}`}>{line}</span>
          <div className="form-actions">
            <button className="btn ghost" onClick={() => void bridge.signOut()}>Sign out</button>
            <button className="btn ghost" title="Every signed-in machine, this one included" onClick={() => void bridge.signOutEverywhere().catch((e) => setError(e instanceof Error ? e.message : String(e)))}>Sign out everywhere</button>
            <button className={`btn ghost ${confirm ? 'warn' : ''}`} onClick={() => void remove()} onBlur={() => setConfirm(false)}>
              {confirm ? 'Confirm: delete the account and its copy on the server' : 'Delete account'}
            </button>
          </div>
          {error && <span className="field-error">{error}</span>}
          <p className="field-help">Deleting removes the account and the synced document from the server. This machine keeps its own copy.</p>
        </div>
      ) : (
        <div className="account">
          <p className="field-help">Keeps your ledgers, entries and record on the server, and the same on every machine you sign in on.</p>
          <button className="btn primary" onClick={() => void signIn()} disabled={busy}>
            <GoogleLogo size={16} weight="bold" aria-hidden />
            {busy ? 'Waiting for the browser' : 'Sign in with Google'}
          </button>
          {error && <span className="field-error">{error}</span>}
        </div>
      )}
    </section>
  )
}

/** Where the data is, a way out and a way back in, and which build this is. */
function DataSection({ kind, openNotes }: { kind: 'electron' | 'web'; openNotes: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => void bridge.getInfo().then(setInfo), [])
  return (
    <section>
      <h3 className="side-title caps">Your data</h3>
      <p className="field-help">
        {kind === 'electron'
          ? `One file on this machine${info ? `, in ${info.dataDir}` : ''}, with a copy a day in backups beside it. Export writes the same JSON anywhere; import replaces what is here, after another copy to backups.`
          : 'In this browser. Export downloads it as JSON.'}
      </p>
      <div className="form-actions">
        <button className="btn" onClick={() => void bridge.exportState().then((p) => setMsg(p ? `Exported to ${p}` : null))}>Export</button>
        {kind === 'electron' && <button className="btn ghost" onClick={() => void bridge.importState().then((r) => setMsg(r.message || null))}>Import</button>}
      </div>
      {msg && <p className="field-help">{msg}</p>}
      {info && (
        <p className="field-help build-line">
          <span className="mono num">Mayorly {info.version}{info.arch ? `  ${info.arch}` : ''}  build {info.commit}  built {builtOn(info)}</span>
          <button type="button" className="btn ghost" onClick={openNotes}>What changed</button>
        </p>
      )}
    </section>
  )
}

/**
 * Bring your own key, the shanejli.com way: paste a key, the provider is read off
 * its shape, its models are listed and the cheapest one is made to answer once.
 * The clerk then files every captured line with the cheapest model, or the one
 * you pick. Keys stay on this machine, sealed with the OS keychain.
 */
function AiSection() {
  const ai = useAi()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^Error: /, '').replace(/^[a-z_]+: /, ''))
      return false
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    if (!key.trim()) return
    if (await run('add', () => bridge.ai.addKey(key))) setKey('')
  }

  const dollars = (micro: number) => (micro < 10_000 ? `$${(micro / 1_000_000).toFixed(4)}` : `$${(micro / 1_000_000).toFixed(2)}`)
  const working = ai.keys.filter((k) => k.status === 'ok')

  return (
    <section>
      <h3 className="side-title caps">AI clerk</h3>
      <p className="field-help">
        Bring your own key. Paste it and the provider is read from the key itself; the cheapest text model that answers is chosen.
        The clerk then files whatever you capture: it picks the ledger from your criteria, trims the title and reads the estimate.
        Keys stay on this machine. Without one, the clerk files by prefix and tag only.
      </p>

      {ai.keys.map((k) => (
        <div key={k.id} className={`ai-key ${k.status}`}>
          <div className="ai-key-head">
            <span className="caps">{ai.providers[k.provider]}</span>
            <span className="mono dim">…{k.keyHint}</span>
            <span className={`ai-status caps ${k.status}`}>{k.status === 'ok' ? 'working' : 'failing'}</span>
            <span className="ai-key-actions">
              <button className="icon-btn" title="Check the key again" aria-label="Check again" disabled={busy !== null} onClick={() => void run(k.id, () => bridge.ai.recheckKey(k.id))}>
                <ArrowsClockwise size={14} />
              </button>
              <button className="icon-btn" title="Remove this key" aria-label="Remove" disabled={busy !== null} onClick={() => void run(k.id, () => bridge.ai.removeKey(k.id))}>
                <Trash size={14} />
              </button>
            </span>
          </div>
          {k.status === 'failing' && k.lastError && <span className="field-error">{k.lastError}</span>}
          <label className="field">
            <span className="field-label caps">Model</span>
            <select value={k.preferredModel ?? ''} onChange={(e) => void bridge.ai.setPreferredModel(k.id, e.target.value || null)}>
              <option value="">Cheapest that answered ({k.defaultModel})</option>
              {k.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
      ))}

      {working.length > 1 && (
        <label className="field">
          <span className="field-label caps">Prefer</span>
          <select value={ai.preferredProvider ?? ''} onChange={(e) => void bridge.ai.setPreferredProvider((e.target.value || null) as AiProvider | null)}>
            <option value="">First working key</option>
            {working.map((k) => <option key={k.provider} value={k.provider}>{ai.providers[k.provider]}</option>)}
          </select>
        </label>
      )}

      <div className="ai-add">
        <input
          className="mono"
          type="password"
          placeholder="Paste an API key: sk-ant-..., sk-..., AIza..., xai-..."
          value={key}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          disabled={busy === 'add'}
        />
        <button className="btn primary" onClick={() => void add()} disabled={busy !== null || !key.trim()}>
          {busy === 'add' ? 'Checking' : 'Add key'}
        </button>
      </div>
      {busy === 'add' && <span className="field-help">Listing the key's models, then one tiny request to the cheapest.</span>}
      {error && <span className="field-error">{error}</span>}
      {ai.usage.calls > 0 && (
        <span className="field-help">Last {ai.usage.days} days: {ai.usage.calls} filed by the clerk, about {dollars(ai.usage.costMicroUsd)}.</span>
      )}
    </section>
  )
}

/**
 * The clerk's standing instructions. Most are learned: move an entry the clerk
 * filed, and the correction is written here as a rule, with the ledger it chose
 * and the one you chose. Edit the wording, add your own, remove what no longer holds.
 */
function HouseRulesSection({ s }: { s: MayorlyState }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    if (!draft.trim()) return
    dispatch({ type: 'rule/add', text: draft })
    setDraft('')
  }
  return (
    <section>
      <h3 className="side-title caps">House rules</h3>
      <p className="field-help">
        What the clerk reads before every filing, ahead of the ledger criteria. When you move an entry the clerk filed, the correction is written here on its own.
      </p>
      {s.houseRules.length === 0 && <p className="field-help">No rules yet. Correct the clerk once, or write one below.</p>}
      <div className="rules-list">
        {s.houseRules.map((r) => <HouseRuleRow key={r.id} id={r.id} text={r.text} learned={!!r.learnedFrom} />)}
      </div>
      <div className="ai-add">
        <input
          value={draft}
          placeholder='Anything about visas or forms goes to Legal.'
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add} disabled={!draft.trim()}><Plus size={14} /> Add rule</button>
      </div>
    </section>
  )
}

function HouseRuleRow({ id, text, learned }: { id: string; text: string; learned: boolean }) {
  const [v, setV] = useState(text)
  useEffect(() => setV(text), [text])
  return (
    <div className="rule-row">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() && v !== text && dispatch({ type: 'rule/update', id, text: v })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="House rule"
      />
      {learned && <span className="ai-status caps" title="Learned from a correction">learned</span>}
      <button className="icon-btn" aria-label="Remove rule" title="Remove" onClick={() => dispatch({ type: 'rule/delete', id })}><Trash size={14} /></button>
    </div>
  )
}

function HotkeyField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  const valid = ACCELERATOR.test(v)
  const reads = hotkeyLabel(normalise(v))
  return (
    <label className="field">
      <span className="field-label caps">{label}</span>
      <input
        className={`mono ${valid ? '' : 'invalid'}`}
        value={v}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (!valid) return setV(value)
          const next = normalise(v)
          setV(next)
          if (next !== value) onCommit(next)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {!valid && <span className="field-error">Needs a modifier and one key, like {EXAMPLE}</span>}
      {valid && reads !== v && <span className="field-help">{reads}</span>}
    </label>
  )
}

/**
 * Typed freely, clamped on commit. Clamping on every keystroke turned "1" then "4"
 * into "14" then the maximum, so a value could never be replaced by typing.
 */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN
}

/** Work hours and the planner's knobs. One window a day here; the reducer keeps any extra ones a request added. */
function CalendarSection({ s }: { s: MayorlyState }) {
  const c = s.settings.calendar
  const set = (patch: Partial<typeof c>) => dispatch({ type: 'settings/update', patch: { calendar: { ...c, ...patch } } })
  const setDay = (d: number, w: { start: number; end: number } | null) => {
    const hours = c.hours.map((list, i) => (i === d ? (w ? [w, ...list.slice(1)] : []) : list))
    set({ hours })
  }
  return (
    <section>
      <h3 className="side-title caps">Calendar</h3>
      <p className="field-help">The planner places entries with an estimate into these hours, earliest due first, in the order of the flow. Hours are kept in {c.tz || 'this machine\'s zone'} and sync with the account.</p>
      <div className="hours-grid">
        {DAY_NAMES.map((name, d) => {
          const w = c.hours[d]?.[0]
          return (
            <div key={name} className="hours-row">
              <label className="check">
                <input type="checkbox" checked={!!w} onChange={(e) => setDay(d, e.target.checked ? { start: 9 * 60, end: 17 * 60 } : null)} />
                <span className="check-box" aria-hidden />
                <span className="hours-day caps">{name}</span>
              </label>
              {w ? (
                <>
                  <input type="time" value={hhmm(w.start)} onChange={(e) => { const m = minutesOf(e.target.value); if (Number.isFinite(m)) setDay(d, { start: m, end: Math.max(m + 15, w.end) }) }} aria-label={`${name} start`} />
                  <span className="dim">to</span>
                  <input type="time" value={hhmm(w.end)} onChange={(e) => { const m = minutesOf(e.target.value); if (Number.isFinite(m)) setDay(d, { start: Math.min(w.start, m - 15), end: m }) }} aria-label={`${name} end`} />
                </>
              ) : (
                <span className="dim">off</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="rules" style={{ marginTop: 14 }}>
        <Num label="Break" help="minutes after each block" value={c.breakMin} min={0} max={60} onChange={(breakMin) => set({ breakMin })} />
        <Num label="Smallest chunk" help="minutes; a tomato is 25" value={c.minChunkMin} min={5} max={240} onChange={(minChunkMin) => set({ minChunkMin })} />
        <Num label="Horizon" help="days ahead the planner looks" value={c.horizonDays} min={7} max={28} onChange={(horizonDays) => set({ horizonDays })} />
      </div>
      <div className="rules">
        <label className="check" title="On, work keeps being placed past its due and is marked late. Off, nothing is placed past a due and the rest is reported as no room.">
          <input type="checkbox" checked={c.spill} onChange={(e) => set({ spill: e.target.checked })} />
          <span className="check-box" aria-hidden />
          <span>Keep placing past a due, marked late</span>
        </label>
      </div>
      <OutsideCalendars s={s} />
    </section>
  )
}

/** Google calendars read as busy time, through their secret iCal address. */
function OutsideCalendars({ s }: { s: MayorlyState }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [titles, setTitles] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const feeds = s.calendar.feeds
  const add = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await bridge.calendar.addSource(url, label, titles)
      setMsg(r.message)
      if (r.ok) {
        setUrl('')
        setLabel('')
      }
    } finally {
      setBusy(false)
    }
  }
  const fmt = (t: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t)
  return (
    <div className="sources">
      <h4 className="field-label caps" style={{ marginTop: 18 }}>Outside calendars</h4>
      <p className="field-help">Your Google calendar, read as busy time so the planner routes around it. In Google Calendar, Settings, your calendar, copy the secret address in iCal format. The address stays on this machine; the events go into your account, with their titles unless you keep them out.</p>
      {feeds.map((f) => (
        <div key={f.id} className="source-row">
          <span className="source-label">{f.label}</span>
          <span className="field-help">{f.error ? f.error : f.lastFetchedAt ? `${s.calendar.external.filter((x) => x.feedId === f.id).length} events, read ${fmt(f.lastFetchedAt)}` : 'not read yet'}</span>
          <label className="check" title="Keep the event titles in your account, or only Busy">
            <input type="checkbox" checked={f.titles} onChange={(e) => dispatch({ type: 'calendar/feed-update', id: f.id, patch: { titles: e.target.checked } })} />
            <span className="check-box" aria-hidden />
            <span>Titles</span>
          </label>
          <button type="button" className="btn ghost" onClick={() => void bridge.calendar.refreshSources()}>Refresh</button>
          <button type="button" className="btn ghost" onClick={() => void bridge.calendar.removeSource(f.id)}>Remove</button>
        </div>
      ))}
      <div className="form-row source-add">
        <label className="field grow"><span className="field-label caps">Secret address</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/.../private-.../basic.ics" spellCheck={false} /></label>
        <label className="field"><span className="field-label caps">Name</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Google" maxLength={60} /></label>
      </div>
      <div className="form-actions">
        <label className="check"><input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} /><span className="check-box" aria-hidden /><span>Keep titles</span></label>
        <button type="button" className="btn" disabled={busy || !url.trim()} onClick={() => void add()}>{busy ? 'Reading' : 'Add calendar'}</button>
        {msg && <span className="field-help">{msg}</span>}
      </div>
    </div>
  )
}

function TextSize({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span className="field-label caps">{label}</span>
      <input type="range" min={TEXT_MIN} max={TEXT_MAX} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="field-help mono num">{Math.round(value * 100)}%</span>
    </label>
  )
}

function Num({ label, help, value, min, max, onChange }: { label: string; help: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const commit = () => {
    setEditing(false)
    const n = Math.min(max, Math.max(min, Math.round(Number(text)) || min))
    setText(String(n))
    if (n !== value) onChange(n)
  }
  return (
    <label className="field">
      <span className="field-label caps">{label}</span>
      <input
        className="mono num"
        type="number"
        min={min}
        max={max}
        value={editing ? text : String(value)}
        onFocus={(e) => {
          setText(String(value))
          setEditing(true)
          e.target.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="field-help">{help}</span>
    </label>
  )
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden />
      <span>{label}</span>
    </label>
  )
}
