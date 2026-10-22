// Account and sync configuration. Values are inlined at build time from .env files
// (electron-vite exposes MAIN_VITE_* to the main process); a plain environment
// variable overrides them in development. The Google client id and the desktop
// client's secret are not confidential for an installed app, per Google's own
// docs, but the secret still lives in .env.local so it stays out of the repo.

const env = import.meta.env as Record<string, string | undefined>
const pick = (name: string) => process.env[name] ?? env[name] ?? ''

export const config = {
  /** The mayorly-api service. Empty disables accounts entirely. */
  apiUrl: pick('MAIN_VITE_API_URL').replace(/\/$/, ''),
  googleClientId: pick('MAIN_VITE_GOOGLE_CLIENT_ID'),
  googleClientSecret: pick('MAIN_VITE_GOOGLE_CLIENT_SECRET'),
}

export const accountsConfigured = () => !!(config.apiUrl && config.googleClientId)
