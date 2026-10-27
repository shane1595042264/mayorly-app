import { Component, type ReactNode } from 'react'
import { bridge } from '../bridge'

// One throw in a render must not leave an invisible window. The state lives in the main
// process, so a reload loses nothing; until then, the smallest possible card says what happened.

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    bridge.log('error', `${error.stack ?? error.message}\n${info.componentStack ?? ''}`)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="hud-error" role="alert">
        <p className="hud-error-title">The HUD hit an error and stopped drawing.</p>
        <p className="hud-error-text mono">{this.state.error.message}</p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
