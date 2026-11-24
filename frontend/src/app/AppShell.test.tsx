import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../shared/ui-store'
import { AppShell } from './AppShell'

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>page</p>} />
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
})
