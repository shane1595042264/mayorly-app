import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'

// Search for Settings, on the desktop's deck and on the phone. Nothing is listed by hand: the
// index is read from the page as it stands, section titles and the labels of every field, toggle
// and row, so a setting is findable the moment it exists. An element can add the words people
// would look for under `data-setting` ("passphrase" on key sync, "Google" on the account).
// Choosing a result scrolls it to the middle of the view and flashes a ring around it, then puts
// the cursor in its first field.

const SOURCES = '[data-setting], .side-title, .section-title, .field-label, .check > span:last-child, .row-title, .label'
const HEADINGS = '.side-title, .section-title'
/** What a found label stands for: the field, row or toggle it labels, else itself. */
const HOLDER = '[data-setting], label.field, .field, label.check, .check, .row, .key-sync, section'

export interface SettingHit {
  el: HTMLElement
  label: string
  section: string
  extra: string
}

function indexOf(root: HTMLElement): SettingHit[] {
  const out: SettingHit[] = []
  const seen = new Set<HTMLElement>()
  let section = ''
  for (const node of root.querySelectorAll<HTMLElement>(SOURCES)) {
    const own = node.getAttribute('data-setting')
    const text = (own ? own.split(',')[0] : node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (node.matches(HEADINGS)) {
      section = text
      const el = (node.closest('section') as HTMLElement | null) ?? node
      if (!seen.has(el)) {
        seen.add(el)
        out.push({ el, label: text, section: '', extra: own ?? '' })
      }
      continue
    }
    const el = (own ? node : (node.parentElement?.closest(HOLDER) as HTMLElement | null)) ?? node
    if (seen.has(el)) continue
    seen.add(el)
    out.push({ el, label: text.length > 60 ? `${text.slice(0, 59)}…` : text, section, extra: own ?? '' })
  }
  return out
}

/** Best first: a label that starts with the words, then one with every word in it, then a match on its section or extra words. */
export function rank(index: SettingHit[], query: string, limit = 8): SettingHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { hit: SettingHit; score: number }[] = []
  for (const hit of index) {
    const label = hit.label.toLowerCase()
    const all = `${label} ${hit.section.toLowerCase()} ${hit.extra.toLowerCase()}`
    if (!words.every((w) => all.includes(w))) continue
    let score = 3
    if (label.startsWith(words.join(' '))) score = 0
    else if (words.every((w) => label.split(/[^a-z0-9]+/).some((t) => t.startsWith(w)))) score = 1
    else if (words.every((w) => label.includes(w))) score = 2
    scored.push({ hit, score })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.hit)
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** To the setting: centred, ringed, and the cursor in its first field once the scroll lands. */
export function jumpTo(el: HTMLElement) {
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' })
  el.classList.remove('setting-flash')
  // A fresh class restarts the animation when the same setting is chosen twice.
  void el.offsetWidth
  el.classList.add('setting-flash')
  window.setTimeout(() => el.classList.remove('setting-flash'), 2000)
  window.setTimeout(() => {
    const field = el.querySelector<HTMLElement>('input:not([type=checkbox]), textarea, select')
    field?.focus({ preventScroll: true })
  }, reduced() ? 0 : 420)
}

/** The part of the label that matched, in bold. */
function marked(label: string, query: string): ReactNode {
  const w = query.trim().split(/\s+/)[0]?.toLowerCase()
  const i = w ? label.toLowerCase().indexOf(w) : -1
  if (i < 0) return label
  return <>{label.slice(0, i)}<b>{label.slice(i, i + w.length)}</b>{label.slice(i + w.length)}</>
}

/**
 * The search box. `root` is the settings page it searches. The results drop under the box; arrow
 * keys and Enter work as in any list, Escape clears. On the desktop `/` focuses it.
 */
export function SettingsSearch({ root, placeholder = 'Search settings' }: { root: RefObject<HTMLElement | null>; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => (root.current && q.trim() ? rank(indexOf(root.current), q) : []), [q, root])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const choose = (hit: SettingHit | undefined) => {
    if (!hit) return
    setOpen(false)
    input.current?.blur()
    jumpTo(hit.el)
  }

  return (
    <div className="settings-search" role="search">
      <MagnifyingGlass size={18} className="settings-search-icon" aria-hidden />
      <input
        ref={input}
        type="search"
        value={q}
        placeholder={placeholder}
        aria-label="Search settings"
        aria-expanded={open && hits.length > 0}
        aria-controls="settings-search-results"
        role="combobox"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((n) => Math.min(hits.length - 1, n + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((n) => Math.max(0, n - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(hits[sel])
          } else if (e.key === 'Escape') {
            setQ('')
            input.current?.blur()
          }
        }}
      />
      {q && (
        <button type="button" className="settings-search-clear" aria-label="Clear the search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ('')}>
          <X size={14} />
        </button>
      )}
      {open && q.trim() && (
        <ul className="settings-search-results" id="settings-search-results" role="listbox">
          {hits.map((h, i) => (
            <li key={i} role="option" aria-selected={i === sel}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => choose(h)}>
                <span className="settings-search-label">{marked(h.label, q)}</span>
                {h.section && <span className="settings-search-section">{h.section}</span>}
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="settings-search-none">Nothing in Settings by that name.</li>}
        </ul>
      )}
    </div>
  )
}
