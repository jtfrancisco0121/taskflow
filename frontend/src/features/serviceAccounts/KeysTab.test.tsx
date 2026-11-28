import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { expectValue } from '../../test/ui'
import { KeysTab } from './KeysTab'

const BASE = '/api/v1/workspaces/:id/service-accounts/:id'
const SECRET = 'tf_sk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa1b2'
const key = (extra = {}) => ({
  id: 'k1',
  name: 'CI-1',
  prefix: 'tf_sk_',
  last4: 'a1b2',
  status: 'ACTIVE',
  createdAt: '2026-11-01T10:00:00Z',
  ...extra,
})

describe('KeysTab', () => {
  it('KEY-1: shows the MCP URL, and the keys with prefix, last four and a text status', async () => {
    installFetch({
      [`GET ${BASE}/api-keys`]: [key(), key({ id: 'k2', name: 'old', status: 'REVOKED' })],
    })
    renderWithProviders(<KeysTab workspaceId="w1" accountId="sa1" />)
    expect(screen.getByText(`${window.location.origin}/api/v1/mcp`)).toBeVisible()
    expect(screen.getByText('Send the key in the Authorization header.')).toBeVisible()
    const table = await screen.findByRole('table', { name: 'API keys' })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getByText('tf_sk_…a1b2')).toBeVisible()
    expect(within(rows[1]).getByText('Active')).toBeVisible()
    expect(within(rows[2]).getByText('Revoked')).toBeVisible()
    expect(within(rows[2]).queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument()
  })

  it('KEY-1: creating a key shows the secret once; Escape does nothing and the button closes it', async () => {
    const user = userEvent.setup()
    let created = false
    const stub = installFetch({
      [`GET ${BASE}/api-keys`]: () => json(created ? [key()] : []),
      [`POST ${BASE}/api-keys`]: () => {
        created = true
        return json({ key: key(), secret: SECRET }, 201)
      },
    })
    const { queryClient } = renderWithProviders(<KeysTab workspaceId="w1" accountId="sa1" />)
    expect(await screen.findByRole('heading', { name: 'No keys yet' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    const create = screen.getByRole('dialog', { name: 'Create key' })
    await user.type(within(create).getByLabelText('Name'), 'CI-1')
    expectValue(within(create).getByLabelText('Expires'), '90 days')
    await user.click(within(create).getByRole('button', { name: 'Create key' }))

    const dialog = await screen.findByRole('dialog', { name: 'Key CI-1 created' })
    const body = stub.calls.find((c) => c.method === 'POST')!.body as { expiresAt?: string }
    expect(body.expiresAt).toBeTruthy()
    expect(within(dialog).getByText(SECRET)).toBeVisible()
    expect(
      within(dialog).getByText(
        'This key will not be shown again. Copy it now and store it in a secret manager.',
      ),
    ).toBeVisible()

    // Escape and a click on the backdrop do not close it
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Key CI-1 created' })).toBeVisible()
    await user.click(document.body)
    expect(screen.getByRole('dialog', { name: 'Key CI-1 created' })).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'I have copied the key' }))
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument())
    // the secret is not in the query cache, and the table shows only prefix and last four
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(SECRET)
    expect(await screen.findByText('tf_sk_…a1b2')).toBeVisible()
  })

  it('KEY-1: Copy writes the secret to the clipboard and announces "Key copied"', async () => {
    const user = userEvent.setup()
    installFetch({
      [`GET ${BASE}/api-keys`]: [],
      [`POST ${BASE}/api-keys`]: json({ key: key(), secret: SECRET }, 201),
    })
    renderWithProviders(<KeysTab workspaceId="w1" accountId="sa1" />)
    await user.click(await screen.findByRole('button', { name: 'Create key' }))
    const create = screen.getByRole('dialog')
    await user.type(within(create).getByLabelText('Name'), 'CI-1')
    await user.click(within(create).getByRole('button', { name: 'Create key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Key CI-1 created' })
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(within(dialog).getByText('Key copied')).toBeVisible())
    expect(within(dialog).getByText('Key copied').closest('[aria-live]')).toHaveAttribute(
      'aria-live',
      'polite',
    )
    expect(await navigator.clipboard.readText()).toBe(SECRET)
  })

  it('KEY-1: a past expiry shows the problem under the field', async () => {
    const user = userEvent.setup()
    installFetch({
      [`GET ${BASE}/api-keys`]: [],
      [`POST ${BASE}/api-keys`]: problem(
        422,
        'api_key.expiry_in_past',
        'The expiry is in the past',
      ),
    })
    renderWithProviders(<KeysTab workspaceId="w1" accountId="sa1" />)
    await user.click(await screen.findByRole('button', { name: 'Create key' }))
    const create = screen.getByRole('dialog')
    await user.type(within(create).getByLabelText('Name'), 'CI-1')
    await user.click(within(create).getByRole('button', { name: 'Create key' }))
    expect(await within(create).findByText('The expiry is in the past')).toBeVisible()
  })

  it('KEY-4: Revoke opens a confirm with Cancel focused and then marks the key Revoked', async () => {
    const user = userEvent.setup()
    let revoked = false
    const stub = installFetch({
      [`GET ${BASE}/api-keys`]: () => json([key({ status: revoked ? 'REVOKED' : 'ACTIVE' })]),
      [`DELETE ${BASE}/api-keys/:id`]: () => {
        revoked = true
        return new Response(null, { status: 204 })
      },
    })
    renderWithProviders(<KeysTab workspaceId="w1" accountId="sa1" />)
    await user.click(await screen.findByRole('button', { name: 'Revoke key CI-1' }))
    const dialog = screen.getByRole('dialog', { name: 'Revoke key' })
    expect(
      within(dialog).getByText(
        'Revoke key CI-1? Agents using it stop working immediately. This cannot be undone.',
      ),
    ).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(stub.count('DELETE', /api-keys/)).toBe(0)
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    expect(await screen.findByText('Revoked')).toBeVisible()
  })
})
