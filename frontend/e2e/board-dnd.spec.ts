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
