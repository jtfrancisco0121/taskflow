import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { api, apiSignUp, createView, row, signInThroughTheUi } from './helpers'
import { pick } from './ui'

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

test('TABLE-1: Pickers edit a row, keyboard width and order survive a reload, and Escape on the detail focuses the row', async ({
  page,
  request,
}) => {
  await openTable(page, request, 2)

  // Add the Start column (it is not a default one), then edit through the Pickers.
  await page.getByText('Columns', { exact: true }).click()
  await page.getByRole('checkbox', { name: 'Start date' }).click()
  await page.keyboard.press('Escape')
  const alpha = row(page, 'Task 1')
  await pick(alpha.getByLabel(/^Status of/), 'in progress')
  await expect(alpha.getByLabel(/^Status of/)).toHaveText(/in progress/)
  await pick(alpha.getByLabel(/^Due date of/), 'Tomorrow')
  await expect(alpha.getByLabel(/^Due date of/)).not.toHaveText('—')
  await pick(alpha.getByLabel(/^Start date of/), 'Today')
  await expect(alpha.getByLabel(/^Start date of/)).not.toHaveText('—')

  // Header keys: widen Title by 20px, then move it one place right.
  const title = page.getByRole('button', { name: /^Title column, width/ })
  const before = Number(/width (\d+)/.exec((await title.getAttribute('aria-label'))!)![1])
  await title.focus()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await expect(title).toHaveAttribute('aria-label', `Title column, width ${before + 20}`)
  await page.keyboard.press('Alt+ArrowRight')
  const order = async () =>
    page
      .getByRole('columnheader')
      .evaluateAll((els) =>
        els.map(
          (el) => el.querySelector('button')?.getAttribute('aria-label')?.split(' column')[0],
        ),
      )
  await expect.poll(async () => (await order()).indexOf('Title')).toBe(2)
  const moved = await order()

  await page.reload()
  await expect(
    page.getByRole('button', { name: `Title column, width ${before + 20}` }),
  ).toBeVisible()
  expect(await order()).toEqual(moved)
  await expect(row(page, 'Task 1').getByLabel(/^Status of/)).toHaveText(/in progress/)
  await expect(row(page, 'Task 1').getByLabel(/^Due date of/)).not.toHaveText('—')
  await expect(row(page, 'Task 1').getByLabel(/^Start date of/)).not.toHaveText('—')

  // Open a task from its title, Escape closes the detail, and the focus is on that task's row.
  await page.getByRole('link', { name: 'Task 2', exact: true }).click()
  await expect(
    page
      .getByRole('dialog', { name: /^Task / })
      .or(page.getByRole('complementary', { name: /^Task / })),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.closest('[data-task-id]')?.textContent ?? ''),
    )
    .toContain('Task 2')
  await expect(page.locator('[data-task-id]:focus')).toHaveCount(1)
})
