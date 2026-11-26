import { expect, test, type Page } from '@playwright/test'
import {
  addTask,
  createList,
  createSpace,
  createField,
  createView,
  liftToNextColumn,
  openFields,
  signUpAndCreateWorkspace,
  taskDetail,
} from './helpers'
import { expectNoContrastViolations, tokenOf, watchFontRequests } from './a11y'
import { pick } from './ui'
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
      // the screens grew past the 30 s default: every slice adds some
      test.setTimeout(120_000)
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

      // The task detail (slice 5): the modal with a subtask, a checklist and the Activity tab, an open
      // Picker, then the docked panel.
      await page.getByRole('link', { name: 'Draft launch post' }).click()
      const detail = taskDetail(page)
      await expect(detail).toBeVisible()
      // tall enough to show the fields, the subtask and the checklist together
      await page.setViewportSize({ width: 1280, height: 1100 })
      await detail.getByRole('textbox', { name: 'Add a subtask' }).fill('Write the migration note')
      await page.keyboard.press('Enter')
      await expect(detail.getByRole('link', { name: 'Write the migration note' })).toBeVisible()
      await detail.getByRole('button', { name: 'Add checklist' }).click()
      const checklistName = detail.getByRole('textbox', { name: 'Checklist name' })
      await expect(checklistName).toBeFocused()
      await checklistName.fill('Release')
      await page.keyboard.press('Enter')
      for (const item of ['Draft the notes', 'Tag the build']) {
        await detail.getByRole('textbox', { name: 'Add an item to Release' }).fill(item)
        await page.keyboard.press('Enter')
        await expect(detail.getByRole('checkbox', { name: item })).toBeVisible()
      }
      await detail.getByRole('checkbox', { name: 'Draft the notes' }).click()
      await expect(detail.getByText('1/2')).toBeVisible()
      await detail.getByRole('tab', { name: 'Activity' }).click()
      await expect(detail.getByText('created this task')).toBeVisible()
      await detail.getByLabel('Title').scrollIntoViewIfNeeded()
      await snap(page, testInfo, `task-modal-${theme}${suffix}`)
      await expectNoContrastViolations(page, `task-modal-${theme}${suffix}`)

      await detail.getByLabel('Status', { exact: true }).click()
      await expect(page.getByRole('option', { name: 'in progress' })).toBeVisible()
      await snap(page, testInfo, `task-picker-${theme}${suffix}`)
      await expectNoContrastViolations(page, `task-picker-${theme}${suffix}`)
      await page.keyboard.press('Escape')

      await detail.getByRole('button', { name: 'Docked' }).click()
      await expect(page.getByRole('complementary', { name: /^Task / })).toBeVisible()
      await snap(page, testInfo, `task-docked-${theme}${suffix}`)
      await expectNoContrastViolations(page, `task-docked-${theme}${suffix}`)
      await detail.getByRole('button', { name: 'Close task panel' }).click()
      await expect(detail).toHaveCount(0)
      // the next screens expect the modal again, and later runs start from the default
      await page.evaluate(() => localStorage.removeItem('taskflow:task-detail'))
      await page.setViewportSize({ width: 1280, height: 720 })

      for (const type of ['Board', 'Table', 'Calendar']) {
        await createView(page, `${type} view`, type)
        await snap(page, testInfo, `${type.toLowerCase()}-${theme}${suffix}`)
        await expectNoContrastViolations(page, `${type.toLowerCase()}-${theme}${suffix}`)
        if (type === 'Board') {
          // a keyboard drag in progress: the card lifted, the next column highlighted as the drop target
          await expect(
            page.getByRole('region', { name: 'in progress' }).getByText('No tasks'),
          ).toBeVisible()
          await page.locator('[data-task-id]').first().focus()
          await liftToNextColumn(page, 'to do')
          await expect(page.locator('section[data-over="true"]')).toHaveCount(1)
          await snap(page, testInfo, `board-drag-${theme}${suffix}`)
          await expectNoContrastViolations(page, `board-drag-${theme}${suffix}`)
          await page.keyboard.press('Escape')
        }
        if (type === 'Table') {
          // the List's status Picker, open on the first Table row
          await page
            .locator('[data-task-id]')
            .first()
            .getByLabel(/^Status of/)
            .click()
          await expect(page.getByRole('option', { name: 'in progress', exact: true })).toBeVisible()
          await snap(page, testInfo, `table-edit-${theme}${suffix}`)
          await expectNoContrastViolations(page, `table-edit-${theme}${suffix}`)
          await page.keyboard.press('Escape')
          await expect(page.getByRole('option', { name: 'in progress', exact: true })).toHaveCount(
            0,
          )
        }
      }

      await page.getByRole('link', { name: 'Automations' }).click()
      await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
      await snap(page, testInfo, `automations-${theme}${suffix}`)
      await expectNoContrastViolations(page, `automations-${theme}${suffix}`)

      // Slice 9b: a rule card with its history, and the status manager.
      await page.getByRole('button', { name: 'New rule' }).click()
      const builder = page.getByRole('dialog', { name: 'New rule' })
      await builder.getByLabel('Rule name').fill('Done notes')
      await pick(builder.getByLabel('To status (optional)'), 'complete')
      await builder.getByLabel('Comment text').fill('Shipped, thanks')
      await snap(page, testInfo, `rule-builder-${theme}${suffix}`)
      await expectNoContrastViolations(page, `rule-builder-${theme}${suffix}`)
      await builder.getByRole('button', { name: 'Create rule' }).click()
      await expect(page.getByRole('article', { name: 'Done notes' })).toBeVisible()
      await snap(page, testInfo, `rule-card-${theme}${suffix}`)
      await expectNoContrastViolations(page, `rule-card-${theme}${suffix}`)
      await page.getByRole('button', { name: 'History' }).click()
      const history = page.getByRole('dialog', { name: /Run history/ })
      await expect(history.getByRole('heading', { name: 'No runs yet' })).toBeVisible()
      await snap(page, testInfo, `run-history-${theme}${suffix}`)
      await expectNoContrastViolations(page, `run-history-${theme}${suffix}`)
      await page.keyboard.press('Escape')
      await expect(history).toHaveCount(0)
      await page.getByRole('link', { name: /^Back to / }).click()
      await page.getByRole('button', { name: 'Statuses' }).click()
      const statuses = page.getByRole('dialog', { name: /Statuses/ })
      await expect(statuses.getByText('Inherited from Engineering')).toBeVisible()
      await snap(page, testInfo, `status-manager-${theme}${suffix}`)
      await expectNoContrastViolations(page, `status-manager-${theme}${suffix}`)
      await statuses.getByRole('button', { name: 'Customize for this List' }).click()
      await expect(statuses.getByRole('textbox', { name: 'Status 1 name' })).toBeVisible()
      await snap(page, testInfo, `status-editor-${theme}${suffix}`)
      await expectNoContrastViolations(page, `status-editor-${theme}${suffix}`)
      await statuses.getByRole('button', { name: 'Cancel' }).click()
      await statuses.getByRole('button', { name: 'Close' }).click()
      await expect(statuses).toHaveCount(0)

      await page.goto(`/w/${workspaceId}/inbox`)
      await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
      await snap(page, testInfo, `inbox-${theme}${suffix}`)
      await expectNoContrastViolations(page, `inbox-${theme}${suffix}`)

      // Slice 9a: the notification settings and the field manager.
      await page.goto(`/w/${workspaceId}/settings/notifications`)
      await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible()
      await expect(page.getByRole('switch', { name: 'Assigned to me: In app' })).toBeVisible()
      await snap(page, testInfo, `notification-settings-${theme}${suffix}`)
      await expectNoContrastViolations(page, `notification-settings-${theme}${suffix}`)

      const fieldsDialog = await openFields(page, 'Engineering')
      await createField(fieldsDialog, 'Effort', 'Dropdown', ['Small', 'Large'])
      await expect(fieldsDialog.getByText('Effort')).toBeVisible()
      await snap(page, testInfo, `field-manager-${theme}${suffix}`)
      await expectNoContrastViolations(page, `field-manager-${theme}${suffix}`)
      await fieldsDialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(fieldsDialog).toHaveCount(0)

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
  await page.keyboard.press('Escape')

  // the task detail under System-dark: the modal, an open Picker, the docked panel
  await page.getByRole('link', { name: 'Draft launch post' }).click()
  const detail = taskDetail(page)
  await expect(detail).toBeVisible()
  await expectNoContrastViolations(page, 'task-modal System-dark')
  await detail.getByLabel('Status', { exact: true }).click()
  await expect(page.getByRole('option', { name: 'in progress' })).toBeVisible()
  await expectNoContrastViolations(page, 'task-picker System-dark')
  await page.keyboard.press('Escape')
  await detail.getByRole('button', { name: 'Docked' }).click()
  await expect(page.getByRole('complementary', { name: /^Task / })).toBeVisible()
  await expectNoContrastViolations(page, 'task-docked System-dark')
  fonts.expectNone()
})
