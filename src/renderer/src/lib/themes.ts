import type { CSSProperties } from 'react'
import { LEDGER_THEMES, type Ledger, type LedgerTheme } from '@core/index'

// A ledger's colour, as the variables the stylesheets read: --ledger, and the same at 42 and 14 percent.
// Amber is the HUD's accent, so a ledger with no theme looks as it always has.

export const THEME_COLORS: Record<LedgerTheme, string> = {
  amber: '#f0ae3c',
  orange: '#ff8a3d',
  coral: '#ff6f61',
  rose: '#ff7f9c',
  magenta: '#e06bd0',
  indigo: '#8a7dff',
  blue: '#5ea8ff',
  sky: '#5fd3f3',
  teal: '#3fc8b4',
  green: '#8fd35a',
  lime: '#cfe84a',
  slate: '#a3adb5',
}

export function themeVars(theme: LedgerTheme | undefined): CSSProperties {
  const c = THEME_COLORS[theme ?? 'amber'] ?? THEME_COLORS.amber
  return { '--ledger': c, '--ledger-2': `${c}6b`, '--ledger-3': `${c}24` } as CSSProperties
}

export function ledgerVars(l: Ledger | null | undefined): CSSProperties {
  return themeVars(l?.theme)
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** How far apart two colours look: the "redmean" weighting of RGB, close enough for twelve swatches. */
function apart(a: LedgerTheme, b: LedgerTheme): number {
  const [r1, g1, b1] = rgb(THEME_COLORS[a])
  const [r2, g2, b2] = rgb(THEME_COLORS[b])
  const r = (r1 + r2) / 2
  return Math.sqrt((2 + r / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - r) / 256) * (b1 - b2) ** 2)
}

/** The colour for a ledger that sets it apart from the others: one nobody wears if any is left,
 * the least worn otherwise, and among those the one farthest from every colour already worn.
 * A ledger with no theme wears amber. Ties go to the order of the palette. */
export function distinctTheme(worn: (LedgerTheme | undefined)[]): LedgerTheme {
  const on = worn.map((t) => t ?? 'amber')
  const count = (t: LedgerTheme) => on.filter((w) => w === t).length
  const least = Math.min(...LEDGER_THEMES.map(count))
  let best: LedgerTheme = LEDGER_THEMES[0]
  let bestGap = -1
  for (const t of LEDGER_THEMES) {
    if (count(t) !== least) continue
    const others = on.filter((w) => w !== t)
    const gap = others.length ? Math.min(...others.map((w) => apart(t, w))) : Infinity
    if (gap > bestGap) {
      best = t
      bestGap = gap
    }
  }
  return best
}
