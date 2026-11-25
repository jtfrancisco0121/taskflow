import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch } from '../test/api'
import { router } from './router'

// AD-3: the palette is mounted by AppShell only, so the shortcut does nothing outside the signed-in shell.
describe('Cmd/Ctrl+K outside the shell', () => {
  it.each([
    ['/signin', 'Sign in'],
    ['/signup', 'Create account'],
    ['/design', 'Design'],
  ])('does nothing on %s', async (path, heading) => {
    installFetch({})
    const user = userEvent.setup()
    const memory = createMemoryRouter(router.routes, { initialEntries: [path] })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={memory} />
      </QueryClientProvider>,
    )
    await screen.findAllByText(new RegExp(heading, 'i'))
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })
})
