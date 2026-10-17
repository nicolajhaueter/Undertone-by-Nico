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
      <main>
        <h1>Undertone</h1>
        <p>by Nico</p>

        <section aria-label="Backend connection" aria-live="polite">
          {connection.state === 'loading' && <p>Connecting…</p>}

          {connection.state === 'success' && (
              <>
                <h2>{connection.data.name}</h2>
                <p>Backend status: {connection.data.status}</p>
              </>
          )}

          {connection.state === 'error' && (
              <p role="alert">{connection.message}</p>
          )}
        </section>
      </main>
  )
}

export default App