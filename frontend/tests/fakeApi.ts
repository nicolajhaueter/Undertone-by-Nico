import { createHash, randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'

type StoredImage = { id: string; type: string; body: Buffer }
type Piece = { name: string; originalImageId: string; cutoutImageId: string | null; shown: string; x: number; y: number; width: number; ratio: number }
type Composition = { id: string; title: string; createdAt: string; updatedAt: string; pieces: Piece[] }

/**
 * In-memory stand-in for the Kotlin API, mirroring its contract (content
 * deduplication, 201/200, 404s). State lives in the test process, so it
 * survives page reloads like the real database would.
 */
export async function fakeApi(page: Page) {
  const images = new Map<string, StoredImage>()
  const byHash = new Map<string, string>()
  const compositions = new Map<string, Composition>()
  const calls: string[] = []

  await page.route('**/api/status', route => route.fulfill({ json: { name: 'Undertone', status: 'running' } }))

  await page.route('**/api/images', async route => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0)
    calls.push('POST /api/images')
    const hash = createHash('sha256').update(body).digest('hex')
    const existing = byHash.get(hash)
    if (existing) return route.fulfill({ status: 200, json: { id: existing } })
    const id = randomUUID()
    images.set(id, { id, type: route.request().headers()['content-type'] ?? '', body })
    byHash.set(hash, id)
    await route.fulfill({ status: 201, json: { id } })
  })

  await page.route('**/api/images/*', async route => {
    const image = images.get(route.request().url().split('/').pop()!)
    if (!image) return route.fulfill({ status: 404, json: { detail: 'Image not found.' } })
    await route.fulfill({ status: 200, contentType: image.type, body: image.body })
  })

  await page.route('**/api/compositions', async route => {
    const method = route.request().method()
    calls.push(`${method} /api/compositions`)
    if (method === 'GET') {
      return route.fulfill({ json: [...compositions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) })
    }
    const input = route.request().postDataJSON() as { title: string; pieces: Piece[] }
    const now = new Date().toISOString()
    const composition = { id: randomUUID(), title: input.title, createdAt: now, updatedAt: now, pieces: input.pieces }
    compositions.set(composition.id, composition)
    await route.fulfill({ status: 201, json: composition })
  })

  await page.route('**/api/compositions/*', async route => {
    const method = route.request().method()
    const id = route.request().url().split('/').pop()!
    calls.push(`${method} /api/compositions/{id}`)
    const existing = compositions.get(id)
    if (!existing) return route.fulfill({ status: 404, json: { detail: 'Composition not found.' } })
    if (method === 'DELETE') {
      compositions.delete(id)
      return route.fulfill({ status: 204 })
    }
    if (method === 'PUT') {
      const input = route.request().postDataJSON() as { title: string; pieces: Piece[] }
      const updated = { ...existing, ...input, updatedAt: new Date().toISOString() }
      compositions.set(id, updated)
      return route.fulfill({ json: updated })
    }
    await route.fulfill({ json: existing })
  })

  return { images, compositions, calls }
}

/** Replaces the cutout worker so tests control when a cutout "finishes". */
export async function controlWorker(page: Page) {
  await page.addInitScript(() => {
    class ControlledWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null
      onerror: (() => void) | null = null
      postMessage() { (window as unknown as { testWorker: ControlledWorker }).testWorker = this }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { value: ControlledWorker })
  })
}

/** Completes the running cutout with a transparent 4 x 6 PNG. */
export async function finishCutout(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 6
    canvas.getContext('2d')!.fillRect(1, 1, 2, 4)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)))
    ;(window as unknown as { testWorker: { onmessage: (event: unknown) => void } }).testWorker.onmessage({ data: { type: 'result', blob } })
  })
}
