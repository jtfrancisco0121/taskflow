import { expect, test } from '@playwright/test'
import {
  addTask,
  createList,
  createSpace,
  row,
  signUpAndCreateWorkspace,
  statusOf,
} from './helpers'

test('FR-26: sign up, create a Workspace, Space, List and task, then open the task', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'Acme')
  await createSpace(page, 'Marketing')
  await createList(page, 'Marketing', 'Launch')

  await expect(page.getByText('No tasks yet. Type a title below to add one.')).toBeVisible()
  await addTask(page, 'Draft launch post')
  await expect(row(page, 'Draft launch post').getByText(/^[A-Z]+-\d+$/)).toBeVisible()

  await page.getByRole('link', { name: 'Draft launch post' }).click()
  await expect(page).toHaveURL(/\/t\/[0-9a-f-]+$/)
  const panel = page.getByRole('complementary', { name: /^Task / })
  await expect(panel.getByLabel('Title')).toHaveValue('Draft launch post')

  // a field edit carries If-Match, a comment shows with its author, the activity names the change
  await panel.getByLabel('Status').selectOption({ label: 'in progress' })
  await expect(panel.getByText('Saved').first()).toBeVisible()
  await panel.getByRole('textbox', { name: 'Write a comment' }).click()
  await page.keyboard.type('Hello')
  await panel.getByRole('button', { name: 'Comment' }).click()
  await expect(panel.getByText('Maya E2E').first()).toBeVisible()
  await expect(panel.getByText('Hello')).toBeVisible()
  await panel.getByRole('tab', { name: 'Activity' }).click()
  await expect(panel.getByText('changed status from to do to in progress')).toBeVisible()

  // a reload keeps the session (refresh cookie) and opens the same task cold
  const url = page.url()
  await page.reload()
  await expect(page).toHaveURL(url)
  await expect(page.getByRole('complementary', { name: /^Task / }).getByLabel('Title')).toHaveValue(
    'Draft launch post',
  )
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible()
})

test('statuses: a first own set remaps its List only, and a reset leaves the sibling List alone', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'Beta')
  await createSpace(page, 'Ops')
  await createList(page, 'Ops', 'List A')
  await addTask(page, 'Task in A')
  await createList(page, 'Ops', 'List B')
  await addTask(page, 'Task in B')
  await expect(statusOf(page, 'Task in B')).toHaveText('to do')

  // List A inherits the Space set: save a first own set that renames "to do" to "Backlog".
  await page.getByRole('link', { name: 'List A' }).click()
  await expect(page.getByRole('heading', { name: 'List A' })).toBeVisible()
  await expect(statusOf(page, 'Task in A')).toHaveText('to do')
  await page.getByRole('button', { name: 'Statuses' }).click()
  const dialog = page.getByRole('dialog', { name: /Statuses/ })
  await expect(dialog.getByText('Inherited from Ops')).toBeVisible()
  await dialog.getByRole('button', { name: 'Customize for this List' }).click()
  await dialog.getByRole('textbox', { name: 'Status 1 name' }).fill('Backlog')
  // "to do" has no same-name status any more: the user says where its tasks go
  await dialog.getByRole('combobox', { name: 'Move tasks from to do to' }).selectOption('Backlog')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText('Defined here')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(statusOf(page, 'Task in A')).toHaveText('Backlog')

  // the sibling List still inherits: its task keeps "to do" with its status pill resolved
  await page.getByRole('link', { name: 'List B' }).click()
  await expect(page.getByRole('heading', { name: 'List B' })).toBeVisible()
  await expect(statusOf(page, 'Task in B')).toHaveText('to do')

  // reset List A to inherited: its task goes back to "to do", the sibling is still untouched
  await page.getByRole('link', { name: 'List A' }).click()
  await page.getByRole('button', { name: 'Statuses' }).click()
  await dialog.getByRole('button', { name: 'Reset to inherited' }).click()
  await dialog.getByRole('combobox', { name: 'Move tasks from Backlog to' }).selectOption('to do')
  await dialog.getByRole('button', { name: 'Reset to inherited' }).click()
  await expect(dialog.getByText('Inherited from Ops')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(statusOf(page, 'Task in A')).toHaveText('to do')
  await page.getByRole('link', { name: 'List B' }).click()
  await expect(statusOf(page, 'Task in B')).toHaveText('to do')
})
