import { StrictMode, Suspense, lazy } from 'react'
import { MotionConfig } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CaptionApp } from './hud/Caption'
import { DrawerApp } from './hud/Drawer'
import { SwitchLogApp } from './hud/SwitchLog'
import { EffectsApp } from './hud/Effects'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './styles/base.css'
import './styles/hud.css'
import './styles/plus.css'
import './styles/deck.css'

// ?caption is the macOS caption window, ?effects its effects window, ?drawer its quick drawer
// and ?switchlog its switch log: the same bundle, one job each, nothing else.
const params = new URLSearchParams(location.search)
const caption = params.has('caption')
const effects = params.has('effects')
const drawer = params.has('drawer')
const switchlog = params.has('switchlog')
if (caption) document.body.classList.add('caption')
if (effects) document.body.classList.add('effects')
if (drawer) document.body.classList.add('drawer-page')
if (switchlog) document.body.classList.add('switchlog-page')
// ?art in the browser build (npm run web) is the art bench, the founder's sprites as they are saved.
// Development only and never under the shell, so the desktop app's bundle does not carry it.
const Bench = import.meta.env.DEV && !window.mayorly && params.has('art') ? lazy(() => import('./bench/Bench').then((m) => ({ default: m.Bench }))) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>{Bench ? <Suspense fallback={null}><Bench /></Suspense> : caption ? <CaptionApp /> : effects ? <EffectsApp /> : drawer ? <DrawerApp /> : switchlog ? <SwitchLogApp /> : <App />}</ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
)
