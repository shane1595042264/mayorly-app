import type { CSSProperties } from 'react'

// Dancing letters, as Balatro sets its words: each letter bobs and tilts on its own beat, a little
// behind the one before, so a line of text ripples. Words stay whole, so a line breaks between them.
// Text only, never a sprite. `still` keeps the letters at rest (reduced motion).

export function Wobble({ text, className, still = false }: { text: string; className?: string; still?: boolean }) {
  let i = 0
  return (
    <span className={`wobble ${still ? 'is-still' : ''} ${className ?? ''}`} aria-label={text}>
      {text.split(/(\s+)/).map((word, w) =>
        /^\s*$/.test(word) ? (
          ' '
        ) : (
          <span className="wobble-word" key={w} aria-hidden>
            {[...word].map((ch) => (
              <span className="wobble-ch" key={i} style={{ '--i': i++ } as CSSProperties}>
                {ch}
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  )
}
