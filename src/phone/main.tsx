import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'
import { PhoneEngine } from './engine'
import { startAccount } from './account'
import { startClerk } from './ai'
import { scheduleAlarms } from './notify'
import { Capacitor } from '@capacitor/core'
import { native } from './platform'
import { setEngine } from './store'
import { applyStagedAtLaunch, checkForUpdate, markBooted } from './updater'
import { App } from './ui/App'
import './phone.css'

async function boot() {
  // A bundle downloaded last session goes in first; the page reloads into it.
  if (applyStagedAtLaunch()) return
  // One line in the device log saying what this bundle can reach natively, for diagnosing an install.
  if (native) console.log('[phone] native plugins', JSON.stringify(((window as { Capacitor?: { PluginHeaders?: { name: string }[] } }).Capacitor?.PluginHeaders ?? []).map((h) => h.name)), 'AuthSession', Capacitor.isPluginAvailable('AuthSession'))
  const engine = await PhoneEngine.boot()
  setEngine(engine)
  if (native) void StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  // A ripe tomato is felt as well as seen.
  engine.onEvents((events) => {
    if (native && events.some((e) => e.type === 'tomato')) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  })
  engine.on((s) => void scheduleAlarms(s, engine.deviceId))
  // ?demo and ?fresh in a browser: the console (and scripts/shot.cjs) can read and drive it, as on the desktop's web build.
  if (engine.scratch) Object.assign(window, { __mayorly: { state: () => engine.state, dispatch: (a: Parameters<typeof engine.act>[0]) => engine.act(a) } })
  engine.start()
  void scheduleAlarms(engine.state, engine.deviceId)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  await startAccount(engine)
  await startClerk(engine)
  markBooted()
  void checkForUpdate()
}

void boot()
