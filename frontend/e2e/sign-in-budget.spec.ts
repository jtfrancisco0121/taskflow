import { expect, test, type Page } from '@playwright/test'
import { apiSignUp, signInAs } from './helpers'

// Epic 14yq6g334tf: e2e setup must not spend the per-IP sign-in limit (20 a minute), or repeat runs fail with
// "Too many attempts". signInAs starts the app from the sign-up's refresh cookie instead of the sign-in form.

function signInRequests(page: Page) {
  const seen: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/auth/signin')
      seen.push(r.url())
  })
  return seen
}

test('E2E-1: signInAs starts the app signed in with no sign-in request', async ({
  page,
  request,
}) => {
  const user = await apiSignUp(request, 'Sam Session')
  const signIns = signInRequests(page)

  await signInAs(page, user)

  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(signIns).toEqual([])
})

test('E2E-2: the same user on a second page falls back to the form, once', async ({
  browser,
  page,
  request,
}) => {
  const user = await apiSignUp(request, 'Sam Twice')
  await signInAs(page, user)
  const other = await (await browser.newContext()).newPage()
  const signIns = signInRequests(other)

  await signInAs(other, user)

  await expect(other.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(signIns).toHaveLength(1)
  await other.context().close()
})
