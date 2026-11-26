import { expect, test, type Page } from '@playwright/test'
import { addTask, createList, createSpace, createView, signUpAndCreateWorkspace } from './helpers'
import { expectNoContrastViolations, tokenOf, watchFontRequests } from './a11y'
import { snap } from './screenshots'

// FR-20, AD-10: the evidence every UI-overhaul slice report needs, the same screens in both themes
// (`<screen>-<theme>.png` under E2E_SCREENSHOTS_DIR). Since slice 3 the theme is the stored choice: `setTheme`
// seeds the theme storage key (`taskflow:theme`) once, before the first navigation, and never writes `data-theme`
// itself, so the inline bootstrap and the theme store are what the screenshots exercise. Each theme runs under both
// emulated OS schemes (the dark-OS shots carry an `-osdark` suffix) to prove the stored choice beats the OS. Every
// screen is scanned with axe's color-contrast rule (AD-9). A last run stores no choice with a dark OS scheme
// (System) and checks that it shows the Aurora ground.

const THEMES = ['light', 'dark'] as const
const OS_SCHEMES = ['light', 'dark'] as const
const THEME_KEY = 'taskflow:theme'

/** Seeds the stored Theme choice once per tab (a sessionStorage flag), so a later choice survives a reload. */
async function setTheme(page: Page, theme: (typeof THEMES)[number] | 'system') {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('tf-theme-seeded')) return
      sessionStorage.setItem('tf-theme-seeded', '1')
      if (value === 'system') localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    },
    [THEME_KEY, theme],
  )
}

const seenBackgrounds = new Map<string, string>()

