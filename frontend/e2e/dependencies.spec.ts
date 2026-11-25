import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { api, apiSignUp, inviteTokenFor, signInThroughTheUi, type ApiUser } from './helpers'
import { expectValue, pick } from './ui'
import { snap } from './screenshots'

// DEP-1..DEP-6: relationships between tasks (UJ-1), the complete-anyway warning (UJ-2), the
// "is blocked" filter and live updates in a second browser.

/** dnd-kit's pointer sensor needs real movement: press, move in steps, release. */
async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 12 })
  await page.mouse.up()
}

type Id = { id: string }
type Task = Id & { version: number; readableId: string }
type StatusSet = { statuses: Array<Id & { name: string }> }

async function scene(request: APIRequestContext, owner: ApiUser) {
  const workspace = await api<Id>(request, owner, 'POST', '/workspaces', { name: 'Release Co' })
  const space = await api<Id>(request, owner, 'POST', '/locations', {
    type: 'SPACE',
    workspaceId: workspace.id,
    name: 'Engineering',
  })
  const releases = await api<Id>(request, owner, 'POST', '/locations', {
    type: 'LIST',
    parentId: space.id,
    name: 'Releases',
  })
  const bugs = await api<Id>(request, owner, 'POST', '/locations', {
    type: 'LIST',
    parentId: space.id,
    name: 'Bugs',
  })
  const release = await api<Task>(request, owner, 'POST', `/lists/${releases.id}/tasks`, {
    title: 'Ship release 2.4',
  })
  const fix = await api<Task>(request, owner, 'POST', `/lists/${bugs.id}/tasks`, {
    title: 'Fix login redirect',
  })
  const statuses = await api<StatusSet>(request, owner, 'GET', `/locations/${releases.id}/statuses`)
  const status = (name: string) => statuses.statuses.find((s) => s.name === name)!.id
  return { workspace, space, releases, bugs, release, fix, status }
}

async function relate(
  request: APIRequestContext,
  user: ApiUser,
  task: Id,
  relation: string,
  other: Id,
) {
  const current = await api<{ version: number }>(request, user, 'GET', `/tasks/${task.id}`)
  await api(
    request,
    user,
    'POST',
    `/tasks/${task.id}/dependencies`,
    { otherTaskId: other.id, relation },
    { 'If-Match': `"${current.version}"` },
  )
}

