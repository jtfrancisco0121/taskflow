import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useThemeStore } from '../../shared/theme/theme-store'
import { useUiStore } from '../../shared/ui-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { AppShell } from '../AppShell'
import { RequireSession } from '../RequireSession'

// AD-9: Ctrl/Cmd+K pressed while the app is still booting (session restore, shell mounting) must not be
// dropped: it is queued and the palette opens once when the shell is ready. Root cause of the old flake: the
// shortcut listener was mounted with AppShell, so a key pressed during "Loading Taskflow…" reached nobody.
const CTRL_K = '{Control>}k{/Control}'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

describe('palette shortcut while the shell mounts', () => {
  it('queues Ctrl+K pressed during the session boot and opens the palette once when the shell is ready', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    installFetch({
      'POST /api/v1/auth/refresh': async () => {
        await held
        return json({ accessToken: 'tok', user: { id: 'u1' } })
      },
      'GET /api/v1/workspaces': { items: [{ id: 'w1', name: 'Acme', role: 'OWNER' }] },
      'GET /api/v1/workspaces/:id/notifications/unread-count': { count: 0 },
      'GET /api/v1/workspaces/:id/tree': { items: [] },
    })
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route element={<RequireSession />}>
          <Route element={<AppShell />}>
            <Route path="/w/:workspaceId" element={<Where />} />
          </Route>
        </Route>
      </Routes>,
      { route: '/w/w1' },
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading Taskflow…')
    await user.keyboard(CTRL_K)
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    await act(async () => release())
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    expect(useUiStore.getState().paletteRequested).toBe(false)
    // a Command picked now runs
    await user.keyboard('Aurora{Enter}')
    await waitFor(() => expect(useThemeStore.getState().choice).toBe('dark'))
    // once: a second press opens it again and a third closes it (no double toggle)
    await user.keyboard(CTRL_K)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    await user.keyboard(CTRL_K)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull(),
    )
  })

  it('opens the palette on /setup and on a task answered 404 (no workspace to wait for)', async () => {
    installFetch({
      'POST /api/v1/auth/refresh': json({ accessToken: 'tok', user: { id: 'u1' } }),
      'GET /api/v1/workspaces': { items: [] },
      'GET /api/v1/tasks/:id': problem(404, 'task.not_found', 'Not found'),
    })
    const user = userEvent.setup()
    for (const route of ['/setup', '/t/gone']) {
      const view = renderWithProviders(
        <Routes>
          <Route element={<RequireSession />}>
            <Route element={<AppShell />}>
              <Route path="/setup" element={<Where />} />
              <Route path="/t/:taskId" element={<Where />} />
            </Route>
          </Route>
        </Routes>,
        { route },
      )
      await screen.findByTestId('where')
      await user.keyboard(CTRL_K)
      expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
      view.unmount()
      useUiStore.setState({ paletteOpen: false })
    }
  })

  it('drops a request made before the shell is ready when the route changes first', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    installFetch({
      'POST /api/v1/auth/refresh': async () => {
        await held
        return json({ accessToken: 'tok', user: { id: 'u1' } })
      },
      'GET /api/v1/workspaces': { items: [] },
    })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <Link to="/setup">elsewhere</Link>
        <Routes>
          <Route element={<RequireSession />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Where />} />
              <Route path="/setup" element={<Where />} />
            </Route>
          </Route>
        </Routes>
      </>,
      { route: '/' },
    )
    await user.keyboard(CTRL_K)
    await user.click(screen.getByRole('link', { name: 'elsewhere' }))
    await act(async () => release())
    await screen.findByRole('button', { name: 'Toggle sidebar' })
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    expect(useUiStore.getState().paletteRequested).toBe(false)
  })
})
