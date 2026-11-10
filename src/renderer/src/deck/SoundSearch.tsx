import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass, Play, Stop } from '@phosphor-icons/react'
import type { AlarmKind } from '@core/index'
import { bridge } from '../bridge'
import { playDataUrl, stopAlarm } from '../lib/sound'
import { downloadSound, findLocal, searchSounds, soundName, type FoundSound } from '../lib/soundSearch'

// Shop for an alarm: suggestions from the catalogue that ships with the app appear as you type,
// and the whole library is asked after a pause when the catalogue has little to offer (or on
// Enter). That search is slow and rationed, so it waits, never runs twice for one word, and keeps
// three seconds between calls. A sound starts downloading when the pointer reaches it, so the
// play button is quick; once downloaded it is kept for the preview, then saved like an upload.

const seconds = (ms: number | null) => (ms === null ? '' : `${Math.max(1, Math.round(ms / 1000))}s`)
/** Ask the network when the catalogue has fewer matches than this. */
const ENOUGH = 8
const PAUSE_MS = 700
const GAP_MS = 3_500

export function SoundSearch({ canSave }: { canSave: boolean }) {
  const [query, setQuery] = useState('')
  const key = query.trim().toLowerCase()
  const local = useMemo(() => findLocal(query), [query])
  const [remote, setRemote] = useState<{ key: string; list: FoundSound[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const files = useRef(new Map<string, Promise<string>>())
  const answers = useRef(new Map<string, FoundSound[]>())
  const lastCall = useRef(0)
  const latest = useRef('')
  latest.current = key

  const file = (s: FoundSound) => {
    let f = files.current.get(s.id)
    if (!f) {
      f = downloadSound(s)
      files.current.set(s.id, f)
      f.catch(() => files.current.delete(s.id))
    }
    return f
  }
  // The pointer on a row is the moment to start fetching it.
  const warm = (s: FoundSound) => void file(s).catch(() => {})

  const askLibrary = useCallback(async (k: string) => {
    const known = answers.current.get(k)
    if (known) {
      setRemote({ key: k, list: known })
      return
    }
    const wait = lastCall.current + GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    if (latest.current !== k) return
    lastCall.current = Date.now()
    setSearching(true)
    try {
      const list = await searchSounds(k)
      answers.current.set(k, list)
      if (latest.current === k) setRemote({ key: k, list })
    } catch (e) {
      if (latest.current === k) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (latest.current === k) setSearching(false)
    }
  }, [])

  useEffect(() => {
    setSearching(false)
    setError(null)
    if (key.length < 3 || local.length >= ENOUGH) return
    const t = setTimeout(() => void askLibrary(key), PAUSE_MS)
    return () => clearTimeout(t)
  }, [key, local.length, askLibrary])

  const shown = useMemo(() => {
    const extra = remote?.key === key ? remote.list : []
    const seen = new Set(local.map((s) => s.id))
    return [...local, ...extra.filter((s) => !seen.has(s.id))]
  }, [local, remote, key])

  const preview = async (s: FoundSound) => {
    setError(null)
    if (playing === s.id) {
      stopAlarm()
      setPlaying(null)
      return
    }
    setBusy(s.id)
    try {
      const data = await file(s)
      setPlaying(s.id)
      await playDataUrl(data, () => setPlaying((p) => (p === s.id ? null : p)))
    } catch (e) {
      setPlaying(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const use = async (s: FoundSound, kind: AlarmKind) => {
    setError(null)
    setDone(null)
    setBusy(s.id)
    try {
      await bridge.alarms.save(kind, soundName(s), await file(s))
      setDone(`${s.title} is now the ${kind === 'work' ? 'work' : 'break'} alarm.`)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sound-search">
      <form
        className="sound-search-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (key) void askLibrary(key)
        }}
      >
        <MagnifyingGlass size={16} className="sound-search-icon" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setDone(null)
          }}
          placeholder="Find a sound: bell, gong, birds, chime"
          aria-label="Search the sound library"
          spellCheck={false}
        />
      </form>
      {key && shown.length === 0 && (
        <p className="field-help">{searching ? 'Searching the whole library.' : 'Nothing here yet. Press Enter to search the whole library.'}</p>
      )}
      {shown.length > 0 && (
        <ul className="sound-results" aria-label="Sounds">
          {shown.map((s) => (
            <li key={s.id} className="sound-row" onPointerEnter={() => warm(s)}>
              <button
                className="icon-btn"
                type="button"
                aria-label={playing === s.id ? `Stop ${s.title}` : `Play ${s.title}`}
                disabled={busy !== null && busy !== s.id}
                onFocus={() => warm(s)}
                onClick={() => void preview(s)}
              >
                {playing === s.id ? <Stop size={14} /> : <Play size={14} />}
              </button>
              <span className="sound-name">
                <span className="ellipsis">{s.title}</span>
                <span className="sound-meta mono num">
                  {s.creator} · {s.license}
                  {s.durationMs !== null ? ` · ${seconds(s.durationMs)}` : ''}
                </span>
              </span>
              <span className="sound-use">
                <button className="btn" type="button" disabled={!canSave || busy !== null} title={canSave ? undefined : 'Set sounds in the desktop app'} onClick={() => void use(s, 'work')}>
                  Work
                </button>
                <button className="btn" type="button" disabled={!canSave || busy !== null} title={canSave ? undefined : 'Set sounds in the desktop app'} onClick={() => void use(s, 'rest')}>
                  Break
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {key && shown.length > 0 && <p className="field-help">{searching ? 'Searching the whole library for more.' : 'Enter searches the whole library for more.'}</p>}
      <p className="field-help">From Freesound through Openverse, under Creative Commons. The alarm keeps the creator's name. Words you search the whole library for go to Openverse.</p>
      {done && <p className="field-help" role="status">{done}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}
