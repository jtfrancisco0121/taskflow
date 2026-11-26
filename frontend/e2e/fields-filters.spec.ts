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
} from './helpers'
import { pick } from './ui'
import { snap } from './screenshots'

// FIELD-3 (3A S5, UJ-2): filter, sort and group by custom fields, with the state in the URL.

test('UJ-2: filter, sort and group by Customer tier and Story points; the URL reproduces the view', async ({
  page,
}, testInfo) => {
  await signUpAndCreateWorkspace(page, 'Filters Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Backlog')
  const dialog = await openFields(page, 'Engineering')
  await createField(dialog, 'Customer tier', 'Dropdown', ['Free', 'Pro', 'Enterprise'])
  await createField(dialog, 'Story points', 'Number')
  await dialog.getByRole('button', { name: 'Close' }).click()
  for (const title of ['Alpha', 'Beta', 'Gamma']) await addTask(page, title)

  // A Table with both columns, values set in the cells.
  await createView(page, 'Triage', 'Table')
  await page.getByText('Columns', { exact: true }).click()
  await page.getByRole('checkbox', { name: /Customer tier/ }).click()
  await expect(page.getByRole('columnheader', { name: /Customer tier/ })).toBeVisible()
  await page.getByRole('checkbox', { name: /Story points/ }).click()
  await expect(page.getByRole('columnheader', { name: /Story points/ })).toBeVisible()
  const values: Array<[string, string, string]> = [
    ['Alpha', 'Enterprise', '8'],
    ['Beta', 'Pro', '3'],
    ['Gamma', 'Enterprise', '5'],
  ]
  for (const [title, tier, points] of values) {
    await row(page, title).getByRole('button', { name: 'Customer tier: empty' }).click()
    await pick(page.getByLabel(/^Customer tier for /), tier)
    await expect(
      row(page, title).getByRole('button', { name: `Customer tier: ${tier}` }),
    ).toBeVisible()
    await row(page, title).getByRole('button', { name: 'Story points: empty' }).click()
    await page.getByRole('textbox', { name: /^Story points for / }).fill(points)
    await page.keyboard.press('Enter')
    await expect(
      row(page, title).getByRole('button', { name: `Story points: ${points}` }),
    ).toBeVisible()
  }

  // Filter: Customer tier is any of Enterprise.
  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByRole('button', { name: '+ Add filter' }).click()
  await pick(page.getByLabel('Filter field'), 'Customer tier')
  const choices = page.getByRole('group', { name: 'Filter value' })
  await choices.getByRole('checkbox', { name: 'Free' }).click()
  await expect(choices.getByRole('checkbox', { name: 'Free' })).not.toBeChecked()
  await choices.getByRole('checkbox', { name: 'Enterprise' }).click()
  await expect(row(page, 'Alpha')).toBeVisible()
  await expect(row(page, 'Gamma')).toBeVisible()
  await expect(row(page, 'Beta')).toHaveCount(0)
  await snap(page, testInfo, 'fields-filters-builder')

  // Sort by Story points ascending: Gamma (5) before Alpha (8).
  await pick(page.getByLabel('Sort by'), 'Story points')
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: /Alpha|Gamma/ })
      .first(),
  ).toContainText('Gamma')
  await snap(page, testInfo, 'fields-filters-table')

  // The URL carries the whole state: a new page shows the same view.
  const second = await page.context().newPage()
  await second.goto(page.url())
  await expect(row(second, 'Alpha')).toBeVisible()
  await expect(row(second, 'Gamma')).toBeVisible()
  await expect(row(second, 'Beta')).toHaveCount(0)
  await second.close()

  // Save the view: the parameters clear, the filter stays.
  await page.getByRole('button', { name: 'Save view' }).click()
  await expect(page.getByRole('button', { name: 'Save view' })).toHaveCount(0)
  await page.reload()
  await expect(row(page, 'Alpha')).toBeVisible()
  await expect(row(page, 'Beta')).toHaveCount(0)

  // A filter nobody matches: the empty result with a way out.
  await page.getByRole('button', { name: /^Filter/ }).click()
  const free = page.getByRole('group', { name: 'Filter value' })
  await free.getByRole('checkbox', { name: 'Free' }).click()
  await expect(free.getByRole('checkbox', { name: 'Free' })).toBeChecked()
  await free.getByRole('checkbox', { name: 'Enterprise' }).click()
  await expect(free.getByRole('checkbox', { name: 'Enterprise' })).not.toBeChecked()
  await expect(page.getByText('No tasks match these filters.')).toBeVisible()
  await snap(page, testInfo, 'fields-filters-empty')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(row(page, 'Beta')).toBeVisible()

  // Group by Customer tier in the List: Enterprise holds its two tasks.
  await page.getByRole('tab', { name: 'List' }).click()
  await pick(page.getByLabel('Group by'), 'Customer tier')
  const enterprise = page.getByRole('button', { name: /^Enterprise/ })
  await expect(enterprise).toHaveText(/2/)
  await expect(page.getByRole('button', { name: /^Pro/ })).toHaveText(/1/)
  await snap(page, testInfo, 'fields-filters-grouped')
})
