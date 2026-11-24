import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { getAccessToken } from '../../api/session'
import { json, problem, renderWithProviders, useStubFetch } from '../../test/api'
import { SignUpPage } from './SignUpPage'

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/setup" element={<h1>Create your Workspace</h1>} />
    </Routes>,
    { route: '/signup' },
  )
}

async function fill(user: ReturnType<typeof userEvent.setup>, email = 'maya@example.com') {
  await user.type(screen.getByLabelText('Display name'), 'Maya')
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), 'correct-horse-battery')
}

describe('SignUpPage', () => {
  it('FR-1: a valid sign-up stores the session and routes to /setup', async () => {
    const stub = useStubFetch({
      'POST /api/v1/auth/signup': json(
        { accessToken: 'tok', user: { id: 'u1', displayName: 'Maya', email: 'maya@example.com' } },
        201,
      ),
    })
    const user = userEvent.setup()
    renderPage()

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Create your Workspace' })).toBeVisible()
    expect(getAccessToken()).toBe('tok')
    expect(stub.calls.find((c) => c.url.pathname.endsWith('/signup'))?.body).toEqual({
      displayName: 'Maya',
      email: 'maya@example.com',
      password: 'correct-horse-battery',
    })
  })

  it('FR-1: a server refusal shows its detail and keeps name and email', async () => {
    useStubFetch({
      'POST /api/v1/auth/signup': problem(409, 'auth.email_taken', 'That email is already in use.'),
    })
    const user = userEvent.setup()
    renderPage()

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That email is already in use.')
    expect(screen.getByLabelText('Display name')).toHaveValue('Maya')
    expect(screen.getByLabelText('Email')).toHaveValue('maya@example.com')
    expect(getAccessToken()).toBeNull()
  })

  it('FR-1: client validation blocks a bad email and a short password without a request', async () => {
    const stub = useStubFetch()
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Display name'), 'Maya')
    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Enter a valid email address.')).toBeVisible()
    expect(screen.getByText('Use at least 10 characters.')).toBeVisible()
    expect(stub.count('POST', /\/auth\/signup$/)).toBe(0)
  })
})
