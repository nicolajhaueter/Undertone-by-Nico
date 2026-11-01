import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { controlWorker, fakeApi } from './fakeApi'

const image = {
  name: 'shirt.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
}

let api: Awaited<ReturnType<typeof fakeApi>>

test.beforeEach(async ({ page }) => {
  api = await fakeApi(page)
  await controlWorker(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
})

async function addPiece(page: Page, name = 'shirt.png') {
  await page.getByLabel('Choose clothing image').setInputFiles({ ...image, name })
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  return page.getByRole('button', { name: `Move ${name}` })
}

const zoomLevel = (page: Page) => page.getByRole('button', { name: 'Reset zoom to 100%' })

test('the workspace fills the window without borders or page scroll', async ({ page }) => {
  const canvas = page.getByLabel('Outfit composition canvas')
  const box = (await canvas.boundingBox())!
  expect(box.width).toBe(1280)
  expect(box.y + box.height).toBe(800)
  expect(await canvas.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800)
  // Straight under the slim app bar: no page heading or description above the workspace.
  expect(box.y).toBeLessThanOrEqual(53)
})

test('dragging empty space pans the canvas without changing saved positions', async ({ page }) => {
  const piece = await addPiece(page)
  const before = (await piece.boundingBox())!
  await page.mouse.move(150, 300)
  await page.mouse.down()
  await page.mouse.move(350, 400, { steps: 5 })
  await page.mouse.up()
  const after = (await piece.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(200, 0)
  expect(after.y - before.y).toBeCloseTo(100, 0)

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  const [saved] = [...api.compositions.values()]
  // The piece landed in the middle of the untouched view; panning only moves the camera.
  expect(saved.pieces[0].x + saved.pieces[0].width / 2).toBeCloseTo(500, 0)
  expect(saved.pieces[0].y + saved.pieces[0].width / saved.pieces[0].ratio / 2).toBeCloseTo(350, 0)
})

test('trackpad scroll pans and pinch or command-scroll zooms around the cursor', async ({ page }) => {
  const piece = await addPiece(page)
  const before = (await piece.boundingBox())!
  await page.mouse.move(640, 400)
  await page.mouse.wheel(120, 0)
  await expect.poll(async () => (await piece.boundingBox())!.x).toBeCloseTo(before.x - 120, 0)

  await expect(zoomLevel(page)).toHaveText('100%')
  const centreBefore = await piece.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  await page.mouse.move(centreBefore.x, centreBefore.y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -60)
  await page.keyboard.up('Control')
  await expect(zoomLevel(page)).not.toHaveText('100%')
  const zoomed = (await piece.boundingBox())!
  expect(zoomed.width).toBeGreaterThan(before.width)
  // The point under the cursor stays put.
  expect(zoomed.x + zoomed.width / 2).toBeCloseTo(centreBefore.x, 0)
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
})

test('zoom buttons, reset and fit', async ({ page }) => {
  const piece = await addPiece(page)
  const width = (await piece.boundingBox())!.width
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoomLevel(page)).toHaveText('125%')
  expect((await piece.boundingBox())!.width).toBeCloseTo(width * 1.25, 0)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(zoomLevel(page)).toHaveText('80%')
  await zoomLevel(page).click()
  await expect(zoomLevel(page)).toHaveText('100%')

  // Move the piece far away, then Fit brings it back into the middle of the screen.
  await piece.focus()
  for (let i = 0; i < 100; i++) await page.keyboard.press('Shift+ArrowRight')
  await expect(piece).not.toBeInViewport()
  await page.getByRole('button', { name: 'Fit to content' }).click()
  await expect(piece).toBeInViewport()
  const box = (await piece.boundingBox())!
  expect(box.x + box.width / 2).toBeCloseTo(640, -1)
})

test('keyboard shortcuts zoom, fit and remove', async ({ page }) => {
  const piece = await addPiece(page)
  await page.locator('body').click({ position: { x: 200, y: 600 } })
  await page.keyboard.press('ControlOrMeta+Equal')
  await expect(zoomLevel(page)).toHaveText('125%')
  await page.keyboard.press('ControlOrMeta+Digit0')
  await expect(zoomLevel(page)).toHaveText('100%')
  await page.keyboard.press('Shift+Digit1')
  await expect(zoomLevel(page)).not.toHaveText('100%')
  await piece.focus()
  await page.keyboard.press('Delete')
  await expect(piece).toHaveCount(0)
})

test('pieces can be moved beyond the old board edges', async ({ page }) => {
  const piece = await addPiece(page)
  await piece.focus()
  for (let i = 0; i < 60; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  expect([...api.compositions.values()][0].pieces[0].x).toBeLessThan(0)
})

test('reopening a composition fits it into view', async ({ page }) => {
  const piece = await addPiece(page)
  await piece.focus()
  for (let i = 0; i < 100; i++) await page.keyboard.press('Shift+ArrowDown')
  await page.getByLabel('Composition title').fill('Far away')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('button', { name: 'Open Far away' }).click()
  await expect(page.getByRole('button', { name: 'Move shirt.png' })).toBeInViewport()
})

test('opening from Archive fits the current window, even after resizing there', async ({ page }) => {
  const piece = await addPiece(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Open Untitled composition' }).click()
  const box = (await piece.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
})

test('the app uses the dark theme', async ({ page }) => {
  const luminance = (rgb: string) => {
    const [r, g, b] = rgb.match(/\d+/g)!.map(Number)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  const canvas = await page.getByLabel('Outfit composition canvas').evaluate(element => getComputedStyle(element).backgroundColor)
  const text = await page.locator('body').evaluate(element => getComputedStyle(element).color)
  expect(luminance(canvas)).toBeLessThan(0.15)
  expect(luminance(text)).toBeGreaterThan(0.8)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
})
