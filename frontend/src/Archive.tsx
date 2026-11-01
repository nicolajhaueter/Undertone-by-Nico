import { useEffect, useState } from 'react'
import './Archive.css'
import { deleteComposition, imageUrl, listCompositions } from './api'
import type { Composition } from './api'

type State =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; compositions: Composition[] }

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// Preview cards are 10:7; lay pieces out in that 1000 x 700 frame.
const FRAME_WIDTH = 1000
const FRAME_HEIGHT = 700
const FILL = 0.84

/**
 * Pieces can sit anywhere on the infinite canvas, so each preview frames the
 * composition's own bounds, centred, keeping proportions. Returns CSS percentages.
 */
function previewLayout(pieces: Composition['pieces']) {
  if (pieces.length === 0) return []
  const left = Math.min(...pieces.map(piece => piece.x))
  const top = Math.min(...pieces.map(piece => piece.y))
  const right = Math.max(...pieces.map(piece => piece.x + piece.width))
  const bottom = Math.max(...pieces.map(piece => piece.y + piece.width / piece.ratio))
  const scale = Math.min(FRAME_WIDTH * FILL / (right - left), FRAME_HEIGHT * FILL / (bottom - top))
  const offsetX = (FRAME_WIDTH - (right - left) * scale) / 2
  const offsetY = (FRAME_HEIGHT - (bottom - top) * scale) / 2
  return pieces.map(piece => ({
    left: `${(offsetX + (piece.x - left) * scale) / FRAME_WIDTH * 100}%`,
    top: `${(offsetY + (piece.y - top) * scale) / FRAME_HEIGHT * 100}%`,
    width: `${piece.width * scale / FRAME_WIDTH * 100}%`,
    aspectRatio: piece.ratio,
  }))
}

export default function Archive({ onOpen }: { onOpen: (composition: Composition) => void }) {
  const [view, setView] = useState<State>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    listCompositions(controller.signal)
      .then(compositions => setView({ state: 'ready', compositions }))
      .catch(cause => {
        if (!controller.signal.aborted) setView({ state: 'error', message: cause instanceof Error ? cause.message : '' })
      })
    return () => controller.abort()
  }, [attempt])

  async function remove(composition: Composition) {
    if (!window.confirm(`Delete “${composition.title}”? This cannot be undone.`)) return
    setError('')
    try {
      await deleteComposition(composition.id)
    } catch (cause) {
      // Already gone elsewhere: the goal is reached, so just refresh the list.
      if (!(cause instanceof Error && 'status' in cause && cause.status === 404)) {
        setError(`Could not delete “${composition.title}”: ${cause instanceof Error ? cause.message : 'the backend is unavailable.'}`)
        return
      }
    }
    setView(current => current.state === 'ready'
      ? { state: 'ready', compositions: current.compositions.filter(item => item.id !== composition.id) }
      : current)
  }

  if (view.state === 'loading') {
    return <section className="empty-space" aria-label="Archive collection" aria-busy="true"><p>Gathering your collection…</p></section>
  }
  if (view.state === 'error') {
    return <section className="empty-space" aria-label="Archive collection">
      <div className="archive-message">
        <p>Archive is unavailable.</p>
        <span>Start PostgreSQL and the backend, then try again.{view.message && ` (${view.message})`}</span>
        <button className="archive-action" onClick={() => { setView({ state: 'loading' }); setAttempt(value => value + 1) }}>Try again</button>
      </div>
    </section>
  }
  if (view.compositions.length === 0) {
    return <section className="empty-space" aria-label="Archive collection">
      <p>Your collection will take shape here.</p>
    </section>
  }

  return <section className="archive" aria-label="Archive collection">
    {error && <p className="archive-error" role="alert">{error}</p>}
    <ul className="archive-grid">
      {view.compositions.map(composition => { const layout = previewLayout(composition.pieces); return <li key={composition.id} className="archive-card">
        <button className="archive-preview" aria-label={`Open ${composition.title}`} onClick={() => onOpen(composition)}>
          {composition.pieces.map((piece, index) => <img key={index} alt="" draggable={false}
            src={imageUrl(piece.shown === 'cutout' && piece.cutoutImageId ? piece.cutoutImageId : piece.originalImageId)}
            style={layout[index]} />)}
        </button>
        <div className="archive-meta">
          <h2>{composition.title}</h2>
          <p>
            {composition.pieces.length} {composition.pieces.length === 1 ? 'piece' : 'pieces'}
            {' · '}
            <time dateTime={composition.updatedAt}>{dateFormat.format(new Date(composition.updatedAt))}</time>
          </p>
          <div className="archive-actions">
            <button className="archive-action" onClick={() => onOpen(composition)}>Open</button>
            <button className="archive-action" aria-label={`Delete ${composition.title}`} onClick={() => void remove(composition)}>Delete</button>
          </div>
        </div>
      </li> })}
    </ul>
  </section>
}
