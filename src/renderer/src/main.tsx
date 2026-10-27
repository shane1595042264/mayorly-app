import { StrictMode } from 'react'
import { MotionConfig } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CaptionApp } from './hud/Caption'
import { EffectsApp } from './hud/Effects'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './styles/base.css'
import './styles/hud.css'
import './styles/plus.css'
import './styles/deck.css'

// ?caption is the macOS caption window and ?effects its effects window: the same bundle,
// one job each, nothing else.
const params = new URLSearchParams(location.search)
const caption = params.has('caption')
const effects = params.has('effects')
if (caption) document.body.classList.add('caption')
if (effects) document.body.classList.add('effects')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>{caption ? <CaptionApp /> : effects ? <EffectsApp /> : <App />}</ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
)
