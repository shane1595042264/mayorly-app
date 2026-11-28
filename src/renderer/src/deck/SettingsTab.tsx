import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ArrowsClockwise, ArrowsLeftRight, CalendarBlank, GoogleLogo, Keyboard, Play, Plus, Robot, SpeakerHigh, TextAa, Timer, Trash, UploadSimple, UserCircle, type Icon } from '@phosphor-icons/react'
import { ALARM_TONES, DEFAULT_HOTKEYS, LEDGER_CAP, TEXT_MAX, TEXT_MIN, type AlarmKind, type AlarmTone, type ClerkSettings, type MayorlyState, type Recipe, type HotkeyAction, type Settings, type ClerkAllow, type AutoSwitchRules, type ImpactMoment, type ImpactSettings, type ImpactStyle } from '@core/index'
import type { AiKeySync, AiProvider, AiPublic, AppInfo } from '../../../shared/bridge'
import { DEFAULT_THRESHOLD, TRIALS } from '../../../shared/ai/tuning'
import { builtOn } from '../../../shared/build'
import { bridge } from '../bridge'
import { acceleratorOf, hotkeyLabel, hotkeyRefusal, IS_MAC, MODIFIER_KEYS, modifiersOf } from '../lib/keys'
import { actionFor, GLOBAL_ACTIONS, keymapOpen } from '../lib/keymap'
import { current, dispatch, useAccount, useAi, useNow, useSyncStatus } from '../store'
import { decodeAlarm, playAlarm, sfx } from '../lib/sound'
import { IMPACT_MOMENTS, IMPACT_STYLES } from '../../../shared/impact'
import { ArtIcon } from '../lib/Pixel'
import type { ArtId } from '../lib/art'
import { SoundSearch } from './SoundSearch'
import { HoursFields, PLAN_HELP, PlanFields, SessionFields, WorkFields } from './PlanSettings'
import { dayKey } from '../../../shared/windows'
import { SettingsSearch } from '../lib/settingsSearch'
import { tip } from '../lib/tips'

const EXAMPLE = IS_MAC ? 'Option+T' : 'Alt+T'

type AreaId = 'timer' | 'switch' | 'sound' | 'pet' | 'calendar' | 'clerk' | 'keys' | 'account'

/**
 * Settings is one view per area, picked from the rail, so a section is never lost in a long page.
 * A rail icon the founder has drawn (`art`) shows in place of the Phosphor one.
 */
const AREAS: { id: AreaId; label: string; icon: Icon; art?: ArtId; electron?: boolean }[] = [
  { id: 'timer', label: 'Timer', icon: Timer, art: 'icon.tomato' },
  { id: 'switch', label: 'Auto switch', icon: ArrowsLeftRight, electron: true },
  { id: 'sound', label: 'Sound and impact', icon: SpeakerHigh },
  { id: 'pet', label: 'Pet and text', icon: TextAa },
  { id: 'calendar', label: 'Calendar', icon: CalendarBlank },
  { id: 'clerk', label: 'Clerk', icon: Robot, art: 'icon.clerk' },
  { id: 'keys', label: 'Hotkeys', icon: Keyboard },
  { id: 'account', label: 'Account and data', icon: UserCircle },
]

/** The area last open, kept while the app runs, so the deck comes back to it. */
let lastArea: AreaId = 'timer'

