import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, Ref } from 'react'
import './Studio.css'
import { ApiError, createComposition, imageUrl, updateComposition, uploadImage } from './api'
import type { Composition, CompositionInput } from './api'
import { prepareForUpload } from './imagePrep'

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
  /** Server ids once uploaded; unset until the first save. */
  originalImageId?: string
  cutoutImageId?: string
}

type Job = { id: string; message: string }
type Gesture =
  | { mode: 'move' | 'resize'; id: string; pointerId: number; startX: number; startY: number; x: number; y: number; width: number }
  | { mode: 'pan'; pointerId: number; startX: number; startY: number; cx: number; cy: number }
/** The world point shown at the centre of the canvas, and the zoom factor (1 = 100 %). */
type View = { cx: number; cy: number; zoom: number }
const MAX_BYTES = 15 * 1024 * 1024
const MAX_PIXELS = 24_000_000
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const MIN_WIDTH = 20
const GRID = 24
// Saved compositions predate the infinite canvas and sit within 1000 x 700; start there.
const HOME: View = { cx: 500, cy: 350, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const UNTITLED = 'Untitled composition'

/** What a save would store; comparing snapshots tells whether there are unsaved changes. */
const snapshotOf = (title: string, pieces: Piece[]) => JSON.stringify([
  title.trim(),
  pieces.map(piece => [piece.original, piece.cutout ?? null, piece.useOriginal, piece.x, piece.y, piece.width]),
])
const EMPTY_SNAPSHOT = snapshotOf('', [])

async function uploadFrom(url: string) {
  const source = await (await fetch(url)).blob()
  return uploadImage(await prepareForUpload(source))
}

export type StudioHandle = {
  /** Loads a saved composition, asking first if it would discard unsaved work. Returns whether it loaded. */
  open: (composition: Composition) => boolean
}

export default function Studio({ active = true, ref }: { active?: boolean; ref?: Ref<StudioHandle> }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [job, setJob] = useState<Job>()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [compositionId, setCompositionId] = useState<string>()
  const [savedSnapshot, setSavedSnapshot] = useState(EMPTY_SNAPSHOT)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const board = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(HOME)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight - 52 })
  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const urls = useRef(new Set<string>())
  const worker = useRef<Worker | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const gesture = useRef<Gesture | null>(null)
  const alive = useRef(true)
  const importing = useRef(false)
  const files = useRef(new Map<string, File>())
  const selected = pieces.find(piece => piece.id === selectedId)
  const dirty = snapshotOf(title, pieces) !== savedSnapshot

  useEffect(() => {
    if (!dirty || pieces.length === 0) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pieces.length])

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
            return { ...piece, cutout, cutoutImageId: undefined, useOriginal: false }
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

  async function importFile(file: File) {
    // Guard synchronously: several paste events can arrive before React renders.
    if (importing.current || worker.current) {
      setError('Wait for the current image to finish, or choose Use original before pasting another.')
      return
    }
    setError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Choose an image smaller than 15 MB.')
      return
    }
    importing.current = true
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
        // Land in the middle of what is on screen, at about the same on-screen size at any zoom.
        x: view.cx - width / view.zoom / 2, y: view.cy - width / view.zoom / ratio / 2, width: width / view.zoom, ratio,
      }])
      setSelectedId(id)
      removeBackground(id, file)
    } catch (cause) {
      if (url) { URL.revokeObjectURL(url); urls.current.delete(url) }
      if (alive.current) setError(cause instanceof Error && cause.message.includes('megapixels')
        ? cause.message : 'This image could not be opened. Try another JPEG, PNG or WebP.')
    } finally {
      importing.current = false
      if (alive.current) setReading(false)
    }
  }

  function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void importFile(file)
  }

  const pasteImage = useEffectEvent((event: ClipboardEvent) => {
    // Preserve normal paste behaviour in present and future text controls.
    if (event.defaultPrevented) return
    const target = event.target
    if (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, [role="textbox"]'))) return
    const item = Array.from(event.clipboardData?.items ?? [])
      .find(item => item.kind === 'file' && item.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (!file) return
    event.preventDefault()
    void importFile(file)
  })

  useEffect(() => {
    if (!active) return
    const onPaste = (event: ClipboardEvent) => pasteImage(event)
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [active])

  function begin(event: ReactPointerEvent, piece: Piece, mode: 'move' | 'resize') {
    if (event.button !== 0) return
    if (spaceHeld) return // Let the canvas pan instead.
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

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(undefined)
    setPanning(true)
    gesture.current = { mode: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cx: view.cx, cy: view.cy }
  }

  function move(event: ReactPointerEvent) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    // Screen pixels to world units.
    const dx = (event.clientX - active.startX) / view.zoom
    const dy = (event.clientY - active.startY) / view.zoom
    if (active.mode === 'pan') {
      setView(current => ({ ...current, cx: active.cx - dx, cy: active.cy - dy }))
      return
    }
    setPieces(current => current.map(piece => {
      if (piece.id !== active.id) return piece
      if (active.mode === 'resize') return { ...piece, width: Math.max(MIN_WIDTH, active.width + dx) }
      return { ...piece, x: active.x + dx, y: active.y + dy }
    }))
  }

  function end(event: ReactPointerEvent) {
    if (gesture.current?.pointerId !== event.pointerId) return
    gesture.current = null
    setPanning(false)
  }

  /** Zooms keeping the world point under (screenX, screenY) fixed; defaults to the canvas centre. */
  function zoomTo(nextZoom: number, screenX = size.width / 2, screenY = size.height / 2) {
    setView(current => {
      const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
      const worldX = current.cx + (screenX - size.width / 2) / current.zoom
      const worldY = current.cy + (screenY - size.height / 2) / current.zoom
      return { zoom, cx: worldX - (screenX - size.width / 2) / zoom, cy: worldY - (screenY - size.height / 2) / zoom }
    })
  }

  /** Live canvas size; Studio is hidden while Archive is open, so fall back to the window. */
  function measure() {
    const rect = board.current?.getBoundingClientRect()
    return rect && rect.width > 0 ? { width: rect.width, height: rect.height } : { width: window.innerWidth, height: window.innerHeight - 52 }
  }

  function fitView(target: Piece[] = pieces) {
    if (target.length === 0) { setView(HOME); return }
    const size = measure()
    const left = Math.min(...target.map(piece => piece.x))
    const top = Math.min(...target.map(piece => piece.y))
    const right = Math.max(...target.map(piece => piece.x + piece.width))
    const bottom = Math.max(...target.map(piece => piece.y + piece.width / piece.ratio))
    const zoom = clamp(Math.min(size.width * 0.75 / (right - left), size.height * 0.7 / (bottom - top)), MIN_ZOOM, 2)
    setView({ zoom, cx: (left + right) / 2, cy: (top + bottom) / 2 })
  }

  useEffect(() => {
    const element = board.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      // Hidden (Archive open) reports zero; keep the last real size.
      if (entry.contentRect.width > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Wheel and pinch need a non-passive listener to stop the browser scrolling or zooming the page.
  const wheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const bounds = board.current!.getBoundingClientRect()
      zoomTo(view.zoom * Math.exp(-event.deltaY * 0.01), event.clientX - bounds.left, event.clientY - bounds.top)
    } else {
      setView(current => ({ ...current, cx: current.cx + event.deltaX / current.zoom, cy: current.cy + event.deltaY / current.zoom }))
    }
  })

  useEffect(() => {
    const element = board.current
    if (!element) return
    const onWheel = (event: WheelEvent) => wheel(event)
    const stopGesture = (event: Event) => event.preventDefault() // Safari pinch
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('gesturestart', stopGesture)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('gesturestart', stopGesture)
    }
  }, [])

  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea'))) return
    if (event.type === 'keyup') {
      if (event.code === 'Space') setSpaceHeld(false)
      return
    }
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); setSpaceHeld(true); return }
    const command = event.metaKey || event.ctrlKey
    if (command && (event.key === '=' || event.key === '+')) { event.preventDefault(); zoomTo(view.zoom * 1.25) }
    else if (command && event.key === '-') { event.preventDefault(); zoomTo(view.zoom / 1.25) }
    else if (command && event.key === '0') { event.preventDefault(); zoomTo(1) }
    else if (event.shiftKey && event.code === 'Digit1') { event.preventDefault(); fitView() }
  })

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => shortcut(event)
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onKey)
    }
  }, [active])

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

  function confirmDiscard() {
    return !dirty || pieces.length === 0 || window.confirm('Replace the current composition? Unsaved changes will be lost.')
  }

  function clearCanvas() {
    stopRemoval()
    urls.current.forEach(url => URL.revokeObjectURL(url))
    urls.current.clear()
    files.current.clear()
    setPieces([])
    setSelectedId(undefined)
    setError('')
    setSavedNote('')
  }

  function startNew() {
    if (!confirmDiscard()) return
    clearCanvas()
    setCompositionId(undefined)
    setTitle('')
    setSavedSnapshot(EMPTY_SNAPSHOT)
    setView(HOME)
  }

  function loadComposition(composition: Composition) {
    if (!confirmDiscard()) return false
    clearCanvas()
    const loaded: Piece[] = composition.pieces.map(piece => ({
      id: crypto.randomUUID(),
      name: piece.name,
      original: imageUrl(piece.originalImageId),
      cutout: piece.cutoutImageId ? imageUrl(piece.cutoutImageId) : undefined,
      useOriginal: piece.shown === 'original' || !piece.cutoutImageId,
      x: piece.x, y: piece.y, width: piece.width, ratio: piece.ratio,
      originalImageId: piece.originalImageId,
      cutoutImageId: piece.cutoutImageId ?? undefined,
    }))
    setPieces(loaded)
    setCompositionId(composition.id)
    setTitle(composition.title)
    setSavedSnapshot(snapshotOf(composition.title, loaded))
    fitView(loaded)
    return true
  }

  useImperativeHandle(ref, () => ({ open: loadComposition }))

  async function retryCutout(piece: Piece) {
    let file = files.current.get(piece.id)
    if (!file) {
      // Reopened pieces have no local file yet; fetch the stored original once.
      try {
        const blob = await (await fetch(piece.original)).blob()
        file = new File([blob], piece.name, { type: blob.type })
        files.current.set(piece.id, file)
      } catch {
        if (alive.current) setError('The original could not be loaded for a new cutout. Check that the backend is running.')
        return
      }
    }
    if (alive.current) removeBackground(piece.id, file)
  }

  async function save() {
    if (saving || job || reading || pieces.length === 0) return
    const snapshot = pieces
    const savedTitle = title.trim() || UNTITLED
    setSaving(true)
    setError('')
    setSavedNote('')
    try {
      // Upload only what the server has not seen; reopened pieces already carry ids.
      const uploaded = new Map<string, { originalImageId: string; cutoutImageId?: string }>()
      for (const piece of snapshot) {
        const originalImageId = piece.originalImageId ?? await uploadFrom(piece.original)
        const cutoutImageId = piece.cutout ? piece.cutoutImageId ?? await uploadFrom(piece.cutout) : undefined
        uploaded.set(piece.id, { originalImageId, cutoutImageId })
      }
      if (!alive.current) return
      setPieces(current => current.map(piece => {
        const ids = uploaded.get(piece.id)
        // A cutout regenerated during the save no longer matches the uploaded one.
        if (!ids) return piece
        const sameCutout = snapshot.find(item => item.id === piece.id)?.cutout === piece.cutout
        return { ...piece, originalImageId: ids.originalImageId, cutoutImageId: sameCutout ? ids.cutoutImageId : piece.cutoutImageId }
      }))

      const input: CompositionInput = {
        title: savedTitle,
        pieces: snapshot.map(piece => {
          const ids = uploaded.get(piece.id)!
          return {
            name: piece.name,
            originalImageId: ids.originalImageId,
            cutoutImageId: ids.cutoutImageId ?? null,
            shown: piece.useOriginal || !ids.cutoutImageId ? 'original' : 'cutout',
            x: piece.x, y: piece.y, width: piece.width, ratio: piece.ratio,
          }
        }),
      }
      let saved
      try {
        saved = compositionId ? await updateComposition(compositionId, input) : await createComposition(input)
      } catch (cause) {
        // Deleted from Archive in the meantime: keep the work as a new composition.
        if (!(cause instanceof ApiError && cause.status === 404 && compositionId)) throw cause
        saved = await createComposition(input)
      }
      if (!alive.current) return
      setCompositionId(saved.id)
      setTitle(saved.title)
      setSavedSnapshot(snapshotOf(saved.title, snapshot))
      setSavedNote(`Saved · ${new Date(saved.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    } catch (cause) {
      if (alive.current) setError(`Could not save: ${cause instanceof Error ? cause.message : 'the backend is unavailable.'} Your composition is still here.`)
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  // Screen position of world (0, 0); the grid moves with it so panning feels physical.
  const originX = size.width / 2 - view.cx * view.zoom
  const originY = size.height / 2 - view.cy * view.zoom
  let gridSize = GRID * view.zoom
  while (gridSize < 12) gridSize *= 4
  const status = saving ? 'Saving…' : compositionId && dirty ? 'Unsaved changes' : savedNote

  return <section className={`studio${panning ? ' is-panning' : spaceHeld ? ' can-pan' : ''}`} aria-label="Studio workspace">
    <div ref={board} className="studio-canvas" aria-label="Outfit composition canvas"
      style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${originX}px ${originY}px` }}
      onPointerDown={beginPan} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <div className="studio-world" style={{ transform: `translate(${originX}px, ${originY}px) scale(${view.zoom})`, '--zoom': view.zoom } as CSSProperties}>
        {pieces.map(piece => <div key={piece.id}
          className={`studio-piece${selectedId === piece.id ? ' selected' : ''}`}
          style={{ left: piece.x, top: piece.y, width: piece.width, aspectRatio: piece.ratio }}
          onPointerDown={event => begin(event, piece, 'move')}
          tabIndex={0} role="button" aria-label={`Move ${piece.name}`} aria-pressed={selectedId === piece.id}
          onFocus={() => setSelectedId(piece.id)}
          onKeyDown={event => {
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return }
            const delta = event.shiftKey ? 20 : 5
            const offsets: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
            const offset = offsets[event.key]
            if (offset) {
              event.preventDefault()
              setPieces(current => current.map(item => item.id === piece.id ? { ...item, x: item.x + offset[0], y: item.y + offset[1] } : item))
            }
          }}>
          <img src={piece.useOriginal ? piece.original : piece.cutout ?? piece.original} alt={piece.name} draggable={false} />
          {selectedId === piece.id && <span className="resize-handle" aria-hidden="true" onPointerDown={event => begin(event, piece, 'resize')} />}
        </div>)}
      </div>
      {pieces.length === 0 && <div className="studio-empty">
        <p>Your next composition starts here.</p>
        <span>Add a piece or paste one with ⌘V. Drag empty space to move around; pinch or ⌘-scroll to zoom.</span>
      </div>}
    </div>

    <div className="studio-overlay studio-compose">
      <input className="studio-title" type="text" value={title} maxLength={120} placeholder={UNTITLED}
        aria-label="Composition title" onChange={event => setTitle(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') void save() }} />
      <span className="studio-status" aria-live="polite">{status}</span>
    </div>

    <div className="studio-overlay studio-actions">
      {(pieces.length > 0 || compositionId) && <button className="studio-button" disabled={saving} onClick={startNew}>New</button>}
      <button className="studio-button primary" disabled={saving || reading || !!job || pieces.length === 0} onClick={() => void save()}>
        {saving ? 'Saving…' : compositionId ? 'Save changes' : 'Save'}
      </button>
    </div>

    <div className="studio-toasts">
      {(reading || job) && <div className="studio-toast" role="status" aria-live="polite">
        {reading ? 'Opening image…' : job?.message}
        {job && <button className="text-button" onClick={stopRemoval}>Use original</button>}
      </div>}
      {error && <p className="studio-toast is-error" role="alert">{error}</p>}
    </div>

    <div className="studio-dock">
      {selected && <div className="studio-overlay piece-controls" aria-label="Selected piece controls">
        <span className="piece-name" title={selected.name}>{selected.name}</span>
        <label className="size-control">Size <input aria-label="Piece size" type="range" min={MIN_WIDTH} max={Math.max(2000, Math.ceil(selected.width))} value={selected.width} onChange={event => {
          const width = Number(event.target.value)
          setPieces(current => current.map(piece => piece.id === selected.id ? { ...piece, width } : piece))
        }} /></label>
        {selected.cutout && <button className="studio-button" onClick={() => {
          if (job?.id === selected.id) stopRemoval()
          setPieces(current => current.map(piece => piece.id === selected.id ? { ...piece, useOriginal: !piece.useOriginal } : piece))
        }}>{selected.useOriginal ? 'Use cutout' : 'Use original'}</button>}
        {!job && <button className="studio-button" disabled={reading || saving} onClick={() => void retryCutout(selected)}>Retry cutout</button>}
        <button className="studio-button" onClick={deleteSelected}>Remove piece</button>
      </div>}
      <div className="studio-overlay studio-toolbar">
        <button className="studio-button primary" disabled={reading || !!job} onClick={() => input.current?.click()}>Add image</button>
        <input ref={input} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose clothing image" onChange={importImage} />
        <span className="studio-hint">or paste ⌘V</span>
        <span className="studio-hint studio-count">{pieces.length} {pieces.length === 1 ? 'piece' : 'pieces'}</span>
      </div>
    </div>

    <div className="studio-overlay studio-zoom" aria-label="Zoom">
      <button className="zoom-button" aria-label="Zoom out" onClick={() => zoomTo(view.zoom / 1.25)}>−</button>
      <button className="zoom-button zoom-level" aria-label="Reset zoom to 100%" title="Reset to 100% (⌘0)" onClick={() => zoomTo(1)}>{Math.round(view.zoom * 100)}%</button>
      <button className="zoom-button" aria-label="Zoom in" onClick={() => zoomTo(view.zoom * 1.25)}>+</button>
      <button className="zoom-button zoom-fit" aria-label="Fit to content" title="Fit to content (⇧1)" onClick={() => fitView()}>Fit</button>
    </div>
  </section>
}
