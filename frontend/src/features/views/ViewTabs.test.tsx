import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ViewDto } from '../../api/types'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { members } from './testSupport'
import { ViewTabs } from './ViewTabs'
import { pick } from '../../test/ui'

const scope = { workspaceId: 'w1', locationId: 'l1' }
const defaults: ViewDto[] = [
  { defaultKind: 'LIST', name: 'List', type: 'LIST', config: { v: 1, group: 'status' } },
  { defaultKind: 'BOARD', name: 'Board', type: 'BOARD', config: { v: 1, group: 'status' } },
  { id: 'v1', name: 'Urgent bugs', type: 'TABLE', visibility: 'SHARED', config: { v: 1 } },
]

describe('VIEW-2 view tabs', () => {
  it('shows List and Board first, then saved views, and "+ View"', () => {
    installFetch({ 'GET /api/v1/workspaces/:id/members': members })
    renderWithProviders(
      <ViewTabs
        scope={scope}
        views={defaults}
        current={defaults[0]}
        config={{ v: 1 }}
        dirty={false}
        clearParams={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'List',
      'Board',
      'Urgent bugs',
    ])
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '+ View' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save view' })).not.toBeInTheDocument()
  })

  it('saving a Default view posts its defaultKind and clears the URL parameters', async () => {
    const stub = installFetch({
      'GET /api/v1/workspaces/:id/members': members,
      'POST /api/v1/views': (_r: Request, body: unknown) =>
        json({ id: 'new', ...(body as object) }, 201),
      'GET /api/v1/locations/:id/views': { items: defaults },
    })
    const clearParams = vi.fn()
    const user = userEvent.setup()
    const config = { v: 1, group: 'priority' }
    renderWithProviders(
      <ViewTabs
        scope={scope}
        views={defaults}
        current={defaults[1]}
        config={config}
        dirty
        clearParams={clearParams}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Save view' }))

    await waitFor(() => expect(clearParams).toHaveBeenCalled())
    const post = stub.calls.find((c) => c.method === 'POST' && c.url.pathname === '/api/v1/views')!
    expect(post.body).toMatchObject({
      locationId: 'l1',
      type: 'BOARD',
      defaultKind: 'BOARD',
      config,
    })
  })

  it('saving a stored view patches its config; Save as new creates one with a name and visibility', async () => {
    const stub = installFetch({
      'GET /api/v1/workspaces/:id/members': members,
      'PATCH /api/v1/views/:id': (_r: Request, body: unknown) =>
        json({ ...defaults[2], ...(body as object) }),
      'POST /api/v1/views': (_r: Request, body: unknown) =>
        json({ id: 'v2', ...(body as object) }, 201),
      'GET /api/v1/locations/:id/views': { items: defaults },
    })
    const clearParams = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ViewTabs
        scope={scope}
        views={defaults}
        current={defaults[2]}
        config={{ v: 1, group: 'assignee' }}
        dirty
        clearParams={clearParams}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Save view' }))
    await waitFor(() => expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(stub.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      config: { v: 1, group: 'assignee' },
    })

    await user.click(screen.getByRole('button', { name: 'Save as new' }))
    await user.type(screen.getByLabelText('View name'), 'Mine')
    await pick(user, screen.getByLabelText('Who can see it'), 'Only me')
    await user.click(screen.getByRole('button', { name: 'Create view' }))
    await waitFor(() => expect(stub.calls.some((c) => c.method === 'POST')).toBe(true))
    expect(stub.calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Mine',
      type: 'TABLE',
      visibility: 'PERSONAL',
      locationId: 'l1',
    })
  })
})
