import { expect, test } from '@playwright/test'
import {
  addTask,
  createField,
  createList,
  createSpace,
  openFields,
  signUpAndCreateWorkspace,
  taskDetail,
} from './helpers'
import { expectValue, pick } from './ui'
import { snap } from './screenshots'

// FIELD-1 (3A S3, UJ-2): set and clear values of several types in the task panel.

test('UJ-2: values are set and cleared in the task panel, a refusal shows the server message, a reload keeps them', async ({
  page,
}, testInfo) => {
  await signUpAndCreateWorkspace(page, 'Values Co')

  // A List with no fields at all: the panel group says so.
  await createSpace(page, 'Bare')
  await createList(page, 'Bare', 'Plain')
  await addTask(page, 'Nothing to fill')
  await page.getByRole('link', { name: 'Nothing to fill' }).click()
  const barePanel = taskDetail(page)
  await expect(
    barePanel.getByText("No custom fields here. Add one from the location's Fields."),
  ).toBeVisible()
  await snap(page, testInfo, 'fields-panel-empty')
  await barePanel.getByRole('button', { name: 'Close task panel' }).click()

  // A Space with fields; its List inherits them.
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Backlog')
  const dialog = await openFields(page, 'Engineering')
  await createField(dialog, 'Story points', 'Number')
  await createField(dialog, 'Customer tier', 'Dropdown', ['Free', 'Pro', 'Enterprise'])
  await createField(dialog, 'Done', 'Checkbox')
  await createField(dialog, 'Notes', 'Text')
  await dialog.getByRole('button', { name: 'Close' }).click()

  await addTask(page, 'Ship it')
  await page.getByRole('link', { name: 'Ship it' }).click()
  const panel = taskDetail(page)
  await expect(panel.getByRole('heading', { name: 'Custom fields' })).toBeVisible()
  await expect(panel.getByText('from Engineering').first()).toBeVisible()

  const points = panel.getByRole('textbox', { name: /^Story points for / })
  // Every edit is waited on until the server has answered: the panel shows a value optimistically, so a
  // reload right after the UI looks done could otherwise race the request still in flight.
  const saved = (act: () => Promise<unknown>) =>
    Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && /\/api\/v1\/tasks\//.test(r.url()) && r.ok(),
      ),
      act(),
    ])
  await points.fill('5')
  await saved(() => points.press('Enter'))
  await expect(panel.getByText('Saved').first()).toBeVisible()
  await saved(() => pick(panel.getByLabel(/^Customer tier for /), 'Enterprise'))
  await saved(() => panel.getByRole('checkbox', { name: /^Done for / }).check())
  await panel.getByRole('textbox', { name: /^Notes for / }).fill('call back')
  await saved(() => panel.getByRole('textbox', { name: /^Notes for / }).press('Enter'))
  await expect(panel.getByRole('checkbox', { name: /^Done for / })).toBeChecked()
  await snap(page, testInfo, 'fields-panel-values')

  // A reload keeps every value.
  await page.reload()
  const reloaded = taskDetail(page)
  await expect(reloaded.getByRole('textbox', { name: /^Story points for / })).toHaveValue('5')
  await expectValue(reloaded.getByLabel(/^Customer tier for /), 'Enterprise')
  await expect(reloaded.getByRole('checkbox', { name: /^Done for / })).toBeChecked()
  await expect(reloaded.getByRole('textbox', { name: /^Notes for / })).toHaveValue('call back')

  // A value the server refuses rolls back and the message is shown.
  const again = reloaded.getByRole('textbox', { name: /^Story points for / })
  await again.fill('abc')
  await again.press('Enter')
  await expect(reloaded.getByText(/Story points expects a number/)).toBeVisible()
  await expect(again).toHaveValue('5')
  await snap(page, testInfo, 'fields-panel-error')

  // Clearing removes the value, and it stays cleared after a reload.
  await again.fill('')
  await again.press('Enter')
  await expect(reloaded.getByText('Saved').first()).toBeVisible()
  await pick(reloaded.getByLabel(/^Customer tier for /), '—')
  await page.reload()
  const cleared = taskDetail(page)
  await expect(cleared.getByRole('textbox', { name: /^Story points for / })).toHaveValue('')
  await expectValue(cleared.getByLabel(/^Customer tier for /), '—')
})
