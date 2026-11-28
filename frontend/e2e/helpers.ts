import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { pick, valueOf } from './ui'

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

/** The status name a List row shows (the value of its status cell). */
export const statusOf = (page: Page, title: string) =>
  valueOf(row(page, title).getByLabel(/^Status of/))

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
  const cookie = response
    .headersArray()
    .find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('refresh_token='))
  if (cookie) {
    const [pair, ...attributes] = cookie.value.split(';').map((part) => part.trim())
    const path = attributes.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/'
    signUpSessions.set(body.user.id, { value: pair.slice('refresh_token='.length), path })
  }
  return { token: body.accessToken, id: body.user.id, email, displayName }
}

/** The refresh cookie each apiSignUp received, until signInAs hands it to a browser (used once). */
const signUpSessions = new Map<string, { value: string; path: string }>()

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

/**
 * Starts the app signed in as `user` (epic 14yq6g334tf). The sign-in form counts against the per-IP limit of
 * 20 a minute, and repeat runs from 127.0.0.1 tripped it ("Too many attempts"). So the browser gets the refresh
 * cookie apiSignUp already received and the app signs in through /auth/refresh, with no /auth/signin request.
 * A refresh cookie is used once (the app rotates it): signing the same user in on a second page uses the form.
 * Guarded by e2e/sign-in-budget.spec.ts.
 */
export async function signInAs(page: Page, user: ApiUser) {
  const session = signUpSessions.get(user.id)
  if (session) {
    signUpSessions.delete(user.id)
    await page.context().addCookies([
      {
        name: 'refresh_token',
        value: session.value,
        domain: 'localhost',
        path: session.path,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ])
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    return
  }
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
  /** The Field type as the picker shows it, e.g. 'Dropdown'. */
  typeLabel: string,
  options: string[] = [],
) {
  await dialog.getByRole('button', { name: 'New field' }).click()
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await pick(dialog.getByLabel('Field type'), typeLabel)
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
  await pick(form.getByLabel('Type'), type)
  await form.getByRole('button', { name: 'Create view' }).click()
  await expect(page.getByRole('tab', { name })).toBeVisible()
}

/** What only each renderer draws once it has data: the old view is gone when the new one's landmark shows. */
const VIEW_LANDMARK = {
  Table: (page: Page) => page.getByRole('table', { name: 'Tasks table', exact: true }),
  List: (page: Page) => page.getByRole('table', { name: 'Tasks', exact: true }),
  Board: (page: Page) => page.locator('[aria-label="Board"]'),
} as const

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Opens the "Columns" picker of the view in tab `tab` (a `kind` view) and returns it, open
 * (ClickUp 14yq6g334rp). Right after a tab switch the old view can still be mounted: a click then opens the old
 * view's picker, and the new view mounts its own closed one (ColumnsPicker is an uncontrolled <details>). So this
 * waits for the tab to be selected and for the new renderer, then (re)opens the one picker until it stays open.
 * Specs never click "Columns" themselves (an ESLint rule in eslint.config.js).
 */
export async function openColumns(page: Page, tab: string, kind: keyof typeof VIEW_LANDMARK) {
  // A view tab's name can carry a visibility mark after the view name (ViewTabs.tsx).
  const name = new RegExp(`^${escapeRegExp(tab)}( |$)`)
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
  await expect(VIEW_LANDMARK[kind](page)).toBeVisible()
  for (const [other, landmark] of Object.entries(VIEW_LANDMARK)) {
    if (other !== kind) await expect(landmark(page)).toHaveCount(0)
  }
  const picker = page.locator('details', { has: page.locator('summary', { hasText: /^Columns$/ }) })
  await expect(async () => {
    await expect(picker).toHaveCount(1, { timeout: 1_000 })
    if (!(await picker.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await picker.locator('summary').click({ timeout: 1_000 })
    }
    await expect(picker).toHaveJSProperty('open', true, { timeout: 1_000 })
  }).toPass()
  return picker
}

/** The open task detail, in either frame: the modal dialog or the docked complementary panel (AD-1). */
export const taskDetail = (page: Page): Locator =>
  page
    .getByRole('dialog', { name: /^Task / })
    .or(page.getByRole('complementary', { name: /^Task / }))

/**
 * Lifts the focused Board card with Space and moves it one column right with ArrowRight. dnd-kit's keyboard
 * sensor can miss a key pressed right after the lift (it listens one tick later), so the arrow is pressed again
 * until the column the card started in is no longer the drop target. Leaves the card lifted.
 */
export async function liftToNextColumn(page: Page, fromColumn: string) {
  const from = page.getByRole('region', { name: fromColumn })
  await page.keyboard.press('Space')
  await expect(page.getByText(/ is over /)).toBeAttached()
  await expect(async () => {
    if ((await from.getAttribute('data-over')) === 'true') await page.keyboard.press('ArrowRight')
    await expect(from).not.toHaveAttribute('data-over', 'true', { timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}
