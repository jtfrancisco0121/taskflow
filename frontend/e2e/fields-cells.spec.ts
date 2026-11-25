import { expect, test } from '@playwright/test'
import {
  addTask,
  createField,
  createList,
  createSpace,
  createView,
  openFields,
  row,
  signUpAndCreateWorkspace,
  statusOf,
} from './helpers'
import { pick } from './ui'
import { snap } from './screenshots'

// FIELD-3 (3A S4, UJ-2): custom field columns in Table and List are editable inline, Board cards show chips.

test('UJ-2: a Customer tier column is edited inline in Table and List, and shows as chips on Board cards', async ({
  page,
}, testInfo) => {
  await signUpAndCreateWorkspace(page, 'Cells Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Backlog')
  const dialog = await openFields(page, 'Engineering')
  await createField(dialog, 'Customer tier', 'Dropdown', ['Free', 'Pro', 'Enterprise'])
  await createField(dialog, 'Story points', 'Number')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await addTask(page, 'Alpha')
  await addTask(page, 'Beta')

  // Table: add the column, pick Enterprise in a cell, the value survives a reload.
  await createView(page, 'Triage', 'Table')
  await page.getByText('Columns', { exact: true }).click()
  await page.getByRole('checkbox', { name: /Customer tier/ }).click()
  await expect(page.getByRole('columnheader', { name: /Customer tier/ })).toBeVisible()
  await page.getByRole('checkbox', { name: /Story points/ }).click()
  await expect(page.getByRole('columnheader', { name: /Story points/ })).toBeVisible()
  await row(page, 'Alpha').getByRole('button', { name: 'Customer tier: empty' }).click()
  await pick(page.getByLabel(/^Customer tier for /), 'Enterprise')
  await expect(
    row(page, 'Alpha').getByRole('button', { name: 'Customer tier: Enterprise' }),
  ).toBeVisible()
  await row(page, 'Alpha').getByRole('button', { name: 'Story points: empty' }).click()
  await page.getByRole('textbox', { name: /^Story points for / }).fill('8')
  await page.keyboard.press('Enter')
  await expect(row(page, 'Alpha').getByRole('button', { name: 'Story points: 8' })).toBeVisible()
  await snap(page, testInfo, 'fields-cells-table')
  await page.reload()
  await expect(
    row(page, 'Alpha').getByRole('button', { name: 'Customer tier: Enterprise' }),
  ).toBeVisible()

  // List: the same column, edited inline on the other task.
  await page.getByRole('tab', { name: 'List' }).click()
  await page.getByText('Columns', { exact: true }).click()
  await page.getByRole('checkbox', { name: /Customer tier/ }).click()
  await expect(page.getByRole('columnheader', { name: /Customer tier/ })).toBeVisible()
  await row(page, 'Beta').getByRole('button', { name: 'Customer tier: empty' }).click()
  await pick(page.getByLabel(/^Customer tier for /), 'Pro')
  await expect(row(page, 'Beta').getByRole('button', { name: 'Customer tier: Pro' })).toBeVisible()
  await snap(page, testInfo, 'fields-cells-list')

  // AD-12: picking a status in a row is a pick in a portalled listbox; it must not reach the row's click
  // handler, which would open the task panel.
  await pick(row(page, 'Beta').getByLabel(/^Status of/), 'in progress')
  await expect(statusOf(page, 'Beta')).toHaveText('in progress')
  await expect(page).not.toHaveURL(/\/t\//)
  await expect(page.getByRole('complementary', { name: /^Task / })).toBeHidden()

  // Board: a chip per card that has a value.
  await page.getByRole('tab', { name: 'Board' }).click()
  await page.getByText('Columns', { exact: true }).click()
  await page.getByRole('checkbox', { name: /Customer tier/ }).click()
  await expect(page.getByLabel('Customer tier: Enterprise')).toBeVisible()
  await expect(page.getByLabel('Customer tier: Pro')).toBeVisible()
  await snap(page, testInfo, 'fields-cells-board')
})