export function SettingsTab({ s, kind, openKeymap, openNotes }: { s: MayorlyState; kind: 'electron' | 'web'; openKeymap: () => void; openNotes: () => void }) {
  const st = s.settings
  const set = (patch: Partial<Settings>) => dispatch({ type: 'settings/update', patch })
  const page = useRef<HTMLDivElement>(null)
  const areas = AREAS.filter((a) => kind === 'electron' || !a.electron)
  const [area, setArea] = useState<AreaId>(() => (areas.some((a) => a.id === lastArea) ? lastArea : 'timer'))
  useEffect(() => {
    lastArea = area
  }, [area])

  const go = (id: AreaId) => {
    setArea(id)
    page.current?.closest('.deck-body')?.scrollTo({ top: 0 })
  }
  const step = (by: number): AreaId => {
    const i = areas.findIndex((a) => a.id === area)
    const next = areas[Math.min(areas.length - 1, Math.max(0, i + by))].id
    if (next !== area) go(next)
    return next
  }

  // The list keys (j and k unless changed) step through the areas, as they step through a list on
  // the other tabs. Not the arrows: on this tab they scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keymapOpen() || e.altKey || e.ctrlKey || e.metaKey || e.key.startsWith('Arrow')) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      const now = current()
      const action = now ? actionFor(e, 'list', now.settings) : null
      if (action !== 'list.down' && action !== 'list.up') return
      e.preventDefault()
      step(action === 'list.down' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** With the rail focused, the arrows move along it. */
  const onRailKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const id = step(e.key === 'ArrowDown' ? 1 : -1)
    e.currentTarget.querySelector<HTMLElement>(`[data-area-tab="${id}"]`)?.focus()
  }

  /** A search result in another area opens that area before the page scrolls to it. */
  const reveal = (el: HTMLElement) => {
    const id = el.closest<HTMLElement>('[data-area]')?.dataset.area as AreaId | undefined
    if (!id || id === area) return false
    setArea(id)
    return true
  }

  return (
    <div className="settings" ref={page}>
      <div className="settings-layout">
        <nav className="settings-rail" aria-label="Settings" onKeyDown={onRailKey}>
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              data-area-tab={a.id}
              className={`settings-rail-item ${area === a.id ? 'on' : ''}`}
              aria-current={area === a.id ? 'page' : undefined}
              onClick={() => go(a.id)}
              {...tip('list.down', 'step through the areas', 'j k')}
            >
              {a.art ? <ArtIcon id={a.art} size={16} fallback={<a.icon size={17} />} /> : <a.icon size={17} />}
              <span>{a.id === 'account' && kind === 'web' ? 'Your data' : a.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-main">
          <SettingsSearch root={page} placeholder="Search settings, or press /" reveal={reveal} />

          <Area id="timer" title="Timer" open={area}>
            <Row title="Lengths" desc="Minutes in each block, and how often the long rest comes." setting="focus, rest, long rest, pomodoro, minutes, tomato length">
              <div className="rules rules-4">
                <Num label="Focus" help="minutes, and the tomato length" value={st.focusMin} min={1} max={180} onChange={(focusMin) => set({ focusMin })} />
                <Num label="Rest" help="minutes" value={st.shortRestMin} min={0} max={60} onChange={(shortRestMin) => set({ shortRestMin })} />
                <Num label="Long rest" help="minutes" value={st.longRestMin} min={0} max={120} onChange={(longRestMin) => set({ longRestMin })} />
                <Num label="Long rest every" help="focus blocks" value={st.longRestEvery} min={1} max={12} onChange={(longRestEvery) => set({ longRestEvery })} />
              </div>
            </Row>
            <Row title="Starting on its own" desc="Off, a block that ends waits for you to start the next one." setting="auto start, autostart, next block, start rests">
              <div className="checks">
                <Check label="Start the next focus or couch block on its own" value={st.autoStartFocus} onChange={(autoStartFocus) => set({ autoStartFocus })} />
                <Check label="Start rests on their own" value={st.autoStartRest} onChange={(autoStartRest) => set({ autoStartRest })} />
              </div>
            </Row>
          </Area>

          {kind === 'electron' && (
            <Area id="switch" title="Auto switch" lede="Rules that change the task on the desk for you. Each one is kept on this computer only." open={area}>
              <AutoSwitchRows rules={st.autoSwitch} set={(autoSwitch) => set({ autoSwitch })} />
            </Area>
          )}

          <Area id="sound" title="Sound and impact" open={area}>
            <Row title="Sound cues" desc="Every sound off or on, the alarms included: the switch's thud, a task's ding, a tomato." setting="sound, sound cues, switch sound, thud, mute, audio">
              <div className="checks">
                <Check label="Sound cues" value={st.sound} onChange={(sound) => set({ sound })} />
              </div>
            </Row>
            <ImpactRow impact={st.impact} set={(impact) => set({ impact })} />
            <AlarmRows s={s} kind={kind} />
          </Area>

          <Area id="pet" title="Pet and text" open={area}>
            <Row title="Place and size" desc="The bottom corner the pet snaps to, and how big it is. Drag the tomato to put it anywhere else." setting="HUD, side, scale, pet, corner, size">
              <div className="rules">
                <div className="field">
                  <span className="field-label caps">Side</span>
                  <div className="seg" role="radiogroup" aria-label="HUD side">
                    {(['left', 'right'] as const).map((v) => (
                      <button key={v} role="radio" aria-checked={st.hudSide === v} className={st.hudSide === v ? 'on' : ''} onClick={() => bridge.snap(v === 'left' ? 3 : 4)}>
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
            </Row>
            <Row title="Text size" desc="Per area, on this machine. The pet grows with its task line." setting="text size, font, zoom, bigger, smaller">
              <div className="rules rules-3">
                <TextSize label="Pet" value={st.text.pet} onChange={(pet) => set({ text: { ...st.text, pet } })} />
                <TextSize label="Deck" value={st.text.deck} onChange={(deck) => set({ text: { ...st.text, deck } })} />
                <TextSize label="Swap menu" value={st.text.plus} onChange={(plus) => set({ text: { ...st.text, plus } })} />
              </div>
            </Row>
            {kind === 'electron' && (
              <Row title="This computer" desc="Kept on this machine only, never synced." setting="startup, login, launch, menu bar, tray">
                <div className="checks">
                  <Check label="Open at login" value={st.openAtLogin} onChange={(openAtLogin) => set({ openAtLogin })} />
                  {IS_MAC && <Check label="Timer beside the menu bar tomato" value={st.trayTimer} onChange={(trayTimer) => set({ trayTimer })} />}
                </div>
              </Row>
            )}
          </Area>

          <Area id="calendar" title="Calendar" lede="The clerk plans open entries into these hours automatically, from now. What does not fit waits beyond the plan." open={area}>
            <Row title="Work hours" desc={PLAN_HELP.work} setting="work schedule, work hours, job, holidays, day off, work ledgers">
              <WorkFields s={s} />
            </Row>
            <Row title="Your hours" desc={PLAN_HELP.hours(s)} setting="your hours, planner hours, available">
              <HoursFields s={s} />
            </Row>
            <Row title="Sessions" desc={PLAN_HELP.sessions} setting="sessions, session length, shortest, longest">
              <SessionFields s={s} />
            </Row>
            <Row title="How it plans" desc="How far ahead, in what order, and what happens at a due." setting="plan range, horizon, mode, rotate, get it done, late, due">
              <PlanFields s={s} />
            </Row>
            <OutsideCalendars s={s} />
            <PlanFeed />
          </Area>

          <Area id="clerk" title="Clerk" open={area}>
            {kind === 'electron' && <AiRows clerk={st.clerk} setClerk={(p) => set({ clerk: { ...st.clerk, ...p } })} />}
            <HouseRulesRow s={s} />
            <RecipesRow s={s} />
          </Area>

          <Area id="keys" title="Hotkeys" open={area}>
            <Row
              title="Tips"
              desc="Click something a key also does and that key shows, big, in the middle of the screen. In force mode the click does nothing until you press the key."
              setting="tips, force mode, mouse, learn the keys, shortcuts"
            >
              <div className="checks">
                <Check label={`Tips when you click something a key does (${hotkeyLabel(st.hotkeys.tips)})`} value={st.tips.on} onChange={(on) => set({ tips: { ...st.tips, on } })} />
                <Check label={`Force mode: the click waits for the key (${hotkeyLabel(st.hotkeys.tipsForce)})`} value={st.tips.force} onChange={(force) => set({ tips: { ...st.tips, force } })} />
                <Check label="Echo the keys you press, with a combo for keys in a row" value={st.tips.echo} onChange={(echo) => set({ tips: { ...st.tips, echo } })} />
              </div>
            </Row>
            <Row
              title="Global hotkeys"
              desc={<>They work from any app. To change one, click its box and press the new keys, a combo such as {EXAMPLE} or Ctrl+Shift+Space; Esc keeps the old one.{IS_MAC && ' Option combos replace the characters they would type while Mayorly runs.'}</>}
              setting="hotkeys, shortcuts, keys, global"
              aside={
                <button type="button" className="btn" onClick={openKeymap} title="Every key in the app, and the ones you changed (? in the deck)" {...tip('deck.keymap', 'every key in the app')}>
                  <Keyboard size={14} /> Keymap
                </button>
              }
            >
              <div className="hotkeys">
                {GLOBAL_ACTIONS.map(([action, label]) => (
                  <HotkeyField key={action} action={action} label={label} hotkeys={st.hotkeys} onCommit={(v) => set({ hotkeys: { ...st.hotkeys, [action]: v } })} />
                ))}
              </div>
            </Row>
          </Area>

          <Area id="account" title={kind === 'electron' ? 'Account and data' : 'Your data'} open={area}>
            {kind === 'electron' && <AccountRow />}
            <DataRows kind={kind} openNotes={openNotes} />
            {kind === 'electron' && <DeleteAccountRow />}
          </Area>
        </div>
      </div>
    </div>
  )
}

/** One area's view. Every area stays on the page while hidden, so the search finds what is in all of them. */
function Area({ id, title, lede, open, children }: { id: AreaId; title: string; lede?: string; open: AreaId; children: ReactNode }) {
  return (
    <div className="settings-area" data-area={id} hidden={open !== id}>
      <h2 className="settings-area-title">{title}</h2>
      {lede && <p className="settings-area-lede">{lede}</p>}
      {children}
    </div>
  )
}

/**
 * One section: its title and what it is for on the left, its controls in a panel on the right (stacked
 * when the deck is narrow). `setting` is more words for the search to find it by.
 */
function Row({ title, desc, setting, aside, children }: { title: string; desc?: ReactNode; setting?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="setting-row">
      <div className="setting-label">
        <h3 className="side-title" data-setting={setting ? `${title}, ${setting}` : undefined}>{title}</h3>
        {desc && <p className="setting-desc">{desc}</p>}
        {aside}
      </div>
      <div className="setting-panel">{children}</div>
    </section>
  )
}

/** The sound each moment's Try plays with it, so the hit is heard where it lands. */
function cueOf(moment: ImpactMoment) {
  if (moment === 'switch') sfx.switch(true)
  else if (moment === 'done') sfx.clear()
  else if (moment === 'tomato') sfx.tomato()
  else sfx.block()
}

/** How each moment hits the screen: a style per moment, Try beside each, every screen or one, the words or none. */
function ImpactRow({ impact, set }: { impact: ImpactSettings; set: (i: ImpactSettings) => void }) {
  return (
    <Row
      title="Impact"
      desc="How each moment hits the screen. A tsunami rolls out from the tomato, and with every screen on it runs on across your other monitors."
      setting="impact, animation, effect, ripple, tsunami, wave, shockwave, sweep, tide, glow, edges, flash, pulse, shake, words, every screen, monitors"
    >
      <div className="impact-list">
        {IMPACT_MOMENTS.map((m) => {
          const style = impact.styles[m.id]
          return (
            <div className="field impact-row" key={m.id}>
              <label className="field-label caps" htmlFor={`impact-${m.id}`}>{m.label}</label>
              <select id={`impact-${m.id}`} value={style} onChange={(e) => set({ ...impact, styles: { ...impact.styles, [m.id]: e.target.value as ImpactStyle } })}>
                {IMPACT_STYLES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <button className="btn" type="button" disabled={style === 'off'} aria-label={`Try ${m.label}`} onClick={() => { cueOf(m.id); bridge.previewImpact(m.id, style) }}><Play size={14} /> Try</button>
            </div>
          )
        })}
      </div>
      <div className="checks">
        <Check label="On every screen" value={impact.everyScreen} onChange={(everyScreen) => set({ ...impact, everyScreen })} />
        <Check label="Say it big in the middle of the screen: Switched to, Done, Rest" value={impact.words} onChange={(words) => set({ ...impact, words })} />
      </div>
    </Row>
  )
}

function AlarmRows({ s, kind }: { s: MayorlyState; kind: 'electron' | 'web' }) {
  const [busy, setBusy] = useState<AlarmKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const upload = async (alarm: AlarmKind) => {
    setBusy(alarm)
    setError(null)
    try {
      const file = await bridge.alarms.pick()
      if (!file) return
      await decodeAlarm(file.dataUrl)
      await bridge.alarms.save(alarm, file.name, file.dataUrl)
    } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error: /, '') : String(e)) }
    finally { setBusy(null) }
  }
  return (
    <>
      <Row title="Alarms" desc="Work and break sounds on this machine. They play while Sound cues is on; Preview always plays." setting="alarm, sound, tone, bell, chime, audio, upload, work starts, break starts">
        {(['work', 'rest'] as const).map((alarm) => {
          const choice = s.settings.alarms[alarm]
          const label = alarm === 'work' ? 'Work starts' : 'Break starts'
          return (
            <div className="field alarm-row" key={alarm}>
              <label className="field-label caps" htmlFor={`alarm-${alarm}`}>{label}</label>
              <select id={`alarm-${alarm}`} value={choice.tone} onChange={(e) => {
                setError(null)
                void dispatch({ type: 'settings/update', patch: { alarms: { ...s.settings.alarms, [alarm]: { ...choice, tone: e.target.value as AlarmTone } } } })
              }}>
                {ALARM_TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                {choice.customId && <option value="custom">{choice.customName ?? 'Custom sound'}</option>}
              </select>
              <button className="btn" type="button" disabled={choice.tone === 'silent'} aria-label={`Preview ${alarm === 'work' ? 'work' : 'break'} alarm`} onClick={() => { setError(null); void playAlarm(choice, true).catch((e) => setError(e instanceof Error ? e.message : String(e))) }}><Play size={14} /> Preview</button>
              <button className="btn" type="button" disabled={busy !== null || kind !== 'electron'} title={kind === 'web' ? 'Upload custom sounds in the desktop app' : 'A sound file of your own'} onClick={() => void upload(alarm)}><UploadSimple size={14} /> {busy === alarm ? 'Reading' : 'Upload'}</button>
            </div>
          )
        })}
        <p className="field-help">MP3, WAV, OGG, M4A, AAC or FLAC, up to 5 MB. Custom alarms play up to 15 seconds.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </Row>
      <Row title="Sound library" desc="Short sounds to find as you type, for work or break." setting="sound library, search sounds, find a sound, freesound">
        <SoundSearch canSave={kind === 'electron'} />
      </Row>
    </>
  )
}

function AccountRow() {
  const account = useAccount()
  const sync = useSyncStatus()
  const now = useNow(10_000)
  const [available, setAvailable] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<{ code: string; expiresAt: string } | null>(null)
  useEffect(() => void bridge.accountsAvailable().then(setAvailable), [])
  const linkPhone = async () => {
    setError(null)
    try {
      setLink(await bridge.linkPhone())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error: /, '') : String(e))
    }
  }
  const linkLeft = link ? Math.max(0, Math.ceil((Date.parse(link.expiresAt) - now) / 60_000)) : 0

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
    <Row title="Account" desc="Keeps your ledgers, entries and record on the server, and the same on every machine you sign in on." setting="Google, sign in, sign out, sync, link a phone, code">
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
            <button className="btn" onClick={() => void bridge.signOut()}>Sign out</button>
            <button className="btn ghost" title="Every signed-in machine, this one included" onClick={() => void bridge.signOutEverywhere().catch((e) => setError(e instanceof Error ? e.message : String(e)))}>Sign out everywhere</button>
          </div>
          {error && <span className="field-error">{error}</span>}
          <div className="link-phone" data-setting="Link a phone, iPhone, code">
            <button className="btn ghost" onClick={() => void linkPhone()}>{link && linkLeft > 0 ? 'New code' : 'Link a phone'}</button>
            {link && linkLeft > 0 ? (
              <span className="link-code-line">
                <span className="link-code" aria-label={`Code ${link.code.split('').join(' ')}`}>{link.code.slice(0, 4)} {link.code.slice(4)}</span>
                <span className="field-help">Type it in Mayorly on the phone. Works once, for {linkLeft} more {linkLeft === 1 ? 'minute' : 'minutes'}.</span>
              </span>
            ) : (
              <span className="field-help">Signs Mayorly on your phone in to this account with a one-time code.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="account">
          <button className="btn primary" onClick={() => void signIn()} disabled={busy}>
            <GoogleLogo size={16} weight="bold" aria-hidden />
            {busy ? 'Waiting for the browser' : 'Sign in with Google'}
          </button>
          {error && <span className="field-error">{error}</span>}
        </div>
      )}
    </Row>
  )
}

