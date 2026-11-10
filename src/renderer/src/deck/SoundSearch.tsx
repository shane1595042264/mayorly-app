import { useRef, useState } from 'react'
import { MagnifyingGlass, Play, Stop } from '@phosphor-icons/react'
import type { AlarmKind } from '@core/index'
import { bridge } from '../bridge'
import { playDataUrl, stopAlarm } from '../lib/sound'
import { downloadSound, searchSounds, soundName, type FoundSound } from '../lib/soundSearch'

// Shop for an alarm: search the library, hear a sound, and make it the work or break alarm. The
// file is downloaded once and kept for the preview, then saved like an uploaded one.

const seconds = (ms: number | null) => (ms === null ? '' : `${Math.max(1, Math.round(ms / 1000))}s`)

export function SoundSearch({ canSave }: { canSave: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoundSound[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const files = useRef(new Map<string, Promise<string>>())

  const file = (s: FoundSound) => {
    let f = files.current.get(s.id)
    if (!f) {
      f = downloadSound(s)
      files.current.set(s.id, f)
      f.catch(() => files.current.delete(s.id))
    }
    return f
  }

  const search = async () => {
    if (!query.trim() || searching) return
    setSearching(true)
    setError(null)
    setDone(null)
    try {
      setResults(await searchSounds(query))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

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
          void search()
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a sound: bell, gong, birds, chime"
          aria-label="Search the sound library"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={!query.trim() || searching}>
          <MagnifyingGlass size={14} /> {searching ? 'Searching' : 'Search'}
        </button>
      </form>
      {results && results.length === 0 && <p className="field-help">Nothing short enough for an alarm. Try another word.</p>}
      {results && results.length > 0 && (
        <ul className="sound-results" aria-label="Sounds">
          {results.map((s) => (
            <li key={s.id} className="sound-row">
              <button
                className="icon-btn"
                type="button"
                aria-label={playing === s.id ? `Stop ${s.title}` : `Play ${s.title}`}
                disabled={busy !== null && busy !== s.id}
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
      <p className="field-help">From Freesound through Openverse, under Creative Commons. The alarm keeps the creator's name. Your search words go to Openverse.</p>
      {done && <p className="field-help" role="status">{done}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}
