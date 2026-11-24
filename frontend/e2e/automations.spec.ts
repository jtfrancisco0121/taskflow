import { expect, test } from '@playwright/test'
import { addTask, createList, createSpace, signUpAndCreateWorkspace } from './helpers'
import { snap } from './screenshots'

// CAP-1, CAP-8 (3C S2): a rule is created, edited, switched off and deleted from the Automations page.

test('UJ-1: create, edit, disable and delete a rule on a List', async ({ page }, testInfo) => {
  await signUpAndCreateWorkspace(page, 'Automations Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Platform')

  await page.getByRole('link', { name: 'Automations' }).click()
  await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(page.getByText('No rules here yet')).toBeVisible()
  await snap(page, testInfo, 'automations-empty')

  await page.getByRole('button', { name: 'New rule' }).click()
  const dialog = page.getByRole('dialog', { name: 'New rule' })
  await dialog.getByLabel('Rule name').fill('Done notes')
  await dialog.getByLabel('To status (optional)').selectOption({ label: 'complete' })
  await dialog.getByLabel('Comment text').fill('Shipped, thanks')
  await snap(page, testInfo, 'automations-builder')
  await dialog.getByRole('button', { name: 'Create rule' }).click()

  const card = page.getByRole('article', { name: 'Done notes' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('switch')).toBeChecked()
  await snap(page, testInfo, 'automations-list')

  await card.getByRole('switch').click()
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
  await dialog.getByLabel('To status (optional)').selectOption({ label: 'complete' })
  await dialog.getByLabel('Action type').first().selectOption('ASSIGN')
  await dialog.getByLabel('Person to assign').selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Add action' }).click()
  await dialog.getByLabel('Comment text').fill('Ready for QA')
  await dialog.getByRole('button', { name: 'Create rule' }).click()
  await expect(page.getByRole('article', { name: 'Done to QA' })).toBeVisible()

  await page.getByRole('link', { name: /^Back to Platform/ }).click()
  await page.getByRole('link', { name: 'Ship it' }).click()
  const panel = page.getByRole('complementary', { name: /^Task / })
  await panel.getByLabel('Status').selectOption({ label: 'complete' })

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