for (const os of OS_SCHEMES)
  for (const theme of THEMES) {
    const suffix = os === 'light' ? '' : '-osdark'
    test(`screens in the ${theme} theme under an OS ${os} scheme`, async ({ page }, testInfo) => {
      const fonts = watchFontRequests(page)
      await page.emulateMedia({ colorScheme: os })
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
      // the same Theme draws the same ground under either OS scheme, and the two Themes differ
      const ground = await tokenOf(page, '--tf-bg')
      expect(seenBackgrounds.get(theme) ?? ground, `${theme} ground under OS ${os}`).toBe(ground)
      seenBackgrounds.set(theme, ground)
      const other = seenBackgrounds.get(theme === 'light' ? 'dark' : 'light')
      if (other) expect(ground).not.toBe(other)
      const list = await snap(page, testInfo, `list-${theme}${suffix}`)
      await expectNoContrastViolations(page, `list-${theme}${suffix}`)

      // The shell shot shows the shell: the workspace switcher is open, so it can never equal the List shot.
      await page.getByRole('button', { name: 'Workspace switcher' }).click()
      await expect(page.getByRole('menu')).toBeVisible()
      const shell = await snap(page, testInfo, `shell-${theme}${suffix}`)
      expect(
        shell.equals(list),
        `shell-${theme}${suffix} must differ from list-${theme}${suffix}`,
      ).toBe(false)
      await expectNoContrastViolations(page, `shell-${theme}${suffix}`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // Slice 4: a status editor open, the chip bar with the save bar, the bulk bar and the shortcut sheet.
      const draft = page.getByRole('row').filter({ hasText: 'Draft launch post' })
      await draft.getByLabel(/^Status of/).click()
      await expect(page.getByRole('option', { name: 'in progress', exact: true })).toBeVisible()
      await snap(page, testInfo, `list-editor-${theme}${suffix}`)
      await expectNoContrastViolations(page, `list-editor-${theme}${suffix}`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('option', { name: 'in progress', exact: true })).toHaveCount(0)

      await page.getByRole('button', { name: 'Filter' }).click()
      await page.getByRole('button', { name: '+ Add filter' }).click()
      const chip = page.getByRole('button', { name: /^Priority is any of/ }).first()
      await expect(chip).toBeVisible()
      await expect(page.getByRole('group', { name: 'Unsaved view changes' })).toBeVisible()
      await snap(page, testInfo, `chip-bar-${theme}${suffix}`)
      await expectNoContrastViolations(page, `chip-bar-${theme}${suffix}`)
      await page.getByRole('button', { name: /^Remove Priority is any of/ }).click()
      await expect(chip).toBeHidden()
      await expect(page.getByRole('group', { name: 'Unsaved view changes' })).toBeHidden()
      await page.getByRole('button', { name: 'Filter', exact: true }).click()
      await expect(page.getByLabel('Filter field')).toHaveCount(0)

      await page.getByRole('checkbox', { name: 'Select Draft launch post' }).click()
      await page.getByRole('checkbox', { name: 'Select Review the pricing page' }).click()
      await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toBeVisible()
      await snap(page, testInfo, `bulk-bar-${theme}${suffix}`)
      await expectNoContrastViolations(page, `bulk-bar-${theme}${suffix}`)
      await page.getByRole('button', { name: 'Clear' }).click()

      await page
        .getByRole('row')
        .filter({ hasText: 'Draft launch post' })
        .locator('[data-task-id]')
        .focus()
      await page.keyboard.press('?')
      const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
      await expect(sheet).toBeVisible()
      await snap(page, testInfo, `shortcuts-${theme}${suffix}`)
      await expectNoContrastViolations(page, `shortcuts-${theme}${suffix}`)
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)

      await page.keyboard.press('ControlOrMeta+k')
      const dialog = page.getByRole('dialog', { name: 'Command palette' })
      await expect(dialog).toBeVisible()
      await page.getByRole('combobox', { name: 'Search commands and tasks' }).fill('Draft')
      await expect(dialog.getByRole('option', { name: /Draft launch post/ })).toBeVisible()
      await snap(page, testInfo, `palette-${theme}${suffix}`)
      await expectNoContrastViolations(page, `palette-${theme}${suffix}`)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)

      await page.getByRole('link', { name: 'Draft launch post' }).click()
      await expect(page.getByRole('complementary', { name: /^Task / })).toBeVisible()
      await snap(page, testInfo, `task-panel-${theme}${suffix}`)
      await expectNoContrastViolations(page, `task-panel-${theme}${suffix}`)
      await page.keyboard.press('Escape')

      for (const type of ['Board', 'Table', 'Calendar']) {
        await createView(page, `${type} view`, type)
        await snap(page, testInfo, `${type.toLowerCase()}-${theme}${suffix}`)
        await expectNoContrastViolations(page, `${type.toLowerCase()}-${theme}${suffix}`)
      }

      await page.getByRole('link', { name: 'Automations' }).click()
      await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
      await snap(page, testInfo, `automations-${theme}${suffix}`)
      await expectNoContrastViolations(page, `automations-${theme}${suffix}`)

      await page.goto(`/w/${workspaceId}/inbox`)
      await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
      await snap(page, testInfo, `inbox-${theme}${suffix}`)
      await expectNoContrastViolations(page, `inbox-${theme}${suffix}`)

      await page.goto(`/w/${workspaceId}/settings/service-accounts`)
      await expect(page.getByText('No service accounts yet', { exact: false })).toBeVisible()
      await snap(page, testInfo, `service-accounts-${theme}${suffix}`)
      await expectNoContrastViolations(page, `service-accounts-${theme}${suffix}`)
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
  // a stored Aurora choice, applied by the bootstrap on reload, draws the same ground as System under a dark OS
  await page.evaluate((key) => localStorage.setItem(key, 'dark'), THEME_KEY)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await tokenOf(page, '--tf-bg')).toBe(system)
  await page.evaluate((key) => localStorage.removeItem(key), THEME_KEY)
  await page.reload()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  await expectNoContrastViolations(page, 'shell System-dark')
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await expect(dialog).toBeVisible()
  await expectNoContrastViolations(page, 'palette System-dark')
  fonts.expectNone()
})
