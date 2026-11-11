import { useState } from 'react'
import { ArrowsClockwise, GoogleLogo, SignOut, X } from '@phosphor-icons/react'
import { addKey, removeKey, setupKeys, unlockKeys, useClerk } from '../ai'
import { type Settings as S } from '@core/index'
import { BUILD } from '../../shared/build'
import { accountsAvailable, linkWithCode, signInWithGoogle, signOut, useAccount } from '../account'
import { googleAvailable } from '../google'
import { checkForUpdate, restartIntoUpdate, useUpdates } from '../updater'
import { native } from '../platform'
import { act, useMayorly, useNow } from '../store'
import { SettingRow, Stepper, Toggle } from './parts'

// The account (a code from a computer), the cadence, and what build this is.

const when = (t: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t)

export function Settings() {
  const s = useMayorly()
  const set = (patch: Partial<S>) => act({ type: 'settings/update', patch })
  return (
    <>
      <h1 className="title">Settings</h1>
      <Account />
      <Clerk />
      <h2 className="section-title">Timer</h2>
      <div className="list">
        <SettingRow title="Focus"><Stepper label="focus minutes" value={s.settings.focusMin} min={5} max={120} step={5} unit="min" onChange={(n) => set({ focusMin: n })} /></SettingRow>
        <SettingRow title="Short rest"><Stepper label="short rest minutes" value={s.settings.shortRestMin} min={1} max={30} unit="min" onChange={(n) => set({ shortRestMin: n })} /></SettingRow>
        <SettingRow title="Long rest"><Stepper label="long rest minutes" value={s.settings.longRestMin} min={5} max={60} step={5} unit="min" onChange={(n) => set({ longRestMin: n })} /></SettingRow>
        <SettingRow title="Long rest every"><Stepper label="focus blocks between long rests" value={s.settings.longRestEvery} min={2} max={8} unit="blocks" onChange={(n) => set({ longRestEvery: n })} /></SettingRow>
        <SettingRow title="Start focus on its own" sub="After a rest ends"><Toggle label="Start focus on its own" on={s.settings.autoStartFocus} onChange={(on) => set({ autoStartFocus: on })} /></SettingRow>
        <SettingRow title="Start rests on its own" sub="After a focus block ends"><Toggle label="Start rests on its own" on={s.settings.autoStartRest} onChange={(on) => set({ autoStartRest: on })} /></SettingRow>
      </div>
      <p className="help">These are the same settings as on your computers. The phone rings at the end of each block, also when locked.</p>
      <About />
    </>
  )
}

