import type { Locator, Page, TestInfo } from '@playwright/test'
import { expect, test } from '@playwright/test'

const list = (page: Page) => page.locator('.fl-root').first()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const row = (page: Page, name: string) =>
  list(page).locator('.fl-row').filter({ has: page.locator('.fl-name', { hasText: new RegExp(`^${escape(name)}$`) }) })
/** The expand / lock button that is shown (left arrow on wide lists, right one on narrow). */
const opener = (target: Locator) => target.locator('.fl-arrow, .fl-arrow-end').locator('visible=true').first()
const rowHeight = (info: TestInfo) => (info.project.name === 'mobile' ? 56 : 40)

async function open(page: Page, path = '/') {
  await page.goto(path)
  await expect(list(page).locator('.fl-row:not(.fl-head)').first()).toBeVisible()
}

async function box(target: Locator) {
  const rect = await target.boundingBox()
  if (!rect) throw new Error('not rendered')
  return rect
}

async function expectOnScreen(page: Page, target: Locator) {
  const rect = await box(target)
  const viewport = page.viewportSize()!
  expect(rect.y).toBeGreaterThanOrEqual(0)
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function check(page: Page, ...names: string[]) {
  for (const name of names) await row(page, name).locator('.fl-cell-check input').check()
}

/** Chromium only: stand in for the system "Save as" dialog with a real file in OPFS. */
async function fakeSaveDialog(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle('out.zip', { create: true })
  })
}

async function savedZip(page: Page) {
  return page.evaluate(async () => {
    const saved = await (await (await navigator.storage.getDirectory()).getFileHandle('out.zip')).getFile()
    return { size: saved.size, head: [...new Uint8Array(await saved.slice(0, 2).arrayBuffer())] }
  })
}

const streams = (info: TestInfo) => info.project.name !== 'webkit'

test('rows keep one height and the page never scrolls sideways', async ({ page }, info) => {
  await open(page)
  for (const name of ['Locked', 'photos', 'big-a.bin']) expect((await box(row(page, name))).height).toBe(rowHeight(info))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('folder passwords are asked for in the row, without moving anything', async ({ page }, info) => {
  await open(page)
  const locked = row(page, 'Locked')
  const next = row(page, 'photos')
  const before = (await box(next)).y

  await opener(locked).click()
  await expect(locked).toHaveClass(/fl-row-prompting/)
  expect((await box(locked)).height).toBe(rowHeight(info))
  expect((await box(next)).y).toBe(before)

  const input = locked.locator('.fl-unlock-row input')
  await input.fill('0000')
  await input.press('Enter')
  await expect(locked).toHaveClass(/fl-row-error/)
  await expect(input).toBeFocused()
  expect((await box(locked)).height).toBe(rowHeight(info))
  expect((await box(next)).y).toBe(before)

  await locked.locator('.fl-unlock-remember').click()
  await input.fill('1234')
  await input.press('Enter')
  await expect(row(page, 'secret-1.txt')).toBeVisible()
  await expect(locked.locator('.fl-remembered')).toBeVisible()

  // Remembered for this tab: a reload opens it without asking.
  await page.reload()
  await opener(row(page, 'Locked')).click()
  await expect(row(page, 'secret-2.txt')).toBeVisible()
})

test('a locked source root unlocks in place', async ({ page }) => {
  await open(page, '/sources')
  const locked = row(page, 'Locked')
  await expect(locked).toHaveClass(/fl-row-locked/)
  await opener(locked).click()
  await locked.locator('.fl-unlock-row input').fill('1234')
  await locked.locator('.fl-unlock-row input').press('Enter')
  await expect(row(page, 'secret-1.txt')).toBeVisible()
})

test('refresh keeps the rows and open folders', async ({ page }) => {
  await open(page)
  await opener(row(page, 'photos')).click()
  await expect(list(page).locator('.fl-more')).toBeVisible()

  await page.route('**/api/fs/list', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
  })
  await list(page).locator('.fl-refresh').click()
  await expect(list(page)).toHaveClass(/fl-refreshing/)
  await expect(list(page).locator('.fl-progress')).toBeVisible()
  await expect(row(page, 'IMG_0001.jpg')).toBeVisible()
  await expect(list(page)).not.toHaveClass(/fl-refreshing/)
  await expect(list(page).locator('.fl-more')).toBeVisible()
})

test('long folders show a page, then more, then the rest', async ({ page }, info) => {
  await open(page)
  await opener(row(page, 'photos')).click()
  const files = list(page).locator('.fl-row:not(.fl-head):not(.fl-more):not(.fl-row-dir)')
  const more = list(page).locator('.fl-more')
  await expect(more).toContainText('还有 250 项')
  expect((await box(more)).height).toBe(rowHeight(info))
  const fileCount = async () => (await files.count()) - 4 // big-a, big-b, broken, notes
  expect(await fileCount()).toBe(200)

  await more.locator('.fl-more-btn').first().click()
  expect(await fileCount()).toBe(400)
  await expect(more.locator('.fl-more-btn')).toHaveText(['显示剩余 50 项'])
  await more.locator('.fl-more-btn').click()
  expect(await fileCount()).toBe(450)
  await expect(more).toHaveCount(0)
})

test('a single download stays on the page and the toast is on screen', async ({ page, context }) => {
  await open(page)
  // A long open folder makes the card much taller than the screen.
  await opener(row(page, 'photos')).click()
  await list(page).locator('.fl-more .fl-more-all').click()
  const url = page.url()
  let popups = 0
  context.on('page', () => popups++)

  // A file at the top: the card's bottom is now far below the screen.
  await row(page, 'IMG_0001.jpg').scrollIntoViewIfNeeded()
  expect((await box(list(page))).y + (await box(list(page))).height).toBeGreaterThan(page.viewportSize()!.height * 3)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row(page, 'IMG_0001.jpg').locator('.fl-download').click(),
  ])
  expect(await download.failure()).toBeNull()
  expect(page.url()).toBe(url)
  expect(popups).toBe(0)
  const toast = list(page).locator('.fl-toast')
  await expect(toast).toHaveText('已交给浏览器下载：IMG_0001.jpg')
  await expectOnScreen(page, toast)
})

