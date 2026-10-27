import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, Keyboard, MagnifyingGlass } from '@phosphor-icons/react'
import { DEFAULT_HOTKEYS, type HotkeyAction, type MayorlyState } from '@core/index'
import { MODIFIER_KEYS, hotkeyLabel, physicalKey } from '../lib/keys'
import { conflictsOf, GLOBAL_ACTIONS, KEYS, keyLabel, keyOf, keysFor, SCOPES, setKeymapOpen, usesOf, type Scope } from '../lib/keymap'
import { reveal } from '../lib/listkeys'
import { dispatch } from '../store'

// The Keymap screen, after Minecraft's controls: sections of rows, each a thing you can do
// and the key that does it, bevelled keycaps you press and then press a key into. Sections
// and rows rank by how often this machine has used them. Everything here works by keyboard.

interface Row {
  id: string
  scope: Scope
  label: string
  note?: string
  keys: string[]
  defaults: string[]
  fixed: boolean
  range: boolean
  global: HotkeyAction | null
  changed: boolean
  uses: number
  conflicts: string[]
}

type Slot = 0 | 1

/** An Electron accelerator from a key event, or null when the shell could not register it. */
function acceleratorOf(e: KeyboardEvent): string | null {
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Cmd')
  let key: string
  if (e.code.startsWith('Key') || e.code.startsWith('Digit')) key = physicalKey(e).toUpperCase()
  else if (e.code === 'Space') key = 'Space'
  else if (/^F\d{1,2}$/.test(e.key)) key = e.key
  else if (e.key.startsWith('Arrow')) key = e.key.slice(5)
  else if (['Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) key = e.key
  else return null
  return [...mods, key].join('+')
}

const scopeTitle = (id: Scope) => SCOPES.find((x) => x.id === id)?.title ?? id

export function Keymap({ s, close }: { s: MayorlyState; close: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSelState] = useState('')
  const selRef = useRef('')
  const setSel = (id: string) => {
    selRef.current = id
    setSelState(id)
  }
  const [waiting, setWaiting] = useState<{ id: string; slot: Slot } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setKeymapOpen(true)
    return () => setKeymapOpen(false)
  }, [])

  const rows = useMemo<Row[]>(() => {
    const hk = s.settings.hotkeys
    const global: Row[] = GLOBAL_ACTIONS.map(([a, label]) => ({
      id: `global.${a}`,
      scope: 'global',
      label,
      keys: [hk[a]],
      defaults: [DEFAULT_HOTKEYS[a]],
      fixed: false,
      range: false,
      global: a,
      changed: hk[a] !== DEFAULT_HOTKEYS[a],
      uses: usesOf(`global.${a}`),
      conflicts: GLOBAL_ACTIONS.filter(([b]) => b !== a && hk[b] === hk[a]).map(([, l]) => l),
    }))
    const local: Row[] = KEYS.map((d) => {
      const keys = keysFor(d.id, s.settings)
      return {
        id: d.id,
        scope: d.scope,
        label: d.label,
        note: d.note,
        keys,
        defaults: d.keys,
        fixed: !!d.fixed,
        range: !!d.range,
        global: null,
        changed: !!s.settings.keymap?.[d.id]?.length,
        uses: usesOf(d.id),
        conflicts: d.range ? [] : conflictsOf(d.id, keys, s.settings).map((c) => `${scopeTitle(c.scope)}: ${c.label}`),
      }
    })
    return [...global, ...local]
  }, [s.settings])

  const needle = q.trim().toLowerCase()
  const sections = useMemo(() => {
    const matches = (r: Row) =>
      !needle ||
      [r.label, r.note ?? '', scopeTitle(r.scope), ...r.keys.map((k) => (r.global ? hotkeyLabel(k) : keyLabel(k)))].some((t) => t.toLowerCase().includes(needle))
    const by = SCOPES.map((sc, i) => ({
      ...sc,
      i,
      rows: rows
        .filter((r) => r.scope === sc.id && matches(r))
        .map((r, j) => ({ r, j }))
        .sort((a, b) => b.r.uses - a.r.uses || a.j - b.j)
        .map((x) => x.r),
    })).filter((sc) => sc.rows.length)
    const total = (sc: { rows: Row[] }) => sc.rows.reduce((n, r) => n + r.uses, 0)
    return by.sort((a, b) => total(b) - total(a) || a.i - b.i)
  }, [rows, needle])
  const visible = useMemo(() => sections.flatMap((sc) => sc.rows), [sections])

  useEffect(() => {
    if (!visible.some((r) => r.id === sel)) setSel(visible[0]?.id ?? '')
  }, [visible, sel])
  useEffect(() => {
    if (sel) reveal(document.querySelector(`[data-krow="${CSS.escape(sel)}"]`))
  }, [sel])

  const say = (text: string) => {
    setFlash(text)
    setTimeout(() => setFlash(null), 2500)
  }
  const setLocal = (r: Row, keys: string[]) => {
    const same = keys.length === r.defaults.length && keys.every((k, i) => k === r.defaults[i])
    const next = { ...s.settings.keymap }
    if (same) delete next[r.id]
    else next[r.id] = keys
    dispatch({ type: 'settings/update', patch: { keymap: next } })
  }
  const setGlobal = (a: HotkeyAction, accel: string) => dispatch({ type: 'settings/update', patch: { hotkeys: { ...s.settings.hotkeys, [a]: accel } } })
  const assign = (r: Row, slot: Slot, e: KeyboardEvent) => {
    if (r.global) {
      const accel = acceleratorOf(e)
      if (!accel) {
        say('A global hotkey needs Ctrl, Alt or Cmd in it')
        return
      }
      setGlobal(r.global, accel)
      return
    }
    const k = keyOf(e)
    if (!k) return
    if (slot === 0) setLocal(r, [k, ...r.keys.slice(1).filter((x) => x !== k)])
    else setLocal(r, Array.from(new Set([r.keys[0] ?? k, k])))
  }
  const reset = (r: Row) => {
    if (r.global) setGlobal(r.global, DEFAULT_HOTKEYS[r.global])
    else if (!r.fixed) setLocal(r, r.defaults)
  }
  const resetAll = () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    dispatch({ type: 'settings/update', patch: { keymap: {}, hotkeys: { ...DEFAULT_HOTKEYS } } })
    setConfirmReset(false)
  }
  const bind = (r: Row, slot: Slot) => {
    if (r.fixed || r.range) return
    setSel(r.id)
    setWaiting({ id: r.id, slot })
  }

  // This screen's own keys, ahead of everyone else's while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (waiting) {
        if (MODIFIER_KEYS.has(e.key)) return
        e.preventDefault()
        const r = rows.find((x) => x.id === waiting.id)
        if (e.key !== 'Escape' && r) assign(r, waiting.slot, e)
        setWaiting(null)
        return
      }
      if (e.target === search.current) {
        if (e.key === 'Escape') {
          e.preventDefault()
          if (q) setQ('')
          else search.current?.blur()
        } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault()
          search.current?.blur()
        }
        return
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const k = keyOf(e)
      const i = visible.findIndex((r) => r.id === selRef.current)
      const row = visible[i]
      if (k === 'Escape') close()
      else if (k === '/') {
        search.current?.focus()
        search.current?.select()
      } else if (k === 'j' || k === 'ArrowDown') setSel(visible[Math.min(i + 1, visible.length - 1)]?.id ?? '')
      else if (k === 'k' || k === 'ArrowUp') setSel(visible[Math.max(i - 1, 0)]?.id ?? '')
      else if (k === 'g') setSel(visible[0]?.id ?? '')
      else if (k === 'G') setSel(visible[visible.length - 1]?.id ?? '')
      else if (k === 'Enter' || k === 'Shift+Enter') {
        if (row) bind(row, k === 'Enter' ? 0 : 1)
      } else if (k === 'Backspace') {
        if (row) reset(row)
      } else if (k === 'Delete') {
        if (row && !row.global && !row.fixed) setLocal(row, row.keys.slice(0, 1))
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const changed = rows.filter((r) => r.changed).length

  return (
    <div className="keymap-wrap" role="dialog" aria-label="Keymap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="keymap">
        <header className="keymap-head">
          <Keyboard size={22} />
          <h2 className="keymap-title">Controls</h2>
          <label className="keymap-search">
            <MagnifyingGlass size={14} />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search  /" spellCheck={false} autoComplete="off" aria-label="Search the keymap" />
          </label>
          <span className="keymap-hint dim">{flash ?? 'j k select   Enter rebind   Backspace default   Esc done'}</span>
        </header>
        <div className="keymap-list">
          {sections.map((sc) => (
            <section key={sc.id} className="keymap-section">
              <h3 className="keymap-section-title caps">
                {sc.title}
                {sc.blurb && <span className="dim">{sc.blurb}</span>}
              </h3>
              {sc.rows.map((r) => (
                <KeyRow key={r.id} r={r} selected={sel === r.id} waiting={waiting} onSelect={() => setSel(r.id)} onBind={(slot) => bind(r, slot)} onReset={() => reset(r)} />
              ))}
            </section>
          ))}
          {visible.length === 0 && <p className="dim keymap-none">Nothing matches.</p>}
        </div>
        <footer className="keymap-foot">
          <span className="dim small">{changed === 0 ? 'Every key at its default' : `${changed} changed`}</span>
          <button type="button" className={`btn ${confirmReset ? 'warn' : 'ghost'}`} onClick={resetAll} onBlur={() => setConfirmReset(false)}>
            {confirmReset ? 'Confirm: every key back to its default' : 'Reset all'}
          </button>
          <button type="button" className="btn primary" onClick={close}>Done</button>
        </footer>
      </div>
    </div>
  )
}

