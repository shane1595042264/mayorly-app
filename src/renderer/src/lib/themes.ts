import type { CSSProperties } from 'react'
import type { Ledger, LedgerTheme } from '@core/index'
import { THEME_COLORS } from '../../../shared/themes'

export { distinctTheme, THEME_COLORS } from '../../../shared/themes'

// A ledger's colour, as the variables the stylesheets read: --ledger, and the same at 42 and 14 percent.
// Amber is the HUD's accent, so a ledger with no theme looks as it always has.

export function themeVars(theme: LedgerTheme | undefined): CSSProperties {
  const c = THEME_COLORS[theme ?? 'amber'] ?? THEME_COLORS.amber
  return { '--ledger': c, '--ledger-2': `${c}6b`, '--ledger-3': `${c}24` } as CSSProperties
}

export function ledgerVars(l: Ledger | null | undefined): CSSProperties {
  return themeVars(l?.theme)
}