/** The one thing in Settings that cannot be undone: last, on its own, and asked twice. */
function DeleteAccountRow() {
  const account = useAccount()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!account) return null
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
  return (
    <Row title="Delete account" desc="Removes the account and the synced document from the server. This machine keeps its own copy." setting="delete account, remove account, close account">
      <button className="btn warn" onClick={() => void remove()} onBlur={() => setConfirm(false)}>
        {confirm ? 'Confirm: delete the account and its copy on the server' : 'Delete account'}
      </button>
      {error && <span className="field-error">{error}</span>}
    </Row>
  )
}

/** Where the data is, a way out and a way back in; then which build this is. */
function DataRows({ kind, openNotes }: { kind: 'electron' | 'web'; openNotes: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => void bridge.getInfo().then(setInfo), [])
  return (
    <>
      <Row
        title="Your data"
        desc={kind === 'electron'
          ? 'One file on this machine, with a copy a day in backups beside it. Export writes the same JSON anywhere; import replaces what is here, after another copy to backups.'
          : 'In this browser. Export downloads it as JSON.'}
        setting="export, import, backup, json, file, data folder"
      >
        {kind === 'electron' && info?.dataDir && <p className="field-help mono setting-path">{info.dataDir}</p>}
        <div className="form-actions">
          <button className="btn" onClick={() => void bridge.exportState().then((p) => setMsg(p ? `Exported to ${p}` : null))}>Export</button>
          {kind === 'electron' && <button className="btn ghost" onClick={() => void bridge.importState().then((r) => setMsg(r.message || null))}>Import</button>}
        </div>
        {msg && <p className="field-help">{msg}</p>}
      </Row>
      {info && (
        <Row title="Version" desc="Which build this is, and what changed in it." setting="version, build, update, what changed, release notes">
          <p className="field-help build-line">
            <span className="mono num">Mayorly {info.version}{info.arch ? `  ${info.arch}` : ''}  build {info.commit}  built {builtOn(info)}</span>
            <button type="button" className="btn ghost" onClick={openNotes}>What changed</button>
          </p>
        </Row>
      )}
    </>
  )
}

