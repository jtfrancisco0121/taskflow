import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { ServiceAccountDetailPage } from './ServiceAccountDetailPage'
import { ServiceAccountsLink } from './ServiceAccountsLink'
import { ServiceAccountsPage } from './ServiceAccountsPage'

const WS = 'w1'
const LIST = `/w/${WS}/settings/service-accounts`
const PATTERN = '/w/:workspaceId/settings/service-accounts'
const BASE = '/api/v1/workspaces/:id/service-accounts'

const account = (extra = {}) => ({
  id: 'sa1',
  name: 'triage-agent',
  disabled: false,
  activeKeys: 1,
  createdAt: '2026-11-01T10:00:00Z',
  ...extra,
})

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path={PATTERN} element={<ServiceAccountsPage />} />
      <Route path={`${PATTERN}/:serviceAccountId`} element={<ServiceAccountDetailPage />} />
    </Routes>,
    { route: LIST },
  )
}

describe('ServiceAccountsPage', () => {
  it('FR-1: shows a loading state, then the empty copy and the create button', async () => {
    installFetch({ [`GET ${BASE}`]: { items: [] } })
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading service accounts' })).toBeVisible()
    expect(
      await screen.findByText(
        'No service accounts yet. Create one to give an agent its own access.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create service account' })).toBeVisible()
  })

  it('FR-1: lists accounts with status, keys and a Disabled pill', async () => {
    installFetch({
      [`GET ${BASE}`]: {
        items: [account(), account({ id: 'sa2', name: 'old-bot', disabled: true, activeKeys: 0 })],
      },
    })
    renderPage()
    const table = await screen.findByRole('table', { name: 'Service accounts' })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getByRole('link', { name: 'triage-agent' })).toBeVisible()
    expect(within(rows[2]).getByText('Disabled')).toBeVisible()
    expect(within(rows[2]).getByRole('button', { name: 'Enable old-bot' })).toBeVisible()
  })

  it('shows the problem and a Retry on an error', async () => {
    installFetch({ [`GET ${BASE}`]: problem(500, 'internal', 'Something broke') })
    renderPage()
    expect(await screen.findByText('Something broke')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })

  it('FR-1: a member who opens the URL sees the 403 copy', async () => {
    installFetch({ [`GET ${BASE}`]: problem(403, 'auth.forbidden', 'Access denied') })
    renderPage()
    expect(
      await screen.findByText('Only Workspace owners and admins can manage service accounts.'),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create service account' })).not.toBeInTheDocument()
  })

  it('FR-1: a duplicate name shows the field error and keeps the dialog open', async () => {
    const user = userEvent.setup()
    installFetch({
      [`GET ${BASE}`]: { items: [] },
      [`POST ${BASE}`]: problem(409, 'service_account.name_taken', 'name taken'),
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Create service account' }))
    const dialog = screen.getByRole('dialog', { name: 'Create service account' })
    await user.type(within(dialog).getByLabelText('Name'), 'triage-agent')
    await user.click(within(dialog).getByRole('button', { name: 'Create service account' }))
    expect(
      await within(dialog).findByText('A service account with this name already exists'),
    ).toBeVisible()
    expect(dialog).toBeVisible()
  })

  it('FR-1: creating opens the new account detail page', async () => {
    const user = userEvent.setup()
    installFetch({
      [`GET ${BASE}`]: { items: [] },
      [`POST ${BASE}`]: json(account({ id: 'sa9' }), 201),
      [`GET ${BASE}/:id`]: account({ id: 'sa9' }),
      [`GET ${BASE}/:id/api-keys`]: [],
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Create service account' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'triage-agent')
    await user.click(within(dialog).getByRole('button', { name: 'Create service account' }))
    expect(await screen.findByRole('heading', { name: 'triage-agent' })).toBeVisible()
    expect(await screen.findByText('No keys. Create one to connect an agent.')).toBeVisible()
  })

  it('FR-3: Disable opens a confirm with Cancel focused, then shows Disabled', async () => {
    const user = userEvent.setup()
    let disabled = false
    const stub = installFetch({
      [`GET ${BASE}`]: () => json({ items: [account({ disabled })] }),
      [`POST ${BASE}/:id/disable`]: () => {
        disabled = true
        return json(account({ disabled: true }))
      },
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Disable triage-agent' }))
    const dialog = screen.getByRole('dialog', { name: 'Disable service account' })
    expect(
      within(dialog).getByText(
        'Disable triage-agent? All its keys stop working until you enable it again.',
      ),
    ).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(stub.count('POST', /disable$/)).toBe(0)
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }))
    expect(await screen.findByText('Disabled')).toBeVisible()
  })

  it('FR-3: the detail page of a disabled account shows the banner and Enable', async () => {
    installFetch({
      [`GET ${BASE}/:id`]: account({ disabled: true }),
      [`GET ${BASE}/:id/api-keys`]: [],
    })
    renderWithProviders(
      <Routes>
        <Route path={`${PATTERN}/:serviceAccountId`} element={<ServiceAccountDetailPage />} />
      </Routes>,
      { route: `${LIST}/sa1` },
    )
    expect(await screen.findByText('Disabled: its keys do not work')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Enable' }).length).toBeGreaterThan(0)
  })
})

describe('ServiceAccountsLink', () => {
  const workspaces = (role: string) => ({ items: [{ id: WS, name: 'Acme', key: 'AC', role }] })

  it('FR-1: owners and admins see Settings, members and guests do not', async () => {
    for (const role of ['OWNER', 'ADMIN']) {
      installFetch({ 'GET /api/v1/workspaces': workspaces(role) })
      const { unmount } = renderWithProviders(<ServiceAccountsLink workspaceId={WS} />)
      expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute('href', LIST)
      unmount()
    }
    for (const role of ['MEMBER', 'GUEST']) {
      const stub = installFetch({ 'GET /api/v1/workspaces': workspaces(role) })
      const { unmount } = renderWithProviders(<ServiceAccountsLink workspaceId={WS} />)
      await waitFor(() => expect(stub.count('GET', /workspaces$/)).toBe(1))
      expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
      unmount()
    }
  })
})
