import { expect, test } from '@playwright/test'
import { controlWorker, fakeApi, finishCutout } from './fakeApi'

const image = {
  name: 'shirt.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
}

let api: Awaited<ReturnType<typeof fakeApi>>

test.beforeEach(async ({ page }) => {
  api = await fakeApi(page)
  await controlWorker(page)
  await page.goto('/')
})

test('saves a composition, uploading WebP images once', async ({ page }) => {
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await finishCutout(page)
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  await page.getByLabel('Composition title').fill('Grey Saturday')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByText(/^Saved · /)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  const [saved] = [...api.compositions.values()]
  expect(saved.title).toBe('Grey Saturday')
  expect(saved.pieces).toHaveLength(1)
  expect(saved.pieces[0]).toMatchObject({ name: 'shirt.png', shown: 'cutout' })
  expect(saved.pieces[0].cutoutImageId).toBeTruthy()
  expect(api.images.size).toBe(2)
  for (const stored of api.images.values()) {
    expect(stored.type).toBe('image/webp')
    expect(stored.body.subarray(8, 12).toString('ascii')).toBe('WEBP')
  }

  // Moving a piece is an unsaved change; saving again updates in place without re-uploading.
  const piece = page.getByRole('button', { name: 'Move shirt.png' })
  await piece.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  const uploadsBefore = api.calls.filter(call => call === 'POST /api/images').length
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  expect(api.calls.filter(call => call === 'POST /api/images')).toHaveLength(uploadsBefore)
  expect(api.calls).toContain('PUT /api/compositions/{id}')
  expect(api.compositions.size).toBe(1)
  expect([...api.compositions.values()][0].pieces[0].x).toBeGreaterThan(saved.pieces[0].x)
})

test('saves the shown version and an untitled fallback', async ({ page }) => {
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await finishCutout(page)
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  const [saved] = [...api.compositions.values()]
  expect(saved.title).toBe('Untitled composition')
  expect(saved.pieces[0].shown).toBe('original')
  await expect(page.getByLabel('Composition title')).toHaveValue('Untitled composition')
})

test('save is unavailable while empty or while a cutout runs', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await finishCutout(page)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
})

test('a failed save keeps the composition and reports the reason', async ({ page }) => {
  await page.route('**/api/compositions', route => route.fulfill({ status: 500, json: { detail: 'Database is offline.' } }))
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await finishCutout(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save: Database is offline.')
  await expect(page.getByRole('button', { name: 'Move shirt.png' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
})

async function saveComposition(page: import('@playwright/test').Page, title: string) {
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await finishCutout(page)
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  await page.getByLabel('Composition title').fill(title)
  await page.getByRole('button', { name: /^Save/ }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
}

test('save, reload and reopen restores the composition exactly', async ({ page }) => {
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await finishCutout(page)
  const piece = page.getByRole('button', { name: 'Move shirt.png' })
  await page.getByLabel('Piece size').fill('260')
  await piece.focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('ArrowDown')
  const style = await piece.getAttribute('style')
  await page.getByLabel('Composition title').fill('Grey Saturday')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()

  await page.reload()
  await expect(page.locator('.studio-piece')).toHaveCount(0)
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Grey Saturday' })).toBeVisible()
  await expect(page.getByText('1 piece ·')).toBeVisible()
  await expect(page.locator('.archive-preview img')).toHaveCount(1)
  await page.getByRole('button', { name: 'Open', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Studio', level: 1 })).toBeVisible()
  await expect(piece).toHaveAttribute('style', style!)
  await expect(page.getByLabel('Composition title')).toHaveValue('Grey Saturday')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  const [saved] = [...api.compositions.values()]
  await expect(piece.locator('img')).toHaveAttribute('src', `/api/images/${saved.pieces[0].cutoutImageId}`)
  await piece.focus()
  await expect(page.getByRole('button', { name: 'Use original', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await expect(piece.locator('img')).toHaveAttribute('src', `/api/images/${saved.pieces[0].originalImageId}`)

  // Saving a reopened composition updates it in place and uploads nothing new.
  const uploadsBefore = api.calls.filter(call => call === 'POST /api/images').length
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  expect(api.calls.filter(call => call === 'POST /api/images')).toHaveLength(uploadsBefore)
  expect(api.compositions.size).toBe(1)
  expect([...api.compositions.values()][0].pieces[0].shown).toBe('original')
})

test('layer order survives a reopen', async ({ page }) => {
  const second = { ...image, name: 'shoe.png' }
  await page.getByLabel('Choose clothing image').setInputFiles(image)
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.getByLabel('Choose clothing image').setInputFiles(second)
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  // Shift the shoe aside so clicking the shirt (which brings it to the front) reaches it.
  await page.getByRole('button', { name: 'Move shoe.png' }).focus()
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.getByRole('button', { name: 'Move shirt.png' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  expect([...api.compositions.values()][0].pieces.map(piece => piece.name)).toEqual(['shoe.png', 'shirt.png'])

  await page.reload()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('button', { name: 'Open Untitled composition' }).click()
  await expect(page.locator('.studio-piece')).toHaveCount(2)
  expect(await page.locator('.studio-piece img').evaluateAll(images => images.map(image => image.getAttribute('alt')))).toEqual(['shoe.png', 'shirt.png'])
})

test('opening asks before replacing unsaved work, and New starts fresh', async ({ page }) => {
  await saveComposition(page, 'Kept')
  // Nothing unsaved, so New clears without asking.
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.locator('.studio-piece')).toHaveCount(0)
  await expect(page.getByLabel('Composition title')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  await page.getByLabel('Choose clothing image').setInputFiles({ ...image, name: 'draft.png' })
  await page.getByRole('button', { name: 'Use original', exact: true }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Open Kept' }).click()
  await expect(page.getByRole('heading', { name: 'Archive', level: 1 })).toBeVisible()

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Open Kept' }).click()
  await expect(page.getByRole('button', { name: 'Move shirt.png' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move draft.png' })).toHaveCount(0)
})

test('archive deletes after confirmation', async ({ page }) => {
  await saveComposition(page, 'Short-lived')
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete Short-lived' }).click()
  await expect(page.getByRole('heading', { name: 'Short-lived' })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete Short-lived' }).click()
  await expect(page.getByText('Your collection will take shape here.')).toBeVisible()
  expect(api.compositions.size).toBe(0)

  // Studio still holds the deleted composition; saving recreates it instead of failing.
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/^Saved · /)).toBeVisible()
  expect(api.compositions.size).toBe(1)
})

test('retry cutout works on a reopened piece', async ({ page }) => {
  await saveComposition(page, 'Retry')
  await page.reload()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('button', { name: 'Open Retry' }).click()
  await page.getByRole('button', { name: 'Move shirt.png' }).focus()
  await page.getByRole('button', { name: 'Retry cutout' }).click()
  // Retry fetches the stored original before the worker starts.
  await expect(page.getByRole('status')).toContainText(/cutout|background/i)
  await finishCutout(page)
  await expect(page.locator('.studio-piece img')).toHaveAttribute('src', /^blob:/)
  await expect(page.getByText('Unsaved changes')).toBeVisible()
})

test('archive explains when the backend is unavailable', async ({ page }) => {
  const outage = (route: import('@playwright/test').Route) => route.fulfill({ status: 503, json: { detail: 'Service unavailable.' } })
  await page.route('**/api/compositions', outage)
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.getByText('Archive is unavailable.')).toBeVisible()
  await expect(page.getByText('(Service unavailable.)')).toBeVisible()
  await page.unroute('**/api/compositions', outage)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Your collection will take shape here.')).toBeVisible()
})
