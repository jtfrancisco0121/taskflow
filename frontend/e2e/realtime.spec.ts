import { expect, test } from '@playwright/test'
import { api, apiSignUp, inviteTokenFor, signInThroughTheUi, taskDetail } from './helpers'
import { expectValue } from './ui'
import { snap } from './screenshots'

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
  await expect(taskDetail(pageA)).toBeVisible()
  await pageB.getByRole('link', { name: 'Live task' }).click()
  await expect(taskDetail(pageB)).toBeVisible()
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

test('FIELD live (3A S6): a value change and a new field show in a second browser without a reload, and the Activity tab names the actor', async ({
  browser,
  request,
}, testInfo) => {
  const a = await apiSignUp(request, 'Alice Owner')
  const b = await apiSignUp(request, 'Bob Member')
  const workspace = await api<Id>(request, a, 'POST', '/workspaces', { name: 'Live Fields Co' })
  const space = await api<Id>(request, a, 'POST', '/locations', {
    type: 'SPACE',
    workspaceId: workspace.id,
    name: 'Shared',
  })
  const list = await api<Id>(request, a, 'POST', '/locations', {
    type: 'LIST',
    parentId: space.id,
    name: 'Fields list',
  })
  const tier = await api<Id>(request, a, 'POST', `/locations/${list.id}/fields`, {
    name: 'Customer tier',
    type: 'DROPDOWN',
    options: [{ name: 'Free' }, { name: 'Pro' }, { name: 'Enterprise' }],
  })
  const task = await api<Id>(request, a, 'POST', `/lists/${list.id}/tasks`, {
    title: 'Live fields',
  })
  await api(request, a, 'POST', `/workspaces/${workspace.id}/invites`, {
    email: b.email,
    role: 'MEMBER',
  })
  await api(request, b, 'POST', `/invites/${await inviteTokenFor(request, b.email)}/accept`)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await signInThroughTheUi(pageB, b)
  await pageB.goto(`/t/${task.id}`)
  const panel = taskDetail(pageB)
  await expect(panel.getByLabel(/^Customer tier for /)).toBeVisible()

  // A sets a value over the API; B's open panel shows it within 2 seconds.
  const current = await api<{ version: number }>(request, a, 'GET', `/tasks/${task.id}`)
  await api(
    request,
    a,
    'PATCH',
    `/tasks/${task.id}`,
    { customFields: { [tier.id]: 'Enterprise' } },
    { 'If-Match': `"${current.version}"` },
  )
  await expectValue(panel.getByLabel(/^Customer tier for /), 'Enterprise', { timeout: 2000 })

  // A defines a new field; it appears in B's panel within 2 seconds.
  await api(request, a, 'POST', `/locations/${list.id}/fields`, {
    name: 'Story points',
    type: 'NUMBER',
  })
  await expect(panel.getByRole('textbox', { name: /^Story points for / })).toBeVisible({
    timeout: 2000,
  })

  // The Activity tab names the actor and the change.
  await panel.getByRole('tab', { name: 'Activity' }).click()
  await expect(panel.getByText('set Customer tier to Enterprise')).toBeVisible()
  await expect(panel.getByText('Alice Owner').first()).toBeVisible()
  await snap(pageB, testInfo, 'fields-activity')
  await contextB.close()
})
