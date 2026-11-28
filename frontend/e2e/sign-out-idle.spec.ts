import { expect, test, type Page } from '@playwright/test'
import { apiSignUp, signInAs } from './helpers'

// ClickUp 14yq6g3353g: a tab idle past the access token's 15 minutes still ends the session when the user signs
// out. Sign-out works from the refresh cookie alone, so the rejected access token the tab sends cannot stop it.

const answerTo = (page: Page, path: string) =>
  page.waitForResponse((r) => new URL(r.url()).pathname === path)

test('E2E-1: sign-out with a rejected access token ends the session, also after a reload', async ({
  page,
  request,
}) => {
  const user = await apiSignUp(request, 'Idle Tab')
  await signInAs(page, user)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  // Stands in for the idle tab: the access token it sends is no longer accepted.
  await page.route('**/api/v1/auth/signout', (route) =>
    route.continue({
      headers: { ...route.request().headers(), authorization: 'Bearer expired.access.token' },
    }),
  )
  const signOut = answerTo(page, '/api/v1/auth/signout')
  await page.getByRole('button', { name: 'Sign out' }).click()

  expect((await signOut).status()).toBe(204)
  await expect(page).toHaveURL(/\/signin$/)

  const bootRefresh = answerTo(page, '/api/v1/auth/refresh')
  await page.reload()
  expect((await bootRefresh).status()).toBe(401)
  await expect(page).toHaveURL(/\/signin$/)
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})
