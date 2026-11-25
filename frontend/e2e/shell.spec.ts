import { expect, test, type Page } from '@playwright/test'
import { addTask, createList, createSpace, signUpAndCreateWorkspace } from './helpers'
import { tokenOf } from './a11y'

// Slice 3: the app shell (AD-6), the theme switcher and its persistence (AD-1, AD-2), the command palette
// (AD-3). Persistence tests never seed storage with an init script: they use the real switcher.

async function setUp(page: Page, workspace = 'Shell Co') {
  await signUpAndCreateWorkspace(page, workspace)
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Platform')
}

const theme = (page: Page) => page.locator('html').getAttribute('data-theme')
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })

test('FR-4: the footer switcher persists across a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await setUp(page)
  const group = sidebar(page).getByRole('group', { name: 'Theme' })
  await group.getByRole('button', { name: 'Aurora' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(group.getByRole('button', { name: 'Aurora' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await group.getByRole('button', { name: 'Light' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('FR-2: System follows the OS scheme live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await setUp(page)
  const group = sidebar(page).getByRole('group', { name: 'Theme' })
  await group.getByRole('button', { name: 'Aurora' }).click()
  const aurora = await tokenOf(page, '--tf-bg')
  await group.getByRole('button', { name: 'System' }).click()
  expect(await theme(page)).toBeNull()
  const systemLight = await tokenOf(page, '--tf-bg')
  expect(systemLight).not.toBe(aurora)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => tokenOf(page, '--tf-bg')).toBe(aurora)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => tokenOf(page, '--tf-bg')).toBe(systemLight)
  await page.reload()
  expect(await theme(page)).toBeNull()
})

test('FR-14: a Board wider than the window scrolls inside main, never the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 720 })
  await setUp(page)
  await addTask(page, 'Write the spec')
  await page.getByRole('tab', { name: 'Board' }).click()
  await expect(page.getByRole('region', { name: 'to do' })).toBeVisible()
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('main')!
    const root = document.scrollingElement!
    return {
      rootScrollWidth: root.scrollWidth,
      innerWidth: window.innerWidth,
      // the Board scrolls itself or main does; either way the content stays inside the shell
      contained:
        main.scrollWidth > main.clientWidth ||
        Array.from(main.querySelectorAll<HTMLElement>('*')).some(
          (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto',
        ),
    }
  })
  expect(metrics.rootScrollWidth).toBe(metrics.innerWidth)
  expect(metrics.contained).toBe(true)
  await expect(sidebar(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Search tasks' })).toBeVisible()
})

test('FR-4: Toggle sidebar hides and restores the sidebar', async ({ page }) => {
  await setUp(page)
  const toggle = page.getByRole('button', { name: 'Toggle sidebar' })
  await toggle.click()
  await expect(sidebar(page)).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(sidebar(page)).toBeVisible()
})

const inView = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const r = el.getBoundingClientRect()
    return (
      r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
    )
  }, selector)

test('FR-12: on a long task the close button and the composer are reachable inside the panel', async ({
  page,
}) => {
  await setUp(page)
  await addTask(page, 'Long task')
  await page.getByRole('link', { name: 'Long task' }).click()
  const panel = page.getByRole('complementary', { name: /^Task / })
  await expect(panel.getByLabel('Title')).toHaveValue('Long task')
  for (let i = 1; i <= 14; i++) {
    const composer = panel.getByRole('textbox', { name: 'Write a comment' })
    const send = panel.getByRole('button', { name: 'Comment' })
    // the editor can remount while the panel's data settles, so type again until the button enables
    await expect(async () => {
      await composer.click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.type(`Comment number ${i}`)
      await expect(send).toBeEnabled({ timeout: 1000 })
    }).toPass()
    await send.click()
    await expect(panel.getByText(`Comment number ${i}`)).toBeVisible()
  }
  await panel.evaluate((el) => (el.scrollTop = 0))
  await expect(panel.getByRole('button', { name: 'Close task panel' })).toBeInViewport()
  await panel.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(panel.getByRole('textbox', { name: 'Write a comment' })).toBeInViewport()
  const scrolled = await page.evaluate(() => ({
    window: document.scrollingElement!.scrollTop,
    main: document.querySelector('main')!.scrollTop,
  }))
  expect(scrolled).toEqual({ window: 0, main: 0 })
  expect(await inView(page, '[aria-label^="Task "]')).toBe(true)
})

test('FR-12: over a Board wider than the window the close button stays in view while the background scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 720 })
  await setUp(page)
  await addTask(page, 'Write the spec')
  await page.getByRole('tab', { name: 'Board' }).click()
  await page.getByRole('region', { name: 'to do' }).getByText('Write the spec').click()
  const panel = page.getByRole('complementary', { name: /^Task / })
  await expect(panel).toBeVisible()
  const background = await page.evaluate(() => {
    const main = document.querySelector('main')!
    const column = Array.from(main.querySelectorAll<HTMLElement>('div')).find(
      (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto',
    )
    if (column) column.scrollLeft = column.scrollWidth
    return { found: !!column, mainScrollLeft: main.scrollLeft }
  })
  expect(background.found).toBe(true)
  expect(background.mainScrollLeft).toBe(0)
  await expect(panel.getByRole('button', { name: 'Close task panel' })).toBeInViewport()
})
