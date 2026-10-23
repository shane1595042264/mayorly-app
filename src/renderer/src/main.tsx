import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CaptionApp } from './hud/Caption'
import './styles/base.css'
import './styles/hud.css'
import './styles/plus.css'
import './styles/deck.css'

// ?caption is the macOS caption window: the same bundle, one line of text, nothing else.
const caption = new URLSearchParams(location.search).has('caption')
if (caption) document.body.classList.add('caption')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {caption ? <CaptionApp /> : <App />}
  </StrictMode>,
)
