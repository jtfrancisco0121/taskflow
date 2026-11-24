import { expect, test } from '@playwright/test'
import { api, apiSignUp, inviteTokenFor, signInThroughTheUi } from './helpers'

type Id = { id: string }
type StatusSet = { statuses: Array<Id & { name: string }> }

test('RT-1 / RT-2 / FR-20: a change and a viewer show up in a second browser within 2 seconds', async ({
  browser,
  request,
}) => {
  // The scene is set through the public API: A owns a Workspace and invites B.
  const a = await apiSignUp(request, 'Alice Owner')
  const b = await apiSignUp(request, 'Bob Member')
  const workspace = await api<Id>(request, a, 'POST', '/workspaces', { name: 'Live Co' })
  const space = await api<Id>(request, a, 'POST', '/locations', {
    type: 'SPACE',
    workspaceId: workspace.id,
    name: 'Shared',
  })
  const list = await api<Id>(request, a, 'POST', '/locations', {
    type: 'LIST',
    parentId: space.id,
    name: 'Board list',
  })
  const task = await api<Id>(request, a, 'POST', `/lists/${list.id}/tasks`, { title: 'Live task' })
  await api(request, a, 'POST', `/workspaces/${workspace.id}/invites`, {
    email: b.email,
    role: 'MEMBER',
  })
  const token = await inviteTokenFor(request, b.email)
  await api(request, b, 'POST', `/invites/${token}/accept`)
  const statuses = await api<StatusSet>(request, a, 'GET', `/locations/${list.id}/statuses`)
  const doing = statuses.statuses.find((s) => s.name === 'in progress')!

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await signInThroughTheUi(pageA, a)
  await signInThroughTheUi(pageB, b)
  const board = `/w/${workspace.id}/l/${space.id}/v/default-board`
  await pageA.goto(board)
  await pageB.goto(board)
  await expect(pageA.getByRole('region', { name: 'to do' }).getByText('Live task')).toBeVisible()
  await expect(pageB.getByRole('region', { name: 'to do' }).getByText('Live task')).toBeVisible()

  // RT-1: A changes the status; B's Board moves the card without a reload, within 2 seconds
  const current = await api<{ version: number }>(request, a, 'GET', `/tasks/${task.id}`)
  await api(
    request,
    a,
    'PATCH',
    `/tasks/${task.id}`,
    { statusId: doing.id },
    { 'If-Match': `"${current.version}"` },
  )
  await expect(
    pageB.getByRole('region', { name: 'in progress' }).getByText('Live task'),
  ).toBeVisible({
    timeout: 2000,
  })
  await expect(pageB.getByRole('region', { name: 'to do' }).getByText('Live task')).toHaveCount(0)

  // RT-2: A opens the task; B opens it too and each sees the other viewing it within 2 seconds
  await pageA.getByRole('link', { name: 'Live task' }).click()
  await expect(pageA.getByRole('complementary', { name: /^Task / })).toBeVisible()
  await pageB.getByRole('link', { name: 'Live task' }).click()
  await expect(pageB.getByRole('complementary', { name: /^Task / })).toBeVisible()
  await expect(pageA.getByText('Bob Member is viewing this')).toBeVisible({ timeout: 2000 })
  await expect(pageB.getByText('Alice Owner is viewing this')).toBeVisible({ timeout: 2000 })

  // a renamed Space shows in the other browser's sidebar without a reload
  await api(request, a, 'PATCH', `/locations/${space.id}`, { name: 'Shared renamed' })
  await expect(pageB.getByRole('treeitem', { name: 'Shared renamed' })).toBeVisible({
    timeout: 2000,
  })

  await contextA.close()
  await contextB.close()
})
