import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { api, apiSignUp, signInThroughTheUi } from './helpers'
import { pick } from './ui'

// Slice 4: the List view. A scene is set through the API, then the UI is driven like a user.

type Id = { id: string }

/** A signed-in Workspace with one List holding the given tasks; the List page is open. */
async function openList(
  page: Page,
  request: APIRequestContext,
  tasks: Array<{ title: string; priority?: string }>,
) {
  const user = await apiSignUp(request, 'Lena List')
  const workspace = await api<Id>(request, user, 'POST', '/workspaces', { name: 'List Co' })
  const space = await api<Id>(request, user, 'POST', '/locations', {
    type: 'SPACE',
    workspaceId: workspace.id,
    name: 'Engineering',
  })
  const list = await api<Id>(request, user, 'POST', '/locations', {
    type: 'LIST',
    parentId: space.id,
    name: 'Backlog',
  })
  for (const task of tasks) await api(request, user, 'POST', `/lists/${list.id}/tasks`, task)
  await signInThroughTheUi(page, user)
  await page.goto(`/w/${workspace.id}/l/${list.id}`)
  for (const task of tasks) await expect(page.getByRole('link', { name: task.title })).toBeVisible()
  return { user, workspace, list }
}

test('chip bar: a filter shows a chip and the save bar; removing it hides both; Back restores it', async ({
  page,
  request,
}) => {
  await openList(page, request, [
    { title: 'Alpha', priority: 'URGENT' },
    { title: 'Beta', priority: 'LOW' },
  ])
  const bar = page.getByRole('group', { name: 'Unsaved view changes' })
  await expect(bar).toBeHidden()

  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByRole('button', { name: '+ Add filter' }).click()
  const chip = page.getByRole('button', { name: 'Priority is any of Urgent', exact: true })
  await expect(chip).toBeVisible()
  await expect(bar).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeHidden()

  await page.getByRole('button', { name: 'Remove Priority is any of Urgent' }).click()
  await expect(chip).toBeHidden()
  await expect(bar).toBeHidden()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible()

  await page.goBack()
  await expect(chip).toBeVisible()
  await expect(bar).toBeVisible()
})

test('chip bar: Save view hides the bar and the saved filter survives a reload', async ({
  page,
  request,
}) => {
  await openList(page, request, [
    { title: 'Alpha', priority: 'URGENT' },
    { title: 'Beta', priority: 'LOW' },
  ])
  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByRole('button', { name: '+ Add filter' }).click()
  await pick(page.getByLabel('Group by'), 'Priority')
  await page.getByRole('button', { name: 'Save view' }).click()
  await expect(page.getByRole('group', { name: 'Unsaved view changes' })).toBeHidden()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Priority is any of Urgent', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('group', { name: 'Unsaved view changes' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeHidden()
})
