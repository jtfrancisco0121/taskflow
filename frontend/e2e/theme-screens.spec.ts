import { expect, test, type Page } from '@playwright/test'
import { addTask, createList, createSpace, createView, signUpAndCreateWorkspace } from './helpers'
import { expectNoContrastViolations, tokenOf, watchFontRequests } from './a11y'
import { snap } from './screenshots'

// FR-20, AD-10: the evidence every UI-overhaul slice report needs, the same screens in both themes
// (`<screen>-<theme>.png` under E2E_SCREENSHOTS_DIR). The theme is set with an init script, which runs in
// every new document, and the color scheme is emulated. Since slice 2 the two themes really differ, and every
// screen is scanned with axe's color-contrast rule (AD-9). A third run leaves `data-theme` unset with a dark OS
// scheme (System) and checks that it shows the Aurora ground. Slice 3 adds the inline bootstrap and theme store, which read the stored choice and may
// overwrite `data-theme`: that slice must change `setTheme` to seed the theme storage key instead.

const THEMES = ['light', 'dark'] as const

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript((value) => {
    const apply = () => document.documentElement.setAttribute('data-theme', value)
    if (document.documentElement) apply()
    document.addEventListener('DOMContentLoaded', apply)
  }, theme)
}

for (const theme of THEMES) {
  test(`screens in the ${theme} theme`, async ({ page }, testInfo) => {
    const fonts = watchFontRequests(page)
    await setTheme(page, theme)
    for (const path of ['/signin', '/signup']) {
      await page.goto(path)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoContrastViolations(page, `${path} ${theme}`)
    }
    await signUpAndCreateWorkspace(page, 'Evidence Co')
    const workspaceId = /\/w\/([^/?#]+)/.exec(page.url())?.[1]
    expect(workspaceId, 'the workspace id in the URL').toBeTruthy()
    await createSpace(page, 'Engineering')
    await createList(page, 'Engineering', 'Platform')
    for (const title of [
      'Draft launch post',
      'Review the pricing page',
      'Fix the sign-in redirect',
    ]) {
      await addTask(page, title)
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await snap(page, testInfo, `list-${theme}`)
    await expectNoContrastViolations(page, `list-${theme}`)

    await page.getByRole('link', { name: 'Draft launch post' }).click()
    await expect(page.getByRole('complementary', { name: /^Task / })).toBeVisible()
    await snap(page, testInfo, `task-panel-${theme}`)
    await expectNoContrastViolations(page, `task-panel-${theme}`)
    await page.keyboard.press('Escape')

    for (const type of ['Board', 'Table', 'Calendar']) {
      await createView(page, `${type} view`, type)
      await snap(page, testInfo, `${type.toLowerCase()}-${theme}`)
      await expectNoContrastViolations(page, `${type.toLowerCase()}-${theme}`)
    }

    await page.getByRole('link', { name: 'Automations' }).click()
    await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
    await snap(page, testInfo, `automations-${theme}`)
    await expectNoContrastViolations(page, `automations-${theme}`)

    await page.goto(`/w/${workspaceId}/inbox`)
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
    await snap(page, testInfo, `inbox-${theme}`)
    await expectNoContrastViolations(page, `inbox-${theme}`)

    await page.goto(`/w/${workspaceId}/settings/service-accounts`)
    await expect(page.getByText('No service accounts yet', { exact: false })).toBeVisible()
    await snap(page, testInfo, `service-accounts-${theme}`)
    await expectNoContrastViolations(page, `service-accounts-${theme}`)
    fonts.expectNone()
  })
}

test('the List follows the OS dark scheme when no theme is stored (System)', async ({ page }) => {
  const fonts = watchFontRequests(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await signUpAndCreateWorkspace(page, 'System Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Platform')
  await addTask(page, 'Draft launch post')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  const system = await tokenOf(page, '--tf-bg')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  expect(await tokenOf(page, '--tf-bg')).toBe(system)
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  await expectNoContrastViolations(page, 'list System-dark')
  fonts.expectNone()
})
