import { expect, test } from '@playwright/test'
import {
  createField,
  createList,
  createSpace,
  openFields,
  signUpAndCreateWorkspace,
} from './helpers'
import { snap } from './screenshots'

// FIELD-1/FIELD-2 (3A S2, UJ-1): define fields at a Space and a List, see where an inherited one comes from, hide it.

test('UJ-1: fields defined on a Space show on its List as inherited, hidden and unhidden there', async ({
  page,
}, testInfo) => {
  await signUpAndCreateWorkspace(page, 'Fields Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Platform')

  // The empty manager of a Space.
  let dialog = await openFields(page, 'Engineering')
  await expect(dialog.getByText('No fields here yet.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'New field' })).toBeVisible()
  await snap(page, testInfo, 'fields-manager-empty')

  await createField(dialog, 'Story points', 'NUMBER')
  await createField(dialog, 'Customer tier', 'DROPDOWN', ['Free', 'Pro'])
  await expect(dialog.getByText('Story points')).toBeVisible()
  await expect(dialog.getByText('Customer tier')).toBeVisible()

  // A name already used on the branch is refused inline and the draft is kept.
  await dialog.getByRole('button', { name: 'New field' }).click()
  await dialog.getByLabel('Name', { exact: true }).fill('story points')
  await dialog.getByRole('button', { name: 'Create field' }).click()
  await expect(dialog.getByText("'story points' is already used on this branch.")).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Rename an Option; the Option editor is the third screenshot.
  await dialog.getByRole('button', { name: 'Edit Customer tier' }).click()
  await dialog.getByLabel('Option 2 name').fill('Enterprise')
  await snap(page, testInfo, 'fields-manager-option-editor')
  await dialog.getByRole('button', { name: 'Save field' }).click()
  await expect(dialog.getByText('Enterprise')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()

  // A field on the List itself, and the Space's fields shown as inherited, "from Engineering".
  dialog = await openFields(page, 'Platform')
  await createField(dialog, 'Notes', 'TEXT')
  await expect(dialog.getByRole('heading', { name: 'Inherited' })).toBeVisible()
  await expect(dialog.getByText('from Engineering').first()).toBeVisible()
  await expect(dialog.getByText('Story points')).toBeVisible()
  await snap(page, testInfo, 'fields-manager-filled')

  await dialog.getByRole('button', { name: 'Hide Story points' }).click()
  await expect(
    dialog.getByText("Hidden here. Tasks in Platform won't show Story points."),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Unhide Story points' }).click()
  await expect(dialog.getByRole('button', { name: 'Hide Story points' })).toBeVisible()
})
