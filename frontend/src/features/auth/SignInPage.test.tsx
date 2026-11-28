import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { getAccessToken } from '../../api/session'
import { json, problem, renderWithProviders, installFetch } from '../../test/api'
import { SignInPage } from './SignInPage'
import { fill } from '../../test/ui'

function renderPage(state?: object) {
  return renderWithProviders(
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/t/:id" element={<h1>Task page</h1>} />
      <Route path="/" element={<h1>Home</h1>} />
    </Routes>,
    { route: '/signin', state },
  )
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await fill(user, screen.getByLabelText('Email'), 'maya@example.com')
  await fill(user, screen.getByLabelText('Password'), 'wrong-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInPage', () => {
  it('FR-2: signing in returns to the page the user came from', async () => {
    installFetch({
      'POST /api/v1/auth/signin': json({ accessToken: 'tok', user: { id: 'u1' } }),
    })
    const user = userEvent.setup()
    renderPage({ from: { pathname: '/t/abc' } })

    await submit(user)

    expect(await screen.findByRole('heading', { name: 'Task page' })).toBeVisible()
    expect(getAccessToken()).toBe('tok')
  })

  it('FR-2: a wrong password shows one generic error, stores no token and clears the password', async () => {
    installFetch({
      'POST /api/v1/auth/signin': problem(401, 'auth.invalid_credentials', 'Bad credentials'),
    })
    const user = userEvent.setup()
    renderPage()

    await submit(user)

    expect(await screen.findAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong email or password.')
    expect(getAccessToken()).toBeNull()
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  it('FR-2: a 429 shows the rate-limit message', async () => {
    installFetch({
      'POST /api/v1/auth/signin': problem(429, 'auth.rate_limited', 'Slow down'),
    })
    const user = userEvent.setup()
    renderPage()

    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again later.',
    )
  })
})
