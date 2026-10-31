import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import './Studio.css'

type Piece = {
  id: string
  name: string
  original: string
  cutout?: string
  useOriginal: boolean
  x: number
  y: number
  width: number
  ratio: number
}

type Job = { id: string; message: string }
type Gesture = {
  id: string; pointerId: number; mode: 'move' | 'resize'
  startX: number; startY: number; x: number; y: number; width: number
}
const MAX_BYTES = 15 * 1024 * 1024
const MAX_PIXELS = 24_000_000
const BOARD_WIDTH = 1000
const BOARD_HEIGHT = 700
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function Studio() {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [job, setJob] = useState<Job>()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const board = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const urls = useRef(new Set<string>())
  const worker = useRef<Worker | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const gesture = useRef<Gesture | null>(null)
  const alive = useRef(true)
  const files = useRef(new Map<string, File>())
  const selected = pieces.find(piece => piece.id === selectedId)

  function makeUrl(blob: Blob) {
    const url = URL.createObjectURL(blob)
    urls.current.add(url)
    return url
  }

  function stopRemoval() {
    worker.current?.terminate()
    worker.current = null
    clearTimeout(timeout.current)
    setJob(undefined)
  }

  useEffect(() => {
    alive.current = true
    const allocatedUrls = urls.current
    return () => {
      alive.current = false
      worker.current?.terminate()
      clearTimeout(timeout.current)
      allocatedUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  function removeBackground(id: string, file: File) {
    stopRemoval()
    setError('')
    setJob({ id, message: 'Preparing background removal…' })
    setPieces(current => current.map(piece => piece.id === id ? { ...piece, useOriginal: true } : piece))
    try {
      const nextWorker = new Worker(new URL('./backgroundRemoval.worker.ts', import.meta.url), { type: 'module' })
      worker.current = nextWorker
      const fail = () => {
        if (worker.current !== nextWorker) return
        stopRemoval()
        setError('Background removal could not finish. Your original is safe. Check your connection and try again.')
      }
      nextWorker.onerror = fail
      nextWorker.onmessage = event => {
        if (worker.current !== nextWorker) return
        const data = event.data
        if (data.type === 'progress') {
          const percent = data.total > 0 ? Math.round(data.current / data.total * 100) : undefined
          setJob({ id, message: data.key.startsWith('fetch:')
            ? `Downloading cutout tools${percent === undefined ? '…' : ` · ${percent}%`}`
            : 'Separating your piece from its background…' })
        } else if (data.type === 'result' && data.blob instanceof Blob) {
          const cutout = makeUrl(data.blob)
          setPieces(current => current.map(piece => {
            if (piece.id !== id) return piece
            if (piece.cutout) {
              URL.revokeObjectURL(piece.cutout)
              urls.current.delete(piece.cutout)
            }
            return { ...piece, cutout, useOriginal: false }
          }))
          stopRemoval()
        } else if (data.type === 'error') fail()
      }
      timeout.current = setTimeout(fail, 180_000)
      nextWorker.postMessage(file)
    } catch {
      stopRemoval()
      setError('Background removal is unavailable in this browser. You can still arrange the original.')
    }
  }

  async function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Choose an image smaller than 15 MB.')
      return
    }
    setReading(true)
    let url: string | undefined
    try {
      url = makeUrl(file)
      const image = new Image()
      image.src = url
      await image.decode()
      if (!alive.current) return
      if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error('Choose an image under 24 megapixels.')
      const ratio = image.naturalWidth / image.naturalHeight
      const width = Math.min(300, 400 * ratio)
      const id = crypto.randomUUID()
      files.current.set(id, file)
      setPieces(current => [...current, {
        id, name: file.name, original: url!, useOriginal: true,
        x: (BOARD_WIDTH - width) / 2, y: (BOARD_HEIGHT - width / ratio) / 2, width, ratio,
      }])
      setSelectedId(id)
      removeBackground(id, file)
    } catch (cause) {
      if (url) { URL.revokeObjectURL(url); urls.current.delete(url) }
      if (alive.current) setError(cause instanceof Error && cause.message.includes('megapixels')
        ? cause.message : 'This image could not be opened. Try another JPEG, PNG or WebP.')
    } finally {
      if (alive.current) setReading(false)
    }
  }

  function begin(event: ReactPointerEvent, piece: Piece, mode: 'move' | 'resize') {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(piece.id)
    // Selecting a piece also brings it to the front.
    setPieces(current => [...current.filter(item => item.id !== piece.id), piece])
    gesture.current = {
      id: piece.id, pointerId: event.pointerId, mode,
      startX: event.clientX, startY: event.clientY, x: piece.x, y: piece.y, width: piece.width,
    }
  }

  function move(event: ReactPointerEvent) {
    const active = gesture.current
    const bounds = board.current?.getBoundingClientRect()
    if (!active || active.pointerId !== event.pointerId || !bounds?.width) return
    const dx = (event.clientX - active.startX) * BOARD_WIDTH / bounds.width
    const dy = (event.clientY - active.startY) * BOARD_HEIGHT / bounds.height
    setPieces(current => current.map(piece => {
      if (piece.id !== active.id) return piece
      if (active.mode === 'resize') {
        const maxWidth = Math.min(BOARD_WIDTH - piece.x, (BOARD_HEIGHT - piece.y) * piece.ratio)
        return { ...piece, width: clamp(active.width + dx, Math.min(60, maxWidth), maxWidth) }
      }
      return { ...piece,
        x: clamp(active.x + dx, 0, BOARD_WIDTH - piece.width),
        y: clamp(active.y + dy, 0, BOARD_HEIGHT - piece.width / piece.ratio),
      }
    }))
  }

  function end(event: ReactPointerEvent) {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null
  }

  function deleteSelected() {
    if (!selected) return
    if (job?.id === selected.id) stopRemoval()
    for (const url of [selected.original, selected.cutout]) {
      if (url) { URL.revokeObjectURL(url); urls.current.delete(url) }
    }
    files.current.delete(selected.id)
    setPieces(current => current.filter(piece => piece.id !== selected.id))
    setSelectedId(undefined)
  }

  return <section className="studio" aria-label="Studio workspace">
    <div className="studio-toolbar">
      <div>
        <button className="studio-button primary" disabled={reading || !!job} onClick={() => input.current?.click()}>Add image</button>
        <input ref={input} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose clothing image" onChange={importImage} />
        <span className="studio-hint">JPEG, PNG or WebP · up to 15 MB</span>
      </div>
      <span className="studio-hint">{pieces.length} {pieces.length === 1 ? 'piece' : 'pieces'}</span>
    </div>
    <p className="studio-note">Automatic cutouts, processed on your device. The first image downloads the cutout tools. This workspace lasts until you reload.</p>
    <div className="studio-feedback" aria-live="polite" role="status">
      {reading ? 'Opening image…' : job?.message}
      {job && <button className="text-button" onClick={stopRemoval}>Use original</button>}
    </div>
    {error && <p className="studio-error" role="alert">{error}</p>}
    <div ref={board} className="studio-board" aria-label="Outfit composition canvas" onPointerDown={() => setSelectedId(undefined)}>
      {pieces.length === 0 && <div className="studio-empty"><p>Your next composition starts here.</p><span>Add a piece, then drag it into place.</span></div>}
      {pieces.map(piece => <div key={piece.id}
        className={`studio-piece${selectedId === piece.id ? ' selected' : ''}`}
        style={{ left: `${piece.x / 10}%`, top: `${piece.y / 7}%`, width: `${piece.width / 10}%`, aspectRatio: piece.ratio }}
        onPointerDown={event => begin(event, piece, 'move')} onPointerMove={move}
        onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
        tabIndex={0} role="button" aria-label={`Move ${piece.name}`} aria-pressed={selectedId === piece.id}
        onFocus={() => setSelectedId(piece.id)}
        onKeyDown={event => {
          const delta = event.shiftKey ? 20 : 5
          const offsets: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
          const offset = offsets[event.key]
          if (offset) {
            event.preventDefault()
            setPieces(current => current.map(item => item.id === piece.id ? { ...item,
              x: clamp(item.x + offset[0], 0, BOARD_WIDTH - item.width),
              y: clamp(item.y + offset[1], 0, BOARD_HEIGHT - item.width / item.ratio),
            } : item))
          }
        }}>
        <img src={piece.useOriginal ? piece.original : piece.cutout ?? piece.original} alt={piece.name} draggable={false} />
        {selectedId === piece.id && <span className="resize-handle" aria-hidden="true" onPointerDown={event => begin(event, piece, 'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} />}
      </div>)}
    </div>
    {selected && <div className="piece-controls" aria-label="Selected piece controls">
      <span className="piece-name" title={selected.name}>{selected.name}</span>
      <label className="size-control">Size <input aria-label="Piece size" type="range" min={Math.min(60, selected.width)} max={Math.min(BOARD_WIDTH - selected.x, (BOARD_HEIGHT - selected.y) * selected.ratio)} value={selected.width} onChange={event => {
        const width = Number(event.target.value)
        setPieces(current => current.map(piece => piece.id === selected.id ? { ...piece, width } : piece))
      }} /></label>
      {selected.cutout && <button className="studio-button" onClick={() => {
        if (job?.id === selected.id) stopRemoval()
        setPieces(current => current.map(piece => piece.id === selected.id ? { ...piece, useOriginal: !piece.useOriginal } : piece))
      }}>{selected.useOriginal ? 'Use cutout' : 'Use original'}</button>}
      {!job && <button className="studio-button" onClick={() => {
        const file = files.current.get(selected.id)
        if (file) removeBackground(selected.id, file)
      }}>Retry cutout</button>}
      <button className="studio-button" onClick={deleteSelected}>Remove piece</button>
    </div>}
    <p className="studio-note">Drag to arrange · use the corner or Size control to resize · arrow keys move a selected piece</p>
  </section>
}
