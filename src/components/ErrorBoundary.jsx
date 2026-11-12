// Catches a screen that crashes while drawing, so staff see what happened and a way out instead of
// a blank page. The message (and the screen's address) is what to send when reporting it.
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('Screen error:', error, info?.componentStack)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main className="main" style={{ maxWidth: 620, margin: '10vh auto', padding: '0 16px' }}>
        <div className="card card-pad stack">
          <h1 style={{ margin: 0, fontSize: 'var(--fs-h2)' }}>This screen couldn’t open</h1>
          <p style={{ margin: 0 }}>Something on this page went wrong. Nothing was saved or lost. Reload the page, or go back to the Dashboard. If it keeps happening, send this message to whoever looks after the app:</p>
          <pre className="error-detail">{`${window.location.pathname}${window.location.search}\n${error?.message || String(error)}`}</pre>
          <div className="inline-row">
            <button type="button" className="btn" onClick={() => window.location.reload()}>Reload Page</button>
            <a className="btn btn-quiet" href="/">Go to Dashboard</a>
          </div>
        </div>
      </main>
    )
  }
}
