import { StrictMode } from 'react'
import { MotionConfig } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CaptionApp } from './hud/Caption'
import { DrawerApp } from './hud/Drawer'
import { EffectsApp } from './hud/Effects'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './styles/base.css'
import './styles/hud.css'
import './styles/plus.css'
import './styles/deck.css'

// ?caption is the macOS caption window, ?effects its effects window and ?drawer its quick
// drawer: the same bundle, one job each, nothing else.
const params = new URLSearchParams(location.search)
const caption = params.has('caption')
const effects = params.has('effects')
const drawer = params.has('drawer')
if (caption) document.body.classList.add('caption')
if (effects) document.body.classList.add('effects')
if (drawer) document.body.classList.add('drawer-page')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>{caption ? <CaptionApp /> : effects ? <EffectsApp /> : drawer ? <DrawerApp /> : <App />}</ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
)
