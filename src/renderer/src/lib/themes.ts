import type { CSSProperties } from 'react'
import type { Ledger, LedgerTheme } from '@core/index'

// A ledger's colour, as the variables the stylesheets read: --ledger, and the same at 42 and 14 percent.
// Amber is the HUD's accent, so a ledger with no theme looks as it always has.

export const THEME_COLORS: Record<LedgerTheme, string> = {
  amber: '#f0ae3c',
  teal: '#3fc8b4',
  blue: '#5ea8ff',
  green: '#8fd35a',
  rose: '#ff7f9c',
  slate: '#a3adb5',
}

export function themeVars(theme: LedgerTheme | undefined): CSSProperties {
  const c = THEME_COLORS[theme ?? 'amber'] ?? THEME_COLORS.amber
  return { '--ledger': c, '--ledger-2': `${c}6b`, '--ledger-3': `${c}24` } as CSSProperties
}

export function ledgerVars(l: Ledger | null | undefined): CSSProperties {
  return themeVars(l?.theme)
}
