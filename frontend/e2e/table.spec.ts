import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { api, apiSignUp, createView, signInThroughTheUi } from './helpers'

// Slice 7: the Table. A scene is set through the API, then the UI is driven like a user.

type Id = { id: string }

/** A signed-in Workspace with one List holding `count` tasks, on a new Table view. */
async function openTable(page: Page, request: APIRequestContext, count: number) {
  const user = await apiSignUp(request, 'Tara Table')
  const workspace = await api<Id>(request, user, 'POST', '/workspaces', { name: 'Table Co' })
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
  for (let i = 1; i <= count; i++) {
    await api<Id>(request, user, 'POST', `/lists/${list.id}/tasks`, { title: `Task ${i}` })
  }
  await signInThroughTheUi(page, user)
  await page.goto(`/w/${workspace.id}/l/${list.id}`)
  await createView(page, 'Grid', 'Table')
  await expect(page.getByRole('table', { name: 'Tasks table' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Task 1', exact: true })).toBeVisible()
  return { user, workspace, list }
}

const scroller = (page: Page) => page.locator('[role="table"][aria-label="Tasks table"] > div')

test('layout: the sticky header stays on top, the first and last rows are reachable, and widths cover every column', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await openTable(page, request, 30)
  const header = page
    .getByRole('row')
    .filter({ has: page.getByRole('columnheader') })
    .first()

  // Before scrolling: the first row starts at the header's bottom, with no gap and no overlap.
  const headerBox = (await header.boundingBox())!
  const firstBox = (await page.locator('[data-task-id]').first().boundingBox())!
  expect(Math.abs(firstBox.y - (headerBox.y + headerBox.height))).toBeLessThanOrEqual(1)

  // Scrolling down: no row paints over the header.
  await scroller(page).evaluate((el) => el.scrollTo({ top: 300 }))
  await expect
    .poll(() =>
      header.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + 40, box.top + box.height / 2)
        return !!hit && el.contains(hit)
      }),
    )
    .toBe(true)

  // To the end: the last task's row is visible and fully below the header.
  await scroller(page).evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  const last = page.locator('[data-task-id]').filter({ hasText: 'Task 30' })
  await expect(last).toBeVisible()
  const headerNow = (await header.boundingBox())!
  const lastBox = (await last.boundingBox())!
  expect(lastBox.y).toBeGreaterThanOrEqual(headerNow.y + headerNow.height - 1)

  // Sideways to the far right: header and row widths equal the column sum and the last header cell is on top.
  await scroller(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth, top: 0 }))
  const sum = await header.evaluate((el) =>
    (el.style.gridTemplateColumns || getComputedStyle(el).gridTemplateColumns)
      .split(' ')
      .reduce((total, w) => total + parseFloat(w), 0),
  )
  await expect.poll(async () => (await header.boundingBox())!.width).toBeCloseTo(sum, 0)
  const rowBox = (await page.locator('[data-task-id]').first().boundingBox())!
  expect(rowBox.width).toBeCloseTo(sum, 0)
  const lastCell = page.getByRole('columnheader').last()
  expect(
    await lastCell.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return !!hit && el.contains(hit)
    }),
  ).toBe(true)
})
