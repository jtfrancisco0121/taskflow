import { expect, test } from '@playwright/test'
import {
  api,
  apiSignUp,
  createView,
  inviteTokenFor,
  openColumns,
  row,
  signInThroughTheUi,
} from './helpers'
import { pick } from './ui'
import { snap } from './screenshots'

// FIELD-1..3 (3A S8): the People field type, picked inline, filtered by "Me" and grouped per person.

type Id = { id: string }

test('People: pick two members in a Table cell, filter by Me, group by the field', async ({
  page,
  request,
}, testInfo) => {
  const alice = await apiSignUp(request, 'Alice Owner')
  const bob = await apiSignUp(request, 'Bob Member')
  const workspace = await api<Id>(request, alice, 'POST', '/workspaces', { name: 'People Co' })
  const space = await api<Id>(request, alice, 'POST', '/locations', {
    type: 'SPACE',
    workspaceId: workspace.id,
    name: 'Engineering',
  })
  const list = await api<Id>(request, alice, 'POST', '/locations', {
    type: 'LIST',
    parentId: space.id,
    name: 'Backlog',
  })
  await api(request, alice, 'POST', `/workspaces/${workspace.id}/invites`, {
    email: bob.email,
    role: 'MEMBER',
  })
  await api(request, bob, 'POST', `/invites/${await inviteTokenFor(request, bob.email)}/accept`)
  await api(request, alice, 'POST', `/locations/${list.id}/fields`, {
    name: 'Reviewer',
    type: 'PEOPLE',
  })
  for (const title of ['One', 'Two']) {
    await api(request, alice, 'POST', `/lists/${list.id}/tasks`, { title })
  }

  await signInThroughTheUi(page, alice)
  await page.goto(`/w/${workspace.id}/l/${list.id}`)
  await createView(page, 'Review', 'Table')
  await openColumns(page, 'Review', 'Table')
  await page.getByRole('checkbox', { name: /Reviewer/ }).click()
  await expect(page.getByRole('columnheader', { name: /Reviewer/ })).toBeVisible()

  // Two members picked in a cell: both avatars show.
  await row(page, 'One').getByRole('button', { name: 'Reviewer: empty' }).click()
  const picker = page.getByRole('group', { name: /^Reviewer for / })
  await picker.getByRole('checkbox', { name: 'Alice Owner' }).click()
  await picker.getByRole('checkbox', { name: 'Bob Member' }).click()
  await snap(page, testInfo, 'fields-people-picker')
  await page.keyboard.press('Escape')
  const cell = row(page, 'One').getByRole('button', { name: /^Reviewer:/ })
  await expect(cell.getByLabel('Alice Owner')).toBeVisible()
  await expect(cell.getByLabel('Bob Member')).toBeVisible()

  // The second task has only Bob.
  await row(page, 'Two').getByRole('button', { name: 'Reviewer: empty' }).click()
  await page
    .getByRole('group', { name: /^Reviewer for / })
    .getByRole('checkbox', { name: 'Bob Member' })
    .click()
  await page.keyboard.press('Escape')
  await expect(row(page, 'Two').getByLabel('Bob Member')).toBeVisible()

  // Filter "Reviewer is any of Me": only the task where Alice is a reviewer.
  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByRole('button', { name: '+ Add filter' }).click()
  await pick(page.getByLabel('Filter field'), 'Reviewer')
  await expect(
    page
      .getByRole('group', { name: 'Filter value' })
      .getByRole('checkbox', { name: 'Me', exact: true }),
  ).toBeChecked()
  await expect(row(page, 'One')).toBeVisible()
  await expect(row(page, 'Two')).toHaveCount(0)

  // Grouped per person in the List: a task sits under each reviewer.
  await page.getByRole('tab', { name: 'List' }).click()
  await pick(page.getByLabel('Group by'), 'Reviewer')
  const bobGroup = page.getByRole('button', { name: /^Bob Member/ })
  await expect(bobGroup).toHaveText(/2/)
  await expect(page.getByRole('button', { name: /^Alice Owner/ })).toHaveText(/1/)
  await snap(page, testInfo, 'fields-people-grouped')
})
