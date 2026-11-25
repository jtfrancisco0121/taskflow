import { expect, test } from '@playwright/test'
import {
  createField,
  createList,
  createSpace,
  createView,
  openFields,
  row,
  signUpAndCreateWorkspace,
} from './helpers'
import { snap } from './screenshots'

// CAP-9, UJ-3 (3A S7): an agent with an API key creates a task with a field value over MCP; the UI shows it.

type McpResult = { result?: { isError?: boolean; content?: Array<{ text: string }> } }

test('UJ-3: an agent files a task with Customer tier by name; the Table shows it and the Activity names the key', async ({
  page,
  request,
}, testInfo) => {
  await signUpAndCreateWorkspace(page, 'Agents Co')
  await createSpace(page, 'Engineering')
  await createList(page, 'Engineering', 'Backlog')
  const listId = page.url().match(/\/l\/([0-9a-f-]+)/)![1]
  const dialog = await openFields(page, 'Engineering')
  await createField(dialog, 'Customer tier', 'Dropdown', ['Free', 'Pro', 'Enterprise'])
  await dialog.getByRole('button', { name: 'Close' }).click()

  // A key through the Settings UI.
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Create service account' }).click()
  const create = page.getByRole('dialog', { name: 'Create service account' })
  await create.getByLabel('Name').fill('triage-agent')
  await create.getByRole('button', { name: 'Create service account' }).click()
  await page.getByRole('button', { name: 'Create key' }).click()
  const keyDialog = page.getByRole('dialog', { name: 'Create key' })
  await keyDialog.getByLabel('Name').fill('CI-1')
  await keyDialog.getByRole('button', { name: 'Create key' }).click()
  const secret = (await page.getByLabel('API key').textContent())!.trim()
  expect(secret).toMatch(/^tf_sk_/)
  await page.getByRole('button', { name: 'I have copied the key' }).click()

  // The agent calls MCP with only the key.
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const response = await request.post('/api/v1/mcp', {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })
    expect(response.ok()).toBe(true)
    const body = (await response.json()) as McpResult
    expect(body.result?.isError ?? false, JSON.stringify(body)).toBe(false)
    return JSON.parse(body.result!.content![0].text)
  }
  const fields = await callTool('list_custom_fields', { locationId: listId })
  expect(fields.fields.map((f: { name: string }) => f.name)).toContain('Customer tier')
  const created = await callTool('create_task', {
    listId,
    title: 'Agent ticket',
    customFields: { 'Customer tier': 'Enterprise' },
    idempotencyKey: crypto.randomUUID(),
  })
  expect(Object.values(created.customFields)).toHaveLength(1)
  const found = await callTool('search_tasks', {
    locationId: listId,
    customFields: [{ fieldId: fields.fields[0].id, op: 'any_of', value: ['Enterprise'] }],
  })
  expect(found.items.map((i: { title: string }) => i.title)).toEqual(['Agent ticket'])

  // The UI shows the value in a Table and the entry in the Activity tab.
  await page.goto(`/w/${page.url().match(/\/w\/([0-9a-f-]+)/)![1]}/l/${listId}`)
  await createView(page, 'Triage', 'Table')
  await page.getByText('Columns', { exact: true }).click()
  await page.getByRole('checkbox', { name: /Customer tier/ }).click()
  await expect(
    row(page, 'Agent ticket').getByRole('button', { name: 'Customer tier: Enterprise' }),
  ).toBeVisible()
  await row(page, 'Agent ticket').getByRole('link', { name: 'Agent ticket' }).click()
  const panel = page.getByRole('complementary', { name: /^Task / })
  await panel.getByRole('tab', { name: 'Activity' }).click()
  await expect(panel.getByText('triage-agent (key CI-1)').first()).toBeVisible()
  await expect(panel.getByText('set Customer tier to Enterprise')).toBeVisible()
  await snap(page, testInfo, 'fields-agent-activity')
})
