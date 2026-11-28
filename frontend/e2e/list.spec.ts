import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { api, apiSignUp, signInAs } from './helpers'
import { pick } from './ui'

// Slice 4: the List view. A scene is set through the API, then the UI is driven like a user.

type Id = { id: string }

/** A signed-in Workspace with one List holding the given tasks; the List page is open. */
async function openList(
  page: Page,
  request: APIRequestContext,
  tasks: Array<{ title: string; priority?: string; parent?: string }>,
) {
  const user = await apiSignUp(request, 'Lena List')
  const workspace = await api<Id>(request, user, 'POST', '/workspaces', { name: 'List Co' })
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
  const ids = new Map<string, string>()
  for (const { parent, ...task } of tasks) {
    const created = await api<Id>(request, user, 'POST', `/lists/${list.id}/tasks`, {
      ...task,
      ...(parent ? { parentTaskId: ids.get(parent) } : {}),
    })
    ids.set(task.title, created.id)
  }
  await signInAs(page, user)
  await page.goto(`/w/${workspace.id}/l/${list.id}`)
  for (const task of tasks) await expect(page.getByRole('link', { name: task.title })).toBeVisible()
  return { user, workspace, list }
}

test('chip bar: a filter shows a chip and the save bar; removing it hides both; Back restores it', async ({
  page,
  request,
}) => {
  await openList(page, request, [
    { title: 'Alpha', priority: 'URGENT' },
    { title: 'Beta', priority: 'LOW' },
  ])
  const bar = page.getByRole('group', { name: 'Unsaved view changes' })
  await expect(bar).toBeHidden()

  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByRole('button', { name: '+ Add filter' }).click()
  const chip = page.getByRole('button', { name: 'Priority is any of Urgent', exact: true })
  await expect(chip).toBeVisible()
  await expect(bar).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeHidden()

  await page.getByRole('button', { name: 'Remove Priority is any of Urgent' }).click()
  await expect(chip).toBeHidden()
  await expect(bar).toBeHidden()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible()

  await page.goBack()
  await expect(chip).toBeVisible()
  await expect(bar).toBeVisible()
})

test('chip bar: Save view hides the bar and the saved filter survives a reload', async ({
  page,
  request,
}) => {
  await openList(page, request, [
    { title: 'Alpha', priority: 'URGENT' },
    { title: 'Beta', priority: 'LOW' },
  ])
  await page.getByRole('button', { name: 'Filter' }).click()
  await page.getByRole('button', { name: '+ Add filter' }).click()
  await pick(page.getByLabel('Group by'), 'Priority')
  await page.getByRole('button', { name: 'Save view' }).click()
  await expect(page.getByRole('group', { name: 'Unsaved view changes' })).toBeHidden()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Priority is any of Urgent', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('group', { name: 'Unsaved view changes' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeHidden()
})

test('row editors: status, priority, assignee and due date are picked in popovers', async ({
  page,
  request,
}) => {
  await openList(page, request, [{ title: 'Alpha' }])
  const alpha = page.getByRole('row').filter({ hasText: 'Alpha' })

  await pick(alpha.getByLabel(/^Status of/), 'in progress')
  await expect(alpha.getByLabel(/^Status of/)).toHaveText('in progress')
  await pick(alpha.getByLabel(/^Priority of/), 'Urgent')
  await expect(alpha.getByLabel(/^Priority of/)).toHaveText('Urgent')

  await pick(alpha.getByLabel(/^Assignees of/), 'Lena List')
  await expect(
    alpha.getByLabel(/^Assignees of/).getByRole('img', { name: 'Lena List' }),
  ).toBeVisible()
  await pick(alpha.getByLabel(/^Assignees of/), 'Lena List')
  await expect(alpha.getByLabel(/^Assignees of/).getByRole('img')).toHaveCount(0)

  await pick(alpha.getByLabel(/^Due date of/), 'Tomorrow')
  await expect(alpha.getByLabel(/^Due date of/)).not.toHaveText('—')
  await page.reload()
  await expect(alpha.getByLabel(/^Due date of/)).not.toHaveText('—')
  await pick(alpha.getByLabel(/^Due date of/), 'No date')
  await expect(alpha.getByLabel(/^Due date of/)).toHaveText('—')
  await expect(alpha.getByLabel(/^Status of/)).toHaveText('in progress')
})

const rowOf = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title })
const rowEl = (page: Page, title: string) => rowOf(page, title).locator('[data-task-id]')

