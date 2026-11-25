import { expect, test, type Page } from '@playwright/test'
import { addTask, createList, createSpace, createView, signUpAndCreateWorkspace } from './helpers'
import { snap } from './screenshots'

// FR-20, AD-10: the evidence every UI-overhaul slice report needs, the same screens in both themes
// (`<screen>-<theme>.png` under E2E_SCREENSHOTS_DIR). The theme is set with an init script, which runs in
// every new document, and the color scheme is emulated. Today both runs show the same light UI; slice 2 adds
// the dark tokens. Slice 3 adds the inline bootstrap and theme store, which read the stored choice and may
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
    await setTheme(page, theme)
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

    await page.getByRole('link', { name: 'Draft launch post' }).click()
    await expect(page.getByRole('complementary', { name: /^Task / })).toBeVisible()
    await snap(page, testInfo, `task-panel-${theme}`)
    await page.keyboard.press('Escape')

    for (const type of ['Board', 'Table', 'Calendar']) {
      await createView(page, `${type} view`, type)
      await snap(page, testInfo, `${type.toLowerCase()}-${theme}`)
    }

    await page.getByRole('link', { name: 'Automations' }).click()
    await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
    await snap(page, testInfo, `automations-${theme}`)

    await page.goto(`/w/${workspaceId}/inbox`)
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
    await snap(page, testInfo, `inbox-${theme}`)

    await page.goto(`/w/${workspaceId}/settings/service-accounts`)
    await expect(page.getByText('No service accounts yet', { exact: false })).toBeVisible()
    await snap(page, testInfo, `service-accounts-${theme}`)
  })
}
