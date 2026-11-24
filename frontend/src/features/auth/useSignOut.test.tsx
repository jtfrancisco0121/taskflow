import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { getAccessToken, setSession } from '../../api/session'
import { newQueryClient, useStubFetch } from '../../test/api'
import { useSignOut } from './useSignOut'

function SignOutButton() {
  const signOut = useSignOut()
  return <button onClick={() => void signOut()}>Sign out</button>
}

describe('useSignOut', () => {
  it('FR-3: calls signout, clears the token and the cache, and routes to sign-in', async () => {
    const stub = useStubFetch({
      'POST /api/v1/auth/signout': new Response(null, { status: 204 }),
    })
    setSession('tok', { id: 'u1' })
    const queryClient = newQueryClient()
    queryClient.setQueryData(['workspaces'], { items: [{ id: 'w1' }] })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/w/1']}>
          <Routes>
            <Route path="/w/1" element={<SignOutButton />} />
            <Route path="/signin" element={<h1>Sign in</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible())
    expect(stub.count('POST', /\/auth\/signout$/)).toBe(1)
    expect(getAccessToken()).toBeNull()
    expect(queryClient.getQueryData(['workspaces'])).toBeUndefined()
  })
})
