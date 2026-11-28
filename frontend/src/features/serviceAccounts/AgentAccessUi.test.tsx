import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { AuditTab } from './AuditTab'
import { KeysTab } from './KeysTab'
import { ServiceAccountDetailPage } from './ServiceAccountDetailPage'
import { ServiceAccountsPage } from './ServiceAccountsPage'

// Slice 9c: agent access on tokens, with loading, empty and error states, the MCP setup panel and the one-time key.
const WS = 'w1'
const LIST = `/w/${WS}/settings/service-accounts`
const PATTERN = '/w/:workspaceId/settings/service-accounts'
const SA = '/api/v1/workspaces/:id/service-accounts'
const ONE = `${SA}/:id`
const SECRET = 'tf_sk_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBc3d4'
const never = () => new Promise<Response>(() => {})

const account = (extra = {}) => ({
  id: 'sa1',
  name: 'triage-agent',
  disabled: false,
  activeKeys: 1,
  createdAt: '2026-11-01T10:00:00Z',
  ...extra,
})
const key = (extra = {}) => ({
  id: 'k1',
  name: 'CI-1',
  prefix: 'tf_sk_',
  last4: 'c3d4',
  status: 'ACTIVE',
  createdAt: '2026-11-01T10:00:00Z',
  ...extra,
})
const noCalls = { totalCalls: 0, days: [], keys: [] }

function renderList() {
  return renderWithProviders(
    <Routes>
      <Route path={PATTERN} element={<ServiceAccountsPage />} />
    </Routes>,
    { route: LIST },
  )
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path={`${PATTERN}/:serviceAccountId`} element={<ServiceAccountDetailPage />} />
    </Routes>,
    { route: `${LIST}/sa1` },
  )
}

