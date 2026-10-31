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
