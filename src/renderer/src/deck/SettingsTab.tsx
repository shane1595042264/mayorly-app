import { useState } from 'react'
import type { HotkeyAction, MayorlyState, Settings } from '@core/index'
import { dispatch } from '../store'

const HOTKEYS: [HotkeyAction, string][] = [
  ['plus', 'Swap menu'],
  ['capture', 'Capture'],
  ['deck', 'Deck'],
  ['pause', 'Hold and resume'],
  ['hide', 'Hide the HUD'],
]

export function SettingsTab({ s, kind }: { s: MayorlyState; kind: 'electron' | 'web' }) {
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
      </section>

      <section>
        <h3 className="side-title caps">Hotkeys</h3>
        <p className="field-help">Global, they work from any app. Use a modifier combo such as Alt+T or Ctrl+Shift+Space.</p>
        <div className="hotkeys">
          {HOTKEYS.map(([action, label]) => (
            <HotkeyField key={action} label={label} value={st.hotkeys[action]} onCommit={(v) => set({ hotkeys: { ...st.hotkeys, [action]: v } })} />
          ))}
        </div>
      </section>
    </div>
  )
}

function HotkeyField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  const valid = /^((Ctrl|Alt|Shift|Super|CommandOrControl)\+)+([A-Z0-9]|F\d{1,2}|Space|Tab|`)$/i.test(v)
  return (
    <label className="field">
      <span className="field-label caps">{label}</span>
      <input
        className={`mono ${valid ? '' : 'invalid'}`}
        value={v}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => (valid && v !== value ? onCommit(v) : setV(value))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {!valid && <span className="field-error">Needs a modifier and one key, like Alt+T</span>}
    </label>
  )
}

function Num({ label, help, value, min, max, onChange }: { label: string; help: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span className="field-label caps">{label}</span>
      <input className="mono num" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
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
