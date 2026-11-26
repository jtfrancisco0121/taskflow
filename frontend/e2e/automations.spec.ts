import { expect, test } from '@playwright/test'
import { addTask, createList, createSpace, signUpAndCreateWorkspace, taskDetail } from './helpers'
import { expectNoContrastViolations } from './a11y'
import { open, pick } from './ui'
import { snap } from './screenshots'

// CAP-1, CAP-8 (3C S2): a rule is created, edited, switched off and deleted from the Automations page.

test('UJ-1: create, edit, disable and delete a rule on a List', async ({ page }, testInfo) => {
  // Reduced motion makes the motion tokens 0s, so switching the theme below is not caught mid-transition.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signUpAndCreateWorkspace(page, 'Automations Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Platform')

  await page.getByRole('link', { name: 'Automations' }).click()
  await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(page.getByText('No rules here yet')).toBeVisible()
  await snap(page, testInfo, 'automations-empty')

  // AD-9: the open builder with its Trigger select open, in Light and in Aurora, with the theme chosen through
  // the real switcher. (No full-page screenshot while the listbox is open: it resizes the viewport, which closes
  // a Radix Select.)
  const themes = page.getByRole('group', { name: 'Theme' })
  for (const [button, label] of [
    ['Light', 'light'],
    ['Aurora', 'dark'],
  ]) {
    await themes.getByRole('button', { name: button }).click()
    await page.getByRole('button', { name: 'New rule' }).click()
    const scanned = page.getByRole('dialog', { name: 'New rule' })
    const listbox = await open(scanned.getByLabel('Trigger'))
    await expectNoContrastViolations(page, `RuleBuilder with an open Select, ${label}`)
    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(scanned).toBeHidden()
  }
  await themes.getByRole('button', { name: 'System' }).click()

  await page.getByRole('button', { name: 'New rule' }).click()
  const dialog = page.getByRole('dialog', { name: 'New rule' })
  await dialog.getByLabel('Rule name').fill('Done notes')

  await pick(dialog.getByLabel('To status (optional)'), 'complete')
  await dialog.getByLabel('Comment text').fill('Shipped, thanks')
  await snap(page, testInfo, 'automations-builder')
  await dialog.getByRole('button', { name: 'Create rule' }).click()

  const card = page.getByRole('article', { name: 'Done notes' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('switch')).toBeChecked()
  await snap(page, testInfo, 'automations-list')

  // The toggle is optimistic and leaves `version` stale until the PATCH returns, and Edit reads the version
  // from the list cache, which the refetch after the PATCH refreshes: arm both waiters before the click and
  // wait for both before Edit (slice-1 carry-over 1).
  const patched = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && /automations\//.test(r.url()),
  )
  const refetched = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/locations\/[^/]+\/automations(\?|$)/.test(r.url()),
  )
  await Promise.all([patched, refetched, card.getByRole('switch').click()])
  await expect(card.getByRole('switch')).not.toBeChecked()
  await expect(card.getByText('Off')).toBeVisible()

  await card.getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit rule: Done notes' })
  await edit.getByLabel('Rule name').fill('Done notes v2')
  await edit.getByRole('button', { name: 'Save rule' }).click()
  await expect(page.getByRole('article', { name: 'Done notes v2' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete' }).click()
  await page
    .getByRole('dialog', { name: 'Delete rule' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByText('No rules here yet')).toBeVisible()
})

// CAP-2, CAP-4, CAP-5, CAP-7 (3C S4): a rule built in the UI runs when a task is marked complete; the open
// task panel shows the comment, the activity names the rule, and the run history shows a Succeeded run.

test('UJ-1: a rule built in the UI fires on a status change and is attributed to the automation', async ({
  page,
}, testInfo) => {
  await signUpAndCreateWorkspace(page, 'Rules Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Platform')
  await addTask(page, 'Ship it')

  await page.getByRole('link', { name: 'Automations' }).click()
  await page.getByRole('button', { name: 'New rule' }).click()
  const dialog = page.getByRole('dialog', { name: 'New rule' })
  await dialog.getByLabel('Rule name').fill('Done to QA')
  await pick(dialog.getByLabel('To status (optional)'), 'complete')
  await pick(dialog.getByLabel('Action type').first(), 'Assign')
  await pick(dialog.getByLabel('Person to assign'), 'Maya E2E')
  await dialog.getByRole('button', { name: 'Add action' }).click()
  await dialog.getByLabel('Comment text').fill('Ready for QA')
  await dialog.getByRole('button', { name: 'Create rule' }).click()
  await expect(page.getByRole('article', { name: 'Done to QA' })).toBeVisible()

  await page.getByRole('link', { name: /^Back to Platform/ }).click()
  await page.getByRole('link', { name: 'Ship it' }).click()
  const panel = taskDetail(page)
  await pick(panel.getByLabel('Status'), 'complete')

  // the open panel shows the rule's comment within a few seconds, without a reload
  await expect(panel.getByText('Ready for QA')).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByText('Automation').first()).toBeVisible()
  await panel.getByRole('tab', { name: 'Activity' }).click()
  await expect(panel.getByText('by automation Done to QA').first()).toBeVisible()
  await snap(page, testInfo, 'automations-activity')

  await page.goto(page.url().replace(/\/t\/.*/, '/'))
  await page
    .getByRole('link', { name: /Platform/ })
    .first()
    .click()
  await page.getByRole('link', { name: 'Automations' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  const history = page.getByRole('dialog', { name: 'Run history: Done to QA' })
  await expect(history.getByText('Succeeded')).toBeVisible({ timeout: 15_000 })
  await expect(history.getByRole('link', { name: /Ship it/ })).toBeVisible()
  await snap(page, testInfo, 'automations-history')
})
