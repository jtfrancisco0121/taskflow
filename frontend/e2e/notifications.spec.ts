import { expect, test } from '@playwright/test'
import { api, apiSignUp, inviteTokenFor, signInThroughTheUi } from './helpers'
import { snap } from './screenshots'

type Id = { id: string }

// CAP-11, CAP-12 (3C S7): an assignment made in browser A raises browser B's bell live, and reading in one tab
// updates the other. SM-3: the 2 second budget is measured over a loop.

test('UJ-2: an assignment in A raises the bell in B within 2 seconds, and marking read updates a second tab', async ({
  browser,
  request,
}, testInfo) => {
  const a = await apiSignUp(request, 'Alice Owner')
  const b = await apiSignUp(request, 'Bob Member')
  const workspace = await api<Id>(request, a, 'POST', '/workspaces', { name: 'Inbox Co' })
  const space = await api<Id>(request, a, 'POST', '/locations', {
    type: 'SPACE',
    workspaceId: workspace.id,
    name: 'Shared',
  })
  const list = await api<Id>(request, a, 'POST', '/locations', {
    type: 'LIST',
    parentId: space.id,
    name: 'Work',
  })
  await api(request, a, 'POST', `/workspaces/${workspace.id}/invites`, {
    email: b.email,
    role: 'MEMBER',
  })
  await api(request, b, 'POST', `/invites/${await inviteTokenFor(request, b.email)}/accept`)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await signInThroughTheUi(pageB, b)
  await pageB.goto(`/w/${workspace.id}`)
  const bell = pageB.getByRole('button', { name: /^Notifications/ })
  await expect(bell).toBeVisible()
  await expect(pageB.getByTestId('unread-badge')).toHaveCount(0)

  // SM-3: several assignments, each must show within 2 s (the slowest of the loop is the measure)
  const elapsed: number[] = []
  for (let i = 1; i <= 5; i++) {
    const started = Date.now()
    await api(request, a, 'POST', `/lists/${list.id}/tasks`, {
      title: `Task ${i}`,
      assigneeIds: [b.id],
    })
    await expect(pageB.getByTestId('unread-badge')).toHaveText(String(i), { timeout: 4000 })
    elapsed.push(Date.now() - started)
  }
  elapsed.sort((x, y) => x - y)
  const p95 = elapsed[Math.ceil(elapsed.length * 0.95) - 1]
  expect(p95, `latencies ${elapsed.join(', ')} ms`).toBeLessThan(2000)

  await bell.click()
  const popover = pageB.getByRole('dialog', { name: 'Notifications' })
  await expect(popover.getByText('Alice Owner assigned you to')).toHaveCount(5)
  await snap(pageB, testInfo, 'notifications-popover')

  // a second tab of B updates when the first marks everything read
  const tab2 = await contextB.newPage()
  await tab2.goto(`/w/${workspace.id}`)
  await expect(tab2.getByTestId('unread-badge')).toHaveText('5')
  await popover.getByRole('button', { name: 'Mark all read' }).click()
  await expect(pageB.getByTestId('unread-badge')).toHaveCount(0)
  await expect(tab2.getByTestId('unread-badge')).toHaveCount(0, { timeout: 4000 })

  await popover.getByRole('link', { name: 'Open inbox' }).click()
  await expect(pageB.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await expect(pageB.getByText("You're all caught up.")).toBeVisible()
  await snap(pageB, testInfo, 'notifications-inbox')
  await pageB.getByRole('tab', { name: 'All' }).click()
  await expect(pageB.getByText('Alice Owner assigned you to')).toHaveCount(5)

  await contextB.close()
})
