import type { BuildInfo } from './bridge'

/** This bundle's build, or a stand-in when it was not stamped (tests, a bare dev server). */
export const BUILD: BuildInfo =
  typeof __MAYORLY_BUILD__ !== 'undefined' ? __MAYORLY_BUILD__ : { version: '0.0.0', commit: 'local', builtAt: 0, notes: null }

/** "Oct 28, 2026, 9:36 PM" in the machine's own locale. */
export function builtOn(b: { builtAt: number }): string {
  return b.builtAt ? new Date(b.builtAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unstamped'
}
