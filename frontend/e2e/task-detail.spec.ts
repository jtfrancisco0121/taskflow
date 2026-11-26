import { expect, test, type Page } from '@playwright/test'
import { pick } from './ui'
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

test('subtasks: add one, see it in the section and the List behind, open it and follow the parent link', async ({
  page,
}) => {
  await setUp(page, ['Parent task'])
  await openByEnter(page, 'Parent task')
  const detail = taskDetail(page)
  const field = detail.getByRole('textbox', { name: 'Add a subtask' })
  await field.fill('Write the migration note')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('')
  const section = detail.getByRole('region', { name: 'Subtasks' })
  await expect(section.getByRole('link', { name: 'Write the migration note' })).toBeVisible()
  // the List behind the detail shows it too, without a reload
  await expect(page.getByRole('row').filter({ hasText: 'Write the migration note' })).toBeVisible()

  await section.getByRole('link', { name: 'Write the migration note' }).click()
  await expect(detail.getByLabel('Title')).toHaveValue('Write the migration note')
  await detail.getByRole('link', { name: /Parent task/ }).click()
  await expect(detail.getByLabel('Title')).toHaveValue('Parent task')
})

async function addChecklist(page: Page, name: string, items: string[]) {
  const detail = taskDetail(page)
  await detail.getByRole('button', { name: 'Add checklist' }).click()
  const field = detail.getByRole('textbox', { name: 'Checklist name' })
  await expect(field).toBeFocused()
  await field.fill(name)
  await page.keyboard.press('Enter')
  for (const text of items) {
    const add = detail.getByRole('textbox', { name: `Add an item to ${name}` })
    await add.fill(text)
    await page.keyboard.press('Enter')
    await expect(detail.getByRole('checkbox', { name: text })).toBeVisible()
  }
}

test('checklists: create Release with two items, check one, 1/2 survives a reload', async ({
  page,
}) => {
  await setUp(page, ['Alpha'])
  await openByEnter(page, 'Alpha')
  await addChecklist(page, 'Release', ['Write notes', 'Tag the build'])
  const detail = taskDetail(page)
  await detail.getByRole('checkbox', { name: 'Write notes' }).click()
  await expect(detail.getByText('1/2')).toBeVisible()
  await page.reload()
  await expect(taskDetail(page).getByText('1/2')).toBeVisible()
  await expect(taskDetail(page).getByRole('checkbox', { name: 'Write notes' })).toBeChecked()
  // rename and delete an item, then the checklist
  const reloaded = taskDetail(page)
  await reloaded.getByRole('button', { name: 'Delete item Tag the build' }).click()
  await expect(reloaded.getByText('1/1')).toBeVisible()
  await reloaded.getByRole('button', { name: 'Delete checklist Release' }).click()
  await expect(reloaded.getByText('No checklists yet.')).toBeVisible()
})

for (const mode of ['modal', 'docked'] as const) {
  test(`SM-1 (${mode}): Enter, Picker edits, a subtask, a checklist item and Escape back to the row`, async ({
    page,
  }) => {
    await setUp(page, ['Alpha'])
    await openByEnter(page, 'Alpha')
    if (mode === 'docked') await taskDetail(page).getByRole('button', { name: 'Docked' }).click()
    const detail = taskDetail(page)
    await pick(detail.getByLabel('Status', { exact: true }), 'in progress')
    await expect(detail.getByLabel('Status', { exact: true })).toHaveText('in progress')
    await pick(detail.getByLabel('Priority', { exact: true }), 'Urgent')
    await expect(detail.getByLabel('Priority', { exact: true })).toHaveText('Urgent')
    await detail.getByRole('textbox', { name: 'Add a subtask' }).fill('First step')
    await page.keyboard.press('Enter')
    await expect(detail.getByRole('link', { name: 'First step' })).toBeVisible()
    await addChecklist(page, 'Steps', ['Do it'])
    await detail.getByRole('button', { name: 'Close task panel' }).focus()
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(rowEl(page, 'Alpha')).toBeFocused()
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: 'Alpha' })
        .getByLabel(/^Priority of/),
    ).toHaveText('Urgent')
  })
}

for (const mode of ['modal', 'docked'] as const) {
  test(`SM-2 (${mode}): j and k walk three tasks of the List without history entries, and the mode survives a reload`, async ({
    page,
  }) => {
    await setUp(page, ['Alpha', 'Beta', 'Gamma'])
    await openByEnter(page, 'Alpha')
    if (mode === 'docked') await taskDetail(page).getByRole('button', { name: 'Docked' }).click()
    const detail = taskDetail(page)
    const title = detail.getByLabel('Title')
    await expect(title).toHaveValue('Alpha')
    // focus is in the detail but not in a text field
    await detail.getByRole('button', { name: 'Close task panel' }).focus()
    const entries = await page.evaluate(() => history.length)
    await page.keyboard.press('j')
    await expect(title).toHaveValue('Beta')
    await page.keyboard.press('j')
    await expect(title).toHaveValue('Gamma')
    await page.keyboard.press('j') // the end: nothing happens
    await expect(title).toHaveValue('Gamma')
    await page.keyboard.press('k')
    await expect(title).toHaveValue('Beta')
    await page.keyboard.press('ArrowUp')
    await expect(title).toHaveValue('Alpha')
    expect(await page.evaluate(() => history.length)).toBe(entries)
    // in a text field j is a letter
    await title.focus()
    await page.keyboard.press('j')
    await expect(title).toHaveValue('Alphaj')
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(
      mode === 'docked'
        ? page.getByRole('complementary', { name: /^Task / })
        : page.getByRole('dialog', { name: /^Task / }),
    ).toBeVisible()
  })
}