/**
 * Bring your own key, the shanejli.com way: paste a key, the provider is read off
 * its shape, its models are listed and the cheapest one is made to answer once.
 * The clerk then files every captured line with the cheapest model, or the one
 * you pick. Keys are sealed on this machine and, with a sync passphrase, shared
 * with the account's other computers, sealed with the passphrase first.
 */
function AiRows({ clerk, setClerk }: { clerk: ClerkSettings; setClerk: (p: Partial<ClerkSettings>) => void }) {
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
      setError(plainError(e).replace(/^[a-z_]+: /, ''))
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
  const providers = [...new Set(working.map((k) => k.provider))]

  return (
    <>
      <Row
        title="AI keys"
        desc="Bring your own key. Without one, the clerk files by prefix and tag only."
        setting="AI clerk, API key, keys, Gemini, OpenAI, Anthropic, Claude, xAI, Grok, model, filing"
      >
        <p className="field-help">
          Paste it and the provider is read from the key itself; the cheapest text model that answers is chosen.
          The clerk then files whatever you capture: it picks the ledger from your criteria, trims the title and reads the estimate.
          Keys stay on this machine unless you sync them below.
        </p>

        {ai.keys.map((k) => (
          <div key={k.id} className={`ai-key ${k.status}`}>
            <div className="ai-key-head">
              <span className="caps">{ai.providers[k.provider]}</span>
              <span className="mono dim">…{k.keyHint}</span>
              <span className={`ai-status caps ${k.status}`}>{k.status === 'ok' ? 'working' : k.status === 'checking' ? 'checking' : 'failing'}</span>
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
            {k.status === 'failing' && k.retryAt != null && <span className="field-help">Resting, not removed. The clerk tries it again on its own {restUntil(k.retryAt)}.</span>}
            {k.status === 'checking' && <span className="field-help">From your other computer. Checking it here.</span>}
            {k.models.length > 0 && <label className="field">
              <span className="field-label caps">Model</span>
              <select value={k.preferredModel ?? ''} onChange={(e) => void bridge.ai.setPreferredModel(k.id, e.target.value || null)}>
                <option value="">Cheapest that answered ({k.defaultModel})</option>
                {k.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>}
          </div>
        ))}

        {providers.length > 1 && (
          <label className="field">
            <span className="field-label caps">Prefer</span>
            <select value={ai.preferredProvider ?? ''} onChange={(e) => void bridge.ai.setPreferredProvider((e.target.value || null) as AiProvider | null)}>
              <option value="">First working key</option>
              {providers.map((p) => <option key={p} value={p}>{ai.providers[p]}</option>)}
            </select>
          </label>
        )}

        <div className="ai-add">
          <input
            className="mono"
            type="password"
            placeholder="Paste an API key: Gemini, Claude, OpenAI or Grok"
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
      </Row>
      <KeySyncRow sync={ai.sync} />
      <ClerkShelf clerk={clerk} set={setClerk} ai={ai} />
      <ClerkAllowance clerk={clerk} set={setClerk} />
    </>
  )
}

/**
 * What the clerk may do to the shelf on its own: start a ledger for a line nothing fits, and fold
 * a ledger it started into one that covers the same ground. How sure it must be is found by trial
 * for the model this machine files with (shared/ai/tuning.ts); moving the slider sets a level of
 * your own instead, which syncs.
 */
function ClerkShelf({ clerk, set, ai }: { clerk: ClerkSettings; set: (p: Partial<ClerkSettings>) => void; ai: AiPublic }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tuned = ai.tuning ?? null
  const level = clerk.minConfidence ?? tuned?.threshold ?? DEFAULT_THRESHOLD
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const running = busy || !!ai.tuningNow
  const working = ai.keys.some((k) => k.status === 'ok')
  const tune = async () => {
    setBusy(true)
    setError(null)
    try {
      await bridge.ai.calibrate()
    } catch (e) {
      setError(plainError(e))
    } finally {
      setBusy(false)
    }
  }
  const whose = clerk.minConfidence !== null ? 'your level' : tuned ? 'tuned' : 'until tuned'
  return (
    <Row
      title="Your shelf"
      desc={`What the clerk may do to your ledgers on its own. It starts a ledger only while the shelf has room for ${LEDGER_CAP}, folds a ledger it started only after a day, and never renames, folds or removes one you wrote or edited.`}
      setting="new ledger, create ledgers, consolidate, fold, merge ledgers, confidence, threshold, tune"
    >
      <div className="checks">
        <Check label="Start a ledger when nothing fits" value={clerk.createLedgers} onChange={(createLedgers) => set({ createLedgers })} />
        <Check label="Fold its own ledgers into ones that overlap" value={clerk.consolidate} onChange={(consolidate) => set({ consolidate })} />
      </div>
      {(clerk.createLedgers || clerk.consolidate) && (
        <>
          <label className="field">
            <span className="field-label caps">How sure</span>
            <input type="range" min={0.5} max={0.99} step={0.01} value={level} onChange={(e) => set({ minConfidence: Number(e.target.value) })} />
            <span className="field-help mono num">{pct(level)} {whose}</span>
          </label>
          <p className="field-help">
            {running
              ? `Tuning: ${ai.tuningDone ?? 0} of ${TRIALS.length} sample lines filed, half that fit a ledger and half that need a new one. One every few seconds, to stay inside the provider's rate limit.`
              : tuned
                ? `Tuned for ${tuned.model} by trial: at ${pct(tuned.threshold)} it got ${tuned.correct} of ${tuned.total} sample lines right.`
                : working
                  ? `Not tuned yet. It files ${TRIALS.length} sample lines and keeps the level that gets the most right, a wrong new ledger counting worse than a missed one.`
                  : 'Needs a working key to tune.'}
          </p>
          <div className="form-actions">
            <button type="button" className="btn" disabled={running || !working} onClick={() => void tune()}>{running ? 'Tuning' : tuned ? 'Tune again' : 'Tune now'}</button>
            {clerk.minConfidence !== null && (
              <button type="button" className="btn ghost" onClick={() => set({ minConfidence: null })}>{tuned ? `Use the tuned level, ${pct(tuned.threshold)}` : 'Use the tuned level'}</button>
            )}
          </div>
          {error && <span className="field-error">{error}</span>}
        </>
      )}
    </Row>
  )
}

/** The rules that move the desk on their own. Each is built in and only turned on or off here. */
const AUTO_SWITCH: { key: keyof AutoSwitchRules; label: string; help: string }[] = [
  {
    key: 'aiPrompt',
    label: 'When you send an AI a prompt, switch to your recent task',
    help: 'What Alt+Q does, so the wait goes to something else; the next prompt or Alt+Q switches again. Claude Code, Gemini CLI and Codex through their hooks; ChatGPT and Gemini in Chrome through the Mayorly extension (load ~/.mayorly/chrome-extension in chrome://extensions, Developer mode, Load unpacked). Not during a rest or when the desk is idle; scheduled tasks and background notices never count.',
  },
  {
    key: 'streamDeath',
    label: 'When the streamer dies in League or GTA, switch to your recent task',
    help: 'For a couch item or task with a context switch rule such as "streamer dies" (or any rule that someone dies or is wasted, on an item whose name says stream or watch), or one whose rules you set to Watching the stream with the eye button. While it runs here and a League of Legends or GTA stream plays in Chrome, on Twitch, YouTube, Kick, Bilibili, Huya or Douyu, Mayorly reads the stream\'s own video and does what Alt+Q does the moment the streamer dies, once per death: in League when the game goes grey, in GTA when it writes WASTED (never FAILED or BUSTED). A stream of another game, or Just Chatting, is never read. It reads the page, never your screen, so your own games never count, and it waits while a League match of yours is running. Needs the Mayorly extension; after an update, press its reload button once in chrome://extensions, then reload the stream page.',
  },
  {
    key: 'streamAd',
    label: 'When the stream plays an ad, switch to your recent task',
    help: 'On the task that watches streams, an ad break starting on its stream (any game or Just Chatting, even in a tab behind others) does what Alt+Q does, so you can get something done instead of listening to it; the stream is muted too while Mute the streams is on, until the break is over, and a notice says when it is. Mayorly knows an ad from the page itself, as an ad blocker does: Twitch\'s ad banner ("xQc is taking an ad break") and countdown, YouTube\'s ad player. Once per break, and only after the stream itself has played a few seconds, so the ad before a stream starts never switches you away; until the break ends, an AI prompt does not take you back to it. Needs the Mayorly extension; after an update, press its reload button once in chrome://extensions, then reload the stream page.',
  },
  {
    key: 'streamOpen',
    label: 'When you bring a live stream to the front, switch to your stream task',
    help: 'Clicking into a Twitch, Kick, Bilibili 直播, Huya or Douyu page, or a live YouTube video, while the desk is on something else puts your stream task on the desk: the one named like the page (watch theBause for Thebausffs), else the one you watched last. A task watches streams when its rules say the streamer dies or its eye is on. Only the moment the page comes to the front counts, so a stream playing on your other screen never pulls you back; not during a rest, nor right after a death switched you away.',
  },
  {
    key: 'streamMute',
    label: 'Mute the streams when you leave the stream task',
    help: 'Whenever the desk leaves a task that watches streams (a death, an AI prompt, Alt+Q, a pick), every stream playing in Chrome is muted, in whatever tab it is, with the player\'s own mute button on Twitch and YouTube; coming back to that task unmutes them. A stream you muted yourself is left as it is.',
  },
  {
    key: 'leaguePlay',
    label: 'When you play League, switch to your League task',
    help: 'The moment a League of Legends match of yours starts on this computer (the game itself, not the client), the couch item or task whose name says League, LoL or 英雄联盟 goes on the desk; the one you played last if there are several, never one that watches streams. From a rest too, and one already on the desk but paused runs again. Not when the desk is idle, and not without a coin for the couch. While the match runs, an AI prompt or a stream brought to the front leaves the desk on it; Alt+Q or a pick still moves it. Mayorly knows a match from the game itself, which answers on this computer only while one is loaded.',
  },
]

/** The rules in rows by what they listen to. */
const SWITCH_GROUPS: { title: string; desc: string; setting: string; keys: (keyof AutoSwitchRules)[] }[] = [
  {
    title: 'AI prompts',
    desc: 'While an AI works on your prompt, you work on something else.',
    setting: 'claude code, claude, prompt, hook, project, gemini, codex, chatgpt, ai',
    keys: ['aiPrompt'],
  },
  {
    title: 'Streams',
    desc: "Read from the stream's own page in Chrome through the Mayorly extension, never from your screen.",
    setting: 'stream, streamer, twitch, youtube, kick, dies, death, ad, mute, watch',
    keys: ['streamDeath', 'streamAd', 'streamOpen', 'streamMute'],
  },
  {
    title: 'Games',
    desc: 'Your own League of Legends match, known from the game itself on this computer.',
    setting: 'league, lol, game, match, play',
    keys: ['leaguePlay'],
  },
]

function AutoSwitchRows({ rules, set }: { rules: AutoSwitchRules; set: (r: AutoSwitchRules) => void }) {
  return (
    <>
      {SWITCH_GROUPS.map((g) => (
        <Row key={g.title} title={g.title} desc={g.desc} setting={`auto switch, ${g.setting}`}>
          {AUTO_SWITCH.filter((r) => g.keys.includes(r.key)).map((r) => (
            <SwitchRule key={r.key} label={r.label} help={r.help} value={rules[r.key]} onChange={(on) => set({ ...rules, [r.key]: on })} />
          ))}
        </Row>
      ))}
    </>
  )
}

/** One rule: its switch and what it does, two lines of that until More opens the rest. */
function SwitchRule({ label, help, value, onChange }: { label: string; help: string; value: boolean; onChange: (v: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="switch-rule">
      <Check label={label} value={value} onChange={onChange} />
      <p className={`field-help switch-rule-help ${open ? 'open' : ''}`}>{help}</p>
      <button type="button" className="switch-rule-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Less' : 'More'}</button>
    </div>
  )
}

const ALLOW: [ClerkAllow, string][] = [['auto', 'Do it'], ['ask', 'Ask first'], ['never', 'Never']]

/** What the clerk may do with an instruction typed into Alt+N, by kind. Done is always undoable from the box. */
function ClerkAllowance({ clerk, set }: { clerk: ClerkSettings; set: (p: Partial<ClerkSettings>) => void }) {
  const row = (scope: 'settings' | 'recipes', label: string, help: string) => (
    <div className="field" key={scope}>
      <span className="field-label caps">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {ALLOW.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={clerk.allow[scope] === v} className={clerk.allow[scope] === v ? 'on' : ''} onClick={() => set({ allow: { ...clerk.allow, [scope]: v } })}>{l}</button>
        ))}
      </div>
      <span className="field-help">{help}</span>
    </div>
  )
  return (
    <Row
      title="Instructions"
      desc={<>Type an instruction into Capture, like "set work to weekdays 7am to 4pm" or "every workday add PRO: CWILL {'{date}'}". Start a line with ! to make sure it is read as one.</>}
      setting="permissions, instructions, auto approve, ask first, what the clerk may do"
    >
      <div className="form-row">
        {row('settings', 'Settings', 'Work hours, days off, session lengths.')}
        {row('recipes', 'Recipes and shortcuts', 'Entries it adds every day, or on a key.')}
      </div>
      <p className="field-help">Do it: done at once, with Undo in the box. Ask first: the box shows Apply.</p>
    </Row>
  )
}

