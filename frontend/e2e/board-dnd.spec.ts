import { expect, test, type Page } from '@playwright/test'
import { addTask, createList, createSpace, signUpAndCreateWorkspace } from './helpers'

/** dnd-kit's pointer sensor needs real movement: press, move in steps, release. */
async function dragTo(
  page: Page,
  from: ReturnType<Page['locator']>,
  to: ReturnType<Page['locator']>,
) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 12 })
  await page.mouse.up()
}

test('BOARD-1 / FR-19: dragging a card to another column survives a reload', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'Board Co')
  await createSpace(page, 'Product')
  await createList(page, 'Product', 'Sprint')
  await addTask(page, 'Write the spec')
  await addTask(page, 'Review the spec')

  await page.getByRole('tab', { name: 'Board' }).click()
  const todo = page.getByRole('region', { name: 'to do' })
  const doing = page.getByRole('region', { name: 'in progress' })
  await expect(todo.getByText('Write the spec')).toBeVisible()
  await expect(todo.getByText('Review the spec')).toBeVisible()

  const move = page.waitForResponse(
    (r) => /\/api\/v1\/tasks\/[^/]+\/move$/.test(r.url()) && r.request().method() === 'POST',
  )
  await dragTo(page, todo.getByText('Write the spec'), doing)
  expect((await move).status()).toBe(200)
  await expect(doing.getByText('Write the spec')).toBeVisible()
  await expect(todo.getByText('Write the spec')).toHaveCount(0)

  await page.reload()
  await expect(
    page.getByRole('region', { name: 'in progress' }).getByText('Write the spec'),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'to do' }).getByText('Review the spec'),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'to do' }).getByText('Write the spec')).toHaveCount(
    0,
  )
})

async function openBoard(page: Page, titles: string[]) {
  await signUpAndCreateWorkspace(page, 'Board Keys Co')
  await createSpace(page, 'Product')
  await createList(page, 'Product', 'Sprint')
  for (const title of titles) await addTask(page, title)
  await page.getByRole('tab', { name: 'Board' }).click()
  await expect(page.getByRole('region', { name: 'to do' }).getByText(titles[0])).toBeVisible()
}

test('keyboard: Tab to a card, Enter opens it, Escape returns focus to the card', async ({
  page,
}) => {
  await openBoard(page, ['Write the spec'])
  const card = page.locator('[data-task-id]').filter({ hasText: 'Write the spec' })
  await card.focus()
  await page.keyboard.press('Enter')
  const detail = page.getByRole('dialog', { name: /^Task / })
  await expect(detail).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  await expect(card).toBeFocused()
})

test('keyboard: Space lifts, ArrowRight, Space drops, survives a reload', async ({ page }) => {
  await openBoard(page, ['Write the spec'])
  const card = page.locator('[data-task-id]').filter({ hasText: 'Write the spec' })
  await card.focus()
  const move = page.waitForResponse(
    (r) => /\/api\/v1\/tasks\/[^/]+\/move$/.test(r.url()) && r.request().method() === 'POST',
  )
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('region', { name: 'in progress' })).toHaveAttribute(
    'data-over',
    'true',
  )
  await page.keyboard.press('Space')
  expect((await move).status()).toBe(200)
  await expect(
    page.getByRole('region', { name: 'in progress' }).getByText('Write the spec'),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'in progress' }).getByText('Write the spec'),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'to do' }).getByText('Write the spec')).toHaveCount(
    0,
  )
})
