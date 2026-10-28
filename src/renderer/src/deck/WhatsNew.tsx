import { useEffect } from 'react'
import { Sparkle } from '@phosphor-icons/react'
import type { BuildInfo } from '../../../shared/bridge'
import { builtOn } from '../../../shared/build'

// What changed, once per build: the first time a build launches on a machine the deck opens
// on this card. Settings can bring it back. Enter, Esc, a click outside or the button close it.

export function WhatsNew({ build, close }: { build: BuildInfo; close: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        close()
      }
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  return (
    <div className="keymap-wrap" role="dialog" aria-label="What changed" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="whatsnew">
        <header className="whatsnew-head">
          <Sparkle size={18} weight="fill" />
          <h2 className="keymap-title">Updated</h2>
        </header>
        <p className="whatsnew-when mono num">
          Mayorly {build.version}  <span className="dim">build</span> {build.commit}  <span className="dim">built</span> {builtOn(build)}
        </p>
        {build.notes ? (
          <>
            <h3 className="whatsnew-title">{build.notes.title}</h3>
            <ul className="whatsnew-list">
              {build.notes.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </>
        ) : (
          <p className="field-help">No notes came with this build.</p>
        )}
        <footer className="whatsnew-foot">
          <span className="field-help">Shown once per build. Settings brings it back.</span>
          <button type="button" className="btn primary" onClick={close}>Got it</button>
        </footer>
      </section>
    </div>
  )
}
