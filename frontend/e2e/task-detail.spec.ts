import { expect, test, type Page } from '@playwright/test'
import { addTask, createList, createSpace, signUpAndCreateWorkspace, taskDetail } from './helpers'

// Slice 5: the task detail, one body in two frames (a modal and a docked panel).

async function setUp(page: Page, titles: string[]) {
  await signUpAndCreateWorkspace(page, 'Detail Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Platform')
  for (const title of titles) await addTask(page, title)
}

const rowEl = (page: Page, title: string) =>
  page.getByRole('row').filter({ hasText: title }).locator('[data-task-id]')

async function openByEnter(page: Page, title: string) {
  await rowEl(page, title).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/t\//)
  await expect(taskDetail(page)).toBeVisible()
}

test('Enter opens a centered modal over the List; Docked moves it beside the List and survives a reload', async ({
  page,
}) => {
  await setUp(page, ['Alpha', 'Beta'])
  await openByEnter(page, 'Alpha')
  const modal = page.getByRole('dialog', { name: /^Task / })
  await expect(modal).toBeVisible()
  await expect(modal.getByLabel('Title')).toBeFocused()
  expect((await modal.boundingBox())!.width).toBeLessThanOrEqual(940)
  await expect(modal.getByRole('region', { name: 'Discussion and activity' })).toBeVisible()
  // the List stays visible behind it
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible()

  await modal.getByRole('button', { name: 'Docked' }).click()
  const docked = page.getByRole('complementary', { name: /^Task / })
  await expect(docked).toBeVisible()
  expect((await docked.boundingBox())!.width).toBeLessThanOrEqual(600)
  await page.reload()
  await expect(page.getByRole('complementary', { name: /^Task / })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /^Task / })).toHaveCount(0)
})

test('docked: the List still takes row clicks and row keys, and Escape returns focus to the row', async ({
  page,
}) => {
  await setUp(page, ['Alpha', 'Beta'])
  await openByEnter(page, 'Alpha')
  await taskDetail(page).getByRole('button', { name: 'Docked' }).click()
  const docked = page.getByRole('complementary', { name: /^Task / })
  await expect(docked.getByLabel('Title')).toHaveValue('Alpha')

  // a row key on a focused List row: j moves to the next row, the docked task stays
  await rowEl(page, 'Alpha').focus()
  await page.keyboard.press('j')
  await expect(rowEl(page, 'Beta')).toBeFocused()
  await expect(docked.getByLabel('Title')).toHaveValue('Alpha')
  await page.keyboard.press('x')
  await expect(page.getByRole('row').filter({ hasText: 'Beta' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(docked.getByLabel('Title')).toHaveValue('Alpha')
  await page.keyboard.press('Escape')

  // a row click opens that task in the same panel
  await page.getByRole('link', { name: 'Beta' }).click()
  await expect(docked.getByLabel('Title')).toHaveValue('Beta')

  await docked.getByLabel('Title').focus()
  await page.keyboard.press('Escape')
  await expect(docked).toHaveCount(0)
  await expect(rowEl(page, 'Beta')).toBeFocused()
})

for (const mode of ['modal', 'docked'] as const) {
  test(`${mode}: Escape returns focus to the row; Escape in the comment composer keeps the detail and the text`, async ({
    page,
  }) => {
    await setUp(page, ['Alpha'])
    await openByEnter(page, 'Alpha')
    if (mode === 'docked') await taskDetail(page).getByRole('button', { name: 'Docked' }).click()
    const detail = taskDetail(page)
    const composer = detail.getByRole('textbox', { name: 'Write a comment' })
    await composer.click()
    await page.keyboard.type('Half a comment')
    await page.keyboard.press('Escape')
    await expect(detail).toBeVisible()
    await expect(composer).toContainText('Half a comment')

    await detail.getByRole('button', { name: 'Close task panel' }).focus()
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(rowEl(page, 'Alpha')).toBeFocused()
  })
}
