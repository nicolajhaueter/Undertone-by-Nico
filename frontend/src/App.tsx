import { useEffect, useState } from 'react'
import './App.css'

type BackendStatus = {
  name: string
  status: string
}

type ConnectionState =
    | { state: 'loading' }
    | { state: 'success'; data: BackendStatus }
    | { state: 'error'; message: string }

function App() {
  const [activeView, setActiveView] = useState<'studio' | 'archive'>('studio')

  const [connection, setConnection] = useState<ConnectionState>({
    state: 'loading',
  })

  useEffect(() => {
    const controller = new AbortController()

    async function loadStatus() {
      try {
        const response = await fetch('/api/status', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Backend returned HTTP ${response.status}`)
        }

        const data: unknown = await response.json()

        if (
            typeof data !== 'object' ||
            data === null ||
            !('name' in data) ||
            !('status' in data) ||
            typeof data.name !== 'string' ||
            typeof data.status !== 'string'
        ) {
          throw new Error('The backend returned an unexpected response.')
        }

        if (!controller.signal.aborted) {
          setConnection({
            state: 'success',
            data: { name: data.name, status: data.status },
          })
        }
      } catch (error) {
        if (controller.signal.aborted) return

        setConnection({
          state: 'error',
          message:
              error instanceof Error
                  ? error.message
                  : 'Could not connect to the backend.',
        })
      }
    }

    void loadStatus()

    return () => controller.abort()
  }, [])

  return (
      <div className="app-shell">
        <header className="app-header">
          <a className="wordmark" href="/">
            <span className="wordmark-title">Undertone</span>
            <span className="wordmark-signature">by Nico</span>
          </a>

          <nav className="main-nav" aria-label="Main navigation">
            <button
                type="button"
                className={
                  activeView === 'studio' ? 'nav-link is-active' : 'nav-link'
                }
                aria-pressed={activeView === 'studio'}
                onClick={() => setActiveView('studio')}
            >
              Studio
            </button>

            <button
                type="button"
                className={
                  activeView === 'archive' ? 'nav-link is-active' : 'nav-link'
                }
                aria-pressed={activeView === 'archive'}
                onClick={() => setActiveView('archive')}
            >
              Archive
            </button>
          </nav>

          <span className="header-caption">A personal fashion space</span>
        </header>

        <main className="view-content">
          <div className="view-heading">
            <p className="eyebrow">
              {activeView === 'studio' ? '01 / Workspace' : '02 / Collection'}
            </p>

            <h1>{activeView === 'studio' ? 'Studio' : 'Archive'}</h1>

            <p className="view-description">
              {activeView === 'studio'
                  ? 'A space to explore pieces, study details, and compose looks.'
                  : 'A collection of looks, references, and ideas to return to.'}
            </p>
          </div>

          <section
              className="empty-space"
              aria-label={
                activeView === 'studio' ? 'Studio workspace' : 'Archive collection'
              }
          >
            <p>
              {activeView === 'studio'
                  ? 'Your next composition starts here.'
                  : 'Your collection will take shape here.'}
            </p>
          </section>
        </main>

        <footer className="app-footer">
          <span>Undertone by Nico</span>

          <span aria-live="polite">
          {connection.state === 'loading' && 'Connecting…'}

            {connection.state === 'success' &&
                (connection.data.status === 'running'
                    ? 'Backend connected'
                    : `Backend: ${connection.data.status}`)}

            {connection.state === 'error' && 'Backend unavailable'}
        </span>
        </footer>
      </div>
  )
}

export default App