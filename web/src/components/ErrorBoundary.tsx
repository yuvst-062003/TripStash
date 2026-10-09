/**
 * The last line between a rendering bug and a blank white screen.
 *
 * A thrown render takes the whole React tree down with it, and on a phone a
 * blank page looks like the app has gone, not like one card could not draw.
 * This catches the throw, says so in one sentence, and offers the reload
 * that would otherwise be the traveller's only guess.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep it visible in the console for whoever is debugging; nothing here
    // is sent anywhere.
    console.error('TripStash could not draw this screen', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="pad stack" role="alert" style={{ paddingTop: 'var(--s-8)' }}>
        <h1 className="t-lg">Something went wrong drawing this screen</h1>
        <p className="t dim">
          Nothing you saved is affected. Reload and it comes back; if it keeps happening,
          tell us what you pressed.
        </p>
        <p className="t-sm dimmer" dir="auto">
          {this.state.error.message}
        </p>
        <button className="btn btn--accent btn--block" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
