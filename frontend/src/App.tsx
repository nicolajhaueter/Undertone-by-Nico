import { useEffect, useRef, useState } from 'react'
import './App.css'
import Archive from './Archive'
import Studio from './Studio'
import type { StudioHandle } from './Studio'

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
  const studio = useRef<StudioHandle>(null)

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

  const status =
      connection.state === 'loading' ? { tone: 'pending', label: 'Connecting to backend…' }
      : connection.state === 'error' ? { tone: 'offline', label: 'Backend unavailable' }
      : connection.data.status === 'running' ? { tone: 'live', label: 'Backend connected' }
      : { tone: 'pending', label: `Backend: ${connection.data.status}` }

  return (
      <div className="app-shell">
        <header className="app-bar">
          <a className="wordmark" href="/">
            <span className="wordmark-title">Undertone</span>
            <span className="wordmark-signature">by Nico</span>
          </a>

          <nav className="main-nav" aria-label="Main navigation">
            {(['studio', 'archive'] as const).map(view => (
                <button
                    key={view}
                    type="button"
                    className={activeView === view ? 'nav-link is-active' : 'nav-link'}
                    aria-pressed={activeView === view}
                    onClick={() => setActiveView(view)}
                >
                  {view === 'studio' ? 'Studio' : 'Archive'}
                </button>
            ))}
          </nav>

          <span className={`backend-status is-${status.tone}`} role="status" title={status.label}>
            <span className="backend-dot" aria-hidden="true" />
            <span className="visually-hidden">{status.label}</span>
          </span>
        </header>

        <main className="app-main">
          <h1 className="visually-hidden">{activeView === 'studio' ? 'Studio' : 'Archive'}</h1>
          <div className="studio-host" hidden={activeView !== 'studio'}>
            <Studio ref={studio} active={activeView === 'studio'} />
          </div>
          {activeView === 'archive' && <div className="archive-host">
            <Archive onOpen={composition => {
              if (studio.current?.open(composition)) setActiveView('studio')
            }} />
          </div>}
        </main>
      </div>
  )
}

export default App