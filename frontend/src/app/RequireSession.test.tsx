import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SignInPage } from '../features/auth'
import { getAccessToken } from '../api/session'
import { json, problem, renderWithProviders, installFetch } from '../test/api'
import { RequireSession } from './RequireSession'
import { fill } from '../test/ui'

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route element={<RequireSession />}>
        <Route path="/t/:id" element={<h1>Task panel</h1>} />
        <Route path="/" element={<h1>Home</h1>} />
      </Route>
    </Routes>,
    { route },
  )
}

describe('RequireSession', () => {
  it('FR-4: shows a loading screen, then restores the session from the refresh cookie', async () => {
    installFetch({
      'POST /api/v1/auth/refresh': json({ accessToken: 'tok', user: { id: 'u1' } }),
    })
    renderApp('/')

    expect(screen.getByRole('status')).toHaveTextContent('Loading Taskflow…')
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(getAccessToken()).toBe('tok')
  })

  it('FR-4: sends exactly one refresh even when the boot effect runs twice', async () => {
    const stub = installFetch({
      'POST /api/v1/auth/refresh': json({ accessToken: 'tok', user: { id: 'u1' } }),
    })
    renderApp('/')
    await screen.findByRole('heading', { name: 'Home' })
    expect(stub.count('POST', /\/auth\/refresh$/)).toBe(1)
  })

  it('FR-5: /t/abc signed out goes to sign-in and back to /t/abc after signing in', async () => {
    installFetch({
      'POST /api/v1/auth/refresh': problem(401, 'auth.invalid_refresh', 'No session'),
      'POST /api/v1/auth/signin': json({ accessToken: 'tok', user: { id: 'u1' } }),
    })
    const user = userEvent.setup()
    renderApp('/t/abc')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible()
    await fill(user, screen.getByLabelText('Email'), 'maya@example.com')
    await fill(user, screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Task panel' })).toBeVisible()
  })
})
