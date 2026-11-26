import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { NotificationSettingsPage } from './NotificationSettingsPage'

const kinds = [
  { kind: 'ASSIGNED', inApp: true, emailDigest: true },
  { kind: 'STATUS_CHANGED', inApp: true, emailDigest: false },
]

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/w/:workspaceId/settings/notifications" element={<NotificationSettingsPage />} />
    </Routes>,
    { route: '/w/w1/settings/notifications' },
  )
}

describe('CAP-13 notification settings', () => {
  it('shows In app and Email digest switches per kind and keeps a change after reload', async () => {
    let state = kinds
    const stub = installFetch({
      'GET /api/v1/workspaces/:id/notification-preferences': () => json({ kinds: state }),
      'PUT /api/v1/workspaces/:id/notification-preferences': (_r, body) => {
        const sent = (body as { kinds: typeof kinds }).kinds[0]
        state = state.map((k) => (k.kind === sent.kind ? sent : k))
        return json({ kinds: state })
      },
    })
    const user = userEvent.setup()
    const first = renderPage()
    const inApp = await screen.findByRole('switch', { name: 'Status changed: In app' })
    expect(inApp).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Status changed: Email digest' })).toBeVisible()
    await user.click(inApp)
    await waitFor(() => expect(stub.count('PUT', /notification-preferences$/)).toBe(1))
    expect(stub.calls.find((c) => c.method === 'PUT')!.body).toEqual({
      kinds: [{ kind: 'STATUS_CHANGED', inApp: false, emailDigest: false }],
    })
    first.unmount()
    renderPage()
    expect(await screen.findByRole('switch', { name: 'Status changed: In app' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('puts the switch back when the server refuses', async () => {
    installFetch({
      'GET /api/v1/workspaces/:id/notification-preferences': () => json({ kinds }),
      'PUT /api/v1/workspaces/:id/notification-preferences': () => problem(500, 'internal', 'Nope'),
    })
    const user = userEvent.setup()
    renderPage()
    const toggle = await screen.findByRole('switch', { name: 'Assigned to me: In app' })
    await user.click(toggle)
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Assigned to me: In app' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
  })

  it('9a-7: shows a loading status, then an error with Retry', async () => {
    let fail = true
    installFetch({
      'GET /api/v1/workspaces/:id/notification-preferences': () =>
        fail ? problem(500, 'internal', 'Prefs are down') : json({ kinds }),
    })
    const user = userEvent.setup()
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Prefs are down')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('switch', { name: 'Assigned to me: In app' })).toBeVisible()
  })

  it('9a-8: shows a loading status while the settings load, and an empty state without kinds', async () => {
    installFetch({
      'GET /api/v1/workspaces/:id/notification-preferences': () => new Promise<Response>(() => {}),
    })
    const first = renderPage()
    expect(
      await screen.findByRole('status', { name: 'Loading notification settings' }),
    ).toBeVisible()
    first.unmount()
    installFetch({
      'GET /api/v1/workspaces/:id/notification-preferences': () => json({ kinds: [] }),
    })
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'No notification events yet.' }),
    ).toBeVisible()
  })

  it('9a-9: a switch toggles with the keyboard (the library Switch)', async () => {
    const stub = installFetch({
      'GET /api/v1/workspaces/:id/notification-preferences': () => json({ kinds }),
      'PUT /api/v1/workspaces/:id/notification-preferences': () => json({ kinds }),
    })
    const user = userEvent.setup()
    renderPage()
    const toggle = await screen.findByRole('switch', { name: 'Assigned to me: Email digest' })
    toggle.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(stub.count('PUT', /notification-preferences$/)).toBe(1))
    expect(stub.calls.find((c) => c.method === 'PUT')!.body).toEqual({
      kinds: [{ kind: 'ASSIGNED', inApp: true, emailDigest: false }],
    })
  })
})