const recipeWhen = (r: Recipe) => {
  if (r.when.kind === 'key') return hotkeyLabel(r.when.key)
  const at = `${String(Math.floor(r.when.at / 60)).padStart(2, '0')}:${String(r.when.at % 60).padStart(2, '0')}`
  const days = r.when.days === 'workdays' ? 'Workdays' : r.when.days === 'weekdays' ? 'Weekdays' : 'Every day'
  return `${days}${r.when.days !== 'everyday' && !r.when.holidays ? ', not holidays' : ''}, ${at}`
}

/** Standing orders the clerk set up: when each runs, what it adds; pause, run now, remove. */
function RecipesRow({ s }: { s: MayorlyState }) {
  return (
    <Row
      title="Recipes"
      desc={<>Entries the clerk adds on its own, every day or on a key. Ask for one in Capture: "every workday, not on holidays, add PRO: CWILL {'{date}'}", or "Alt+H makes PRO: CWILL {'{date}'}, 16 tomatoes". {'{date}'} is the month and day.</>}
      setting="recipes, shortcuts, recurring, daily, every day, automation"
    >
      {s.recipes.length === 0 ? (
        <p className="field-help">None yet.</p>
      ) : (
        <div className="sources">
          {s.recipes.map((r) => (
            <div key={r.id} className={`source-row ${r.enabled ? '' : 'dim'}`}>
              <label className="check" title={r.enabled ? 'On' : 'Paused'}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => dispatch({ type: 'recipe/update', id: r.id, patch: { enabled: e.target.checked } })} aria-label={`${r.name} on`} />
                <span className="check-box" aria-hidden />
              </label>
              <span className="source-label">{r.name}</span>
              <span className="field-help"><span className="mono">{recipeWhen(r)}</span>: {r.line}{r.estimateMin ? `, ${r.estimateMin} min` : ''}{r.when.kind === 'key' && r.start ? ', started' : ''}</span>
              <button type="button" className="btn ghost small" title="Make today's entry now" onClick={() => dispatch({ type: 'recipe/run', id: r.id, day: dayKey(Date.now(), s.settings.calendar.tz) })}><Play size={12} /> Today</button>
              <button type="button" className="icon-btn" aria-label={`Remove ${r.name}`} title="Remove" onClick={() => dispatch({ type: 'recipe/remove', id: r.id })}><Trash size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </Row>
  )
}

/** When a resting key is tried again, in words. A rest is at most a day, so a time not today is tomorrow. */
function restUntil(at: number): string {
  const left = at - Date.now()
  if (left <= 3 * 60_000) return 'in a few minutes'
  if (left < 60 * 60_000) return `in ${Math.round(left / 60_000)} minutes`
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? `at ${time}` : `tomorrow at ${time}`
}

function plainError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '')
}

/**
 * The keys on the account's other devices. They sync with the sign-in: the vault's key is kept by
 * the server, so no device asks for a passphrase (shared/ai/keysync.ts). A passphrase is asked for
 * only for an old vault no device has handed over yet, and the field for it stays out of the way.
 */
function KeySyncRow({ sync }: { sync: AiKeySync }) {
  const now = useNow(30_000)
  const [available, setAvailable] = useState(false)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [withPass, setWithPass] = useState(false)
  // Opening Settings asks main for the AI state, which also looks for keys from another device.
  useEffect(() => {
    void bridge.accountsAvailable().then(setAvailable)
    void bridge.ai.get()
  }, [])
  useEffect(() => setError(null), [sync.phase])

  const unlock = async () => {
    setBusy(true)
    setError(null)
    try {
      await bridge.ai.syncUnlock(pass)
      setPass('')
    } catch (e) {
      setError(plainError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null
  const ago = sync.at ? Math.round((now - sync.at) / 60_000) : null
  return (
    <Row title="Key sync" desc="The same keys on your other computers and your phone, through your account." setting="Key sync, AI keys between devices, passphrase">
      {sync.phase === 'off' && <p className="field-help">Sign in under Account and data, and these keys reach your other computers and your phone.</p>}
      {(sync.phase === 'checking' || sync.phase === 'none') && <p className="field-help">Checking key sync</p>}
      {sync.phase === 'on' && (
        <p className="field-help">
          Keys sync with your other computers and your phone through your account.{ago === null ? '' : ago < 1 ? ' Synced just now.' : ` Synced ${ago} min ago.`}
        </p>
      )}
      {sync.phase === 'locked' && (
        <>
          <p className="field-help">Your keys come over as soon as a device that has them opens Mayorly. Nothing to type.</p>
          {!withPass ? (
            <button className="btn ghost" onClick={() => setWithPass(true)}>Use my old sync passphrase instead</button>
          ) : (
            <div className="ai-add">
              <input type="password" placeholder="Old sync passphrase" value={pass} autoComplete="current-password" spellCheck={false} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pass && void unlock()} disabled={busy} />
              <button className="btn primary" onClick={() => void unlock()} disabled={busy || !pass}>{busy ? 'Unlocking' : 'Unlock'}</button>
            </div>
          )}
        </>
      )}
      {(error ?? sync.message) && <span className="field-error">{error ?? sync.message}</span>}
    </Row>
  )
}

/**
 * The clerk's standing instructions. Most are learned: move an entry the clerk
 * filed, and the correction is written here as a rule, with the ledger it chose
 * and the one you chose. Edit the wording, add your own, remove what no longer holds.
 */
function HouseRulesRow({ s }: { s: MayorlyState }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    if (!draft.trim()) return
    dispatch({ type: 'rule/add', text: draft })
    setDraft('')
  }
  return (
    <Row
      title="House rules"
      desc="What the clerk reads before every filing, ahead of the ledger criteria. When you move an entry the clerk filed, the correction is written here on its own."
      setting="house rules, rules, corrections, learned"
    >
      {s.houseRules.length === 0 ? (
        <p className="field-help">No rules yet. Correct the clerk once, or write one below.</p>
      ) : (
        <div className="rules-list">
          {s.houseRules.map((r) => <HouseRuleRow key={r.id} id={r.id} text={r.text} learned={!!r.learnedFrom} />)}
        </div>
      )}
      <div className="ai-add">
        <input
          value={draft}
          placeholder='Anything about visas or forms goes to Legal.'
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add} disabled={!draft.trim()}><Plus size={14} /> Add rule</button>
      </div>
    </Row>
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

/**
 * A global hotkey, set by pressing it: click the box (or Enter on it), press the new combo, and it is
 * kept. While the box listens the shell lets go of every global shortcut (`holdHotkeys`), so a combo
 * already in use reaches the box instead of running. Esc, or a click away, keeps the old one.
 */
function HotkeyField({ action, label, hotkeys, onCommit }: {
  action: HotkeyAction
  label: string
  hotkeys: Settings['hotkeys']
  onCommit: (v: string) => void
}) {
  const value = hotkeys[action]
  const [listening, setListening] = useState(false)
  const [held, setHeld] = useState('')
  const [say, setSay] = useState<string | null>(null)
  // The keys are read through a ref, so the listener (and the shell's hold) lasts the whole press.
  const now = useRef({ value, hotkeys, onCommit })
  now.current = { value, hotkeys, onCommit }
  useEffect(() => {
    if (!listening) return
    bridge.holdHotkeys?.(true)
    const stop = () => {
      setListening(false)
      setHeld('')
    }
    const onKey = (e: KeyboardEvent) => {
      // Nothing else in the app hears these keys while the box listens.
      e.preventDefault()
      e.stopImmediatePropagation()
      // The modifiers held so far show in the box as they go down and up.
      if (MODIFIER_KEYS.has(e.key)) {
        // A modifier let go is no longer held, whatever its own keyup event says.
        const gone = e.type === 'keyup' ? ({ Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: IS_MAC ? 'Cmd' : 'Super' } as Record<string, string>)[e.key] : undefined
        setHeld(modifiersOf(e).split('+').filter((m) => m && m !== gone).join('+'))
        return
      }
      if (e.type === 'keyup') return
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setSay(null)
        stop()
        return
      }
      const accel = acceleratorOf(e)
      if (!accel) {
        setSay(hotkeyRefusal(e))
        return
      }
      const { value: was, hotkeys: all, onCommit: commit } = now.current
      const other = GLOBAL_ACTIONS.find(([a]) => a !== action && all[a] === accel)
      if (other) {
        setSay(`${hotkeyLabel(accel)} is already ${other[1].split(/[,:]/)[0].toLowerCase()}. Press another`)
        return
      }
      setSay(null)
      stop()
      if (accel !== was) {
        sfx.tick()
        commit(accel)
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      bridge.holdHotkeys?.(false)
    }
  }, [listening, action])
  const def = DEFAULT_HOTKEYS[action]
  return (
    <div className="field">
      <span className="field-label caps">{label}</span>
      <button
        type="button"
        className={`hotkey-box mono ${listening ? 'is-listening' : ''} ${say ? 'invalid' : ''}`}
        aria-label={`${label}: ${hotkeyLabel(value)}. Click and press the new keys`}
        onClick={() => {
          setSay(null)
          setHeld('')
          setListening((on) => !on)
        }}
        onBlur={() => {
          setListening(false)
          setHeld('')
          setSay(null)
        }}
      >
        {listening ? (held ? `${hotkeyLabel(held)}+` : 'Press the new keys') : hotkeyLabel(value)}
      </button>
      {say ? (
        <span className="field-error">{say}</span>
      ) : listening ? (
        <span className="field-help">Esc keeps {hotkeyLabel(value)}</span>
      ) : value !== def ? (
        <button type="button" className="hotkey-reset" onClick={() => onCommit(def)}>Back to {hotkeyLabel(def)}</button>
      ) : null}
    </div>
  )
}

/** The plan as a calendar Google subscribes to: one secret address per account, from the server. */
function PlanFeed() {
  const account = useAccount()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!account) {
      setUrl(null)
      return
    }
    void bridge.calendar.feed('get').then(setUrl).catch(() => {})
  }, [account])
  const run = async (op: 'create' | 'rotate' | 'drop') => {
    setBusy(true)
    setError(null)
    try {
      setUrl(await bridge.calendar.feed(op))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error: /, '') : String(e))
    } finally {
      setBusy(false)
    }
  }
  const copy = () => {
    if (!url) return
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  if (!account) return null
  return (
    <Row
      title="Your plan in Google Calendar"
      desc="A calendar address Google can subscribe to: the planned blocks and the events made here."
      setting="feed, subscribe, google calendar, ical, share the plan"
    >
      <p className="field-help">In Google Calendar, Other calendars, plus, From URL. Google reads it on its own clock, often hours apart; the plan here is always current. Anyone with the address can read your plan, so keep it to yourself or make a new one.</p>
      {url ? (
        <>
          <div className="form-row">
            <label className="field grow"><span className="field-label caps">Address</span><input value={url} readOnly onFocus={(e) => e.currentTarget.select()} spellCheck={false} /></label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy address'}</button>
            <button type="button" className="btn ghost" disabled={busy} title="The old address stops working at once" onClick={() => void run('rotate')}>New address</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void run('drop')}>Stop sharing</button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void run('create')}>{busy ? 'Making' : 'Make an address'}</button>
        </div>
      )}
      {error && <span className="field-help field-error">{error}</span>}
    </Row>
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
    <Row
      title="Outside calendars"
      desc="Your Google calendar, read as busy time so the planner routes around it."
      setting="google calendar, ical, ics, busy, outside calendar, secret address"
    >
      <p className="field-help">In Google Calendar, Settings, your calendar, copy the secret address in iCal format. The address stays on this machine; the events go into your account, with their titles unless you keep them out.</p>
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
    </Row>
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

function Num({ label, help, value, min, max, step = 1, onChange }: { label: string; help: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const commit = () => {
    setEditing(false)
    const n = Math.min(max, Math.max(min, Math.round(Number(text) / step) * step || min))
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
        step={step}
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