/** Every place a browser could keep the secret after the dialog: storage and the TanStack caches. */
function persisted(queryClient: ReturnType<typeof renderWithProviders>['queryClient']): string {
  const stores = [localStorage, sessionStorage].map((s) =>
    Object.keys(s)
      .map((k) => `${k}=${s.getItem(k)}`)
      .join(';'),
  )
  const queries = queryClient
    .getQueryCache()
    .getAll()
    .map((q) => q.state.data)
  const mutations = queryClient
    .getMutationCache()
    .getAll()
    .map((m) => m.state.data)
  return JSON.stringify([stores, queries, mutations])
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('slice 9c agent access', () => {
  it('9c-1: the accounts list shows skeletons while loading, an empty state, and an error with Retry', async () => {
    installFetch({ [`GET ${SA}`]: never })
    const first = renderList()
    const loading = screen.getByRole('status', { name: 'Loading service accounts' })
    expect(loading.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    first.unmount()

    installFetch({ [`GET ${SA}`]: { items: [] } })
    const empty = renderList()
    expect(await screen.findByRole('heading', { name: 'No service accounts yet' })).toBeVisible()
    expect(screen.getByText('Create one to give an agent its own access.')).toBeVisible()
    empty.unmount()

    let fail = true
    installFetch({
      [`GET ${SA}`]: () =>
        fail ? problem(500, 'internal', 'Accounts are down') : json({ items: [account()] }),
    })
    const user = userEvent.setup()
    renderList()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Accounts are down')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'triage-agent' })).toBeVisible()
  })

  it('9c-2: the account page shows skeletons while loading, then a failed load offers Retry', async () => {
    installFetch({ [`GET ${ONE}`]: never })
    const first = renderDetail()
    const loading = screen.getByRole('status', { name: 'Loading service account' })
    expect(loading.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    first.unmount()

    let fail = true
    installFetch({
      [`GET ${ONE}`]: () => (fail ? problem(500, 'internal', 'Account is down') : json(account())),
      [`GET ${ONE}/api-keys`]: [],
    })
    const user = userEvent.setup()
    renderDetail()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Account is down')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'triage-agent', level: 1 })).toBeVisible()
  })

  it('9c-3: the Keys and Audit tabs follow the arrow keys, Home and End, with one tab stop', async () => {
    installFetch({
      [`GET ${ONE}`]: account(),
      [`GET ${ONE}/api-keys`]: [],
      [`GET ${ONE}/audit`]: noCalls,
      [`GET ${ONE}/activity`]: { items: [] },
    })
    const user = userEvent.setup()
    renderDetail()
    const keys = await screen.findByRole('tab', { name: 'Keys' })
    const audit = screen.getByRole('tab', { name: 'Audit' })
    expect(keys).toHaveAttribute('tabindex', '0')
    expect(audit).toHaveAttribute('tabindex', '-1')
    keys.focus()
    await user.keyboard('{ArrowRight}')
    expect(audit).toHaveFocus()
    expect(audit).toHaveAttribute('aria-selected', 'true')
    expect(audit).toHaveAttribute('tabindex', '0')
    expect(await screen.findByRole('tabpanel', { name: 'Audit' })).toBeVisible()
    await user.keyboard('{ArrowRight}')
    expect(keys).toHaveFocus()
    await user.keyboard('{End}')
    expect(audit).toHaveFocus()
    await user.keyboard('{Home}')
    expect(keys).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(audit).toHaveFocus()
    expect(keys).toHaveAttribute('aria-selected', 'false')
  })

  it('9c-4: the keys tab shows skeletons while loading, an empty state, and an error with Retry', async () => {
    installFetch({ [`GET ${ONE}/api-keys`]: never })
    const first = renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    const loading = screen.getByRole('status', { name: 'Loading keys' })
    expect(loading.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    first.unmount()

    installFetch({ [`GET ${ONE}/api-keys`]: [] })
    const empty = renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    expect(await screen.findByRole('heading', { name: 'No keys yet' })).toBeVisible()
    expect(screen.getByText('Create one to connect an agent.')).toBeVisible()
    empty.unmount()

    let fail = true
    installFetch({
      [`GET ${ONE}/api-keys`]: () =>
        fail ? problem(500, 'internal', 'Keys are down') : json([key()]),
    })
    const user = userEvent.setup()
    renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Keys are down')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('tf_sk_…c3d4')).toBeVisible()
  })

  it('9c-5: MCP setup shows the URL, transport and header, and copies the URL (never a key)', async () => {
    installFetch({ [`GET ${ONE}/api-keys`]: [key()] })
    const user = userEvent.setup()
    renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    const setup = screen.getByRole('region', { name: 'MCP setup' })
    const url = `${window.location.origin}/api/v1/mcp`
    expect(within(setup).getByText(url)).toBeVisible()
    expect(within(setup).getByText('Streamable HTTP')).toBeVisible()
    expect(within(setup).getByText('Authorization: Bearer <key>')).toBeVisible()
    await user.click(within(setup).getByRole('button', { name: 'Copy MCP URL' }))
    expect(await navigator.clipboard.readText()).toBe(url)
    await waitFor(() => expect(within(setup).getByText('URL copied')).toBeVisible())
    expect(within(setup).getByText('URL copied').closest('[aria-live]')).toHaveAttribute(
      'aria-live',
      'polite',
    )
    // the panel carries no key material at all, only the placeholder
    expect(setup.textContent).not.toMatch(/tf_sk_[A-Za-z0-9]/)
  })

  it('9c-6: a new key is shown once, masked in screenshots, never logged or kept in storage or caches', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level),
    )
    let created = false
    installFetch({
      [`GET ${ONE}/api-keys`]: () => json(created ? [key()] : []),
      [`POST ${ONE}/api-keys`]: () => {
        created = true
        return json({ key: key(), secret: SECRET }, 201)
      },
    })
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    await screen.findByRole('heading', { name: 'No keys yet' })
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    const create = screen.getByRole('dialog', { name: 'Create key' })
    await user.type(within(create).getByLabelText('Name'), 'CI-1')
    await user.click(within(create).getByRole('button', { name: 'Create key' }))

    const dialog = await screen.findByRole('dialog', { name: 'Key CI-1 created' })
    const shown = within(dialog).getByLabelText('API key')
    expect(shown).toHaveTextContent(SECRET)
    expect(shown).toHaveAttribute('data-secret')
    expect(screen.getAllByText(SECRET)).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'MCP setup' }).textContent).not.toContain(SECRET)
    expect(persisted(queryClient)).not.toContain(SECRET)

    await user.click(within(dialog).getByRole('button', { name: 'I have copied the key' }))
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument())
    expect(await screen.findByText('tf_sk_…c3d4')).toBeVisible()
    expect(document.body.innerHTML).not.toContain(SECRET)
    await waitFor(() => expect(persisted(queryClient)).not.toContain(SECRET))

    // opening Create key again starts blank: the old secret does not come back
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    expect(screen.getByRole('dialog', { name: 'Create key' })).toBeVisible()
    expect(document.body.innerHTML).not.toContain(SECRET)

    for (const spy of logs)
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET)

    // the e2e screenshots mask every element marked data-secret
    const shots = import.meta.glob('../../../e2e/screenshots.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    expect(Object.values(shots)[0]).toMatch(/mask: \[page\.locator\('[^']*\[data-secret\]/)
  })

  it('9c-6b: while the key is being created, Cancel and Escape cannot close the dialog', async () => {
    let answer: (r: Response) => void = () => {}
    installFetch({
      [`GET ${ONE}/api-keys`]: () => json([]),
      [`POST ${ONE}/api-keys`]: () => new Promise<Response>((resolve) => (answer = resolve)),
    })
    const user = userEvent.setup()
    renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    await screen.findByRole('heading', { name: 'No keys yet' })
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    const create = screen.getByRole('dialog', { name: 'Create key' })
    await user.type(within(create).getByLabelText('Name'), 'CI-1')
    await user.click(within(create).getByRole('button', { name: 'Create key' }))
    expect(await within(create).findByRole('button', { name: 'Creating…' })).toBeDisabled()
    expect(within(create).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Create key' })).toBeVisible()
    answer(json({ key: key(), secret: SECRET }, 201))
    const shown = await screen.findByRole('dialog', { name: 'Key CI-1 created' })
    expect(within(shown).getByLabelText('API key')).toHaveTextContent(SECRET)
  })

  it('9c-6c: a key whose dialog unmounts mid-request is revoked and the user is told, without the secret', async () => {
    useToastStore.setState({ toasts: [] })
    let answer: (r: Response) => void = () => {}
    const stub = installFetch({
      [`GET ${ONE}/api-keys`]: () => json([]),
      [`POST ${ONE}/api-keys`]: () => new Promise<Response>((resolve) => (answer = resolve)),
      [`DELETE ${ONE}/api-keys/:id`]: () => new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    await screen.findByRole('heading', { name: 'No keys yet' })
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    const create = screen.getByRole('dialog', { name: 'Create key' })
    await user.type(within(create).getByLabelText('Name'), 'CI-1')
    await user.click(within(create).getByRole('button', { name: 'Create key' }))
    await within(create).findByRole('button', { name: 'Creating…' })
    unmount()
    answer(json({ key: key(), secret: SECRET }, 201))
    await waitFor(() => expect(stub.count('DELETE', /api-keys\/k1$/)).toBe(1))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Key CI-1 was created while its window was closing, so it was revoked. Create a new key.',
      ),
    )
    expect(JSON.stringify(useToastStore.getState().toasts)).not.toContain(SECRET)
  })

  it('9c-6d: a create that fails after the dialog unmounts revokes nothing', async () => {
    useToastStore.setState({ toasts: [] })
    let answer: (r: Response) => void = () => {}
    const stub = installFetch({
      [`GET ${ONE}/api-keys`]: () => json([]),
      [`POST ${ONE}/api-keys`]: () => new Promise<Response>((resolve) => (answer = resolve)),
    })
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    await screen.findByRole('heading', { name: 'No keys yet' })
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    const create = screen.getByRole('dialog', { name: 'Create key' })
    await user.type(within(create).getByLabelText('Name'), 'CI-1')
    await user.click(within(create).getByRole('button', { name: 'Create key' }))
    await within(create).findByRole('button', { name: 'Creating…' })
    unmount()
    answer(problem(500, 'internal', 'Nope'))
    await new Promise((r) => setTimeout(r, 50))
    expect(stub.count('DELETE', /api-keys/)).toBe(0)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('9c-7: a member who opens an account URL sees the 403 copy, no keys and no Create key', async () => {
    const stub = installFetch({
      [`GET ${ONE}`]: problem(403, 'auth.forbidden', 'Access denied'),
      [`GET ${ONE}/api-keys`]: [key()],
    })
    renderDetail()
    expect(
      await screen.findByText('Only Workspace owners and admins can manage service accounts.'),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create key' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'MCP setup' })).not.toBeInTheDocument()
    expect(screen.queryByText('tf_sk_…c3d4')).not.toBeInTheDocument()
    expect(stub.count('GET', /api-keys/)).toBe(0)
    expect(stub.count('POST', /api-keys/)).toBe(0)
  })

  it('9c-8: the audit tab shows skeletons, empty states, and errors with Retry for calls and changes', async () => {
    installFetch({ [`GET ${ONE}/audit`]: never, [`GET ${ONE}/activity`]: never })
    const first = renderWithProviders(<AuditTab workspaceId={WS} accountId="sa1" />)
    for (const name of ['Loading calls', 'Loading changes']) {
      const loading = screen.getByRole('status', { name })
      expect(loading.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    }
    first.unmount()

    installFetch({ [`GET ${ONE}/audit`]: noCalls, [`GET ${ONE}/activity`]: { items: [] } })
    const empty = renderWithProviders(<AuditTab workspaceId={WS} accountId="sa1" />)
    expect(
      await screen.findByRole('heading', { name: 'No calls in the last 30 days' }),
    ).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'No changes yet' })).toBeVisible()
    empty.unmount()

    let fail = true
    installFetch({
      [`GET ${ONE}/audit`]: () =>
        fail ? problem(500, 'internal', 'Audit is down') : json(noCalls),
      [`GET ${ONE}/activity`]: () =>
        fail ? problem(500, 'internal', 'Changes are down') : json({ items: [] }),
    })
    const user = userEvent.setup()
    renderWithProviders(<AuditTab workspaceId={WS} accountId="sa1" />)
    const alerts = await screen.findAllByRole('alert')
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(alerts[0]).toHaveTextContent('Audit is down')
    fail = false
    for (const alert of screen.getAllByRole('alert'))
      await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('heading', { name: 'No calls in the last 30 days' }),
    ).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'No changes yet' })).toBeVisible()
  })

  it('9c-9: Escape cancels the revoke confirm without a request; Enter on Revoke revokes', async () => {
    let revoked = false
    const stub = installFetch({
      [`GET ${ONE}/api-keys`]: () => json([key({ status: revoked ? 'REVOKED' : 'ACTIVE' })]),
      [`DELETE ${ONE}/api-keys/:id`]: () => {
        revoked = true
        return new Response(null, { status: 204 })
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<KeysTab workspaceId={WS} accountId="sa1" />)
    const open = await screen.findByRole('button', { name: 'Revoke key CI-1' })
    open.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Revoke key' })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Revoke key' })).not.toBeInTheDocument(),
    )
    expect(stub.count('DELETE', /api-keys/)).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Revoke key CI-1' }))
    const dialog = screen.getByRole('dialog', { name: 'Revoke key' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Revoke' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Revoked')).toBeVisible()
    expect(stub.count('DELETE', /api-keys/)).toBe(1)
  })
})