test('UJ-1 / UJ-2: relate tasks from the panel, see Blocked everywhere, refuse a loop, warn on complete, filter', async ({
  page,
  request,
}, testInfo) => {
  const mara = await apiSignUp(request, 'Mara Owner')
  const s = await scene(request, mara)
  await signInThroughTheUi(page, mara)

  // UJ-1: Mara makes the release wait on the login fix, from the task panel.
  await page.goto(`/t/${s.release.id}`)
  const panel = page.getByRole('complementary', { name: /^Task / })
  const section = panel.getByRole('region', { name: 'Dependencies' })
  await expect(section.getByText('No dependencies yet.')).toBeVisible()
  await snap(page, testInfo, 'dependencies-empty')
  await section.getByRole('button', { name: 'Add a relationship' }).click()
  await expect(section.getByRole('radio', { name: 'Waiting on' })).toBeChecked()
  await section.getByRole('combobox', { name: 'Find a task' }).fill('login')
  await snap(page, testInfo, 'dependencies-picker')
  await section.getByRole('option', { name: /Fix login redirect/ }).click()
  await expect(
    section.getByRole('list', { name: 'Waiting on' }).getByRole('link', { name: /Fix login/ }),
  ).toBeVisible()
  await expect(panel.getByRole('img', { name: 'Blocked by 1 task' })).toBeVisible()
  await snap(page, testInfo, 'dependencies-section')

  // The List row behind the panel is Blocked too.
  await expect(page.getByRole('img', { name: 'Blocked by 1 task' })).toHaveCount(2)
  await snap(page, testInfo, 'dependencies-list-badge')

  // The fix waits on a third task; making that task wait on the release would close a loop, and
  // the picker names it. (A direct reverse is "already related", so the loop needs three tasks.)
  const third = await api<Task>(request, mara, 'POST', `/lists/${s.bugs.id}/tasks`, {
    title: 'Cut release branch',
  })
  await relate(request, mara, s.fix, 'WAITING_ON', third)
  await page.goto(`/t/${third.id}`)
  const thirdSection = page.getByRole('region', { name: 'Dependencies' })
  await thirdSection.getByRole('button', { name: 'Add a relationship' }).click()
  await thirdSection.getByRole('combobox', { name: 'Find a task' }).fill('release')
  await thirdSection.getByRole('option', { name: /Ship release 2.4/ }).click()
  const refusal = thirdSection.getByRole('alert')
  await expect(refusal).toContainText('This would make a loop:')
  await expect(refusal).toContainText(s.release.readableId)
  await expect(refusal).toContainText(s.fix.readableId)
  await expect(refusal).toContainText(third.readableId)
  await snap(page, testInfo, 'dependencies-cycle-refusal')

  // Board: the card is Blocked; dropping it in Complete warns, Cancel keeps it where it was.
  await page.goto(`/w/${s.workspace.id}/l/${s.releases.id}/v/default-board`)
  const card = page.locator(`[data-task-id="${s.release.id}"]`)
  await expect(card.getByRole('img', { name: 'Blocked by 1 task' })).toBeVisible()
  await dragTo(page, card, page.getByRole('region', { name: 'complete' }))
  const dialog = page.getByRole('dialog', {
    name: 'Ship release 2.4 is waiting on 1 unfinished task',
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Complete anyway' })).toBeVisible()
  await snap(page, testInfo, 'dependencies-complete-warning')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(
    page.getByRole('region', { name: 'to do' }).getByText('Ship release 2.4'),
  ).toBeVisible()

  // The "is blocked" filter keeps only blocked tasks and the URL carries it.
  await api(request, mara, 'POST', `/lists/${s.releases.id}/tasks`, { title: 'Unrelated chore' })
  await page.goto(`/w/${s.workspace.id}/l/${s.space.id}`)
  await expect(page.getByRole('link', { name: 'Unrelated chore' })).toBeVisible()
  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByRole('button', { name: '+ Add filter' }).click()
  await pick(page.getByLabel('Filter field'), 'Blocked')
  await expectValue(page.getByLabel('Filter operator'), 'is blocked')
  await expect(page.getByRole('link', { name: 'Ship release 2.4' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Unrelated chore' })).toHaveCount(0)
  await expect(page).toHaveURL(/[?&]f=/)
  await snap(page, testInfo, 'dependencies-filter')

  // Activity: who added the relationship, and later that the blocker was completed.
  await api(
    request,
    mara,
    'PATCH',
    `/tasks/${s.fix.id}`,
    { statusId: s.status('complete') },
    {
      'If-Match': `"${(await api<{ version: number }>(request, mara, 'GET', `/tasks/${s.fix.id}`)).version}"`,
    },
  )
  await page.goto(`/t/${s.release.id}`)
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByText(`added: waiting on ${s.fix.readableId}`)).toBeVisible()
  await expect(page.getByText(`${s.fix.readableId} was completed`)).toBeVisible()
  await snap(page, testInfo, 'dependencies-activity')
})

test('RT / FR-11: the Blocked badge appears and disappears in a second browser without a reload', async ({
  browser,
  request,
}, testInfo) => {
  const a = await apiSignUp(request, 'Alice Owner')
  const b = await apiSignUp(request, 'Bob Member')
  const s = await scene(request, a)
  await api(request, a, 'POST', `/workspaces/${s.workspace.id}/invites`, {
    email: b.email,
    role: 'MEMBER',
  })
  await api(request, b, 'POST', `/invites/${await inviteTokenFor(request, b.email)}/accept`)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await signInThroughTheUi(pageB, b)
  await pageB.goto(`/w/${s.workspace.id}/l/${s.releases.id}/v/default-board`)
  const card = pageB.locator(`[data-task-id="${s.release.id}"]`)
  await expect(card).toBeVisible()
  await expect(card.getByRole('img', { name: /Blocked by/ })).toHaveCount(0)

  // A relates the release to the fix: B's card becomes Blocked live.
  await relate(request, a, s.release, 'WAITING_ON', s.fix)
  await expect(card.getByRole('img', { name: 'Blocked by 1 task' })).toBeVisible({ timeout: 4000 })
  await snap(pageB, testInfo, 'dependencies-live-blocked')

  // A completes the blocker: the badge disappears without a reload.
  const current = await api<{ version: number }>(request, a, 'GET', `/tasks/${s.fix.id}`)
  await api(
    request,
    a,
    'PATCH',
    `/tasks/${s.fix.id}`,
    { statusId: s.status('complete') },
    { 'If-Match': `"${current.version}"` },
  )
  await expect(card.getByRole('img', { name: /Blocked by/ })).toHaveCount(0, { timeout: 4000 })
  await snap(pageB, testInfo, 'dependencies-live-unblocked')
  await contextB.close()
})