test('row keys: j/k, x, Enter, s, p, a, d, Escape', async ({ page, request }) => {
  await openList(page, request, [{ title: 'Alpha' }, { title: 'Beta' }])
  await rowEl(page, 'Alpha').focus()

  await page.keyboard.press('j')
  await expect(rowEl(page, 'Beta')).toBeFocused()
  await page.keyboard.press('k')
  await expect(rowEl(page, 'Alpha')).toBeFocused()

  await page.keyboard.press('x')
  await expect(rowOf(page, 'Alpha')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(rowOf(page, 'Alpha')).toHaveAttribute('aria-selected', 'false')

  await page.keyboard.press('s')
  await page.getByRole('option', { name: 'in progress', exact: true }).click()
  await expect(rowOf(page, 'Alpha').getByLabel(/^Status of/)).toHaveText('in progress')
  // The editor gives focus back to its own trigger; the next row key still acts on the row.
  await expect(rowOf(page, 'Alpha').getByLabel(/^Status of/)).toBeFocused()

  await page.keyboard.press('p')
  await page.getByRole('option', { name: 'Urgent', exact: true }).click()
  await expect(rowOf(page, 'Alpha').getByLabel(/^Priority of/)).toHaveText('Urgent')

  await page.keyboard.press('a')
  await page.getByRole('option', { name: 'Lena List', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(rowOf(page, 'Alpha').getByRole('img', { name: 'Lena List' })).toBeVisible()

  await page.keyboard.press('d')
  await page.getByRole('option', { name: 'Tomorrow', exact: true }).click()
  await expect(rowOf(page, 'Alpha').getByLabel(/^Due date of/)).not.toHaveText('—')

  await rowEl(page, 'Alpha').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/t\//)
})

test('row keys: Backspace trashes the row and Undo brings it back; the guard keeps keys in quick add', async ({
  page,
  request,
}) => {
  await openList(page, request, [{ title: 'Alpha' }, { title: 'Beta' }])
  // Typing in the quick-add box never triggers a row key.
  await page.getByRole('textbox', { name: 'Add a task' }).fill('')
  await page.getByRole('textbox', { name: 'Add a task' }).pressSequentially('xjsp?')
  await expect(page.getByRole('textbox', { name: 'Add a task' })).toHaveValue('xjsp?')
  await expect(page.getByRole('dialog')).toBeHidden()

  await rowEl(page, 'Alpha').focus()
  await page.keyboard.press('j')
  await page.keyboard.press('k')
  await page.keyboard.press('x')
  await page.keyboard.press('j')
  await page.keyboard.press('x')
  await page.keyboard.press('k')
  await page.keyboard.press('Backspace')
  await expect(page.getByText('Moved 2 tasks to trash.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha' })).toBeHidden()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Restored 2 tasks.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible()
})

test('two quick Backspaces then one Undo restores both rows', async ({ page, request }) => {
  await openList(page, request, [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }])
  await rowEl(page, 'Alpha').focus()
  await page.keyboard.press('Backspace')
  await expect(page.getByRole('link', { name: 'Alpha' })).toBeHidden()
  await expect(page.getByText('Moved 1 task to trash.')).toBeVisible()
  await expect(rowEl(page, 'Beta')).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(page.getByText('Moved 2 tasks to trash.')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Restored 2 tasks.')).toBeVisible()
  for (const title of ['Alpha', 'Beta', 'Gamma']) {
    await expect(page.getByRole('link', { name: title })).toBeVisible()
  }
})

// The guard (isShortcutBlocked) in a real browser: the key is dispatched on the row itself, so it reaches the
// Tasks table handler whatever the open layer does with focus.
const pressOnRow = (page: Page, title: string, key: string) =>
  rowEl(page, title).evaluate(
    (el, k) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })),
    key,
  )

test('row keys do nothing while a modal dialog is open', async ({ page, request }) => {
  await openList(page, request, [{ title: 'Alpha' }, { title: 'Beta' }])
  await rowEl(page, 'Alpha').focus()
  await page.getByRole('button', { name: 'Statuses' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  for (const key of ['x', 'j', 'Backspace', 's']) await pressOnRow(page, 'Alpha', key)
  await expect(rowOf(page, 'Alpha')).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByText(/to trash/)).toHaveCount(0)
  await expect(page.locator('[data-tf-floating]')).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('link', { name: 'Alpha' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible()
})

test('row keys do nothing while a floating layer (a row editor) is open', async ({
  page,
  request,
}) => {
  await openList(page, request, [{ title: 'Alpha' }, { title: 'Beta' }])
  await rowOf(page, 'Beta')
    .getByLabel(/^Priority of/)
    .click()
  const layer = page.locator('[data-tf-floating]')
  await expect(layer).toBeVisible()
  for (const key of ['x', 'j', 'Backspace']) await pressOnRow(page, 'Alpha', key)
  await expect(rowOf(page, 'Alpha')).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByText(/to trash/)).toHaveCount(0)
  await expect(layer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(layer).toBeHidden()
  await expect(page.getByRole('link', { name: 'Alpha' })).toBeVisible()
})

test('a held Backspace on a focused row trashes exactly one task', async ({ page, request }) => {
  await openList(page, request, [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }])
  await rowEl(page, 'Alpha').focus()
  // Playwright marks every down() of an already pressed key as an auto-repeat.
  await page.keyboard.down('Backspace')
  for (let i = 0; i < 5; i++) await page.keyboard.down('Backspace')
  await page.keyboard.up('Backspace')
  await expect(page.getByText('Moved 1 task to trash.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Alpha' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Gamma' })).toBeVisible()
  await expect(page.getByText(/Moved \d+ tasks? to trash/)).toHaveCount(1)
})

test('bulk Delete of a parent and its subtask, then Undo, restores both with no error', async ({
  page,
  request,
}) => {
  await openList(page, request, [
    { title: 'Parent' },
    { title: 'Child', parent: 'Parent' },
    { title: 'Other' },
  ])
  await page.getByRole('checkbox', { name: 'Select Parent' }).click()
  await page.getByRole('checkbox', { name: 'Select Child' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Moved 2 tasks to trash.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Parent' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Child' })).toBeHidden()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Restored 2 tasks.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Parent' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Child' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('? opens the shortcut sheet; Escape closes it and focus is back on the row', async ({
  page,
  request,
}) => {
  await openList(page, request, [{ title: 'Alpha' }])
  await rowEl(page, 'Alpha').focus()
  await page.keyboard.press('?')
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('region', { name: 'Global' })).toBeVisible()
  await expect(sheet.getByRole('region', { name: 'List' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(rowEl(page, 'Alpha')).toBeFocused()

  // In the quick-add box the ? is just a character.
  const add = page.getByRole('textbox', { name: 'Add a task' })
  await add.click()
  await page.keyboard.press('?')
  await expect(add).toHaveValue('?')
  await expect(sheet).toBeHidden()
})
