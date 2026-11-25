import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { installFetch, json } from '../test/api'
import { useUiStore } from '../shared/ui-store'
import { AppShell } from './AppShell'

function renderShell(route = '/') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>page</p>} />
            <Route path="/w/:workspaceId" element={<p>workspace</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarOpen: true })
  })

  it('shows the app title and the sidebar', () => {
    renderShell()
    expect(screen.getByText('Taskflow')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()
  })

  it('hides and shows the sidebar with the toggle and flips the store', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(useUiStore.getState().sidebarOpen).toBe(false)
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(useUiStore.getState().sidebarOpen).toBe(true)
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()
  })

  it('has the sidebar landmarks: Locations nav, theme switcher, sign out', () => {
    renderShell()
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' })
    expect(within(sidebar).getByRole('navigation', { name: 'Locations' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('main is the only scroll container', () => {
    renderShell()
    expect(screen.getByRole('main')).toHaveClass('overflow-auto', 'min-w-0')
  })

  describe('Inbox link (FR-11)', () => {
    function withUnread(count: number) {
      installFetch({
        'GET /api/v1/workspaces': { items: [] },
        'GET /api/v1/workspaces/:id/notifications/unread-count': () => json({ count }),
        'GET /api/v1/workspaces/:id/tree': { items: [] },
      })
      renderShell('/w/w1')
    }

    it('shows no badge at 0 and the plain name', async () => {
      withUnread(0)
      const link = await screen.findByRole('link', { name: 'Inbox' })
      expect(link).toHaveAttribute('href', '/w/w1/inbox')
      expect(screen.queryByTestId('inbox-badge')).not.toBeInTheDocument()
    })

    it('shows the number and names it, 3', async () => {
      withUnread(3)
      const link = await screen.findByRole('link', { name: 'Inbox, 3 unread' })
      expect(within(link).getByTestId('inbox-badge')).toHaveTextContent('3')
    })

    it('caps the badge at 99+ but names the real count', async () => {
      withUnread(120)
      const link = await screen.findByRole('link', { name: 'Inbox, 120 unread' })
      expect(within(link).getByTestId('inbox-badge')).toHaveTextContent('99+')
    })
  })
})