function KeyRow({ r, selected, waiting, onSelect, onBind, onReset }: {
  r: Row
  selected: boolean
  waiting: { id: string; slot: Slot } | null
  onSelect: () => void
  onBind: (slot: Slot) => void
  onReset: () => void
}) {
  const cap = (k: string | undefined, slot: Slot) => {
    const isWaiting = waiting?.id === r.id && waiting.slot === slot
    const text = isWaiting ? '> ? <' : k ? (r.global ? hotkeyLabel(k) : keyLabel(k)) : '+'
    if (r.fixed) return <span className="keycap fixed">{text}</span>
    return (
      <button
        type="button"
        className={`keycap ${isWaiting ? 'is-waiting' : ''} ${!k ? 'is-empty' : ''} ${k && r.conflicts.length ? 'is-conflict' : ''}`}
        onClick={() => onBind(slot)}
        title={k ? 'Press, then the new key' : 'A second key'}
      >
        {text}
      </button>
    )
  }
  return (
    <div className={`keymap-row ${selected ? 'is-selected' : ''}`} data-krow={r.id} onClick={onSelect}>
      <div className="keymap-what">
        <span className="keymap-label">{r.label}</span>
        {r.note && <span className="keymap-note">{r.note}</span>}
        {r.conflicts.length > 0 && <span className="keymap-conflict">Also {r.conflicts.join(', ')}</span>}
      </div>
      {r.range ? <span className="keycap fixed">{keyLabel(r.keys[0])} to {keyLabel(r.keys[1])}</span> : cap(r.keys[0], 0)}
      {r.range || r.global || (r.fixed && !r.keys[1]) ? <span /> : cap(r.keys[1], 1)}
      {r.changed ? (
        <button type="button" className="icon-btn" title="Back to the default" aria-label={`Reset ${r.label}`} onClick={onReset}>
          <ArrowCounterClockwise size={14} />
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}
