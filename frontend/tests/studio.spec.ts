import { expect, test } from '@playwright/test'

const image = {
  name: 'shirt.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { name: 'Undertone', status: 'running' } }))
  // Only the inference boundary is simulated: browser decoding, pointer input,
  // layout, object URLs, controls and React state remain real.
  await page.addInitScript(() => {
    class ControlledWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null
      onerror: (() => void) | null = null
      postMessage() { (window as unknown as { testWorker: ControlledWorker }).testWorker = this }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { value: ControlledWorker })
  })
  await page.goto('/')
})

test('import, cutout, original toggle, drag, resize and tab retention', async ({ page }) => {
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  const piece = page.getByRole('button', { name: 'Move shirt.png' })
  await expect(piece).toBeVisible()
  const original = await piece.locator('img').getAttribute('src')
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)))
    ;(window as unknown as { testWorker: { onmessage: (event: unknown) => void } }).testWorker.onmessage({ data: { type: 'result', blob } })
  })
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  expect(await piece.locator('img').getAttribute('src')).not.toBe(original)
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await expect(piece.locator('img')).toHaveAttribute('src', original!)
  await page.getByRole('button', { name: 'Use cutout' }).click()
  await piece.scrollIntoViewIfNeeded()
  const before = await piece.boundingBox()
  await page.mouse.move(before!.x + 10, before!.y + 10)
  await page.mouse.down()
  await page.mouse.move(before!.x + 90, before!.y + 60)
  await page.mouse.up()
  const after = await piece.boundingBox()
  expect(after!.x).toBeGreaterThan(before!.x + 60)
  expect(after!.y).toBeGreaterThan(before!.y + 30)
  await page.getByLabel('Piece size').fill('400')
  expect((await piece.boundingBox())!.width).toBeGreaterThan(after!.width)
  await piece.focus()
  const keyboardBefore = await piece.boundingBox()
  await page.keyboard.press('ArrowLeft')
  expect((await piece.boundingBox())!.x).toBeLessThan(keyboardBefore!.x)
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(piece).toBeHidden()
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(piece).toBeVisible()
  await page.getByRole('button', { name: 'Remove piece' }).click()
  await expect(piece).toHaveCount(0)
})

test('failure preserves original and permits retry and cancel', async ({ page }) => {
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { testWorker: { onmessage: (event: unknown) => void } }).testWorker.onmessage({ data: { type: 'error' } })
  })
  await expect(page.getByRole('alert')).toContainText('Your original is safe')
  await expect(page.getByRole('button', { name: 'Move shirt.png' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry cutout' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add image', exact: true })).toBeEnabled()
})

test('rejects unsupported, oversized and corrupt images', async ({ page }) => {
  const input = page.getByLabel('Choose clothing image')
  await input.setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') })
  await expect(page.getByRole('alert')).toHaveText('Choose a JPEG, PNG or WebP image.')
  await input.setInputFiles({ ...image, buffer: Buffer.alloc(16 * 1024 * 1024) })
  await expect(page.getByRole('alert')).toHaveText('Choose an image smaller than 15 MB.')
  await input.setInputFiles({ ...image, buffer: Buffer.from('broken PNG') })
  await expect(page.getByRole('alert')).toContainText('could not be opened')
  await expect(page.locator('.studio-piece')).toHaveCount(0)
})

test('mobile layout stays within viewport and pieces remain bounded', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  const piece = page.getByRole('button', { name: 'Move shirt.png' })
  await piece.focus()
  for (let i = 0; i < 80; i++) await page.keyboard.press('Shift+ArrowRight')
  const bounds = await page.locator('.studio-board').boundingBox()
  const rect = await piece.boundingBox()
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})


test('cancel ignores a late worker result', async ({ page }) => {
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.evaluate(() => {
    ;(window as unknown as { testWorker: { onmessage: (event: unknown) => void } }).testWorker.onmessage({ data: { type: 'result', blob: new Blob(['late']) } })
  })
  await expect(page.getByRole('button', { name: 'Use cutout' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry cutout' })).toBeVisible()
})


test('paste imports a clipboard image into the automatic cutout flow', async ({ page }) => {
  const prevented = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([bytes], 'pasted-shirt.png', { type: 'image/png' }))
    const event = new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    return event.defaultPrevented
  }, image.buffer.toString('base64'))
  expect(prevented).toBe(true)
  await expect(page.getByRole('button', { name: 'Move pasted-shirt.png' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Move pasted-shirt.png' })).toBeVisible()
})
