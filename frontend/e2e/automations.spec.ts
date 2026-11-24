import { expect, test } from '@playwright/test'
import { createList, createSpace, signUpAndCreateWorkspace } from './helpers'
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