test('in-memory ZIP asks above the warning size and produces an archive', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await open(page)
  await check(page, 'big-a.bin', 'big-b.bin')
  await list(page).locator('.fl-bar .fl-btn-primary').click()

  const dialog = page.locator('dialog.fl-confirm')
  await expect(dialog.locator('.fl-confirm-title')).toHaveText('文件较大（4.0 MB）')
  await expectOnScreen(page, dialog)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.locator('.fl-btn-primary').click(),
  ])
  const zip = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  })
  expect(zip.subarray(0, 2).toString()).toBe('PK')
  expect(zip.length).toBeGreaterThan(4 * 1024 * 1024)
  expect(zip.includes('big-a.bin')).toBe(true)
  expect(zip.includes('big-b.bin')).toBe(true)
})

test('streaming ZIP shows progress, locks the selection and writes the file', async ({ page }, info) => {
  test.skip(!streams(info), 'Safari cannot stream to disk')
  await fakeSaveDialog(page)
  await open(page)
  await page.route('**/p/big-b.bin', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await check(page, 'big-a.bin', 'big-b.bin')
  await list(page).locator('.fl-bar .fl-btn-primary').click()

  await expect(list(page).locator('.fl-zip-cancel')).toBeVisible()
  await expect(list(page).locator('.fl-selection-count')).toHaveText(/^打包中 \d+%$/)
  await expect(row(page, 'big-a.bin').locator('.fl-cell-check input')).toBeDisabled()
  await expect(list(page).locator('.fl-toast')).toContainText('已打包', { timeout: 15_000 })

  const saved = await savedZip(page)
  expect(saved.head).toEqual([0x50, 0x4b])
  expect(saved.size).toBeGreaterThan(4 * 1024 * 1024)
})

test('cancelling a ZIP keeps the selection', async ({ page }, info) => {
  if (streams(info)) await fakeSaveDialog(page)
  await open(page)
  await page.route('**/p/big-b.bin', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    await route.continue().catch(() => {})
  })
  await check(page, 'big-a.bin', 'notes.txt', 'big-b.bin')
  await list(page).locator('.fl-bar .fl-btn-primary').click()
  // In-memory browsers ask first (over the 3 MB warning size of the fixture page).
  if (!streams(info)) await page.locator('dialog.fl-confirm .fl-btn-primary').click()

  await list(page).locator('.fl-zip-cancel').click()
  await expect(list(page).locator('.fl-toast')).toHaveText('已取消下载')
  await expect(list(page).locator('.fl-selection-count')).toHaveText('已选 3 项')
})

test('a failed ZIP explains why in a dialog on screen', async ({ page }, info) => {
  if (streams(info)) await fakeSaveDialog(page)
  await open(page)
  await check(page, 'notes.txt', 'broken.bin')
  await list(page).locator('.fl-bar .fl-btn-primary').click()

  const dialog = page.locator('dialog.fl-confirm')
  await expect(dialog.locator('.fl-confirm-title')).toHaveText('打包失败')
  await expect(dialog.locator('.fl-confirm-text').first()).toHaveText('broken.bin：HTTP 500')
  await expectOnScreen(page, dialog)
  await dialog.locator('.fl-btn-primary').click()
  await expect(list(page).locator('.fl-selection-count')).toHaveText('已选 2 项')
})
