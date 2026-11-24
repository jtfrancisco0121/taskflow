import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

/** A unique account per run, so a flow never depends on leftover data. */
export function uniqueEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

export const PASSWORD = 'correct-horse-battery'

export async function signUpAndCreateWorkspace(
  page: Page,
  workspaceName: string,
  displayName = 'Maya E2E',
) {
  await page.goto('/signup')
  await page.getByLabel('Display name').fill(displayName)
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Create your Workspace' })).toBeVisible()
  await page.getByLabel('Name', { exact: true }).fill(workspaceName)
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await expect(page.getByText('This Workspace has no Spaces yet.')).toBeVisible()
}

export async function createSpace(page: Page, name: string) {
  // The first Space has its own button on the empty Workspace page; later ones use the sidebar's.
  const first = page.getByRole('button', { name: 'Create Space' })
  await (
    (await first.count()) > 0 ? first : page.getByRole('button', { name: 'New Space' })
  ).click()
  await page.getByRole('textbox', { name: 'New Space name' }).fill(name)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('treeitem', { name })).toBeVisible()
}

export async function createList(page: Page, spaceName: string, listName: string) {
  await page.getByRole('button', { name: `Actions for ${spaceName}` }).click()
  await page.getByRole('menuitem', { name: 'New List' }).click()
  await page.getByRole('textbox', { name: 'New List name' }).fill(listName)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: listName })).toBeVisible()
}

export async function addTask(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Add a task' }).fill(title)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: title })).toBeVisible()
}

export const row = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title })

/** The status name a List row shows (the selected option of its status cell). */
export const statusOf = (page: Page, title: string) =>
  row(page, title)
    .getByLabel(/^Status of/)
    .locator('option:checked')

// ---- API helpers (the two-browser specs set the scene through the public API) ----

export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'

export type ApiUser = { token: string; id: string; email: string; displayName: string }

export async function apiSignUp(request: APIRequestContext, displayName: string): Promise<ApiUser> {
  const email = uniqueEmail(displayName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'))
  const response = await request.post('/api/v1/auth/signup', {
    data: { email, password: PASSWORD, displayName },
  })
  expect(response.status()).toBe(201)
  const body = await response.json()
  return { token: body.accessToken, id: body.user.id, email, displayName }
}

export async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  user: ApiUser,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { Authorization: `Bearer ${user.token}`, ...headers },
  })
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(
    true,
  )
  return (response.status() === 204 ? {} : await response.json()) as T
}

/** The invite token from the mail Mailpit caught for the address (polls up to 10 s). */
export async function inviteTokenFor(request: APIRequestContext, email: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const search = await request.get(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    )
    const messages = (await search.json()).messages ?? []
    if (messages.length > 0) {
      const message = await (
        await request.get(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)
      ).json()
      const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(message.Text)
      if (match) return match[1]
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`no invite mail for ${email}`)
}

export async function signInThroughTheUi(page: Page, user: ApiUser) {
  await page.goto('/signin')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

// ---- custom fields (3A) ----

export async function openFields(page: Page, location: string) {
  await page.getByRole('button', { name: `Actions for ${location}` }).click()
  await page.getByRole('menuitem', { name: 'Fields' }).click()
  const dialog = page.getByRole('dialog', { name: `Fields: ${location}` })
  await expect(dialog).toBeVisible()
  return dialog
}

export async function createField(
  dialog: Locator,
  name: string,
  type: string,
  options: string[] = [],
) {
  await dialog.getByRole('button', { name: 'New field' }).click()
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByLabel('Field type').selectOption(type)
  for (const [i, option] of options.entries()) {
    await dialog.getByRole('button', { name: 'Add option' }).click()
    await dialog.getByLabel(`Option ${i + 1} name`).fill(option)
  }
  await dialog.getByRole('button', { name: 'Create field' }).click()
  await expect(dialog.getByRole('heading', { name: 'Fields here' })).toBeVisible()
}

/** Creates a saved view of the given type through the "+ View" form and waits for its tab. */
export async function createView(page: Page, name: string, type: string) {
  await page.getByRole('button', { name: '+ View' }).click()
  const form = page.getByRole('form', { name: 'New view' })
  await form.getByLabel('View name').fill(name)
  await form.getByLabel('Type').selectOption({ label: type })
  await form.getByRole('button', { name: 'Create view' }).click()
  await expect(page.getByRole('tab', { name })).toBeVisible()
}