function Account() {
  const { account, sync } = useAccount()
  const now = useNow(15_000)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const google = googleAvailable()
  const [withCode, setWithCode] = useState(!google)
  if (!accountsAvailable) return null
  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (m !== 'cancelled') setError(m)
    } finally {
      setBusy(false)
    }
  }
  const link = async () => {
    setBusy(true)
    setError(null)
    try {
      await linkWithCode(code)
      setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  let line = 'Not synced yet'
  if (sync.phase === 'syncing') line = 'Syncing'
  else if (sync.phase === 'error') line = sync.message ?? 'Sync failed'
  else if (sync.at) {
    const m = Math.round((now - sync.at) / 60_000)
    line = m < 1 ? 'Synced just now' : `Synced ${m} min ago`
  }
  return (
    <>
      <h2 className="section-title">Account</h2>
      {account ? (
        <div className="list">
          <div className="row">
            <span className="row-main">
              <span className="row-title">{account.name ?? account.email}</span>
              <span className="row-sub" style={sync.phase === 'error' ? { color: 'var(--danger)' } : undefined}>{line}</span>
            </span>
            <button type="button" className="btn" style={{ height: 36 }} onClick={() => void signOut()}><SignOut size={16} />Sign out</button>
          </div>
        </div>
      ) : (
        <>
          <p className="help" style={{ paddingTop: 0, paddingBottom: 10 }}>Sign in with the Google account your computers use. Your ledgers, entries and the desk then sync with them, and what is on this phone now is kept.</p>
          {google && (
            <button type="button" className="primary" style={{ width: '100%' }} disabled={busy} onClick={() => void signIn()}>
              <GoogleLogo size={20} weight="bold" aria-hidden />
              {busy && !withCode ? 'Signing in' : 'Sign in with Google'}
            </button>
          )}
          {google && !withCode && (
            <button type="button" className="help" style={{ display: 'block', margin: '10px auto 0', padding: 8 }} onClick={() => setWithCode(true)}>Use a code from a computer instead</button>
          )}
          {withCode && <>
          {google && <p className="help" style={{ paddingTop: 16, paddingBottom: 10 }}>On a computer, open Settings, Account, Link a phone, and type the code here.</p>}
          <input className="field link-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} onKeyDown={(e) => e.key === 'Enter' && code.length === 8 && void link()} placeholder="Code" aria-label="Code from your computer" autoCapitalize="characters" autoCorrect="off" spellCheck={false} inputMode="text" enterKeyHint="go" />
          <div className="btn-row">
            <button type="button" className="btn white" disabled={code.length !== 8 || busy} onClick={() => void link()}>{busy ? 'Linking' : 'Link this phone'}</button>
          </div>
          </>}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </>
  )
}

// The clerk's keys. With an account, the keys on the computers come over once the sync passphrase
// set there is typed here; a key pasted here goes to them the same way.
function Clerk() {
  const { ai } = useClerk()
  const { account } = useAccount()
  const [pass, setPass] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'pass' | 'key' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!ai) return null
  const run = async (what: 'pass' | 'key', fn: () => Promise<void>) => {
    setBusy(what)
    setError(null)
    try {
      await fn()
      if (what === 'pass') setPass('')
      else setKey('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const phase = ai.sync.phase
  return (
    <>
      <h2 className="section-title">AI clerk</h2>
      {account && (phase === 'locked' || phase === 'none') && (
        <>
          <p className="help" style={{ paddingTop: 0, paddingBottom: 10 }}>
            {phase === 'locked'
              ? 'Your computers keep their AI keys behind a sync passphrase. Type it once here and the keys come to this phone.'
              : 'No computer has set a sync passphrase yet. Choose one here, at least ten characters, and type the same on your computers to share keys.'}
          </p>
          <input className="field" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Sync passphrase" aria-label="Sync passphrase" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" onKeyDown={(e) => e.key === 'Enter' && pass && void run('pass', () => (phase === 'locked' ? unlockKeys(pass) : setupKeys(pass)))} />
          <div className="btn-row">
            <button type="button" className="btn white" disabled={!pass || busy !== null} onClick={() => void run('pass', () => (phase === 'locked' ? unlockKeys(pass) : setupKeys(pass)))}>
              {busy === 'pass' ? 'Opening the keys' : phase === 'locked' ? 'Bring my keys' : 'Set the passphrase'}
            </button>
          </div>
          {busy === 'pass' && <p className="help">This takes a few seconds on purpose: it is what keeps the passphrase hard to guess.</p>}
        </>
      )}
      {!account && <p className="help" style={{ paddingTop: 0, paddingBottom: 10 }}>Sign in above to bring the AI keys from your computers, or paste one here.</p>}
      {account && phase === 'on' && <p className="help" style={{ paddingTop: 0, paddingBottom: 10 }}>Keys sync with your computers.</p>}
      {ai.keys.length > 0 && (
        <div className="list" style={{ marginBottom: 10 }}>
          {ai.keys.map((k) => (
            <div key={k.id} className="row">
              <span className="row-main">
                <span className="row-title">{ai.providers[k.provider]}, ending {k.keyHint}</span>
                <span className="row-sub" style={k.status === 'failing' ? { color: 'var(--danger)' } : undefined}>
                  {k.status === 'ok' ? `Files with ${k.preferredModel ?? k.defaultModel}` : k.status === 'checking' ? 'Checking on this phone' : k.lastError ?? 'Not working'}
                </span>
              </span>
              <button type="button" className="btn" style={{ height: 36, width: 36, padding: 0, justifyContent: 'center' }} aria-label={`Remove the ${ai.providers[k.provider]} key ending ${k.keyHint}`} onClick={() => removeKey(k.id)}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
      <input className="field" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="Paste an API key" aria-label="API key" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" onKeyDown={(e) => e.key === 'Enter' && key && void run('key', () => addKey(key))} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={!key || busy !== null} onClick={() => void run('key', () => addKey(key))}>{busy === 'key' ? 'Checking the key' : 'Add key'}</button>
      </div>
      <p className="help">Gemini, OpenAI, Anthropic or xAI. The clerk uses the cheapest model that answers. Keys stay on your devices and go only to their provider.</p>
      {error && <p className="error">{error}</p>}
    </>
  )
}

function About() {
  const u = useUpdates()
  let line = ''
  if (u.phase === 'checking') line = 'Checking for an update'
  else if (u.phase === 'downloading') line = `Downloading ${u.version}`
  else if (u.phase === 'ready') line = `${u.version} is ready`
  else if (u.phase === 'current') line = 'Up to date'
  else if (u.phase === 'install') line = `${u.version} needs a new install from the computer`
  else if (u.phase === 'error') line = `Update failed: ${u.message}`
  return (
    <>
      <h2 className="section-title">This app</h2>
      <div className="list">
        <div className="row">
          <span className="row-main">
            <span className="row-title num">Build {BUILD.version}, {BUILD.commit}</span>
            <span className="row-sub">{BUILD.builtAt ? `Built ${when(BUILD.builtAt)}` : 'Development'}{line ? `. ${line}` : ''}</span>
          </span>
          {native && (u.phase === 'ready' ? (
            <button type="button" className="btn white" style={{ height: 36 }} onClick={restartIntoUpdate}>Restart</button>
          ) : (
            <button type="button" className="btn" style={{ height: 36 }} aria-label="Check for an update" disabled={u.phase === 'checking' || u.phase === 'downloading'} onClick={() => void checkForUpdate()}><ArrowsClockwise size={16} /></button>
          ))}
        </div>
      </div>
    </>
  )
}
